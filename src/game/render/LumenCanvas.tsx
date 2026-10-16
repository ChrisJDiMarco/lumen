import { useCallback, useEffect, useRef } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import type { Trial } from '../core/protocol'
import { FrameTrialScheduler, type PresentationStage, type TrialPresentationMetrics } from '../core/trialScheduler'
import { COLLECTIBLE_ANCHORS, quadraticBezierPoint, resolutionPath, trailSamples, type CollectibleKind, type QuadraticPath } from './cinematicGeometry'
import { selectQualityTier } from './quality'
import { peripheralPoint, stimulusMaskSites, trialRadius } from './stimulusGeometry'

export type ResponsePhase = 'stimulus' | 'identify' | 'locate' | 'resolved' | 'paused' | 'recovery'

export interface LumenCanvasProps {
  phase: ResponsePhase
  trial?: Trial
  highContrast?: boolean
  reducedMotion?: boolean
  targetScale?: number
  qualityTier?: 'auto' | 'high' | 'medium' | 'low'
  selectedSector?: number
  resolvedSector?: number
  responseCorrect?: boolean
  collectionLevel?: number
  onIdentify: (identity: Trial['centralGlyph']) => void
  onLocate: (sector: number) => void
  onPresentationComplete?: (metrics: TrialPresentationMetrics) => void
  onPresentationStage?: (stage: PresentationStage) => void
  onRendererFailure?: (reason: 'context-loss' | 'unsupported') => void
  onRendererReady?: (quality: 'high' | 'medium' | 'low') => void
}

const WORLD_WIDTH = 1600
const WORLD_HEIGHT = 900

interface SceneLayers {
  backdrop: Container
  ambient: Container
  isolation: Container
  stimuli: Container
  response: Container
  resolution: Container
}

interface FireflyMotion {
  readonly graphic: Graphics
  readonly baseX: number
  readonly baseY: number
  readonly phase: number
  readonly period: number
}

interface ResolutionMotion {
  readonly path: QuadraticPath
  readonly seed: Graphics
  readonly trail: readonly Graphics[]
  readonly bloom: Graphics
}

interface SceneMotion {
  readonly fireflies?: readonly FireflyMotion[]
  readonly resolution?: ResolutionMotion
}

export function createSceneLayers(stage: Container): SceneLayers {
  const layers: SceneLayers = {
    backdrop: new Container({ label: 'backdrop' }),
    ambient: new Container({ label: 'ambient-world' }),
    isolation: new Container({ label: 'stimulus-isolation' }),
    stimuli: new Container({ label: 'scored-stimuli' }),
    response: new Container({ label: 'response' }),
    resolution: new Container({ label: 'resolution' }),
  }
  stage.addChild(layers.backdrop, layers.ambient, layers.isolation, layers.stimuli, layers.response, layers.resolution)
  return layers
}

export function LumenCanvas({ phase, trial, highContrast = false, reducedMotion = false, targetScale = 1, qualityTier = 'auto', selectedSector = 0, resolvedSector, responseCorrect = false, collectionLevel = 0, onLocate, onPresentationComplete, onPresentationStage, onRendererFailure, onRendererReady }: LumenCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<{ app: Application; layers: SceneLayers } | null>(null)
  const schedulerRef = useRef<FrameTrialScheduler | null>(null)
  const geometryRef = useRef<{ width: number; height: number; dpr: number } | null>(null)
  const motionCleanupRef = useRef<(() => void) | null>(null)
  const onLocateRef = useRef(onLocate)
  const onPresentationCompleteRef = useRef(onPresentationComplete)
  const onPresentationStageRef = useRef(onPresentationStage)
  const onRendererFailureRef = useRef(onRendererFailure)
  const onRendererReadyRef = useRef(onRendererReady)
  onLocateRef.current = onLocate
  onPresentationCompleteRef.current = onPresentationComplete
  onPresentationStageRef.current = onPresentationStage
  onRendererFailureRef.current = onRendererFailure
  onRendererReadyRef.current = onRendererReady
  const resolvedQuality = qualityTier === 'auto' ? selectQualityTier({ devicePixelRatio: window.devicePixelRatio || 1, maxTextureSize: 4096, warmupP95Ms: 1000 / 60, reducedMotion }) : qualityTier

  const render = useCallback((stage: PresentationStage | ResponsePhase) => {
    if (!runtimeRef.current) return
    motionCleanupRef.current?.()
    const motion = drawScene(runtimeRef.current.layers, stage, trial, highContrast, reducedMotion, targetScale, selectedSector, resolvedSector, responseCorrect, collectionLevel, (sector) => onLocateRef.current(sector))
    motionCleanupRef.current = startSceneMotion(runtimeRef.current.app, motion, reducedMotion)
    hostRef.current?.setAttribute('data-stage', stage)
  }, [collectionLevel, highContrast, reducedMotion, resolvedSector, responseCorrect, selectedSector, targetScale, trial])

  const startPresentation = useCallback(() => {
    if (!trial || !runtimeRef.current) return
    schedulerRef.current?.cancel()
    motionCleanupRef.current?.()
    const lock = preparePresentationScene(runtimeRef.current.layers, trial, highContrast, reducedMotion, targetScale)
    motionCleanupRef.current = startSettleLockMotion(runtimeRef.current.app, lock, reducedMotion)
    schedulerRef.current = new FrameTrialScheduler({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      onStage: (stage) => {
        if (stage === 'present') {
          motionCleanupRef.current?.()
          motionCleanupRef.current = null
        }
        showPreparedStage(runtimeRef.current?.layers, stage)
        hostRef.current?.setAttribute('data-stage', stage)
        onPresentationStageRef.current?.(stage)
      },
      onComplete: (metrics) => onPresentationCompleteRef.current?.(metrics),
    })
    schedulerRef.current.start(import.meta.env.VITE_E2E_TEST_MODE === 'true'
      ? { settleMs: 16, presentationMs: 32, maskMs: 16, refreshEstimateMs: 1_000 }
      : { settleMs: 500, presentationMs: trial.durationMs, maskMs: 100 })
  }, [highContrast, reducedMotion, targetScale, trial])

  useEffect(() => {
    let cancelled = false
    let initialized = false
    let warmupFrame = 0
    const app = new Application()

    void app.init({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, qualityCap(resolvedQuality, reducedMotion)),
      resizeTo: hostRef.current ?? undefined,
      preference: 'webgl',
    }).then(() => {
      initialized = true
      if (cancelled || !hostRef.current) {
        app.destroy(true)
        return
      }
      app.stage.label = 'lumen-world'
      const layers = createSceneLayers(app.stage)
      hostRef.current.appendChild(app.canvas)
      app.canvas.setAttribute('aria-hidden', 'true')
      hostRef.current.setAttribute('data-renderer', 'warming')
      runtimeRef.current = { app, layers }
      fitWorld(app)
      if (phase === 'stimulus' && trial) preparePresentationScene(layers, trial, highContrast, reducedMotion, targetScale)
      else drawScene(layers, phase, trial, highContrast, reducedMotion, targetScale, selectedSector, resolvedSector, responseCorrect, collectionLevel, (sector) => onLocateRef.current(sector))
      app.render()
      const warmupSamples = Array.from({ length: 5 }, () => {
        const sampleStartedAt = performance.now()
        app.render()
        return Math.max(0.1, performance.now() - sampleStartedAt)
      }).sort((left, right) => left - right)
      const warmupP95Ms = warmupSamples[Math.ceil(warmupSamples.length * 0.95) - 1]
      const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl
      const maxTextureSize = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined
      const warmedQuality = qualityTier === 'auto' ? selectQualityTier({ devicePixelRatio: window.devicePixelRatio || 1, maxTextureSize: maxTextureSize ?? 4096, warmupP95Ms, reducedMotion }) : qualityTier
      app.renderer.resolution = Math.min(window.devicePixelRatio || 1, qualityCap(warmedQuality, reducedMotion))
      fitWorld(app)
      app.render()
      warmupFrame = requestAnimationFrame(() => {
        if (cancelled || !hostRef.current) return
        hostRef.current.setAttribute('data-quality', warmedQuality)
        hostRef.current.setAttribute('data-renderer', 'ready')
        onRendererReadyRef.current?.(warmedQuality)
        if (phase === 'stimulus') startPresentation()
        else render(phase)
      })
    }).catch((error: unknown) => {
      hostRef.current?.setAttribute('data-renderer', 'unavailable')
      hostRef.current?.setAttribute('data-error', error instanceof Error ? error.message : String(error))
      onRendererFailureRef.current?.('unsupported')
    })

    return () => {
      cancelled = true
      if (warmupFrame) cancelAnimationFrame(warmupFrame)
      schedulerRef.current?.cancel()
      motionCleanupRef.current?.()
      motionCleanupRef.current = null
      runtimeRef.current = null
      if (initialized) app.destroy(true)
    }
  }, [])

  useEffect(() => {
    if (!runtimeRef.current) return
    if (phase === 'stimulus') startPresentation()
    else render(phase)
  }, [phase, render, startPresentation])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!runtimeRef.current) return
      const next = { width: entry?.contentRect.width ?? host.clientWidth, height: entry?.contentRect.height ?? host.clientHeight, dpr: window.devicePixelRatio || 1 }
      const previous = geometryRef.current
      if (previous && (previous.width !== next.width || previous.height !== next.height || previous.dpr !== next.dpr)) schedulerRef.current?.invalidate('geometry-change')
      geometryRef.current = next
      fitWorld(runtimeRef.current.app)
    })
    resizeObserver.observe(host)
    const onVisibility = () => { if (document.hidden) schedulerRef.current?.invalidate('visibility-change') }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      schedulerRef.current?.invalidate('context-loss')
      host.setAttribute('data-renderer', 'recovering')
      onRendererFailureRef.current?.('context-loss')
    }
    document.addEventListener('visibilitychange', onVisibility)
    host.addEventListener('webglcontextlost', onContextLost, true)
    return () => {
      resizeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      host.removeEventListener('webglcontextlost', onContextLost, true)
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="lumen-canvas"
      role="img"
      aria-label="A moonlit bioluminescent forest surrounding the visual attention arena"
      data-phase={phase}
      data-quality={resolvedQuality}
    >
      <div className="canvas-fallback"><span>◐</span><p>The forest is gathering light…</p></div>
      <div className="canvas-recovery" role="status" aria-live="polite"><strong>The forest renderer paused.</strong><span>This glimpse will retry from a safe boundary.</span></div>
    </div>
  )
}

function qualityCap(tier: LumenCanvasProps['qualityTier'], reducedMotion: boolean): number {
  if (reducedMotion || tier === 'low') return 1
  if (tier === 'high') return 2
  return 1.5
}

function fitWorld(app: Application) {
  const scale = Math.min(app.screen.width / WORLD_WIDTH, app.screen.height / WORLD_HEIGHT)
  app.stage.scale.set(scale)
  app.stage.position.set((app.screen.width - WORLD_WIDTH * scale) / 2, (app.screen.height - WORLD_HEIGHT * scale) / 2)
}

function clearLayers(layers: SceneLayers) {
  Object.values(layers).forEach((layer: Container) => layer.removeChildren().forEach((child) => child.destroy()))
}

function drawScene(layers: SceneLayers, phase: PresentationStage | ResponsePhase, trial: Trial | undefined, highContrast: boolean, reducedMotion: boolean, targetScale: number, selectedSector: number, resolvedSector: number | undefined, responseCorrect: boolean, collectionLevel: number, onLocate: (sector: number) => void): SceneMotion {
  clearLayers(layers)
  const quiet = phase === 'settle' || phase === 'present' || phase === 'mask'
  drawBackdrop(layers.backdrop, quiet)
  const fireflies = drawAmbient(layers.ambient, reducedMotion, quiet)
  if (!quiet) drawCollectibles(layers.ambient, phase, collectionLevel)
  drawIsolation(layers.isolation, highContrast, quiet)
  drawFixation(layers.stimuli, highContrast, targetScale)
  if (phase === 'present' && trial) drawTrial(layers.stimuli, trial, highContrast, targetScale)
  if (phase === 'mask' && trial) drawMask(layers.stimuli, trial, highContrast, targetScale)
  if (phase === 'locate') drawResponseRing(layers.response, targetScale, selectedSector, onLocate)
  const resolution = phase === 'resolved' ? drawResolution(layers.resolution, reducedMotion, resolvedSector ?? selectedSector, responseCorrect) : undefined
  return { fireflies, resolution }
}

function preparePresentationScene(layers: SceneLayers, trial: Trial, highContrast: boolean, _reducedMotion: boolean, targetScale: number): Container {
  clearLayers(layers)
  drawBackdrop(layers.backdrop, true)
  drawAmbient(layers.ambient, true, true)
  drawIsolation(layers.isolation, highContrast, true)
  const lock = drawFixation(layers.stimuli, highContrast, targetScale)
  const present = new Container({ label: 'prepared-present', visible: false })
  const mask = new Container({ label: 'prepared-mask', visible: false })
  drawTrial(present, trial, highContrast, targetScale)
  drawMask(mask, trial, highContrast, targetScale)
  layers.stimuli.addChild(present, mask)
  return lock
}

function showPreparedStage(layers: SceneLayers | undefined, stage: PresentationStage) {
  if (!layers) return
  const present = layers.stimuli.children.find((child) => child.label === 'prepared-present')
  const mask = layers.stimuli.children.find((child) => child.label === 'prepared-mask')
  if (present) present.visible = stage === 'present'
  if (mask) mask.visible = stage === 'mask'
}

function drawBackdrop(layer: Container, quiet: boolean) {
  const water = new Graphics()
    .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x071326, alpha: quiet ? 0.3 : 0.08 })
    .ellipse(800, 530, 510, 185).fill({ color: 0x0d2c49, alpha: 0.2 })
    .ellipse(800, 545, 370, 105).stroke({ color: 0x72e4dc, width: 2, alpha: quiet ? 0.08 : 0.16 })
    .ellipse(800, 555, 240, 62).stroke({ color: 0xffd778, width: 1, alpha: quiet ? 0.04 : 0.12 })
  layer.addChild(water)
}

function drawTrial(layer: Container, trial: Trial, highContrast: boolean, targetScale: number) {
  const color = highContrast ? 0xffffff : 0xffd778
  const center = new Graphics()
  drawGlyph(center, trial.centralGlyph, 800, 420, targetScale, color)
  const radius = trialRadius(trial.eccentricity)
  const { x: targetX, y: targetY } = peripheralPoint(trial.sector, radius)
  center.circle(targetX, targetY, 30 * targetScale).fill({ color: 0x05101e, alpha: 0.72 })
  drawTargetSeed(center, targetX, targetY, targetScale, highContrast ? 0xffffff : 0x72e4dc)
  trial.distractorSectors.forEach((sector) => {
    const { x, y } = peripheralPoint(sector, radius)
    center.circle(x, y, 30 * targetScale).fill({ color: 0x05101e, alpha: 0.72 })
    center.circle(x, y, 14 * targetScale).stroke({ color: highContrast ? 0xd4dce5 : 0xa58be8, width: 4 * targetScale, alpha: 0.86 })
    center.moveTo(x + 8 * targetScale, y - 11 * targetScale).lineTo(x + 15 * targetScale, y - 18 * targetScale).stroke({ color: highContrast ? 0xd4dce5 : 0xa58be8, width: 3 * targetScale, alpha: 0.86 })
  })
  layer.addChild(center)
}

function drawMask(layer: Container, trial: Trial, highContrast: boolean, targetScale: number) {
  const color = highContrast ? 0xffffff : 0xaebfd0
  const mask = new Graphics()
  stimulusMaskSites(trial).forEach(({ x, y }, index) => drawRosette(mask, x, y, (index === 0 ? 30 : 22) * targetScale, color))
  layer.addChild(mask)
}

function drawAmbient(layer: Container, reducedMotion: boolean, quiet: boolean): readonly FireflyMotion[] | undefined {
  const flora = new Graphics()
  ;[[170, 690], [330, 760], [510, 700], [1110, 745], [1310, 675], [1450, 770]].forEach(([x, y], index) => {
    flora.circle(x, y, 8 + (index % 3) * 4).fill({ color: index % 2 ? 0xa58be8 : 0x72e4dc, alpha: 0.8 })
    flora.circle(x, y, 24 + (index % 3) * 5).fill({ color: index % 2 ? 0xa58be8 : 0x72e4dc, alpha: 0.12 })
  })
  layer.addChild(flora)
  if (!quiet) {
    const anchors = [[250, 265], [390, 190], [590, 130], [1020, 165], [1200, 230], [1410, 280], [1440, 520], [1260, 610], [410, 585], [180, 515]] as const
    const fireflies = anchors.map(([x, y], index) => {
      const graphic = new Graphics().circle(0, 0, 3 + index % 2).fill({ color: 0xffd778, alpha: reducedMotion ? 0.35 : 0.68 }).circle(0, 0, 10 + index % 3 * 2).fill({ color: 0xffd778, alpha: 0.05 })
      graphic.position.set(x, y)
      layer.addChild(graphic)
      return { graphic, baseX: x, baseY: y, phase: index * 0.73, period: 3_500 + index % 6 * 420 }
    })
    return fireflies
  }
  return undefined
}

function drawIsolation(layer: Container, highContrast: boolean, quiet: boolean) {
  const mist = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x061120, alpha: highContrast ? 0.4 : quiet ? 0.3 : 0.17 })
  for (let radius = 390; radius >= 210; radius -= 45) mist.circle(800, 420, radius).stroke({ color: 0x83d8dc, width: 1, alpha: quiet ? 0.055 : 0.03 })
  mist.circle(800, 420, 155).fill({ color: 0x294867, alpha: quiet ? 0.2 : 0.13 })
  layer.addChild(mist)
}

function drawFixation(layer: Container, highContrast: boolean, targetScale: number): Container {
  const color = highContrast ? 0xffffff : 0xedf3e8
  const lock = new Container({ label: 'fixation-lock' })
  lock.position.set(800, 420)
  const g = new Graphics().circle(0, 0, 88 * targetScale).stroke({ color: 0x72e4dc, width: 1, alpha: 0.17 }).circle(0, 0, 62 * targetScale).stroke({ color, width: 2, alpha: 0.42 }).circle(0, 0, 35 * targetScale).stroke({ color, width: 3, alpha: 0.9 }).circle(0, 0, 6 * targetScale).fill(color)
  ;[[0, -100, 0, -90], [100, 0, 90, 0], [0, 100, 0, 90], [-100, 0, -90, 0]].forEach(([x1, y1, x2, y2]) => g.moveTo(x1 * targetScale, y1 * targetScale).lineTo(x2 * targetScale, y2 * targetScale))
  g.stroke({ color: 0xffd778, width: 3, alpha: 0.86 })
  g.arc(0, 0, 106 * targetScale, -Math.PI * 0.78, -Math.PI * 0.34).stroke({ color: 0xffd778, width: 2, alpha: 0.64 })
  lock.addChild(g)
  layer.addChild(lock)
  return lock
}

function drawResponseRing(layer: Container, targetScale: number, selectedSector: number, onLocate: (sector: number) => void) {
  const centerX = 800
  const centerY = 420
  const horizontalRadius = 335
  const verticalRadius = 270
  const angle = selectedSector * Math.PI / 4 - Math.PI / 2
  const x = centerX + Math.cos(angle) * horizontalRadius
  const y = centerY + Math.sin(angle) * verticalRadius
  const guide = new Graphics().ellipse(centerX, centerY, horizontalRadius, verticalRadius).stroke({ color: 0x72e4dc, width: 2, alpha: 0.16 }).ellipse(centerX, centerY, horizontalRadius - 18, verticalRadius - 18).stroke({ color: 0xffd778, width: 1, alpha: 0.08 })
  guide.moveTo(centerX, centerY).lineTo(x, y).stroke({ color: 0xffd778, width: 2 * targetScale, alpha: 0.16 })
  layer.addChild(guide)
  void onLocate
}

function drawResolution(layer: Container, reducedMotion: boolean, sector: number, correct: boolean): ResolutionMotion | undefined {
  const path = resolutionPath(sector)
  const color = correct ? 0xffd778 : 0x72e4dc
  const arcs = new Graphics()
    .moveTo(path.start.x, path.start.y).quadraticCurveTo(path.control.x, path.control.y, path.end.x, path.end.y).stroke({ color, width: 3, alpha: 0.46 })
    .moveTo(path.start.x, path.start.y - 5).quadraticCurveTo(path.control.x, path.control.y - 7, path.end.x, path.end.y).stroke({ color: 0xedf3e8, width: 1, alpha: 0.2 })
    .circle(path.start.x, path.start.y, 28).stroke({ color, width: 4, alpha: 0.84 })
  layer.addChild(arcs)
  const bloom = new Graphics().circle(0, 0, correct ? 112 : 88).fill({ color, alpha: correct ? 0.12 : 0.075 }).circle(0, 0, 46).stroke({ color, width: 3, alpha: 0.82 })
  bloom.position.set(800, 420)
  layer.addChild(bloom)
  if (reducedMotion) return undefined
  bloom.alpha = 0
  bloom.scale.set(0.72)
  const trail = Array.from({ length: 16 }, (_, index) => {
    const dot = new Graphics().circle(0, 0, 2.5 + index * 0.16).fill({ color, alpha: 0.5 })
    dot.position.set(path.start.x, path.start.y)
    layer.addChild(dot)
    return dot
  })
  const seed = new Graphics().circle(0, 0, 8).fill({ color, alpha: 0.95 }).circle(0, 0, 18).fill({ color, alpha: 0.13 })
  seed.position.set(path.start.x, path.start.y)
  layer.addChild(seed)
  return { path, seed, trail, bloom }
}

function drawCollectibles(layer: Container, phase: PresentationStage | ResponsePhase, collectionLevel: number) {
  const visibleAlpha = phase === 'locate' ? 0.25 : phase === 'paused' || phase === 'recovery' ? 0.16 : 0.92
  const earned = Math.min(COLLECTIBLE_ANCHORS.length, Math.max(0, Math.floor(collectionLevel)))
  COLLECTIBLE_ANCHORS.forEach((anchor, index) => {
    const color = index < earned ? 0xffd778 : anchor.tone === 'cyan' ? 0x72e4dc : 0xa58be8
    const collectible = new Container({ label: `collectible-${index}` })
    collectible.position.set(anchor.x, anchor.y)
    collectible.alpha = visibleAlpha
    const glow = new Graphics().circle(0, 0, 38).fill({ color, alpha: 0.055 }).circle(0, 0, 4).fill({ color, alpha: 0.78 })
    const lineArt = new Graphics()
    drawCollectibleShape(lineArt, anchor.kind, color)
    collectible.addChild(glow, lineArt)
    layer.addChild(collectible)
  })
}

function drawCollectibleShape(graphics: Graphics, kind: CollectibleKind, color: number) {
  if (kind === 'moth') {
    graphics.moveTo(0, -5).bezierCurveTo(-12, -30, -40, -28, -35, 2).bezierCurveTo(-31, 25, -10, 24, 0, 9)
      .moveTo(0, -5).bezierCurveTo(12, -30, 40, -28, 35, 2).bezierCurveTo(31, 25, 10, 24, 0, 9)
      .moveTo(0, -8).lineTo(0, 30).moveTo(-2, -8).bezierCurveTo(-8, -20, -18, -23, -25, -25).moveTo(2, -8).bezierCurveTo(8, -20, 18, -23, 25, -25)
      .stroke({ color, width: 2.5, alpha: 0.92 })
    return
  }
  if (kind === 'leaf') {
    graphics.moveTo(22, -32).bezierCurveTo(-8, -31, -34, -10, -23, 25).bezierCurveTo(-4, 37, 26, 12, 22, -32)
      .moveTo(-22, 26).lineTo(16, -23).moveTo(-13, 14).lineTo(3, 13).moveTo(-4, 2).lineTo(-13, -1).moveTo(6, -11).lineTo(17, -7)
      .stroke({ color, width: 2.5, alpha: 0.92 })
    return
  }
  if (kind === 'lotus') {
    for (let index = 0; index < 7; index += 1) {
      const angle = -Math.PI / 2 + (index - 3) * 0.28
      const x = Math.cos(angle) * 30
      const y = Math.sin(angle) * 30
      graphics.moveTo(0, 18).quadraticCurveTo(x * 1.1, y * 0.55, x, y).quadraticCurveTo(x * 0.25, y * 0.35, 0, 18)
    }
    graphics.moveTo(-34, 20).quadraticCurveTo(0, 33, 34, 20).stroke({ color, width: 2.2, alpha: 0.92 })
    return
  }
  graphics.circle(0, 0, 30).stroke({ color, width: 2.5, alpha: 0.9 })
  for (let radius = 22; radius >= 6; radius -= 5) graphics.arc(0, 0, radius, -Math.PI * 0.2, Math.PI * 1.64)
  graphics.moveTo(26, 14).quadraticCurveTo(38, 21, 42, 31).stroke({ color, width: 2.2, alpha: 0.9 })
}

function startSettleLockMotion(app: Application, lock: Container, reducedMotion: boolean): () => void {
  if (reducedMotion) return () => undefined
  const startedAt = performance.now()
  lock.scale.set(1.12)
  lock.rotation = -0.3
  lock.alpha = 0.45
  const tick = () => {
    const progress = Math.min(1, (performance.now() - startedAt) / 180)
    const eased = 1 - (1 - progress) ** 3
    lock.scale.set(1.12 - eased * 0.12)
    lock.rotation = -0.3 + eased * 0.3
    lock.alpha = 0.45 + eased * 0.55
    if (progress >= 1) app.ticker.remove(tick)
  }
  app.ticker.add(tick)
  return () => {
    app.ticker.remove(tick)
    if (!lock.destroyed) {
      lock.scale.set(1)
      lock.rotation = 0
      lock.alpha = 1
    }
  }
}

function startSceneMotion(app: Application, motion: SceneMotion, reducedMotion: boolean): () => void {
  if (reducedMotion || (!motion.fireflies?.length && !motion.resolution)) return () => undefined
  const startedAt = performance.now()
  let resolutionComplete = false
  const tick = () => {
    const elapsed = performance.now() - startedAt
    motion.fireflies?.forEach((item) => {
      const wave = elapsed / item.period * Math.PI * 2 + item.phase
      item.graphic.position.set(item.baseX + Math.cos(wave) * 8, item.baseY + Math.sin(wave * 0.83) * 5)
      item.graphic.alpha = 0.52 + Math.sin(wave * 0.7) * 0.17
    })
    if (motion.resolution && !resolutionComplete) {
      const { path, seed, trail, bloom } = motion.resolution
      const flight = Math.max(0, Math.min(1, (elapsed - 80) / 420))
      const eased = 1 - (1 - flight) ** 2
      const seedPoint = quadraticBezierPoint(path, eased)
      seed.position.set(seedPoint.x, seedPoint.y)
      seed.scale.set(elapsed < 80 ? 1 - elapsed / 80 * 0.45 : 0.55 + flight * 0.45)
      trailSamples(path, eased, trail.length).forEach((sample, index) => {
        trail[index].position.set(sample.x, sample.y)
        trail[index].alpha = elapsed < 80 ? 0 : sample.alpha * (1 - Math.max(0, flight - 0.82) / 0.18)
      })
      const bloomProgress = Math.max(0, Math.min(1, (elapsed - 420) / 200))
      bloom.alpha = bloomProgress
      bloom.scale.set(0.72 + bloomProgress * 0.28)
      if (elapsed >= 650) {
        resolutionComplete = true
        seed.visible = false
        trail.forEach((dot) => { dot.visible = false })
        bloom.alpha = 1
        bloom.scale.set(1)
        if (!motion.fireflies?.length) app.ticker.remove(tick)
      }
    }
  }
  app.ticker.add(tick)
  return () => app.ticker.remove(tick)
}

function drawGlyph(graphics: Graphics, glyph: Trial['centralGlyph'], x: number, y: number, scale: number, color: number) {
  if (glyph === 'leaf') {
    graphics.moveTo(x + 20 * scale, y - 30 * scale).bezierCurveTo(x - 7 * scale, y - 27 * scale, x - 28 * scale, y - 7 * scale, x - 19 * scale, y + 23 * scale).bezierCurveTo(x - 5 * scale, y + 34 * scale, x + 23 * scale, y + 13 * scale, x + 20 * scale, y - 30 * scale).fill(color)
    graphics.moveTo(x - 17 * scale, y + 22 * scale).lineTo(x + 14 * scale, y - 20 * scale).stroke({ color: 0x071326, width: 3 * scale, alpha: 0.72 })
  } else {
    graphics.moveTo(x, y - 7 * scale).bezierCurveTo(x - 14 * scale, y - 31 * scale, x - 38 * scale, y - 24 * scale, x - 31 * scale, y + 5 * scale).bezierCurveTo(x - 25 * scale, y + 27 * scale, x - 7 * scale, y + 28 * scale, x, y + 12 * scale).bezierCurveTo(x + 7 * scale, y + 28 * scale, x + 25 * scale, y + 27 * scale, x + 31 * scale, y + 5 * scale).bezierCurveTo(x + 38 * scale, y - 24 * scale, x + 14 * scale, y - 31 * scale, x, y - 7 * scale).fill(color)
    graphics.moveTo(x, y - 8 * scale).lineTo(x, y + 28 * scale).stroke({ color: 0x071326, width: 3 * scale, alpha: 0.72 }).moveTo(x - 2 * scale, y - 8 * scale).bezierCurveTo(x - 8 * scale, y - 24 * scale, x - 18 * scale, y - 26 * scale, x - 24 * scale, y - 29 * scale).moveTo(x + 2 * scale, y - 8 * scale).bezierCurveTo(x + 8 * scale, y - 24 * scale, x + 18 * scale, y - 26 * scale, x + 24 * scale, y - 29 * scale).stroke({ color, width: 3 * scale })
  }
}

function drawTargetSeed(graphics: Graphics, x: number, y: number, scale: number, color: number) {
  graphics.moveTo(x, y - 18 * scale).lineTo(x + 8 * scale, y - 7 * scale).lineTo(x + 18 * scale, y).lineTo(x + 8 * scale, y + 7 * scale).lineTo(x, y + 18 * scale).lineTo(x - 8 * scale, y + 7 * scale).lineTo(x - 18 * scale, y).lineTo(x - 8 * scale, y - 7 * scale).closePath().fill(color).circle(x, y, 5 * scale).fill(0x071326)
}

function drawRosette(graphics: Graphics, x: number, y: number, radius: number, color: number) {
  for (let index = 0; index < 12; index += 1) {
    const angle = index * Math.PI / 6
    graphics.moveTo(x + Math.cos(angle) * radius * 0.35, y + Math.sin(angle) * radius * 0.35).lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  }
  graphics.stroke({ color, width: 2, alpha: 0.62 })
}
