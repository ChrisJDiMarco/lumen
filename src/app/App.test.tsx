import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'

vi.mock('../game/render/LumenCanvas', () => ({
  LumenCanvas: ({ phase, onIdentify, onLocate, onPresentationComplete }: {
    phase: string
    onIdentify: (identity: 'leaf' | 'moth') => void
    onLocate: (sector: number) => void
    onPresentationComplete: (metrics: object) => void
  }) => (
    <div data-testid="lumen-canvas" data-phase={phase}>
      {phase === 'stimulus' && <button onClick={() => onPresentationComplete({ valid: true, requestedOnset: 0, actualOnset: 0, requestedDurationMs: 120, actualOffset: 120, measuredDurationMs: 120, refreshEstimateMs: 16 })}>Complete presentation</button>}
      <button onClick={() => onIdentify('leaf')}>Choose leaf</button>
      <button onClick={() => onLocate(0)}>Choose north</button>
    </div>
  ),
}))

afterEach(cleanup)

describe('Lumen app shell', () => {
  it('keeps first play disabled while the visual preflight is still pending', () => {
    const assetLoader = vi.fn(() => new Promise<never>(() => undefined))
    render(<App assetLoader={assetLoader} />)

    fireEvent.click(screen.getByRole('button', { name: /play a journey/i }))

    expect(screen.getByRole('button', { name: /preparing forest/i })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/preparing visual assets/i)
  })

  it('continues in a clearly labeled vector mode when scenery cannot decode', async () => {
    const assetLoader = vi.fn(async () => ({
      status: 'degraded' as const,
      loaded: ['/assets/generated/forest-background.png'],
      failed: ['/assets/generated/forest-decor-transparent.png'],
    }))
    render(<App assetLoader={assetLoader} />)

    fireEvent.click(screen.getByRole('button', { name: /play a journey/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /begin practice/i })).toBeEnabled())

    expect(screen.getByRole('status')).toHaveTextContent(/simplified vector scenery/i)
    fireEvent.click(screen.getByRole('button', { name: /begin practice/i }))
    expect(screen.getByTestId('lumen-canvas')).toBeVisible()
  })

  it('opens the research disclosure without weakening the preliminary language', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /read the research/i }))

    expect(screen.getByRole('dialog', { name: /research behind lumen/i })).toBeVisible()
    expect(screen.getByText(/25 percent lower rate/i)).toBeVisible()
    expect(screen.getByText(/small.*needs replication/i)).toBeVisible()
    expect(screen.getByText(/has not been clinically validated/i)).toBeVisible()
  })

  it('moves from first run into accessible setup and practice', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /play a journey/i }))
    expect(screen.getByRole('heading', { name: /make lumen comfortable/i })).toBeVisible()

    fireEvent.click(screen.getByLabelText(/larger targets/i))
    fireEvent.click(screen.getByRole('button', { name: /begin practice/i }))

    expect(screen.getByRole('heading', { name: /practice/i })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /complete presentation/i }))
    expect(screen.getByText(/which symbol was in the center/i)).toBeVisible()
    expect(screen.getByTestId('lumen-canvas')).toHaveAttribute('data-phase', 'identify')
  })

  it('supports the complete response flow and presents non-clinical results', () => {
    render(<App initialView="journey" />)

    fireEvent.click(screen.getByRole('button', { name: /complete presentation/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /choose leaf/i }).at(-1)!)
    expect(screen.getByTestId('lumen-canvas')).toHaveAttribute('data-phase', 'locate')
    fireEvent.click(screen.getAllByRole('button', { name: /choose north/i }).at(-1)!)
    expect(screen.getByText(/response recorded/i)).toBeVisible()

    expect(screen.getByRole('button', { name: /next glimpse/i })).toBeVisible()
  })

  it('plays a complete trial with arrows and Space alone', async () => {
    render(<App initialView="journey" />)

    fireEvent.click(screen.getByRole('button', { name: /complete presentation/i }))
    const firstGlyph = screen.getAllByRole('button', { name: /choose (leaf|moth)/i })[0]
    fireEvent.keyDown(firstGlyph, { key: 'ArrowRight' })
    const secondGlyph = screen.getAllByRole('button', { name: /choose (leaf|moth)/i })[1]
    expect(secondGlyph).toHaveAttribute('data-active', 'true')
    fireEvent.click(secondGlyph)
    expect(screen.getByTestId('lumen-canvas')).toHaveAttribute('data-phase', 'locate')
    const north = screen.getByRole('button', { name: /^North$/ })
    fireEvent.keyDown(north, { key: 'ArrowRight' })
    fireEvent.click(document.activeElement as HTMLElement)
    expect(screen.getByText(/response recorded/i)).toBeVisible()
    const next = screen.getByRole('button', { name: /next glimpse/i })
    await waitFor(() => expect(next).toBeEnabled())
    fireEvent.click(next)
    expect(screen.getByTestId('lumen-canvas')).toHaveAttribute('data-phase', 'stimulus')
  })

  it('exposes history and settings as keyboard-accessible navigation', () => {
    render(<App initialView="home" />)

    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    expect(screen.getByRole('heading', { name: /recent journeys/i })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('heading', { name: /settings/i })).toBeVisible()
    expect(screen.getByLabelText(/reduced motion/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/high contrast/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/preferred input/i)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /master volume/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export my lumen data/i })).toBeVisible()
  })

  it('keeps the utility return destination when switching settings and history', () => {
    render(<App initialView="home" />)
    fireEvent.click(screen.getByRole('button', { name: /settings/i }))
    fireEvent.click(screen.getByRole('button', { name: /history/i }))
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }))
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeVisible()
  })

  it('runs four unscored practice trials before the scored journey', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /play a journey/i }))
    fireEvent.click(screen.getByRole('button', { name: /begin practice/i }))
    for (let index = 0; index < 4; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /complete presentation/i }))
      fireEvent.click(screen.getAllByRole('button', { name: /choose leaf/i }).at(-1)!)
      fireEvent.click(screen.getAllByRole('button', { name: /choose north/i }).at(-1)!)
      fireEvent.click(screen.getByRole('button', { name: index === 3 ? /begin full journey/i : /next practice/i }))
    }
    expect(screen.getByRole('heading', { name: /follow the light/i })).toBeVisible()
    expect(screen.getByLabelText(/trial 1 of 24/i)).toBeVisible()
  })

  it('restores focus to the research trigger when the modal closes', () => {
    render(<App />)
    const trigger = screen.getByRole('button', { name: /read the research/i })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })
})
