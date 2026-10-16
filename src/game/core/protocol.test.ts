import { describe, expect, it } from 'vitest'

import {
  createSession,
  recordTrial,
  standardProtocol,
  type TrialResult,
} from './protocol'

const correctResult: TrialResult = {
  centralCorrect: true,
  peripheralCorrect: true,
  valid: true,
  responseMs: 620,
}

describe('deterministic training protocol', () => {
  it('generates the same trial sequence for the same seed', () => {
    const first = createSession('lumen-seed', standardProtocol)
    const second = createSession('lumen-seed', standardProtocol)

    expect(first.currentTrial).toEqual(second.currentTrial)

    const firstNext = recordTrial(first, correctResult)
    const secondNext = recordTrial(second, correctResult)
    expect(firstNext.currentTrial).toEqual(secondNext.currentTrial)
  })

  it('keeps every generated target inside protocol bounds', () => {
    let session = createSession('bounds', standardProtocol)

    for (let index = 0; index < 100; index += 1) {
      const trial = session.currentTrial
      expect(trial.sector).toBeGreaterThanOrEqual(0)
      expect(trial.sector).toBeLessThan(8)
      expect(trial.eccentricity).toBeGreaterThanOrEqual(standardProtocol.minEccentricity)
      expect(trial.eccentricity).toBeLessThanOrEqual(standardProtocol.maxEccentricity)
      expect(trial.durationMs).toBeGreaterThanOrEqual(standardProtocol.minDurationMs)
      expect(trial.durationMs).toBeLessThanOrEqual(standardProtocol.maxDurationMs)
      session = recordTrial(session, correctResult)
    }
  })

  it('increases difficulty after a correct run and steps back after errors', () => {
    let session = createSession('adapt', standardProtocol)
    const initialDifficulty = session.difficulty

    for (let index = 0; index < standardProtocol.warmupTrials + standardProtocol.correctResponsesToAdvance; index += 1) session = recordTrial(session, correctResult)
    expect(session.difficulty).toBeGreaterThan(initialDifficulty)

    const incorrect: TrialResult = {
      centralCorrect: false,
      peripheralCorrect: true,
      valid: true,
      responseMs: 900,
    }
    const beforeError = session.difficulty
    session = recordTrial(session, incorrect)
    expect(session.difficulty).toBeLessThan(beforeError)
  })

  it('holds difficulty steady during versioned warm-up trials', () => {
    let session = createSession('warmup', standardProtocol)
    const initialDifficulty = session.difficulty
    for (let index = 0; index < standardProtocol.warmupTrials; index += 1) session = recordTrial(session, correctResult)
    expect(session.difficulty).toBe(initialDifficulty)
    expect(session.correctStreak).toBe(0)
  })

  it('changes only one protocol dimension at each adaptation step', () => {
    let session = createSession('one-dimension', standardProtocol)
    for (let index = 0; index < standardProtocol.warmupTrials; index += 1) session = recordTrial(session, correctResult)
    const before = session.difficultyProfile
    for (let index = 0; index < standardProtocol.correctResponsesToAdvance; index += 1) session = recordTrial(session, correctResult)
    const changed = Object.keys(before).filter((key) => before[key as keyof typeof before] !== session.difficultyProfile[key as keyof typeof before])
    expect(changed).toHaveLength(1)
  })

  it('does not score or adapt an invalid trial', () => {
    const session = createSession('invalid', standardProtocol)
    const invalid = recordTrial(session, {
      ...correctResult,
      valid: false,
      invalidReason: 'visibility-change',
    })

    expect(invalid.difficulty).toBe(session.difficulty)
    expect(invalid.completedTrials).toHaveLength(0)
    expect(invalid.voidedTrials).toHaveLength(1)
    expect(invalid.voidedTrials[0]?.result.invalidReason).toBe('visibility-change')
    expect(invalid.currentTrial).toEqual(session.currentTrial)
  })

  it('requires both response components for a correct trial', () => {
    const session = recordTrial(createSession('components', standardProtocol), {
      ...correctResult,
      peripheralCorrect: false,
    })

    expect(session.completedTrials[0]?.correct).toBe(false)
    expect(session.correctStreak).toBe(0)
  })

  it('clamps adaptation at the configured difficulty bounds', () => {
    let upper = createSession('upper-bound', standardProtocol)
    for (let index = 0; index < 100; index += 1) upper = recordTrial(upper, correctResult)
    expect(upper.difficulty).toBe(standardProtocol.maxDifficulty)

    const incorrect: TrialResult = {
      centralCorrect: false,
      peripheralCorrect: false,
      valid: true,
      responseMs: 1_200,
    }
    let lower = upper
    for (let index = 0; index < 100; index += 1) lower = recordTrial(lower, incorrect)
    expect(lower.difficulty).toBe(standardProtocol.minDifficulty)
  })

  it('returns new immutable state without changing the previous session', () => {
    const previous = createSession('immutable', standardProtocol)
    const previousSnapshot = structuredClone(previous)

    const next = recordTrial(previous, correctResult)

    expect(previous).toEqual(previousSnapshot)
    expect(next).not.toBe(previous)
    expect(next.completedTrials).not.toBe(previous.completedTrials)
  })
})
