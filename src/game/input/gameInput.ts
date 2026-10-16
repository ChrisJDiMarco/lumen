import type { ResponsePhase } from '../render/LumenCanvas'

export interface GameSelection {
  readonly identityIndex: number
  readonly sector: number
}

export type GameInputAction =
  | { readonly type: 'none' }
  | { readonly type: 'confirm-identity'; readonly index: number }
  | { readonly type: 'confirm-sector'; readonly sector: number }
  | { readonly type: 'continue' | 'pause' | 'resume' | 'retry' }

export interface GameInputResult {
  readonly selection: GameSelection
  readonly action: GameInputAction
}

const sectorCoordinates = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
] as const

const directSectors: Readonly<Record<string, number>> = {
  '1': 7, '2': 0, '3': 1, '4': 6, '6': 2, '7': 5, '8': 4, '9': 3,
}

export function interpretGameKey(key: string, phase: ResponsePhase, selection: GameSelection): GameInputResult {
  const normalizedKey = key === 'Spacebar' ? ' ' : key
  if ((phase === 'identify' || phase === 'locate') && normalizedKey === 'Escape') {
    return { selection, action: { type: 'pause' } }
  }
  if (normalizedKey === ' ') {
    if (phase === 'identify') return { selection, action: { type: 'confirm-identity', index: selection.identityIndex } }
    if (phase === 'locate') return { selection, action: { type: 'confirm-sector', sector: selection.sector } }
    if (phase === 'resolved') return { selection, action: { type: 'continue' } }
    if (phase === 'paused') return { selection, action: { type: 'resume' } }
    if (phase === 'recovery') return { selection, action: { type: 'retry' } }
  }
  if (phase === 'identify') {
    if (normalizedKey === '1' || normalizedKey.toLowerCase() === 'a') return { selection, action: { type: 'confirm-identity', index: 0 } }
    if (normalizedKey === '2' || normalizedKey.toLowerCase() === 's') return { selection, action: { type: 'confirm-identity', index: 1 } }
    if (normalizedKey === 'ArrowLeft' || normalizedKey === 'ArrowUp') return { selection: { ...selection, identityIndex: 0 }, action: { type: 'none' } }
    if (normalizedKey === 'ArrowRight' || normalizedKey === 'ArrowDown') return { selection: { ...selection, identityIndex: 1 }, action: { type: 'none' } }
  }
  if (phase === 'locate') {
    const directSector = directSectors[normalizedKey]
    if (directSector !== undefined) return { selection: { ...selection, sector: directSector }, action: { type: 'confirm-sector', sector: directSector } }
    if (normalizedKey.startsWith('Arrow')) return { selection: { ...selection, sector: moveSector(selection.sector, normalizedKey) }, action: { type: 'none' } }
  }
  return { selection, action: { type: 'none' } }
}

export function moveSector(sector: number, key: string): number {
  const current = sectorCoordinates[sector] ?? sectorCoordinates[0]
  const delta = key === 'ArrowLeft' ? { x: -1, y: 0 }
    : key === 'ArrowRight' ? { x: 1, y: 0 }
      : key === 'ArrowUp' ? { x: 0, y: -1 }
        : key === 'ArrowDown' ? { x: 0, y: 1 }
          : { x: 0, y: 0 }
  let next = { x: current.x + delta.x, y: current.y + delta.y }
  if (next.x === 0 && next.y === 0) next = { x: delta.x, y: delta.y }
  const nextSector = sectorCoordinates.findIndex((coordinate) => coordinate.x === next.x && coordinate.y === next.y)
  return nextSector === -1 ? sector : nextSector
}
