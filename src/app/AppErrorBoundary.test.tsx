import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearLocalDiagnostics, getLocalDiagnostics } from '../platform/localDiagnostics'
import { AppErrorBoundary } from './AppErrorBoundary'

function BrokenView(): never {
  throw new Error('test render failure')
}

describe('AppErrorBoundary', () => {
  beforeEach(() => {
    clearLocalDiagnostics()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('replaces a failed render with a usable local recovery screen', () => {
    const onExport = vi.fn()
    const onReload = vi.fn()

    render(
      <AppErrorBoundary onExport={onExport} onReload={onReload}>
        <BrokenView />
      </AppErrorBoundary>,
    )

    expect(screen.getByRole('heading', { name: /forest needs a moment/i })).toBeVisible()
    expect(screen.getByText(/nothing is sent anywhere/i)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /save diagnostic file/i }))
    fireEvent.click(screen.getByRole('button', { name: /reload lumen/i }))
    expect(onExport).toHaveBeenCalledOnce()
    expect(onReload).toHaveBeenCalledOnce()
    expect(getLocalDiagnostics().at(-1)?.kind).toBe('react.boundary')
  })

  it('renders children when no error occurs', () => {
    render(<AppErrorBoundary><p>Lumen is ready</p></AppErrorBoundary>)
    expect(screen.getByText('Lumen is ready')).toBeVisible()
  })
})
