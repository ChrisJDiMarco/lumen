import 'fake-indexeddb/auto'

import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import { createSession, recordTrial, standardProtocol } from '../game/core/protocol'
import { CHECKPOINT_SCHEMA_VERSION, type JourneyCheckpoint } from './checkpoint'
import { createLumenRepository, defaultPreferences, type SavedJourney } from './lumenRepository'

const databases: string[] = []

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => indexedDB.deleteDatabase(name)))
})

function repository() {
  const name = `lumen-test-${crypto.randomUUID()}`
  databases.push(name)
  return createLumenRepository(name)
}

function checkpoint(): JourneyCheckpoint {
  const initial = createSession('resume-seed', standardProtocol)
  const session = recordTrial(initial, {
    centralCorrect: true,
    peripheralCorrect: true,
    valid: true,
    responseMs: 410,
  })

  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    boundary: 'inter-trial',
    savedAt: '2026-07-13T16:00:00.000Z',
    mode: 'journey',
    completedTrials: 1,
    targetTrials: 24,
    session,
  }
}

describe('LumenRepository', () => {
  it('starts with privacy-preserving comfort defaults', async () => {
    const repo = repository()
    await expect(repo.loadPreferences()).resolves.toEqual(defaultPreferences)
    await repo.close()
  })

  it('round-trips comfort preferences locally', async () => {
    const repo = repository()
    const preferences = { ...defaultPreferences, reducedMotion: true, sound: false }
    await repo.savePreferences(preferences)
    await expect(repo.loadPreferences()).resolves.toEqual(preferences)
    await repo.close()
  })

  it('merges newly introduced settings into a legacy preference record', async () => {
    const name = `lumen-test-${crypto.randomUUID()}`
    databases.push(name)
    const legacy = new Dexie(name)
    legacy.version(1).stores({ preferences: 'id', journeys: 'id, completedAt' })
    await legacy.table('preferences').put({ id: 'comfort', reducedMotion: true, sound: false })
    legacy.close()

    const repo = createLumenRepository(name)
    await expect(repo.loadPreferences()).resolves.toEqual({
      ...defaultPreferences,
      reducedMotion: true,
      sound: false,
    })
    await repo.close()
  })

  it('stores completed journeys newest first without network identifiers', async () => {
    const repo = repository()
    const older: SavedJourney = {
      id: 'older',
      completedAt: '2026-07-11T12:00:00.000Z',
      accuracy: 0.75,
      averageResponseMs: 510,
      finalDifficulty: 0.35,
      completedTrials: 24,
    }
    const newer = { ...older, id: 'newer', completedAt: '2026-07-13T12:00:00.000Z' }
    await repo.saveJourney(older)
    await repo.saveJourney(newer)
    await expect(repo.listJourneys()).resolves.toEqual([newer, older])
    await repo.close()
  })

  it('keeps completed sessions immutable while allowing idempotent saves', async () => {
    const repo = repository()
    const journey: SavedJourney = { id: 'fixed', completedAt: '2026-07-13T12:00:00.000Z', accuracy: 0.8, averageResponseMs: 430, finalDifficulty: 0.4, completedTrials: 24 }
    await repo.saveJourney(journey)
    await expect(repo.saveJourney(journey)).resolves.toBeUndefined()
    await expect(repo.saveJourney({ ...journey, accuracy: 0.2 })).rejects.toThrow(/immutable/i)
    await repo.close()
  })

  it('persists a safe-boundary checkpoint across repository instances', async () => {
    const name = `lumen-test-${crypto.randomUUID()}`
    databases.push(name)
    const first = createLumenRepository(name)
    await first.saveCheckpoint(checkpoint())
    await first.close()

    const reopened = createLumenRepository(name)
    await expect(reopened.loadCheckpoint()).resolves.toEqual(checkpoint())
    await reopened.close()
  })

  it('clears a checkpoint without deleting completed journeys', async () => {
    const repo = repository()
    const journey: SavedJourney = { id: 'done', completedAt: '2026-07-13T12:00:00.000Z', accuracy: 0.8, averageResponseMs: 430, finalDifficulty: 0.4, completedTrials: 24 }
    await repo.saveJourney(journey)
    await repo.saveCheckpoint(checkpoint())
    await repo.clearCheckpoint()

    await expect(repo.loadCheckpoint()).resolves.toBeNull()
    await expect(repo.listJourneys()).resolves.toEqual([journey])
    await repo.close()
  })

  it('rejects an unsafe checkpoint before writing it', async () => {
    const repo = repository()
    await expect(repo.saveCheckpoint({ ...checkpoint(), boundary: 'presentation' } as unknown as JourneyCheckpoint))
      .rejects.toThrow(/checkpoint/i)
    await expect(repo.loadCheckpoint()).resolves.toBeNull()
    await repo.close()
  })

  it('falls back to process memory when IndexedDB access is denied', async () => {
    const name = `lumen-denied-${crypto.randomUUID()}`
    const deniedIndexedDb = {
      open() {
        throw new DOMException('Storage access denied', 'SecurityError')
      },
    }
    const options = { indexedDB: deniedIndexedDb, IDBKeyRange }
    const journey: SavedJourney = { id: 'fallback', completedAt: '2026-07-13T12:00:00.000Z', accuracy: 0.8, averageResponseMs: 430, finalDifficulty: 0.4, completedTrials: 24 }

    const first = createLumenRepository(name, options)
    await expect(first.saveCheckpoint(checkpoint())).resolves.toBeUndefined()
    await expect(first.saveJourney(journey)).resolves.toBeUndefined()
    await first.close()

    const reopened = createLumenRepository(name, options)
    await expect(reopened.loadCheckpoint()).resolves.toEqual(checkpoint())
    await expect(reopened.listJourneys()).resolves.toEqual([journey])
    await expect(reopened.saveJourney({ ...journey, accuracy: 0.1 })).rejects.toThrow(/immutable/i)
    await reopened.close()
  })

  it('quarantines malformed checkpoint and journey records encountered in IndexedDB', async () => {
    const name = `lumen-test-${crypto.randomUUID()}`
    databases.push(name)
    const raw = new Dexie(name)
    raw.version(3).stores({
      preferences: 'id',
      journeys: 'id, completedAt',
      corruptBackups: 'id, storeName, backedUpAt',
      checkpoints: 'id',
    })
    await raw.table('checkpoints').put({ id: 'active', ...checkpoint(), boundary: 'presentation' })
    await raw.table('journeys').put({ id: 'bad', completedAt: 'not-a-date', accuracy: 2 })
    raw.close()

    const repo = createLumenRepository(name)
    await expect(repo.loadCheckpoint()).resolves.toBeNull()
    await expect(repo.listJourneys()).resolves.toEqual([])
    const exported = JSON.parse(await repo.exportData()) as { corruptBackups: { storeName: string }[] }
    expect(exported.corruptBackups.map(({ storeName }) => storeName).sort()).toEqual(['checkpoints', 'journeys'])
    await repo.close()
  })

  it('rejects malformed completed journeys before saving them', async () => {
    const repo = repository()
    await expect(repo.saveJourney({
      id: 'invalid',
      completedAt: 'not-a-date',
      accuracy: 7,
      averageResponseMs: -1,
      finalDifficulty: Number.NaN,
      completedTrials: -4,
    })).rejects.toThrow(/journey/i)
    await expect(repo.listJourneys()).resolves.toEqual([])
    await repo.close()
  })

  it('exports and deletes all local player data', async () => {
    const repo = repository()
    await repo.savePreferences({ ...defaultPreferences, highContrast: true })
    await repo.saveJourney({ id: 'one', completedAt: '2026-07-13T12:00:00.000Z', accuracy: 0.8, averageResponseMs: 440, finalDifficulty: 0.4, completedTrials: 24 })

    const exported = JSON.parse(await repo.exportData()) as { preferences: { highContrast: boolean }; journeys: unknown[] }
    expect(exported.preferences.highContrast).toBe(true)
    expect(exported.journeys).toHaveLength(1)

    await repo.deleteAllData()
    await expect(repo.listJourneys()).resolves.toEqual([])
    await expect(repo.loadPreferences()).resolves.toEqual(defaultPreferences)
    await repo.close()
  })

  it('backs up a corrupt preference record and resets only invalid fields', async () => {
    const name = `lumen-test-${crypto.randomUUID()}`
    databases.push(name)
    const raw = new Dexie(name)
    raw.version(1).stores({ preferences: 'id', journeys: 'id, completedAt' })
    await raw.table('preferences').put({ id: 'comfort', reducedMotion: true, masterVolume: 'loud' })
    raw.close()
    const repo = createLumenRepository(name)

    const preferences = await repo.loadPreferences()
    expect(preferences.reducedMotion).toBe(true)
    expect(preferences.masterVolume).toBe(defaultPreferences.masterVolume)
    const exported = JSON.parse(await repo.exportData()) as { corruptBackups: unknown[] }
    expect(exported.corruptBackups).toHaveLength(1)
    await repo.close()
  })
})
