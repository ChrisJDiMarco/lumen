import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearGameAssetCache, loadGameAssets } from './assets'

afterEach(() => {
  clearGameAssetCache()
  vi.useRealTimers()
})

describe('loadGameAssets', () => {
  it('decodes every scenery asset before reporting ready', async () => {
    const decoded: string[] = []
    const createImage = vi.fn(() => {
      const image = { src: '', decode: async () => { decoded.push(image.src) } }
      return image as unknown as HTMLImageElement
    })

    const result = await loadGameAssets({ createImage })

    expect(result.status).toBe('ready')
    expect(result.failed).toEqual([])
    expect(decoded).toEqual(expect.arrayContaining(['/assets/generated/forest-background.png', '/assets/generated/forest-decor-transparent.png']))
  })

  it('reports a playable degraded mode when decorative scenery is corrupt', async () => {
    const createImage = vi.fn(() => {
      const image = { src: '', decode: async () => {
        if (image.src.includes('decor-transparent')) throw new Error('corrupt image')
      } }
      return image as unknown as HTMLImageElement
    })

    const result = await loadGameAssets({ createImage })

    expect(result.status).toBe('degraded')
    expect(result.loaded).toEqual(['/assets/generated/forest-background.png'])
    expect(result.failed).toEqual(['/assets/generated/forest-decor-transparent.png'])
  })

  it('times out a decode that never settles instead of deadlocking startup', async () => {
    vi.useFakeTimers()
    const createImage = vi.fn(() => ({ src: '', decode: () => new Promise<void>(() => undefined) }) as unknown as HTMLImageElement)

    const pending = loadGameAssets({ createImage, timeoutMs: 250 })
    await vi.advanceTimersByTimeAsync(251)
    const result = await pending

    expect(result.status).toBe('degraded')
    expect(result.failed).toHaveLength(2)
  })

  it('retains decoded images and avoids repeated work on returning-player paths', async () => {
    const createImage = vi.fn(() => ({ src: '', decode: async () => undefined }) as unknown as HTMLImageElement)

    await loadGameAssets({ createImage })
    await loadGameAssets({ createImage })

    expect(createImage).toHaveBeenCalledTimes(2)
  })
})
