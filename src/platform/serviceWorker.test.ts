import { describe, expect, it, vi } from 'vitest'

import { registerLumenServiceWorker, supportsLumenServiceWorker } from './serviceWorker'

describe('supportsLumenServiceWorker', () => {
  it('allows only production http and https pages with service worker support', () => {
    expect(supportsLumenServiceWorker('https:', true, true)).toBe(true)
    expect(supportsLumenServiceWorker('http:', true, true)).toBe(true)
    expect(supportsLumenServiceWorker('tauri:', true, true)).toBe(false)
    expect(supportsLumenServiceWorker('file:', true, true)).toBe(false)
    expect(supportsLumenServiceWorker('https:', false, true)).toBe(false)
    expect(supportsLumenServiceWorker('https:', true, false)).toBe(false)
  })
})

describe('registerLumenServiceWorker', () => {
  it('registers the root service worker without using the HTTP cache', async () => {
    const register = vi.fn().mockResolvedValue({})

    await registerLumenServiceWorker({
      enabled: true,
      location: { protocol: 'https:' },
      serviceWorker: { register },
    })

    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  })

  it('does nothing in native shells, development, or unsupported browsers', async () => {
    const register = vi.fn()

    await registerLumenServiceWorker({
      enabled: true,
      location: { protocol: 'tauri:' },
      serviceWorker: { register },
    })
    await registerLumenServiceWorker({
      enabled: false,
      location: { protocol: 'https:' },
      serviceWorker: { register },
    })
    await registerLumenServiceWorker({
      enabled: true,
      location: { protocol: 'https:' },
      serviceWorker: undefined,
    })

    expect(register).not.toHaveBeenCalled()
  })

  it('contains registration failures so app startup remains available', async () => {
    const register = vi.fn().mockRejectedValue(new Error('registration denied'))

    await expect(registerLumenServiceWorker({
      enabled: true,
      location: { protocol: 'https:' },
      serviceWorker: { register },
    })).resolves.toBeUndefined()
  })
})
