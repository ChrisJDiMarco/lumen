import type {
  CompletedTrial,
  DifficultyProfile,
  TrainingSession,
  Trial,
  TrialResult,
} from '../game/core/protocol'

export const CHECKPOINT_SCHEMA_VERSION = 1 as const

/**
 * A resumable session snapshot. The literal boundary deliberately excludes
 * transient settle, present, mask, and response UI state.
 */
export interface JourneyCheckpoint {
  readonly schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION
  readonly boundary: 'inter-trial'
  readonly savedAt: string
  readonly mode: 'practice' | 'journey'
  readonly completedTrials: number
  readonly targetTrials: number
  readonly session: TrainingSession
}

const checkpointKeys = new Set([
  'schemaVersion',
  'boundary',
  'savedAt',
  'mode',
  'completedTrials',
  'targetTrials',
  'session',
])

export function isJourneyCheckpoint(value: unknown): value is JourneyCheckpoint {
  if (!isRecord(value) || !hasOnlyKeys(value, checkpointKeys)) return false
  if (
    value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
    value.boundary !== 'inter-trial' ||
    !isIsoDate(value.savedAt) ||
    (value.mode !== 'practice' && value.mode !== 'journey') ||
    !isNonNegativeInteger(value.completedTrials) ||
    !isPositiveInteger(value.targetTrials) ||
    value.completedTrials >= value.targetTrials
  ) return false

  return isTrainingSession(value.session, value.completedTrials)
}

function isTrainingSession(value: unknown, completedCount: number): value is TrainingSession {
  if (!isRecord(value)) return false
  const completed = value.completedTrials
  const voided = value.voidedTrials
  if (
    typeof value.seed !== 'string' || value.seed.length === 0 ||
    typeof value.protocolVersion !== 'string' || value.protocolVersion.length === 0 ||
    !isUnitNumber(value.difficulty) ||
    !isDifficultyProfile(value.difficultyProfile) ||
    !isNonNegativeInteger(value.correctStreak) ||
    !isTrial(value.currentTrial) || value.currentTrial.id !== completedCount ||
    !Array.isArray(completed) || completed.length !== completedCount ||
    !Array.isArray(voided) ||
    !isUint32(value.rngState)
  ) return false

  if (!completed.every((entry, index) => isCompletedTrial(entry, index))) return false
  return voided.every((entry) => isVoidedTrial(entry, completedCount))
}

function isDifficultyProfile(value: unknown): value is DifficultyProfile {
  return isRecord(value) &&
    isUnitNumber(value.duration) &&
    isUnitNumber(value.eccentricity) &&
    isUnitNumber(value.distractors)
}

function isTrial(value: unknown): value is Trial {
  if (!isRecord(value)) return false
  const choices = value.centralChoices
  const distractors = value.distractorSectors
  if (
    !isNonNegativeInteger(value.id) ||
    !isGlyph(value.centralGlyph) ||
    !Array.isArray(choices) || choices.length !== 2 ||
    !isGlyph(choices[0]) || !isGlyph(choices[1]) || choices[0] === choices[1] ||
    !isNonNegativeInteger(value.sector) ||
    !isUnitNumber(value.eccentricity) ||
    !isPositiveInteger(value.durationMs) ||
    !Array.isArray(distractors) ||
    !distractors.every(isNonNegativeInteger)
  ) return false

  return new Set(distractors).size === distractors.length && !distractors.includes(value.sector)
}

function isTrialResult(value: unknown, expectedValid: boolean): value is TrialResult {
  if (!isRecord(value)) return false
  if (
    typeof value.centralCorrect !== 'boolean' ||
    typeof value.peripheralCorrect !== 'boolean' ||
    value.valid !== expectedValid ||
    !isNonNegativeNumber(value.responseMs)
  ) return false

  const optionalNumbers = [
    value.requestedPresentationMs,
    value.measuredPresentationMs,
    value.refreshEstimateMs,
  ]
  if (optionalNumbers.some((candidate) => candidate !== undefined && !isNonNegativeNumber(candidate))) {
    return false
  }
  if (value.invalidReason !== undefined && typeof value.invalidReason !== 'string') return false
  return value.inputType === undefined || ['pointer', 'keyboard', 'unknown'].includes(String(value.inputType))
}

function isCompletedTrial(value: unknown, expectedId: number): value is CompletedTrial {
  if (!isRecord(value) || !isTrial(value.trial) || value.trial.id !== expectedId) return false
  if (!isTrialResult(value.result, true) || typeof value.correct !== 'boolean') return false
  if (!isUnitNumber(value.difficultyBefore) || !isUnitNumber(value.difficultyAfter)) return false
  return value.correct === (value.result.centralCorrect && value.result.peripheralCorrect)
}

function isVoidedTrial(value: unknown, currentTrialId: number): boolean {
  return isRecord(value) &&
    isTrial(value.trial) && value.trial.id <= currentTrialId &&
    isTrialResult(value.result, false)
}

function isGlyph(value: unknown): value is Trial['centralGlyph'] {
  return value === 'leaf' || value === 'moth'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value))
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff
}
