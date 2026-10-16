import { describe, expect, it } from 'vitest'

import { COLLECTIBLE_ANCHORS, createProgressSegments, quadraticBezierPoint, resolutionPath, trailSamples } from './cinematicGeometry'
import { trialRadius } from './stimulusGeometry'

describe('cinematic geometry', () => {
  it('keeps decorative collectibles outside the scored envelope and exclusion margin', () => {
    const maximumScoredRadius = trialRadius(0.82)
    for (const anchor of COLLECTIBLE_ANCHORS) {
      const distance = Math.hypot(anchor.x - 800, anchor.y - 420)
      expect(distance).toBeGreaterThanOrEqual(maximumScoredRadius + 70)
    }
  })

  it('builds a lifted flight arc from the chosen sector to fixation', () => {
    const path = resolutionPath(2)
    expect(path.start).toEqual({ x: 1135, y: 420 })
    expect(path.end).toEqual({ x: 800, y: 420 })
    expect(path.control.y).toBeLessThan(420)
    expect(quadraticBezierPoint(path, 0)).toEqual(path.start)
    expect(quadraticBezierPoint(path, 1)).toEqual(path.end)
  })

  it('uses a fixed trail pool and never samples outside the flight', () => {
    const path = resolutionPath(7)
    const samples = trailSamples(path, 0.74, 16)
    expect(samples).toHaveLength(16)
    for (const sample of samples) {
      expect(sample.progress).toBeGreaterThanOrEqual(0)
      expect(sample.progress).toBeLessThanOrEqual(0.74)
    }
  })

  it('marks completed, current, and upcoming progress without relying on color alone', () => {
    expect(createProgressSegments(0, 4).map((item) => item.state)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming'])
    expect(createProgressSegments(2, 4).map((item) => item.state)).toEqual(['complete', 'complete', 'current', 'upcoming'])
    expect(createProgressSegments(24, 24).every((item) => item.state === 'complete')).toBe(true)
  })
})
