import { describe, expect, it } from 'vitest'

import { canvasPointToProtocol, createArena, protocolPointToCanvas } from './arena'

describe('stimulus arena', () => {
  it('contain-fits a 16:9 logical arena without stretching', () => {
    expect(createArena(1200, 900)).toEqual({ x: 0, y: 112.5, width: 1200, height: 675, scale: 0.75 })
  })

  it('maps normalized protocol points into canvas coordinates', () => {
    const arena = createArena(1600, 900)
    expect(protocolPointToCanvas(arena, { x: 0, y: 0 })).toEqual({ x: 800, y: 450 })
    expect(protocolPointToCanvas(arena, { x: 1, y: -1 })).toEqual({ x: 1600, y: 0 })
  })

  it('round-trips points through the inverse arena transform', () => {
    const arena = createArena(1024, 768)
    const protocolPoint = { x: -0.625, y: 0.75 }

    expect(canvasPointToProtocol(arena, protocolPointToCanvas(arena, protocolPoint))).toEqual(
      protocolPoint,
    )
  })

  it.each([
    [0, 900],
    [1600, -1],
    [Number.NaN, 900],
    [1600, Number.POSITIVE_INFINITY],
  ])('rejects an invalid canvas size (%s, %s)', (width, height) => {
    expect(() => createArena(width, height)).toThrow(RangeError)
  })
})
