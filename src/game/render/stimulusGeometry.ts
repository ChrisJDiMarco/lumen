import type { Trial } from '../core/protocol'

const CENTER_X = 800
const CENTER_Y = 420

export interface StimulusPoint { readonly x: number; readonly y: number }

export function trialRadius(eccentricity: number): number {
  return 215 + 95 * eccentricity
}

export function peripheralPoint(sector: number, radius: number): StimulusPoint {
  const angle = sector * Math.PI / 4 - Math.PI / 2
  return {
    x: Math.round(CENTER_X + Math.cos(angle) * radius),
    y: Math.round(CENTER_Y + Math.sin(angle) * radius),
  }
}

export function stimulusMaskSites(trial: Trial): readonly StimulusPoint[] {
  const radius = trialRadius(trial.eccentricity)
  return [{ x: CENTER_X, y: CENTER_Y }, ...[trial.sector, ...trial.distractorSectors].map((sector) => peripheralPoint(sector, radius))]
}
