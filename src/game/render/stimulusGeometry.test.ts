import { describe, expect, it } from 'vitest'

import { peripheralPoint, stimulusMaskSites, trialRadius } from './stimulusGeometry'

const trial = {
  id: 1,
  centralGlyph: 'leaf' as const,
  centralChoices: ['leaf', 'moth'] as const,
  sector: 2,
  eccentricity: 0.5,
  durationMs: 120,
  distractorSectors: [0, 5],
}

describe('stimulus geometry', () => {
  it('keeps eccentric targets inside the shared response annulus', () => {
    expect(trialRadius(0.34)).toBeGreaterThanOrEqual(240)
    expect(trialRadius(0.82)).toBeLessThanOrEqual(300)
  })

  it('places each sector around the fixation point', () => {
    expect(peripheralPoint(0, 270)).toEqual({ x: 800, y: 150 })
    expect(peripheralPoint(2, 270)).toEqual({ x: 1070, y: 420 })
    expect(peripheralPoint(4, 270)).toEqual({ x: 800, y: 690 })
  })

  it('masks the center, target, and every distractor site', () => {
    const sites = stimulusMaskSites(trial)
    expect(sites).toHaveLength(4)
    expect(sites[0]).toEqual({ x: 800, y: 420 })
    expect(new Set(sites.map(({ x, y }) => `${x}:${y}`)).size).toBe(4)
  })
})
