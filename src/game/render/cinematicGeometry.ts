export type CollectibleKind = 'moth' | 'lotus' | 'leaf' | 'shell'

export interface CollectibleAnchor {
  readonly x: number
  readonly y: number
  readonly kind: CollectibleKind
  readonly tone: 'cyan' | 'orchid'
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface QuadraticPath {
  readonly start: Point
  readonly control: Point
  readonly end: Point
}

export interface TrailPoint extends Point {
  readonly progress: number
  readonly alpha: number
}

export interface ProgressSegment {
  readonly index: number
  readonly state: 'complete' | 'current' | 'upcoming'
}

export const COLLECTIBLE_ANCHORS: readonly CollectibleAnchor[] = Object.freeze([
  { x: 180, y: 290, kind: 'moth', tone: 'cyan' },
  { x: 300, y: 690, kind: 'lotus', tone: 'orchid' },
  { x: 470, y: 155, kind: 'leaf', tone: 'cyan' },
  { x: 1130, y: 150, kind: 'lotus', tone: 'orchid' },
  { x: 1320, y: 315, kind: 'leaf', tone: 'cyan' },
  { x: 1370, y: 690, kind: 'shell', tone: 'cyan' },
])

export function resolutionPath(sector: number): QuadraticPath {
  const angle = sector * Math.PI / 4 - Math.PI / 2
  const start = {
    x: Math.round(800 + Math.cos(angle) * 335),
    y: Math.round(420 + Math.sin(angle) * 270),
  }
  const end = { x: 800, y: 420 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.max(1, Math.hypot(dx, dy))
  const perpendicular = { x: -dy / length, y: dx / length }
  const direction = perpendicular.y <= 0 ? 1 : -1
  const lift = 115
  return {
    start,
    control: {
      x: (start.x + end.x) / 2 + perpendicular.x * lift * direction,
      y: (start.y + end.y) / 2 + perpendicular.y * lift * direction,
    },
    end,
  }
}

export function quadraticBezierPoint(path: QuadraticPath, progress: number): Point {
  const t = Math.max(0, Math.min(1, progress))
  const inverse = 1 - t
  return {
    x: inverse * inverse * path.start.x + 2 * inverse * t * path.control.x + t * t * path.end.x,
    y: inverse * inverse * path.start.y + 2 * inverse * t * path.control.y + t * t * path.end.y,
  }
}

export function trailSamples(path: QuadraticPath, progress: number, count = 16): readonly TrailPoint[] {
  const safeCount = Math.max(1, Math.min(16, Math.floor(count)))
  return Array.from({ length: safeCount }, (_, index) => {
    const lag = (safeCount - 1 - index) * 0.032
    const sampleProgress = Math.max(0, Math.min(progress, progress - lag))
    const point = quadraticBezierPoint(path, sampleProgress)
    return { ...point, progress: sampleProgress, alpha: 0.08 + (index / safeCount) * 0.56 }
  })
}

export function createProgressSegments(completed: number, total: number): readonly ProgressSegment[] {
  const safeTotal = Math.max(1, Math.floor(total))
  const safeCompleted = Math.max(0, Math.min(safeTotal, Math.floor(completed)))
  return Array.from({ length: safeTotal }, (_, index) => ({
    index,
    state: index < safeCompleted ? 'complete' : index === safeCompleted ? 'current' : 'upcoming',
  }))
}
