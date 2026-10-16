export type ResolvedQualityTier = 'high' | 'medium' | 'low'

export interface QualityCapabilities {
  readonly devicePixelRatio: number
  readonly maxTextureSize: number
  readonly warmupP95Ms: number
  readonly reducedMotion: boolean
}

export function selectQualityTier(capabilities: QualityCapabilities): ResolvedQualityTier {
  if (capabilities.warmupP95Ms > 25 || capabilities.maxTextureSize < 4096) return 'low'
  if (capabilities.reducedMotion) return 'medium'
  if (capabilities.devicePixelRatio >= 2 && capabilities.maxTextureSize >= 8192 && capabilities.warmupP95Ms <= 18) return 'high'
  return 'medium'
}
