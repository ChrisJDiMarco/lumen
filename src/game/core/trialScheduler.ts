export type PresentationStage = 'settle' | 'present' | 'mask' | 'response'

export interface TrialPresentationPlan {
  readonly settleMs: number
  readonly presentationMs: number
  readonly maskMs: number
  readonly refreshEstimateMs?: number
}

export interface TrialPresentationMetrics {
  readonly requestedOnset: number
  readonly actualOnset: number
  readonly requestedDurationMs: number
  readonly actualOffset: number
  readonly measuredDurationMs: number
  readonly refreshEstimateMs: number
  readonly valid: boolean
  readonly invalidReason?: string
}

interface SchedulerDependencies {
  readonly requestFrame: (callback: FrameRequestCallback) => number
  readonly cancelFrame: (handle: number) => void
  readonly onStage: (stage: PresentationStage) => void
  readonly onComplete: (metrics: TrialPresentationMetrics) => void
}

// A missed refresh produces a gap close to 2x the display interval. Keeping the
// limit below that boundary catches a skipped frame while allowing substantial
// timestamp and scheduling jitter on otherwise continuous presentations.
const presentationFrameGapMultiplier = 1.75

export class RefreshEstimator {
  private readonly deltas: number[] = []
  private previousFrame: number | null = null

  record(now: number): void {
    if (this.previousFrame !== null) {
      const delta = now - this.previousFrame
      if (delta >= 4 && delta <= 50) {
        this.deltas.push(delta)
        if (this.deltas.length > 30) this.deltas.shift()
      }
    }
    this.previousFrame = now
  }

  estimate(): number {
    if (this.deltas.length === 0) return 1000 / 60
    const sorted = [...this.deltas].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
}

export class FrameTrialScheduler {
  private frameHandle: number | null = null
  private stage: PresentationStage | null = null
  private stageStartedAt = 0
  private requestedOnset = 0
  private actualOnset = 0
  private actualOffset = 0
  private plan: TrialPresentationPlan | null = null
  private invalidReason: string | undefined
  private previousPresentationFrameAt: number | null = null
  private presentationFrameGapLimitMs = Number.POSITIVE_INFINITY
  private presentationFrameGapDetected = false
  private readonly refreshEstimator = new RefreshEstimator()

  constructor(private readonly dependencies: SchedulerDependencies) {}

  start(plan: TrialPresentationPlan): void {
    this.cancel()
    this.plan = plan
    this.stage = null
    this.invalidReason = undefined
    this.previousPresentationFrameAt = null
    this.presentationFrameGapLimitMs = Number.POSITIVE_INFINITY
    this.presentationFrameGapDetected = false
    this.frameHandle = this.dependencies.requestFrame(this.onFrame)
  }

  invalidate(reason: string): void {
    this.invalidReason ??= reason
  }

  cancel(): void {
    if (this.frameHandle !== null) this.dependencies.cancelFrame(this.frameHandle)
    this.frameHandle = null
    this.stage = null
    this.plan = null
    this.previousPresentationFrameAt = null
    this.presentationFrameGapLimitMs = Number.POSITIVE_INFINITY
    this.presentationFrameGapDetected = false
  }

  private readonly onFrame: FrameRequestCallback = (now) => {
    const plan = this.plan
    if (!plan) return

    if (this.stage === null || this.stage === 'settle') this.refreshEstimator.record(now)
    if (this.stage === 'present') this.validatePresentationFrame(now)
    if (this.stage === null) {
      this.enter('settle', now)
      if (plan.settleMs === 0) this.beginPresentation(now)
    } else if (this.stage === 'settle' && now - this.stageStartedAt >= plan.settleMs) {
      this.beginPresentation(now)
    } else if (this.stage === 'present' && now - this.actualOnset >= plan.presentationMs) {
      this.actualOffset = now
      this.enter('mask', now)
      if (plan.maskMs === 0) this.finish(now)
    } else if (this.stage === 'mask' && now - this.stageStartedAt >= plan.maskMs) {
      this.finish(now)
    }

    if (this.plan) this.frameHandle = this.dependencies.requestFrame(this.onFrame)
  }

  private beginPresentation(now: number): void {
    const plan = this.plan
    if (!plan) return
    this.requestedOnset = this.stageStartedAt + plan.settleMs
    this.actualOnset = now
    const refreshEstimateMs = plan.refreshEstimateMs ?? this.refreshEstimator.estimate()
    this.previousPresentationFrameAt = now
    this.presentationFrameGapLimitMs = refreshEstimateMs * presentationFrameGapMultiplier
    this.enter('present', now)
  }

  private validatePresentationFrame(now: number): void {
    if (this.previousPresentationFrameAt !== null && now - this.previousPresentationFrameAt > this.presentationFrameGapLimitMs) {
      this.presentationFrameGapDetected = true
    }
    this.previousPresentationFrameAt = now
  }

  private enter(stage: PresentationStage, now: number): void {
    this.stage = stage
    this.stageStartedAt = now
    this.dependencies.onStage(stage)
  }

  private finish(now: number): void {
    const plan = this.plan
    if (!plan) return
    const refreshEstimateMs = plan.refreshEstimateMs ?? this.refreshEstimator.estimate()
    const measuredDurationMs = this.actualOffset - this.actualOnset
    const exposureMissed = Math.abs(measuredDurationMs - plan.presentationMs) > refreshEstimateMs
    const invalidReason = this.invalidReason
      ?? (exposureMissed ? 'exposure-tolerance' : undefined)
      ?? (this.presentationFrameGapDetected ? 'presentation-frame-gap' : undefined)
    const metrics: TrialPresentationMetrics = {
      requestedOnset: this.requestedOnset,
      actualOnset: this.actualOnset,
      requestedDurationMs: plan.presentationMs,
      actualOffset: this.actualOffset || now,
      measuredDurationMs,
      refreshEstimateMs,
      valid: invalidReason === undefined,
      ...(invalidReason ? { invalidReason } : {}),
    }
    this.enter('response', now)
    this.plan = null
    this.frameHandle = null
    this.dependencies.onComplete(metrics)
  }
}
