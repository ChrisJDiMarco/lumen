import { describe, expect, it } from 'vitest'

import { createSession, recordTrial, standardProtocol } from '../game/core/protocol'
import {
  CHECKPOINT_SCHEMA_VERSION,
  isJourneyCheckpoint,
  type JourneyCheckpoint,
} from './checkpoint'

function checkpoint(): JourneyCheckpoint {
  const initial = createSession('resume-seed', standardProtocol)
  const session = recordTrial(initial, {
    centralCorrect: true,
    peripheralCorrect: true,
    valid: true,
    responseMs: 410,
  })

  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    boundary: 'inter-trial',
    savedAt: '2026-07-13T16:00:00.000Z',
    mode: 'journey',
    completedTrials: 1,
    targetTrials: 24,
    session,
  }
}

describe('JourneyCheckpoint schema', () => {
  it('accepts a deterministic session saved between trials', () => {
    expect(isJourneyCheckpoint(checkpoint())).toBe(true)
  })

  it('rejects renderer phases so mid-presentation state cannot be resumed', () => {
    expect(isJourneyCheckpoint({ ...checkpoint(), phase: 'present' })).toBe(false)
    expect(isJourneyCheckpoint({ ...checkpoint(), boundary: 'presentation' })).toBe(false)
  })

  it('rejects trial metadata that disagrees with the embedded session', () => {
    expect(isJourneyCheckpoint({ ...checkpoint(), completedTrials: 0 })).toBe(false)
    expect(isJourneyCheckpoint({ ...checkpoint(), targetTrials: 1 })).toBe(false)
    expect(isJourneyCheckpoint({
      ...checkpoint(),
      session: { ...checkpoint().session, currentTrial: { ...checkpoint().session.currentTrial, id: 2 } },
    })).toBe(false)
  })

  it('rejects malformed nested trial data instead of trusting an outer version flag', () => {
    const malformed = structuredClone(checkpoint()) as unknown as {
      session: { currentTrial: { centralGlyph: string } }
    }
    malformed.session.currentTrial.centralGlyph = 'unknown'
    expect(isJourneyCheckpoint(malformed)).toBe(false)
  })
})
