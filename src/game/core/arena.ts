export const LOGICAL_ARENA_WIDTH = 1600
export const LOGICAL_ARENA_HEIGHT = 900

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Arena {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly scale: number
}

/** Creates a centered 16:9 arena in CSS-pixel canvas coordinates. */
export function createArena(canvasWidth: number, canvasHeight: number): Arena {
  assertPositiveFinite(canvasWidth, 'canvasWidth')
  assertPositiveFinite(canvasHeight, 'canvasHeight')

  const scale = Math.min(
    canvasWidth / LOGICAL_ARENA_WIDTH,
    canvasHeight / LOGICAL_ARENA_HEIGHT,
  )
  const width = LOGICAL_ARENA_WIDTH * scale
  const height = LOGICAL_ARENA_HEIGHT * scale

  return {
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
    scale,
  }
}

/** Maps protocol coordinates in [-1, 1] around fixation to CSS pixels. */
export function protocolPointToCanvas(arena: Arena, point: Point): Point {
  return {
    x: arena.x + ((point.x + 1) * arena.width) / 2,
    y: arena.y + ((point.y + 1) * arena.height) / 2,
  }
}

/** Inverse of protocolPointToCanvas; useful for pointer hit testing. */
export function canvasPointToProtocol(arena: Arena, point: Point): Point {
  return {
    x: ((point.x - arena.x) * 2) / arena.width - 1,
    y: ((point.y - arena.y) * 2) / arena.height - 1,
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`)
  }
}
