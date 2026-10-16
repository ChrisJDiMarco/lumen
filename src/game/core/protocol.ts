export type CentralGlyph = 'leaf' | 'moth'

export interface ProtocolConfig {
  readonly version: string
  readonly sectorCount: number
  readonly minEccentricity: number
  readonly maxEccentricity: number
  readonly minDurationMs: number
  readonly maxDurationMs: number
  readonly minDifficulty: number
  readonly maxDifficulty: number
  readonly initialDifficulty: number
  readonly difficultyStep: number
  readonly correctResponsesToAdvance: number
  readonly warmupTrials: number
  readonly maxDistractors: number
}

export interface Trial {
  readonly id: number
  readonly centralGlyph: CentralGlyph
  readonly centralChoices: readonly [CentralGlyph, CentralGlyph]
  readonly sector: number
  readonly eccentricity: number
  readonly durationMs: number
  readonly distractorSectors: readonly number[]
}

export interface TrialResult {
  readonly centralCorrect: boolean
  readonly peripheralCorrect: boolean
  readonly valid: boolean
  readonly responseMs: number
  readonly invalidReason?: string
  readonly requestedPresentationMs?: number
  readonly measuredPresentationMs?: number
  readonly refreshEstimateMs?: number
  readonly inputType?: 'pointer' | 'keyboard' | 'unknown'
}

export interface CompletedTrial {
  readonly trial: Trial
  readonly result: TrialResult
  readonly correct: boolean
  readonly difficultyBefore: number
  readonly difficultyAfter: number
}

export interface TrainingSession {
  readonly seed: string
  readonly protocolVersion: string
  readonly difficulty: number
  readonly difficultyProfile: DifficultyProfile
  readonly correctStreak: number
  readonly currentTrial: Trial
  readonly completedTrials: readonly CompletedTrial[]
  readonly voidedTrials: readonly { readonly trial: Trial; readonly result: TrialResult }[]
  readonly rngState: number
}

export interface DifficultyProfile {
  readonly duration: number
  readonly eccentricity: number
  readonly distractors: number
}

export const standardProtocol: ProtocolConfig = Object.freeze(standardProtocolContract)

export function createSession(seed: string, protocol: ProtocolConfig): TrainingSession {
  validateProtocol(protocol)
  const initialState = hashSeed(seed)
  const difficultyProfile: DifficultyProfile = {
    duration: protocol.initialDifficulty,
    eccentricity: protocol.initialDifficulty,
    distractors: protocol.initialDifficulty,
  }
  const generated = generateTrial(0, difficultyProfile, initialState, protocol)

  return {
    seed,
    protocolVersion: protocol.version,
    difficulty: protocol.initialDifficulty,
    difficultyProfile,
    correctStreak: 0,
    currentTrial: generated.trial,
    completedTrials: [],
    voidedTrials: [],
    rngState: generated.nextState,
  }
}

export function recordTrial(
  session: TrainingSession,
  result: TrialResult,
  protocol: ProtocolConfig = standardProtocol,
): TrainingSession {
  if (!result.valid) {
    return {
      ...session,
      voidedTrials: [...session.voidedTrials, { trial: session.currentTrial, result: { ...result } }],
    }
  }
  if (protocol.version !== session.protocolVersion) {
    throw new Error(
      `Protocol ${protocol.version} cannot continue session ${session.protocolVersion}`,
    )
  }

  const correct = result.centralCorrect && result.peripheralCorrect
  const adaptation = adaptDifficulty(session, correct, protocol)
  const completed: CompletedTrial = {
    trial: session.currentTrial,
    result: { ...result },
    correct,
    difficultyBefore: session.difficulty,
    difficultyAfter: adaptation.difficulty,
  }
  const generated = generateTrial(
    session.currentTrial.id + 1,
    adaptation.difficultyProfile,
    session.rngState,
    protocol,
  )

  return {
    ...session,
    difficulty: adaptation.difficulty,
    difficultyProfile: adaptation.difficultyProfile,
    correctStreak: adaptation.correctStreak,
    currentTrial: generated.trial,
    completedTrials: [...session.completedTrials, completed],
    rngState: generated.nextState,
  }
}

interface Adaptation {
  readonly difficulty: number
  readonly difficultyProfile: DifficultyProfile
  readonly correctStreak: number
}

function adaptDifficulty(
  session: TrainingSession,
  correct: boolean,
  protocol: ProtocolConfig,
): Adaptation {
  if (session.completedTrials.length < protocol.warmupTrials) {
    return { difficulty: session.difficulty, difficultyProfile: session.difficultyProfile, correctStreak: 0 }
  }
  const dimension = difficultyDimension(session.completedTrials.length)
  if (!correct) {
    const difficultyProfile = adjustDimension(session.difficultyProfile, dimension, -protocol.difficultyStep, protocol)
    return {
      difficulty: profileAverage(difficultyProfile),
      difficultyProfile,
      correctStreak: 0,
    }
  }

  const correctStreak = session.correctStreak + 1
  if (correctStreak < protocol.correctResponsesToAdvance) {
    return { difficulty: session.difficulty, difficultyProfile: session.difficultyProfile, correctStreak }
  }

  const difficultyProfile = adjustDimension(session.difficultyProfile, dimension, protocol.difficultyStep, protocol)
  return {
    difficulty: profileAverage(difficultyProfile),
    difficultyProfile,
    correctStreak: 0,
  }
}

function difficultyDimension(index: number): keyof DifficultyProfile {
  return (['duration', 'eccentricity', 'distractors'] as const)[index % 3]
}

function adjustDimension(profile: DifficultyProfile, dimension: keyof DifficultyProfile, change: number, protocol: ProtocolConfig): DifficultyProfile {
  return {
    ...profile,
    [dimension]: clampAndRound(profile[dimension] + change, protocol.minDifficulty, protocol.maxDifficulty),
  }
}

function profileAverage(profile: DifficultyProfile): number {
  return round((profile.duration + profile.eccentricity + profile.distractors) / 3, 10)
}

interface GeneratedTrial {
  readonly trial: Trial
  readonly nextState: number
}

function generateTrial(
  id: number,
  difficultyProfile: DifficultyProfile,
  initialState: number,
  protocol: ProtocolConfig,
): GeneratedTrial {
  let state = initialState
  const centralRoll = nextRandom(state)
  state = centralRoll.state
  const sectorRoll = nextRandom(state)
  state = sectorRoll.state

  const centralGlyph: CentralGlyph = centralRoll.value < 0.5 ? 'leaf' : 'moth'
  const sector = Math.floor(sectorRoll.value * protocol.sectorCount)
  const distractorCount = Math.min(
    protocol.maxDistractors,
    Math.floor(normalizeDifficulty(difficultyProfile.distractors, protocol) * (protocol.maxDistractors + 1)),
  )
  const candidates = Array.from({ length: protocol.sectorCount }, (_, candidate) => candidate).filter(
    (candidate) => candidate !== sector,
  )
  const distractorSectors: number[] = []

  for (let index = 0; index < distractorCount && candidates.length > 0; index += 1) {
    const roll = nextRandom(state)
    state = roll.state
    const candidateIndex = Math.floor(roll.value * candidates.length)
    const [candidate] = candidates.splice(candidateIndex, 1)
    if (candidate !== undefined) distractorSectors.push(candidate)
  }

  return {
    trial: {
      id,
      centralGlyph,
      centralChoices: centralRoll.value < 0.25 || centralRoll.value >= 0.75
        ? ['leaf', 'moth']
        : ['moth', 'leaf'],
      sector,
      eccentricity: round(
        lerp(protocol.minEccentricity, protocol.maxEccentricity, normalizeDifficulty(difficultyProfile.eccentricity, protocol)),
        4,
      ),
      durationMs: Math.round(
        lerp(protocol.maxDurationMs, protocol.minDurationMs, normalizeDifficulty(difficultyProfile.duration, protocol)),
      ),
      distractorSectors,
    },
    nextState: state,
  }
}

function normalizeDifficulty(difficulty: number, protocol: ProtocolConfig): number {
  return (difficulty - protocol.minDifficulty) / (protocol.maxDifficulty - protocol.minDifficulty)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function clampAndRound(value: number, minimum: number, maximum: number): number {
  return round(Math.min(maximum, Math.max(minimum, value)), 10)
}

function round(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function nextRandom(state: number): { readonly state: number; readonly value: number } {
  const nextState = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return { state: nextState, value: nextState / 0x1_0000_0000 }
}

function validateProtocol(protocol: ProtocolConfig): void {
  const finiteValues = [
    protocol.minEccentricity,
    protocol.maxEccentricity,
    protocol.minDurationMs,
    protocol.maxDurationMs,
    protocol.minDifficulty,
    protocol.maxDifficulty,
    protocol.initialDifficulty,
    protocol.difficultyStep,
  ]
  if (finiteValues.some((value) => !Number.isFinite(value))) {
    throw new RangeError('Protocol numeric values must be finite')
  }
  if (!Number.isInteger(protocol.sectorCount) || protocol.sectorCount < 2) {
    throw new RangeError('Protocol sectorCount must be an integer of at least 2')
  }
  if (protocol.minEccentricity < 0 || protocol.minEccentricity > protocol.maxEccentricity) {
    throw new RangeError('Protocol eccentricity bounds are invalid')
  }
  if (protocol.minDurationMs <= 0 || protocol.minDurationMs > protocol.maxDurationMs) {
    throw new RangeError('Protocol duration bounds are invalid')
  }
  if (protocol.minDifficulty >= protocol.maxDifficulty) {
    throw new RangeError('Protocol difficulty bounds are invalid')
  }
  if (
    protocol.initialDifficulty < protocol.minDifficulty ||
    protocol.initialDifficulty > protocol.maxDifficulty
  ) {
    throw new RangeError('Protocol initialDifficulty is outside its bounds')
  }
  if (protocol.difficultyStep <= 0) {
    throw new RangeError('Protocol difficultyStep must be positive')
  }
  if (
    !Number.isInteger(protocol.correctResponsesToAdvance) ||
    protocol.correctResponsesToAdvance < 1
  ) {
    throw new RangeError('Protocol correctResponsesToAdvance must be a positive integer')
  }
  if (!Number.isInteger(protocol.warmupTrials) || protocol.warmupTrials < 0) {
    throw new RangeError('Protocol warmupTrials must be a non-negative integer')
  }
  if (!Number.isInteger(protocol.maxDistractors) || protocol.maxDistractors < 0) {
    throw new RangeError('Protocol maxDistractors must be a non-negative integer')
  }
}
import standardProtocolContract from '../protocols/lumen-standard-v1.json'
