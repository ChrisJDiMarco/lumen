import { describe, expect, it } from 'vitest'

import { interpretGameKey } from './gameInput'

describe('interpretGameKey', () => {
  it('moves between the two center symbols with arrows and confirms with Space', () => {
    expect(interpretGameKey('ArrowRight', 'identify', { identityIndex: 0, sector: 0 })).toEqual({
      selection: { identityIndex: 1, sector: 0 },
      action: { type: 'none' },
    })
    expect(interpretGameKey('ArrowLeft', 'identify', { identityIndex: 1, sector: 0 }).selection.identityIndex).toBe(0)
    expect(interpretGameKey(' ', 'identify', { identityIndex: 1, sector: 0 }).action).toEqual({ type: 'confirm-identity', index: 1 })
  })

  it('walks all eight peripheral positions as a spatial ring', () => {
    expect(interpretGameKey('ArrowRight', 'locate', { identityIndex: 0, sector: 7 }).selection.sector).toBe(0)
    expect(interpretGameKey('ArrowLeft', 'locate', { identityIndex: 0, sector: 0 }).selection.sector).toBe(7)
    expect(interpretGameKey('ArrowUp', 'locate', { identityIndex: 0, sector: 5 }).selection.sector).toBe(6)
    expect(interpretGameKey('ArrowDown', 'locate', { identityIndex: 0, sector: 1 }).selection.sector).toBe(2)
    expect(interpretGameKey('Spacebar', 'locate', { identityIndex: 0, sector: 3 }).action).toEqual({ type: 'confirm-sector', sector: 3 })
  })

  it('uses Space for the safe between-trial actions but never skips a stimulus', () => {
    const selection = { identityIndex: 0, sector: 0 }
    expect(interpretGameKey(' ', 'resolved', selection).action).toEqual({ type: 'continue' })
    expect(interpretGameKey(' ', 'paused', selection).action).toEqual({ type: 'resume' })
    expect(interpretGameKey(' ', 'recovery', selection).action).toEqual({ type: 'retry' })
    expect(interpretGameKey(' ', 'stimulus', selection).action).toEqual({ type: 'none' })
  })

  it('pauses only while responding and keeps legacy direct shortcuts', () => {
    const selection = { identityIndex: 0, sector: 0 }
    expect(interpretGameKey('Escape', 'identify', selection).action).toEqual({ type: 'pause' })
    expect(interpretGameKey('Escape', 'locate', selection).action).toEqual({ type: 'pause' })
    expect(interpretGameKey('1', 'identify', selection).action).toEqual({ type: 'confirm-identity', index: 0 })
    expect(interpretGameKey('9', 'locate', selection).action).toEqual({ type: 'confirm-sector', sector: 3 })
  })
})
