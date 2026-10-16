import { describe, expect, it, vi } from 'vitest'

import { FrameTrialScheduler, RefreshEstimator, type TrialPresentationMetrics } from './trialScheduler'

class FakeFrames {
  private callback: FrameRequestCallback | null = null
  readonly request = vi.fn((callback: FrameRequestCallback) => {
    this.callback = callback
    return 1
  })
  readonly cancel = vi.fn()

  frame(now: number) {
    const callback = this.callback
    this.callback = null
    callback?.(now)
  }
}

describe('FrameTrialScheduler', () => {
  it('estimates high-refresh displays from a rolling median', () => {
    const estimator = new RefreshEstimator()
    ;[0, 8.2, 16.5, 24.8, 33.1].forEach((frame) => estimator.record(frame))
    expect(estimator.estimate()).toBeCloseTo(8.3, 1)
  })
  it('runs settle, present, mask and completion on animation frames', () => {
    const frames = new FakeFrames()
    const stages: string[] = []
    let metrics: TrialPresentationMetrics | undefined
    const scheduler = new FrameTrialScheduler({
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onStage: (stage) => stages.push(stage),
      onComplete: (result) => { metrics = result },
    })

    scheduler.start({ settleMs: 400, presentationMs: 120, maskMs: 100 })
    frames.frame(10)
    frames.frame(410)
    ;[426, 442, 458, 474, 490, 506, 522].forEach((now) => frames.frame(now))
    frames.frame(530)
    frames.frame(630)

    expect(stages).toEqual(['settle', 'present', 'mask', 'response'])
    expect(metrics).toMatchObject({ requestedDurationMs: 120, measuredDurationMs: 120, valid: true })
  })

  it('voids a presentation after visibility or geometry interruption', () => {
    const frames = new FakeFrames()
    const complete = vi.fn()
    const scheduler = new FrameTrialScheduler({
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onStage: vi.fn(),
      onComplete: complete,
    })

    scheduler.start({ settleMs: 400, presentationMs: 120, maskMs: 100 })
    frames.frame(0)
    frames.frame(400)
    scheduler.invalidate('visibility-change')
    frames.frame(520)
    frames.frame(620)

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ valid: false, invalidReason: 'visibility-change' }))
  })

  it('detects exposure beyond one estimated refresh interval', () => {
    const frames = new FakeFrames()
    const complete = vi.fn()
    const scheduler = new FrameTrialScheduler({ requestFrame: frames.request, cancelFrame: frames.cancel, onStage: vi.fn(), onComplete: complete })

    scheduler.start({ settleMs: 0, presentationMs: 100, maskMs: 0, refreshEstimateMs: 16 })
    frames.frame(0)
    frames.frame(140)
    frames.frame(141)

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ valid: false, invalidReason: 'exposure-tolerance' }))
  })

  it.each([
    {
      refreshRateHz: 60,
      refreshEstimateMs: 1000 / 60,
      frameTimes: [0, 1000 / 60, 2000 / 60, 4000 / 60, 5000 / 60, 6000 / 60],
    },
    {
      refreshRateHz: 120,
      refreshEstimateMs: 1000 / 120,
      frameTimes: [0, 1000 / 120, 2000 / 120, 4000 / 120, 5000 / 120, 6000 / 120, 7000 / 120, 8000 / 120, 9000 / 120, 10000 / 120, 11000 / 120, 12000 / 120],
    },
    {
      refreshRateHz: 144,
      refreshEstimateMs: 1000 / 144,
      frameTimes: [0, 1000 / 144, 2000 / 144, 4000 / 144, 5000 / 144, 6000 / 144, 7000 / 144, 8000 / 144, 9000 / 144, 10000 / 144, 11000 / 144, 12000 / 144, 13000 / 144, 14000 / 144, 15000 / 144],
    },
  ])('voids a scored presentation with an internal skipped frame at $refreshRateHz Hz', ({ refreshEstimateMs, frameTimes }) => {
    const frames = new FakeFrames()
    const complete = vi.fn()
    const scheduler = new FrameTrialScheduler({
      requestFrame: frames.request,
      cancelFrame: frames.cancel,
      onStage: vi.fn(),
      onComplete: complete,
    })

    scheduler.start({ settleMs: 0, presentationMs: 100, maskMs: 0, refreshEstimateMs })
    frameTimes.forEach((now) => frames.frame(now))

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      valid: false,
      invalidReason: 'presentation-frame-gap',
      requestedDurationMs: 100,
    }))
    expect(complete.mock.calls[0]?.[0].measuredDurationMs).toBeLessThanOrEqual(100 + refreshEstimateMs)
  })

  it('cancels without completing', () => {
    const frames = new FakeFrames()
    const complete = vi.fn()
    const scheduler = new FrameTrialScheduler({ requestFrame: frames.request, cancelFrame: frames.cancel, onStage: vi.fn(), onComplete: complete })
    scheduler.start({ settleMs: 400, presentationMs: 100, maskMs: 80 })

    scheduler.cancel()

    expect(frames.cancel).toHaveBeenCalledWith(1)
    expect(complete).not.toHaveBeenCalled()
  })
})
