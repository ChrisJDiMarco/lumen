import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildLocalDiagnosticsReport,
  clearLocalDiagnostics,
  getLocalDiagnostics,
  installLocalDiagnosticsCapture,
  recordLocalDiagnostic,
} from './localDiagnostics'

describe('local diagnostics', () => {
  beforeEach(() => clearLocalDiagnostics())
  afterEach(() => {
    clearLocalDiagnostics()
    vi.restoreAllMocks()
  })

  it('keeps a bounded, sanitized in-memory history', () => {
    for (let index = 0; index < 55; index += 1) {
      recordLocalDiagnostic('runtime.error', `failure ${index}\nwith details`, {
        source: `https://example.test/app.js?token=secret#${index}`,
      })
    }

    const entries = getLocalDiagnostics()
    expect(entries).toHaveLength(50)
    expect(entries[0]?.message).toBe('failure 5 with details')
    expect(entries.at(-1)?.context.source).toBe('/app.js')
    expect(JSON.stringify(entries)).not.toContain('token=secret')
  })

  it('captures window errors and unhandled rejections without sending data', () => {
    const remove = installLocalDiagnosticsCapture(window)

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'renderer failed',
      filename: 'https://example.test/assets/index.js?build=private',
      lineno: 12,
      colno: 4,
      error: new Error('renderer failed'),
    }))
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.resolve(),
      reason: new Error('asset decode failed'),
    }))

    expect(getLocalDiagnostics().map(({ kind }) => kind)).toEqual([
      'runtime.error',
      'runtime.unhandledrejection',
    ])
    expect(getLocalDiagnostics()[0]?.context.source).toBe('/assets/index.js')
    remove()
  })

  it('builds an exportable report without URL query strings or stacks', () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-07-13T12:00:00.000Z')
    recordLocalDiagnostic('react.boundary', 'render failed', { componentStack: 'at App' })

    const report = buildLocalDiagnosticsReport({
      href: 'https://lumen.example/play?session=secret#trial',
      userAgent: 'Test Browser',
    })

    expect(report.generatedAt).toBe('2026-07-13T12:00:00.000Z')
    expect(report.page).toBe('https://lumen.example/play')
    expect(report.userAgent).toBe('Test Browser')
    expect(report.entries[0]?.context.componentStack).toBe('at App')
    expect(JSON.stringify(report)).not.toContain('session=secret')
  })
})
