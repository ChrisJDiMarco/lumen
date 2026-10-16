export const gameAssetManifest = Object.freeze({
  version: 'lumen-assets-v2',
  scenery: [
    '/assets/generated/forest-background.png',
    '/assets/generated/forest-decor-transparent.png',
  ] as const,
})

export type GameAssetStatus = 'ready' | 'degraded'

export interface GameAssetLoadResult {
  readonly status: GameAssetStatus
  readonly loaded: readonly string[]
  readonly failed: readonly string[]
}

export interface GameAssetLoadOptions {
  readonly createImage?: () => HTMLImageElement
  readonly timeoutMs?: number
  readonly retryFailed?: boolean
}

const retainedImages = new Map<string, HTMLImageElement>()
let cachedResult: GameAssetLoadResult | null = null
let inFlight: Promise<GameAssetLoadResult> | null = null

export async function loadGameAssets(options: GameAssetLoadOptions = {}): Promise<GameAssetLoadResult> {
  if (options.retryFailed) clearGameAssetCache()
  if (cachedResult) return cachedResult
  if (inFlight) return inFlight

  const createImage = options.createImage ?? (() => new Image())
  const timeoutMs = options.timeoutMs ?? 8_000
  inFlight = Promise.all(gameAssetManifest.scenery.map(async (source) => {
    const image = createImage()
    try {
      await loadImage(image, source, timeoutMs)
      retainedImages.set(source, image)
      return { source, loaded: true as const }
    } catch {
      return { source, loaded: false as const }
    }
  })).then((assets) => {
    const loaded = assets.filter((asset) => asset.loaded).map((asset) => asset.source)
    const failed = assets.filter((asset) => !asset.loaded).map((asset) => asset.source)
    cachedResult = Object.freeze({
      status: failed.length === 0 ? 'ready' : 'degraded',
      loaded: Object.freeze(loaded),
      failed: Object.freeze(failed),
    })
    return cachedResult
  }).finally(() => {
    inFlight = null
  })

  return inFlight
}

/** Kept for callers that only need to await preflight completion. */
export async function preloadGameAssets(createImage: () => HTMLImageElement = () => new Image()): Promise<void> {
  await loadGameAssets({ createImage })
}

export function clearGameAssetCache(): void {
  retainedImages.clear()
  cachedResult = null
  inFlight = null
}

async function loadImage(image: HTMLImageElement, source: string, timeoutMs: number): Promise<void> {
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`Timed out loading ${source}`)), timeoutMs)
  })
  const decode = typeof image.decode === 'function'
    ? (image.src = source, image.decode())
    : new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error(`Could not load ${source}`))
        image.src = source
      })
  try {
    await Promise.race([decode, timeout])
  } finally {
    window.clearTimeout(timer)
    image.onload = null
    image.onerror = null
  }
}
