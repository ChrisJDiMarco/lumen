import Dexie, { type DexieOptions, type EntityTable } from 'dexie'

import { isJourneyCheckpoint, type JourneyCheckpoint } from './checkpoint'

export interface LumenPreferences {
  readonly largeTargets: boolean
  readonly highContrast: boolean
  readonly reducedMotion: boolean
  readonly sound: boolean
  readonly inputMode: 'auto' | 'pointer' | 'keyboard'
  readonly masterVolume: number
  readonly musicVolume: number
  readonly ambienceVolume: number
  readonly feedbackVolume: number
  readonly qualityTier: 'auto' | 'high' | 'medium' | 'low'
  readonly reminders: boolean
  readonly diagnostics: boolean
}

export interface SavedJourney {
  readonly id: string
  readonly completedAt: string
  readonly accuracy: number
  readonly averageResponseMs: number
  readonly finalDifficulty: number
  readonly completedTrials: number
  readonly protocolVersion?: string
  readonly seed?: string
  readonly platform?: string
  readonly viewport?: { readonly width: number; readonly height: number }
  readonly devicePixelRatio?: number
  readonly trials?: readonly unknown[]
  readonly voidedTrials?: readonly unknown[]
}

interface PreferenceRecord extends LumenPreferences { readonly id: 'comfort' }
interface CheckpointRecord extends JourneyCheckpoint { readonly id: 'active' }

interface LumenDatabase extends Dexie {
  preferences: EntityTable<PreferenceRecord, 'id'>
  journeys: EntityTable<SavedJourney, 'id'>
  corruptBackups: EntityTable<CorruptBackup, 'id'>
  checkpoints: EntityTable<CheckpointRecord, 'id'>
}

interface CorruptBackup {
  readonly id: string
  readonly storeName: string
  readonly backedUpAt: string
  readonly payload: unknown
}

interface MemoryStore {
  preferences: PreferenceRecord | undefined
  readonly journeys: Map<string, SavedJourney>
  checkpoint: JourneyCheckpoint | null | undefined
  readonly corruptBackups: Map<string, CorruptBackup>
  persistentReadsSuppressed: boolean
}

type PersistentResult<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false }

export type LumenRepositoryStorageOptions = Pick<DexieOptions, 'indexedDB' | 'IDBKeyRange'>

const memoryStores = new Map<string, MemoryStore>()

export const defaultPreferences: LumenPreferences = Object.freeze({
  largeTargets: false,
  highContrast: false,
  reducedMotion: false,
  sound: true,
  inputMode: 'auto',
  masterVolume: 80,
  musicVolume: 35,
  ambienceVolume: 55,
  feedbackVolume: 70,
  qualityTier: 'auto',
  reminders: false,
  diagnostics: false,
})

export interface LumenRepository {
  loadPreferences(): Promise<LumenPreferences>
  savePreferences(preferences: LumenPreferences): Promise<void>
  listJourneys(limit?: number): Promise<readonly SavedJourney[]>
  saveJourney(journey: SavedJourney): Promise<void>
  loadCheckpoint(): Promise<JourneyCheckpoint | null>
  saveCheckpoint(checkpoint: JourneyCheckpoint): Promise<void>
  clearCheckpoint(): Promise<void>
  exportData(): Promise<string>
  deleteAllData(): Promise<void>
  close(): Promise<void>
}

export function createLumenRepository(
  name = 'lumen',
  storageOptions: LumenRepositoryStorageOptions = {},
): LumenRepository {
  const memory = getMemoryStore(name)
  let db = createDatabase(name, storageOptions)

  async function tryPersistent<T>(operation: (database: LumenDatabase) => Promise<T>): Promise<PersistentResult<T>> {
    if (!db || memory.persistentReadsSuppressed) return { available: false }
    try {
      return { available: true, value: await operation(db) }
    } catch {
      db.close()
      db = null
      return { available: false }
    }
  }

  async function quarantine(
    storeName: string,
    payload: unknown,
    removePersistent?: (database: LumenDatabase) => Promise<void>,
  ): Promise<void> {
    const backup: CorruptBackup = {
      id: crypto.randomUUID(),
      storeName,
      backedUpAt: new Date().toISOString(),
      payload: clone(payload),
    }
    memory.corruptBackups.set(backup.id, backup)
    await tryPersistent(async (database) => {
      await database.corruptBackups.put(backup)
      await removePersistent?.(database)
    })
  }

  async function loadPreferences(): Promise<LumenPreferences> {
    let stored = memory.preferences
    if (!stored) {
      const persistent = await tryPersistent((database) => database.preferences.get('comfort'))
      if (persistent.available && persistent.value) {
        stored = clone(persistent.value)
        memory.preferences = stored
      }
    }
    if (!stored) return defaultPreferences

    const { id: _id, ...preferences } = stored
    const sanitized = sanitizePreferences(preferences)
    if (sanitized.corrupt) {
      await quarantine('preferences', stored)
      const corrected: PreferenceRecord = { id: 'comfort', ...sanitized.preferences }
      memory.preferences = corrected
      await tryPersistent((database) => database.preferences.put(corrected).then(() => undefined))
    }
    return clone(sanitized.preferences)
  }

  async function savePreferences(preferences: LumenPreferences): Promise<void> {
    const sanitized = sanitizePreferences(preferences).preferences
    const record: PreferenceRecord = { id: 'comfort', ...sanitized }
    memory.preferences = clone(record)
    await tryPersistent((database) => database.preferences.put(record).then(() => undefined))
  }

  async function listJourneys(limit = 30): Promise<readonly SavedJourney[]> {
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 30
    const persistent = await tryPersistent((database) => database.journeys.toArray() as Promise<unknown[]>)
    if (persistent.available) {
      for (const candidate of persistent.value) {
        if (isSavedJourney(candidate)) {
          if (!memory.journeys.has(candidate.id)) memory.journeys.set(candidate.id, clone(candidate))
          continue
        }
        const candidateId = recordStringId(candidate)
        await quarantine(
          'journeys',
          candidate,
          candidateId ? (database) => database.journeys.delete(candidateId) : undefined,
        )
      }
    }

    return [...memory.journeys.values()]
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      .slice(0, safeLimit)
      .map(clone)
  }

  async function saveJourney(journey: SavedJourney): Promise<void> {
    if (!isSavedJourney(journey)) throw new TypeError('Completed journey does not match the local schema')
    const snapshot = clone(journey)
    let existing = memory.journeys.get(snapshot.id)

    if (!existing) {
      const persistent = await tryPersistent((database) => database.journeys.get(snapshot.id) as Promise<unknown>)
      if (persistent.available && persistent.value !== undefined) {
        if (!isSavedJourney(persistent.value)) {
          await quarantine('journeys', persistent.value, (database) => database.journeys.delete(snapshot.id))
        } else {
          existing = clone(persistent.value)
          memory.journeys.set(existing.id, existing)
        }
      }
    }

    if (existing) {
      if (!sameValue(existing, snapshot)) throw new Error('Completed journeys are immutable')
      return
    }

    const persistentSave = await tryPersistent((database) => database.journeys.add(snapshot).then(() => undefined))
    memory.journeys.set(snapshot.id, snapshot)
    if (!persistentSave.available) return
  }

  async function loadCheckpoint(): Promise<JourneyCheckpoint | null> {
    if (memory.checkpoint !== undefined) return memory.checkpoint ? clone(memory.checkpoint) : null

    const persistent = await tryPersistent((database) => database.checkpoints.get('active') as Promise<unknown>)
    if (!persistent.available || persistent.value === undefined) {
      memory.checkpoint = null
      return null
    }
    const record = persistent.value
    const payload = withoutRecordId(record)
    if (!isJourneyCheckpoint(payload)) {
      await quarantine('checkpoints', record, (database) => database.checkpoints.delete('active'))
      memory.checkpoint = null
      return null
    }

    memory.checkpoint = clone(payload)
    return clone(payload)
  }

  async function saveCheckpoint(checkpoint: JourneyCheckpoint): Promise<void> {
    if (!isJourneyCheckpoint(checkpoint)) throw new TypeError('Journey checkpoint is not a safe inter-trial snapshot')
    const snapshot = clone(checkpoint)
    memory.checkpoint = snapshot
    const record: CheckpointRecord = { id: 'active', ...snapshot }
    await tryPersistent((database) => database.checkpoints.put(record).then(() => undefined))
  }

  async function clearCheckpoint(): Promise<void> {
    memory.checkpoint = null
    await tryPersistent((database) => database.checkpoints.delete('active'))
  }

  async function exportData(): Promise<string> {
    const preferences = await loadPreferences()
    const journeys = await listJourneys(Number.MAX_SAFE_INTEGER)
    const checkpoint = await loadCheckpoint()
    const persistent = await tryPersistent((database) => database.corruptBackups.toArray())
    if (persistent.available) {
      for (const backup of persistent.value) memory.corruptBackups.set(backup.id, clone(backup))
    }
    return JSON.stringify({
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      preferences,
      journeys,
      checkpoint,
      corruptBackups: [...memory.corruptBackups.values()].map(clone),
    }, null, 2)
  }

  async function deleteAllData(): Promise<void> {
    memory.preferences = undefined
    memory.journeys.clear()
    memory.checkpoint = null
    memory.corruptBackups.clear()
    memory.persistentReadsSuppressed = true

    if (!db) return
    try {
      await db.transaction('rw', db.preferences, db.journeys, db.checkpoints, db.corruptBackups, async () => {
        await Promise.all([
          db!.preferences.clear(),
          db!.journeys.clear(),
          db!.checkpoints.clear(),
          db!.corruptBackups.clear(),
        ])
      })
      memory.persistentReadsSuppressed = false
    } catch {
      db.close()
      db = null
    }
  }

  return {
    loadPreferences,
    savePreferences,
    listJourneys,
    saveJourney,
    loadCheckpoint,
    saveCheckpoint,
    clearCheckpoint,
    exportData,
    deleteAllData,
    async close() {
      db?.close()
      db = null
    },
  }
}

function createDatabase(name: string, storageOptions: LumenRepositoryStorageOptions): LumenDatabase | null {
  try {
    const database = new Dexie(name, storageOptions) as LumenDatabase
    database.version(1).stores({ preferences: 'id', journeys: 'id, completedAt' })
    database.version(2).stores({ preferences: 'id', journeys: 'id, completedAt', corruptBackups: 'id, storeName, backedUpAt' })
    database.version(3).stores({
      preferences: 'id',
      journeys: 'id, completedAt',
      corruptBackups: 'id, storeName, backedUpAt',
      checkpoints: 'id',
    })
    return database
  } catch {
    return null
  }
}

function getMemoryStore(name: string): MemoryStore {
  const existing = memoryStores.get(name)
  if (existing) return existing
  const created: MemoryStore = {
    preferences: undefined,
    journeys: new Map(),
    checkpoint: undefined,
    corruptBackups: new Map(),
    persistentReadsSuppressed: false,
  }
  memoryStores.set(name, created)
  return created
}

function sanitizePreferences(stored: Partial<LumenPreferences>): { preferences: LumenPreferences; corrupt: boolean } {
  const candidate = { ...defaultPreferences, ...stored }
  let corrupt = false
  const booleanKeys = ['largeTargets', 'highContrast', 'reducedMotion', 'sound', 'reminders', 'diagnostics'] as const
  for (const key of booleanKeys) {
    if (typeof candidate[key] !== 'boolean') { candidate[key] = defaultPreferences[key]; corrupt = true }
  }
  const volumeKeys = ['masterVolume', 'musicVolume', 'ambienceVolume', 'feedbackVolume'] as const
  for (const key of volumeKeys) {
    if (typeof candidate[key] !== 'number' || !Number.isFinite(candidate[key])) { candidate[key] = defaultPreferences[key]; corrupt = true }
    else candidate[key] = Math.min(100, Math.max(0, candidate[key]))
  }
  if (!['auto', 'pointer', 'keyboard'].includes(candidate.inputMode)) { candidate.inputMode = defaultPreferences.inputMode; corrupt = true }
  if (!['auto', 'high', 'medium', 'low'].includes(candidate.qualityTier)) { candidate.qualityTier = defaultPreferences.qualityTier; corrupt = true }
  return { preferences: candidate, corrupt }
}

function isSavedJourney(value: unknown): value is SavedJourney {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' || value.id.length === 0 ||
    typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)) ||
    !isUnitNumber(value.accuracy) ||
    !isNonNegativeNumber(value.averageResponseMs) ||
    !isUnitNumber(value.finalDifficulty) ||
    !isNonNegativeInteger(value.completedTrials)
  ) return false
  if (value.protocolVersion !== undefined && typeof value.protocolVersion !== 'string') return false
  if (value.seed !== undefined && typeof value.seed !== 'string') return false
  if (value.platform !== undefined && typeof value.platform !== 'string') return false
  if (value.devicePixelRatio !== undefined && (!isPositiveNumber(value.devicePixelRatio))) return false
  if (value.trials !== undefined && !Array.isArray(value.trials)) return false
  if (value.voidedTrials !== undefined && !Array.isArray(value.voidedTrials)) return false
  if (value.viewport !== undefined) {
    if (!isRecord(value.viewport) || !isPositiveNumber(value.viewport.width) || !isPositiveNumber(value.viewport.height)) return false
  }
  return true
}

function withoutRecordId(value: unknown): unknown {
  if (!isRecord(value)) return value
  const { id: _id, ...payload } = value
  return payload
}

function recordStringId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === 'string' ? value.id : null
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}
