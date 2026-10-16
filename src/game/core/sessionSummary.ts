import type { TrainingSession } from './protocol'

export interface SessionSummary {
  readonly accuracy: number
  readonly averageResponseMs: number
  readonly presentationSpeedMs: number
  readonly consistency: number
  readonly completedTrials: number
  readonly voidedTrials: number
}

export function summarizeSession(session: TrainingSession): SessionSummary {
  const completedTrials = session.completedTrials.length
  if (completedTrials === 0) return { accuracy: 0, averageResponseMs: 0, presentationSpeedMs: session.currentTrial.durationMs, consistency: 0, completedTrials: 0, voidedTrials: session.voidedTrials.length }
  const responses = session.completedTrials.map(({ result }) => result.responseMs)
  const presentations = session.completedTrials.map(({ result, trial }) => result.measuredPresentationMs ?? trial.durationMs)
  const averageResponseMs = average(responses)
  const variance = average(responses.map((response) => (response - averageResponseMs) ** 2))
  return {
    accuracy: session.completedTrials.filter(({ correct }) => correct).length / completedTrials,
    averageResponseMs: Math.round(averageResponseMs),
    presentationSpeedMs: Math.round(average(presentations)),
    consistency: Math.round(Math.sqrt(variance)),
    completedTrials,
    voidedTrials: session.voidedTrials.length,
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
