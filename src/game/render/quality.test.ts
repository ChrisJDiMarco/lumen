import { describe, expect, it } from 'vitest'

import { selectQualityTier } from './quality'

describe('selectQualityTier', () => {
  it('selects high only for a capable, stable display', () => {
    expect(selectQualityTier({ devicePixelRatio: 2, maxTextureSize: 8192, warmupP95Ms: 15, reducedMotion: false })).toBe('high')
  })

  it('uses medium for typical hardware and low for sustained slow frames', () => {
    expect(selectQualityTier({ devicePixelRatio: 1.5, maxTextureSize: 4096, warmupP95Ms: 19, reducedMotion: false })).toBe('medium')
    expect(selectQualityTier({ devicePixelRatio: 2, maxTextureSize: 8192, warmupP95Ms: 28, reducedMotion: false })).toBe('low')
  })

  it('keeps reduced motion on a restrained tier', () => {
    expect(selectQualityTier({ devicePixelRatio: 2, maxTextureSize: 8192, warmupP95Ms: 14, reducedMotion: true })).toBe('medium')
  })
})
