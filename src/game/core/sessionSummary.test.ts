import { describe, expect, it } from 'vitest'

import { createSession, recordTrial, standardProtocol } from './protocol'
import { summarizeSession } from './sessionSummary'

describe('summarizeSession', () => {
  it('derives accuracy, response time, achieved speed and consistency from valid trials', () => {
    let session = createSession('summary', standardProtocol)
    session = recordTrial(session, { centralCorrect: true, peripheralCorrect: true, valid: true, responseMs: 400, measuredPresentationMs: 370 })
    session = recordTrial(session, { centralCorrect: false, peripheralCorrect: true, valid: true, responseMs: 600, measuredPresentationMs: 360 })

    expect(summarizeSession(session)).toEqual(expect.objectContaining({
      accuracy: 0.5,
      averageResponseMs: 500,
      presentationSpeedMs: 365,
      completedTrials: 2,
    }))
    expect(summarizeSession(session).consistency).toBeGreaterThan(0)
  })
})
