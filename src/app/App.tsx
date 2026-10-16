import { useEffect, useRef, useState } from 'react'

import { createLumenRepository, defaultPreferences, type LumenPreferences, type SavedJourney } from '../data/lumenRepository'
import { CHECKPOINT_SCHEMA_VERSION, type JourneyCheckpoint } from '../data/checkpoint'
import { createSession, recordTrial, standardProtocol, type CentralGlyph, type TrainingSession } from '../game/core/protocol'
import { summarizeSession } from '../game/core/sessionSummary'
import type { PresentationStage, TrialPresentationMetrics } from '../game/core/trialScheduler'
import { interpretGameKey } from '../game/input/gameInput'
import { LumenCanvas, type ResponsePhase } from '../game/render/LumenCanvas'
import { loadGameAssets, type GameAssetLoadOptions, type GameAssetLoadResult } from '../game/render/assets'
import { createProgressSegments } from '../game/render/cinematicGeometry'
import { LumenAudio } from '../platform/lumenAudio'
import '../styles/tokens.css'
import '../styles/app.css'

type View = 'landing' | 'setup' | 'home' | 'practice' | 'journey' | 'results' | 'history' | 'settings' | 'how' | 'sources'

export interface AppProps {
  initialView?: View
  assetLoader?: (options?: GameAssetLoadOptions) => Promise<GameAssetLoadResult>
}

type Preferences = LumenPreferences
type InputSource = 'pointer' | 'keyboard'
interface TrialOutcome { readonly centralCorrect: boolean; readonly peripheralCorrect: boolean; readonly sector: number }
const initialPreferences = defaultPreferences
type AssetState = 'idle' | 'loading' | 'ready' | 'degraded' | 'error'

export function App({ initialView = 'landing', assetLoader = loadGameAssets }: AppProps) {
  const [view, setView] = useState<View>(initialView)
  const [returnView, setReturnView] = useState<View>(initialView)
  const [researchOpen, setResearchOpen] = useState(false)
  const [preferences, setPreferences] = useState(initialPreferences)
  const [phase, setPhase] = useState<ResponsePhase>('stimulus')
  const [identity, setIdentity] = useState<CentralGlyph | null>(null)
  const [lastOutcome, setLastOutcome] = useState<TrialOutcome | null>(null)
  const [session, setSession] = useState<TrainingSession>(() => createSession('lumen-preview', standardProtocol))
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [voidReason, setVoidReason] = useState<string | null>(null)
  const [journeys, setJourneys] = useState<readonly SavedJourney[]>([])
  const [checkpoint, setCheckpoint] = useState<JourneyCheckpoint | null>(null)
  const [checkpointStatus, setCheckpointStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [journeySaveStatus, setJourneySaveStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [settingsStatus, setSettingsStatus] = useState('Saved on this device')
  const [systemReducedMotion, setSystemReducedMotion] = useState(false)
  const [supportedDisplay, setSupportedDisplay] = useState(true)
  const [assetState, setAssetState] = useState<AssetState>(import.meta.env.MODE === 'test' && assetLoader === loadGameAssets ? 'ready' : 'idle')
  const [assetAttempt, setAssetAttempt] = useState(0)
  const [rendererAttempt, setRendererAttempt] = useState(0)
  const [resolvedQuality, setResolvedQuality] = useState<'high' | 'medium' | 'low'>('medium')
  const repositoryRef = useRef(createLumenRepository())
  const mainRef = useRef<HTMLElement>(null)
  const identityAnswerRef = useRef<CentralGlyph | null>(null)
  const presentationMetricsRef = useRef<TrialPresentationMetrics | null>(null)
  const responseStartedAtRef = useRef(0)
  const inputSourceRef = useRef<InputSource | 'unknown'>('unknown')
  const contextLossesRef = useRef(0)
  const timingFailuresRef = useRef(0)
  const rendererFailuresRef = useRef(0)
  const audioRef = useRef(new LumenAudio())
  const preferencesTouchedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    const repository = repositoryRef.current
    let cancelled = false
    const load = Promise.all([repository.loadPreferences(), repository.listJourneys(), repository.loadCheckpoint()])
    void load.then(([savedPreferences, savedJourneys, savedCheckpoint]) => {
      if (cancelled) return
      if (!preferencesTouchedRef.current) setPreferences(savedPreferences)
      setJourneys(savedJourneys)
      setCheckpoint(savedCheckpoint)
    }).catch(() => { if (!cancelled) setSettingsStatus('Local data could not be opened. New play will remain in memory.') })
    return () => { cancelled = true; void load.finally(() => repository.close()).catch(() => undefined) }
  }, [])

  useEffect(() => {
    if (assetState === 'ready' || assetState === 'degraded') return
    let cancelled = false
    setAssetState('loading')
    void assetLoader({ retryFailed: assetAttempt > 0 }).then((result) => {
      if (!cancelled) setAssetState(result.status)
    }).catch(() => {
      if (!cancelled) setAssetState('error')
    })
    return () => { cancelled = true }
  }, [assetAttempt, assetLoader])

  useEffect(() => {
    audioRef.current.configure({
      enabled: preferences.sound,
      master: preferences.masterVolume / 100,
      music: preferences.musicVolume / 100,
      ambience: preferences.ambienceVolume / 100,
      feedback: preferences.feedbackVolume / 100,
    })
  }, [preferences.ambienceVolume, preferences.feedbackVolume, preferences.masterVolume, preferences.musicVolume, preferences.sound])

  useEffect(() => {
    audioRef.current.setPresentationQuiet(phase === 'stimulus')
  }, [phase])

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const display = window.matchMedia('(min-width: 1024px) and (min-height: 700px)')
    const updateMotion = () => setSystemReducedMotion(motion.matches)
    const updateDisplay = () => setSupportedDisplay(display.matches)
    updateMotion()
    updateDisplay()
    motion.addEventListener('change', updateMotion)
    display.addEventListener('change', updateDisplay)
    return () => {
      motion.removeEventListener('change', updateMotion)
      display.removeEventListener('change', updateDisplay)
    }
  }, [])

  useEffect(() => {
    mainRef.current?.focus()
  }, [view])

  const navigate = (next: View) => {
    setView(next)
  }

  const inActiveSession = view === 'practice' || view === 'journey'
  const presentationLocked = inActiveSession && supportedDisplay && phase === 'stimulus'
  const navigationLocked = presentationLocked || checkpointStatus === 'saving' || journeySaveStatus === 'saving'

  const requestSessionNavigation = (next: View) => {
    if (!inActiveSession || phase === 'resolved' || phase === 'recovery' || phase === 'paused' || !supportedDisplay) {
      navigate(next)
      return
    }
    if (presentationLocked) return
    if (window.confirm('Leave this journey? Lumen will resume from the last safely completed glimpse.')) navigate(next)
  }

  useEffect(() => {
    if (!inActiveSession) return
    const preserveJourney = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preserveJourney)
    return () => window.removeEventListener('beforeunload', preserveJourney)
  }, [inActiveSession])

  const openUtility = (next: 'history' | 'settings') => {
    if (view === next) return
    if (view !== 'history' && view !== 'settings') setReturnView(view)
    requestSessionNavigation(next)
  }

  const updatePreferences = (patch: Partial<Preferences>) => {
    preferencesTouchedRef.current = true
    setPreferences((current) => {
      const next = { ...current, ...patch }
      setSettingsStatus('Saving…')
      void repositoryRef.current.savePreferences(next)
        .then(() => { if (mountedRef.current) setSettingsStatus('Saved on this device') })
        .catch(() => { if (mountedRef.current) setSettingsStatus('Could not save. Your current choices still apply.') })
      return next
    })
  }

  const togglePreference = (key: 'largeTargets' | 'highContrast' | 'reducedMotion' | 'sound' | 'reminders' | 'diagnostics') => {
    updatePreferences({ [key]: !preferences[key] })
  }

  const startPlay = () => {
    if ('AudioContext' in window) void audioRef.current.start().then(() => audioRef.current.configure({ enabled: preferences.sound, master: preferences.masterVolume / 100, music: preferences.musicVolume / 100, ambience: preferences.ambienceVolume / 100, feedback: preferences.feedbackVolume / 100 })).catch(() => setSettingsStatus('Sound could not start. Visual play remains available.'))
    setPracticeIndex(0)
    setSession(createSession(`practice-${crypto.randomUUID()}-0`, standardProtocol))
    setPhase('stimulus')
    setIdentity(null)
    navigate('setup')
  }

  const resumeJourney = () => {
    if (!checkpoint) return
    setSession(checkpoint.session)
    setPhase('stimulus')
    setIdentity(null)
    setLastOutcome(null)
    navigate(checkpoint.mode)
  }

  const beginResponse = () => {
    setVoidReason(null)
    presentationMetricsRef.current = null
    identityAnswerRef.current = null
    setPhase('stimulus')
    setIdentity(null)
    setLastOutcome(null)
    inputSourceRef.current = 'unknown'
  }

  const presentationComplete = (metrics: TrialPresentationMetrics) => {
    presentationMetricsRef.current = metrics
    if (!metrics.valid) {
      if (metrics.invalidReason === 'exposure-tolerance' || metrics.invalidReason === 'presentation-frame-gap') {
        timingFailuresRef.current += 1
        if (timingFailuresRef.current >= 3) updatePreferences({ qualityTier: 'low' })
      }
      if (view === 'journey') setSession((current) => recordTrial(current, { centralCorrect: false, peripheralCorrect: false, valid: false, responseMs: 0, invalidReason: metrics.invalidReason ?? 'timing-quality' }))
      setVoidReason(metrics.invalidReason ?? 'timing-quality')
      setPhase('recovery')
      return
    }
    responseStartedAtRef.current = performance.now()
    setPhase('identify')
  }

  const chooseIdentity = (choice: CentralGlyph, source: InputSource = 'pointer') => {
    if (phase !== 'identify') return
    inputSourceRef.current = source
    setIdentity(choice)
    identityAnswerRef.current = choice
    setPhase('locate')
  }

  const chooseLocation = (sector: number, source: InputSource = 'pointer') => {
    if (phase !== 'locate') return
    inputSourceRef.current = source
    const centralCorrect = identityAnswerRef.current === session.currentTrial.centralGlyph
    const peripheralCorrect = sector === session.currentTrial.sector
    const correct = centralCorrect && peripheralCorrect
    setLastOutcome({ centralCorrect, peripheralCorrect, sector })
    audioRef.current.playFeedback(correct)
    if (view === 'practice') {
      setPhase('resolved')
      return
    }
    const next = recordTrial(session, {
      centralCorrect,
      peripheralCorrect,
      valid: presentationMetricsRef.current?.valid ?? false,
      responseMs: Math.round(performance.now() - responseStartedAtRef.current),
      invalidReason: presentationMetricsRef.current?.invalidReason,
      requestedPresentationMs: presentationMetricsRef.current?.requestedDurationMs,
      measuredPresentationMs: presentationMetricsRef.current?.measuredDurationMs,
      refreshEstimateMs: presentationMetricsRef.current?.refreshEstimateMs,
      inputType: inputSourceRef.current,
    })
    setSession(next)
    const nextCheckpoint: JourneyCheckpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      boundary: 'inter-trial',
      savedAt: new Date().toISOString(),
      mode: 'journey',
      completedTrials: next.completedTrials.length,
      targetTrials: 24,
      session: next,
    }
    if (next.completedTrials.length < 24) {
      setCheckpointStatus('saving')
      void repositoryRef.current.saveCheckpoint(nextCheckpoint).then(() => {
        if (!mountedRef.current) return
        setCheckpoint(nextCheckpoint)
        setCheckpointStatus('saved')
      }).catch(() => { if (mountedRef.current) setCheckpointStatus('error') })
    }
    setPhase('resolved')
  }

  const advanceJourney = async (mode: 'practice' | 'journey') => {
    if (mode === 'practice') {
      if (practiceIndex < 3) {
        const nextPractice = practiceIndex + 1
        setPracticeIndex(nextPractice)
        setSession(createSession(`practice-${crypto.randomUUID()}-${nextPractice}`, standardProtocol))
        beginResponse()
        return
      }
      setSession(createSession(crypto.randomUUID(), standardProtocol))
      setCheckpoint(null)
      void repositoryRef.current.clearCheckpoint()
      beginResponse()
      navigate('journey')
      return
    }
    if (session.completedTrials.length < 24) {
      beginResponse()
      return
    }
    const summary = summarizeSession(session)
    const journey: SavedJourney = {
      id: crypto.randomUUID(),
      completedAt: new Date().toISOString(),
      accuracy: summary.accuracy,
      averageResponseMs: summary.averageResponseMs,
      finalDifficulty: session.difficulty,
      completedTrials: session.completedTrials.length,
      protocolVersion: session.protocolVersion,
      seed: session.seed,
      platform: navigator.userAgent.includes('Mac') ? 'macOS/webview' : navigator.platform || 'web',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio || 1,
      trials: session.completedTrials,
      voidedTrials: session.voidedTrials,
    }
    setJourneySaveStatus('saving')
    try {
      await repositoryRef.current.saveJourney(journey)
      await repositoryRef.current.clearCheckpoint()
      if (!mountedRef.current) return
      setCheckpoint(null)
      setJourneys((current) => [journey, ...current].slice(0, 30))
      setJourneySaveStatus('idle')
      navigate('results')
    } catch {
      if (mountedRef.current) setJourneySaveStatus('error')
    }
  }

  const inUtilityView = view === 'history' || view === 'settings'
  const effectiveReducedMotion = preferences.reducedMotion || systemReducedMotion

  return (
    <div className={`app view-${view} asset-${assetState} ${effectiveReducedMotion ? 'reduce-motion' : ''} ${preferences.highContrast ? 'high-contrast' : ''}`}>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="topbar" inert={researchOpen ? true : undefined} aria-hidden={researchOpen ? true : undefined}>
        <button className="wordmark" disabled={navigationLocked} onClick={() => requestSessionNavigation('home')} aria-label="Lumen home">
          <span className="wordmark-mark" aria-hidden="true">◐</span>
          Lumen
        </button>
        <nav aria-label="Utility navigation">
          <button disabled={navigationLocked} className={view === 'history' ? 'active' : ''} aria-current={view === 'history' ? 'page' : undefined} onClick={() => openUtility('history')}>History</button>
          <button disabled={navigationLocked} className={view === 'settings' ? 'active' : ''} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => openUtility('settings')}>Settings</button>
        </nav>
      </header>

      <main ref={mainRef} id="main" tabIndex={-1} inert={researchOpen ? true : undefined} aria-hidden={researchOpen ? true : undefined}>
        {view === 'landing' && (
          <Landing onPlay={startPlay} onResume={resumeJourney} resumeAvailable={Boolean(checkpoint) && (assetState === 'ready' || assetState === 'degraded' || assetState === 'error')} onResearch={() => setResearchOpen(true)} onHow={() => navigate('how')} />
        )}
        {view === 'setup' && (
          <Setup preferences={preferences} assetState={assetState} onRetryAssets={() => { setAssetState('idle'); setAssetAttempt((attempt) => attempt + 1) }} onToggle={togglePreference} onInputMode={(inputMode) => updatePreferences({ inputMode })} onBack={() => navigate('landing')} onContinue={() => { beginResponse(); navigate('practice') }} />
        )}
        {view === 'home' && <Home journeys={journeys} reminders={preferences.reminders} resumeAvailable={Boolean(checkpoint)} assetsPlayable={assetState === 'ready' || assetState === 'degraded' || assetState === 'error'} onPlay={() => { if (checkpoint) resumeJourney(); else { setSession(createSession(crypto.randomUUID(), standardProtocol)); beginResponse(); navigate('journey') } }} />}
        {view === 'how' && <HowItWorks onBack={() => navigate('landing')} onPlay={startPlay} />}
        {view === 'sources' && <Sources onBack={() => navigate('landing')} />}
        {(view === 'practice' || view === 'journey') && (
          <PlayScreen
            mode={view}
            phase={phase}
            preferences={preferences}
            identity={identity}
            lastOutcome={lastOutcome}
            session={session}
            practiceIndex={practiceIndex}
            supportedDisplay={supportedDisplay}
            reducedMotion={effectiveReducedMotion}
            voidReason={voidReason}
            checkpointStatus={checkpointStatus}
            journeySaveStatus={journeySaveStatus}
            rendererAttempt={rendererAttempt}
            resolvedQuality={resolvedQuality}
            onIdentify={chooseIdentity}
            onLocate={chooseLocation}
            onPresentationComplete={presentationComplete}
            onRetry={() => {
              if (voidReason === 'context-loss' || voidReason === 'unsupported') setRendererAttempt((attempt) => attempt + 1)
              beginResponse()
            }}
            onPause={() => setPhase('paused')}
            onResume={() => setPhase(identity ? 'locate' : 'identify')}
            onRendererFailure={(reason) => {
              rendererFailuresRef.current += 1
              if (reason === 'context-loss') contextLossesRef.current += 1
              if (contextLossesRef.current >= 2 || rendererFailuresRef.current >= 2) updatePreferences({ qualityTier: 'low' })
              setVoidReason(reason)
              setPhase('recovery')
            }}
            onRendererReady={setResolvedQuality}
            onFinish={() => { void advanceJourney(view) }}
          />
        )}
        {view === 'results' && <Results session={session} onHome={() => navigate('home')} onAgain={() => { setSession(createSession(crypto.randomUUID(), standardProtocol)); beginResponse(); navigate('journey') }} />}
        {view === 'history' && <History journeys={journeys} onBack={() => navigate(returnView)} />}
        {view === 'settings' && <Settings preferences={preferences} status={settingsStatus} onToggle={togglePreference} onChange={updatePreferences} onExport={async () => {
          const data = await repositoryRef.current.exportData()
          const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `lumen-data-${new Date().toISOString().slice(0, 10)}.json`
          anchor.click()
          URL.revokeObjectURL(url)
        }} onDelete={async () => {
          await repositoryRef.current.deleteAllData()
          setPreferences(defaultPreferences)
          setJourneys([])
          setSettingsStatus('Local Lumen data deleted')
        }} onBack={() => navigate(returnView)} />}
      </main>

      {!inUtilityView && !inActiveSession && <footer inert={researchOpen ? true : undefined} aria-hidden={researchOpen ? true : undefined}>Designed for a quiet three-minute pause. Your play stays on this device.</footer>}
      {researchOpen && <ResearchDialog onClose={() => setResearchOpen(false)} onSources={() => { setResearchOpen(false); navigate('sources') }} />}
    </div>
  )
}

function Landing({ onPlay, onResume, resumeAvailable, onResearch, onHow }: { onPlay: () => void; onResume: () => void; resumeAvailable: boolean; onResearch: () => void; onHow: () => void }) {
  return (
    <section className="landing scenic-shell" aria-labelledby="landing-title">
      <div className="hero-copy">
        <p className="eyebrow">A visual attention journey</p>
        <h1 id="landing-title">Notice more,<br /><em>a little faster.</em></h1>
        <p className="hero-intro">Follow brief sparks through a living forest. Three calm minutes, shaped around your recent play.</p>
        <div className="button-row">
          <button className="button primary" onClick={resumeAvailable ? onResume : onPlay}>{resumeAvailable ? 'Resume saved journey' : 'Play a journey'} <span aria-hidden="true">→</span></button>
          <button className="button quiet" onClick={onHow}>How it works</button>
        </div>
      </div>
      <div className="lumen-orbit" aria-hidden="true"><span /><i>◐</i></div>
      <article className="research-card">
        <div className="research-glyph" aria-hidden="true">✦</div>
        <div>
          <h2>Built from a promising research idea</h2>
          <p>Adaptive visual speed training has produced encouraging long-term results in the ACTIVE trial. New biomarker findings are preliminary. Lumen is inspired by this work, but Lumen itself has not been clinically tested.</p>
          <button className="text-button" onClick={onResearch}>Read the research <span aria-hidden="true">↗</span></button>
        </div>
      </article>
    </section>
  )
}

function Setup({ preferences, assetState, onRetryAssets, onToggle, onInputMode, onBack, onContinue }: {
  preferences: Preferences
  assetState: AssetState
  onRetryAssets: () => void
  onToggle: (key: 'largeTargets' | 'highContrast' | 'reducedMotion' | 'sound') => void
  onInputMode: (mode: Preferences['inputMode']) => void
  onBack: () => void
  onContinue: () => void
}) {
  const canContinue = assetState === 'ready' || assetState === 'degraded' || assetState === 'error'
  const assetMessage = assetState === 'degraded' || assetState === 'error'
    ? 'Lumen is ready with simplified vector scenery. Gameplay and scoring are fully available.'
    : 'Preparing visual assets before the first scored frame.'
  return (
    <section className="page-card setup-page" aria-labelledby="setup-title" aria-busy={assetState === 'idle' || assetState === 'loading'}>
      <p className="eyebrow">Before the first light</p>
      <h1 id="setup-title">Make Lumen comfortable</h1>
      <p className="lede">These choices change the atmosphere, never your score. Recommended settings are ready to use.</p>
      <div className="choice-grid">
        <Toggle title="Larger targets" detail="Increase symbol and response-ring size." checked={preferences.largeTargets} onChange={() => onToggle('largeTargets')} />
        <Toggle title="High contrast" detail="Separate stimuli more strongly from the forest." checked={preferences.highContrast} onChange={() => onToggle('highContrast')} />
        <Toggle title="Reduced motion" detail="Replace ripple and drift with gentle fades." checked={preferences.reducedMotion} onChange={() => onToggle('reducedMotion')} />
        <Toggle title="Sound" detail="Ambient forest and answer feedback." checked={preferences.sound} onChange={() => onToggle('sound')} />
      </div>
      <fieldset className="segmented-field"><legend>Preferred input</legend><p>Lumen always keeps pointer and keyboard controls available.</p><div>{(['auto', 'pointer', 'keyboard'] as const).map((mode) => <label key={mode}><input type="radio" name="setup-input" value={mode} checked={preferences.inputMode === mode} onChange={() => onInputMode(mode)} /><span>{mode === 'auto' ? 'Automatic' : mode[0].toUpperCase() + mode.slice(1)}</span></label>)}</div></fieldset>
      <div className="button-row split"><button className="button quiet" onClick={onBack}>Back</button><div className="setup-actions">{(assetState === 'degraded' || assetState === 'error') && <button className="button quiet" onClick={onRetryAssets}>Retry scenery</button>}<button className="button primary" disabled={!canContinue} aria-describedby={assetState !== 'ready' ? 'asset-status' : undefined} onClick={onContinue}>{canContinue ? 'Begin practice' : 'Preparing forest…'}</button></div></div>{assetState !== 'ready' && <p id="asset-status" role="status" aria-live="polite" aria-atomic="true">{assetMessage}</p>}
    </section>
  )
}

function Toggle({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="toggle-card">
      <span><strong>{title}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch" aria-hidden="true" />
    </label>
  )
}

function Home({ journeys, reminders, resumeAvailable, assetsPlayable, onPlay }: { journeys: readonly SavedJourney[]; reminders: boolean; resumeAvailable: boolean; assetsPlayable: boolean; onPlay: () => void }) {
  const completed = journeys.length
  const progress = Math.min(100, Math.round(completed / 7 * 100))
  const remaining = Math.max(0, 7 - completed)
  const today = new Date().toDateString()
  const journeysToday = journeys.filter((journey) => new Date(journey.completedAt).toDateString() === today).length
  const restorationState = Math.min(3, Math.floor(completed / 2))
  return (
    <section className={`home scenic-shell restoration-${restorationState}`} aria-labelledby="home-title">
      <div className="home-copy">
        <p className="eyebrow">The forest remembers</p>
        <h1 id="home-title">Welcome back<br />to blue hour.</h1>
        <p>{remaining ? `${remaining} ${remaining === 1 ? 'journey' : 'journeys'} until the moon garden is fully restored.` : 'The moon garden is fully awake.'}</p>
        <button className="button primary" disabled={!assetsPlayable} onClick={onPlay}>{assetsPlayable ? resumeAvailable ? 'Resume saved journey' : 'Begin a journey' : 'Preparing forest…'} <span aria-hidden="true">→</span></button>
      </div>
      <div className="milestone-card"><span>Forest restored</span><strong>{progress}%</strong><progress max="100" value={progress}>{progress}%</progress><small>{remaining ? 'Next: moon garden' : 'Restoration complete'}</small></div>
      {reminders && journeysToday >= 2 && <aside className="fatigue-note"><strong>A quiet pause may help</strong><p>You have completed two journeys today. Lumen will be here when your eyes feel rested.</p></aside>}
    </section>
  )
}

function HowItWorks({ onBack, onPlay }: { onBack: () => void; onPlay: () => void }) {
  return (
    <section className="page-card" aria-labelledby="how-title">
      <p className="eyebrow">One simple rhythm</p><h1 id="how-title">How it works</h1>
      <ol className="steps">
        <li><span>1</span><div><strong>Notice the center</strong><p>Two symbols appear briefly. Remember the one at the center.</p></div></li>
        <li><span>2</span><div><strong>Catch the edge</strong><p>At the same moment, a spark appears farther out. Remember where.</p></div></li>
        <li><span>3</span><div><strong>Answer in order</strong><p>Choose the center symbol, then the spark’s location. Lumen gently adapts.</p></div></li>
      </ol>
      <div className="button-row"><button className="button quiet" onClick={onBack}>Back</button><button className="button primary" onClick={onPlay}>Set up my journey</button></div>
    </section>
  )
}

function PlayScreen({ mode, phase, preferences, identity, lastOutcome, session, practiceIndex, supportedDisplay, reducedMotion, voidReason, checkpointStatus, journeySaveStatus, rendererAttempt, resolvedQuality, onIdentify, onLocate, onPresentationComplete, onRendererFailure, onRendererReady, onRetry, onPause, onResume, onFinish }: {
  mode: 'practice' | 'journey'
  phase: ResponsePhase
  preferences: Preferences
  identity: CentralGlyph | null
  lastOutcome: TrialOutcome | null
  session: TrainingSession
  practiceIndex: number
  supportedDisplay: boolean
  reducedMotion: boolean
  voidReason: string | null
  checkpointStatus: 'idle' | 'saving' | 'saved' | 'error'
  journeySaveStatus: 'idle' | 'saving' | 'error'
  rendererAttempt: number
  resolvedQuality: 'high' | 'medium' | 'low'
  onIdentify: (identity: CentralGlyph, source?: InputSource) => void
  onLocate: (sector: number, source?: InputSource) => void
  onPresentationComplete: (metrics: TrialPresentationMetrics) => void
  onRendererFailure: (reason: 'context-loss' | 'unsupported') => void
  onRendererReady: (quality: 'high' | 'medium' | 'low') => void
  onRetry: () => void
  onPause: () => void
  onResume: () => void
  onFinish: () => void
}) {
  const [identityIndex, setIdentityIndex] = useState(0)
  const [keyboardSector, setKeyboardSector] = useState(0)
  const [presentationStage, setPresentationStage] = useState<PresentationStage>('settle')
  const responseHeadingRef = useRef<HTMLParagraphElement>(null)
  const glyphButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const sectorButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const actionButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (phase === 'stimulus') {
      setIdentityIndex(0)
      setKeyboardSector(0)
      return
    }
    if (phase === 'identify') glyphButtonRefs.current[identityIndex]?.focus({ preventScroll: true })
    else if (phase === 'locate') sectorButtonRefs.current[keyboardSector]?.focus({ preventScroll: true })
    else if (phase === 'paused' || phase === 'recovery' || phase === 'resolved') actionButtonRef.current?.focus({ preventScroll: true })
  }, [phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      if ((phase === 'identify' || phase === 'locate') && event.key === 'Escape') { onPause(); return }
      if (phase === 'paused' && (event.key === 'Enter' || event.key === 'Escape')) { onResume(); return }
      if (phase === 'identify' && ['1', '2', 'a', 's'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        const index = event.key === '1' || event.key.toLowerCase() === 'a' ? 0 : 1
        onIdentify(session.currentTrial.centralChoices[index], 'keyboard')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onIdentify, onPause, onResume, phase, session.currentTrial.centralChoices])

  const moveIdentitySelection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith('Arrow')) return
    event.preventDefault()
    const next = interpretGameKey(event.key, 'identify', { identityIndex, sector: keyboardSector }).selection.identityIndex
    setIdentityIndex(next)
    glyphButtonRefs.current[next]?.focus({ preventScroll: true })
  }

  const moveSectorSelection = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.key.startsWith('Arrow') && !['1', '2', '3', '4', '6', '7', '8', '9'].includes(event.key)) return
    event.preventDefault()
    const next = interpretGameKey(event.key, 'locate', { identityIndex, sector: keyboardSector }).selection.sector
    setKeyboardSector(next)
    sectorButtonRefs.current[next]?.focus({ preventScroll: true })
  }

  const trialNumber = mode === 'practice' ? practiceIndex + 1 : Math.min(session.completedTrials.length + 1, 24)
  const totalTrials = mode === 'practice' ? 4 : 24
  const completedForProgress = mode === 'practice' ? practiceIndex : session.completedTrials.length
  const progressSegments = createProgressSegments(completedForProgress, totalTrials)
  const collectionLevel = session.completedTrials.filter((trial) => trial.correct).length
  if (!supportedDisplay) {
    return <section className="page-card display-gate" aria-labelledby="display-title"><p className="eyebrow">A little more room</p><h1 id="display-title">Open Lumen on a larger display</h1><p className="lede">Scored play needs a landscape area of at least 1024 × 700 so targets remain separated and readable. Settings and history still work here.</p></section>
  }
  return (
    <section className="play-page" aria-labelledby="play-title">
      <div className="play-heading">
        <div><p className="eyebrow">{mode === 'practice' ? 'No score, take your time' : 'Journey · forest path I'}</p><h1 id="play-title">{mode === 'practice' ? 'Practice' : 'Follow the light'}</h1></div>
        <div className="trial-count" aria-label={`Trial ${trialNumber} of ${totalTrials}`}><span>{String(trialNumber).padStart(2, '0')}</span> / {totalTrials}</div>
      </div>
      <div className={`game-frame ${preferences.largeTargets ? 'large-targets' : ''}`} data-phase={phase} data-presentation-stage={phase === 'stimulus' ? presentationStage : undefined} data-outcome={lastOutcome ? lastOutcome.centralCorrect && lastOutcome.peripheralCorrect ? 'correct' : 'learning' : undefined} data-void-reason={voidReason ?? undefined}>
        <div className="game-hud" aria-hidden="true"><span>{mode === 'practice' ? 'Practice path' : 'Blue-hour path'}</span><div className={`journey-progress progress-${totalTrials}`}>{progressSegments.map((segment) => <i key={segment.index} data-state={segment.state} />)}</div><span>{String(trialNumber).padStart(2, '0')} / {String(totalTrials).padStart(2, '0')}</span></div>
        {(phase === 'identify' || phase === 'locate') && <button className="scene-pause" type="button" aria-label="Pause journey" onClick={onPause}><span aria-hidden="true">Ⅱ</span></button>}
        <LumenCanvas key={`renderer-${rendererAttempt}`} phase={phase} trial={session.currentTrial} highContrast={preferences.highContrast} reducedMotion={reducedMotion} targetScale={preferences.largeTargets ? 1.3 : 1} qualityTier={preferences.qualityTier} selectedSector={keyboardSector} resolvedSector={lastOutcome?.sector} responseCorrect={lastOutcome?.centralCorrect && lastOutcome?.peripheralCorrect} collectionLevel={collectionLevel} onIdentify={onIdentify} onLocate={(sector) => onLocate(sector, 'pointer')} onPresentationComplete={onPresentationComplete} onPresentationStage={setPresentationStage} onRendererFailure={onRendererFailure} onRendererReady={onRendererReady} />
        {phase === 'locate' && <div className="sector-ring-controls" role="group" aria-labelledby="location-prompt" onKeyDown={moveSectorSelection}>{sectorLabels.map((label, sector) => <button key={label} ref={(element) => { sectorButtonRefs.current[sector] = element }} className={`sector-button sector-${sector}`} tabIndex={sector === keyboardSector ? 0 : -1} data-active={sector === keyboardSector ? 'true' : undefined} aria-label={label} onFocus={() => setKeyboardSector(sector)} onClick={(event) => onLocate(sector, event.detail === 0 ? 'keyboard' : 'pointer')}><span aria-hidden="true">{sectorArrows[sector]}</span></button>)}</div>}
        {preferences.diagnostics && <aside className="diagnostics" aria-label="Local rendering diagnostics"><span>Protocol {session.protocolVersion}</span><span>Quality {resolvedQuality}</span><span>DPR {window.devicePixelRatio.toFixed(2)}</span><span>Viewport {window.innerWidth}×{window.innerHeight}</span><span>Requested {session.currentTrial.durationMs} ms</span><span>Voids {session.voidedTrials.length}</span></aside>}
        <div className="response-dock">
          {phase === 'stimulus' && <div className="stimulus-status" role="status"><span aria-hidden="true">◉</span><p>Rest your eyes on the center. The glimpse will be brief.</p></div>}
          {phase === 'identify' && <><p ref={responseHeadingRef} id="identity-prompt">Which symbol was in the center?</p><div className="glyph-choices" role="group" aria-labelledby="identity-prompt" onKeyDown={moveIdentitySelection}>{session.currentTrial.centralChoices.map((glyph, index) => <button key={glyph} ref={(element) => { glyphButtonRefs.current[index] = element }} tabIndex={index === identityIndex ? 0 : -1} data-active={index === identityIndex ? 'true' : undefined} onFocus={() => setIdentityIndex(index)} onClick={(event) => onIdentify(glyph, event.detail === 0 ? 'keyboard' : 'pointer')} aria-label={`Choose ${glyph}`}><GlyphIcon glyph={glyph} /><span>{glyph === 'leaf' ? 'Moonleaf' : 'Silkmoth'}</span><small>{index === 0 ? 'A or 1' : 'S or 2'}</small></button>)}</div></>}
          {phase === 'locate' && <p ref={responseHeadingRef} id="location-prompt">Where was the edge light? <span className="muted">Arrows move · Space chooses</span></p>}
          {phase === 'paused' && <div className="resolved"><span aria-hidden="true">Ⅱ</span><div><strong>Journey paused</strong><p>Your current response is safe. Resume when you are ready.</p></div><button ref={actionButtonRef} className="button primary" onClick={onResume}>Resume</button></div>}
          {phase === 'recovery' && <div className="resolved"><span aria-hidden="true">↻</span><div><strong>Let’s retry that glimpse</strong><p>{voidReason === 'unsupported' ? 'This graphics renderer is unavailable. Try a current Safari, Chrome, Edge, or the Mac app.' : 'The display changed during the glimpse. It did not affect your score.'}</p></div><button ref={actionButtonRef} className="button primary" onClick={onRetry}>Retry safely</button></div>}
          {phase === 'resolved' && <div className="resolved"><span aria-hidden="true">✦</span><div><strong>{journeySaveStatus === 'error' ? 'Journey needs saving' : 'Response recorded'}</strong><p>{journeySaveStatus === 'error' ? 'Lumen could not confirm this completed journey. Choose See results to retry the local save.' : checkpointStatus === 'saving' ? 'Securing this safe checkpoint on your device…' : checkpointStatus === 'error' ? 'The response is held in memory; keep Lumen open until the next save.' : resolvedMessage(mode, lastOutcome, session.currentTrial)}</p></div><button ref={actionButtonRef} className="button primary" disabled={checkpointStatus === 'saving' || journeySaveStatus === 'saving'} onClick={onFinish}>{journeySaveStatus === 'saving' ? 'Saving journey…' : mode === 'practice' ? practiceIndex >= 3 ? 'Begin full journey' : 'Next practice' : session.completedTrials.length >= 24 ? journeySaveStatus === 'error' ? 'Retry save' : 'See results' : 'Next glimpse'}</button></div>}
        </div>
        <p className="keyboard-hint">Arrows move · Space or Enter chooses · Escape pauses during your response</p>
      </div>
    </section>
  )
}

const sectorLabels = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'] as const
const sectorArrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const

function GlyphIcon({ glyph }: { glyph: CentralGlyph }) {
  return glyph === 'leaf'
    ? <svg className="glyph-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M50 10C28 12 13 25 14 43c1 9 9 13 17 10 15-5 20-23 19-43Z" /><path d="M17 48c8-8 16-15 27-27" /></svg>
    : <svg className="glyph-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 27C23 12 8 14 9 29c1 10 10 17 23 17M32 27c9-15 24-13 23 2-1 10-10 17-23 17" /><path d="M32 24v27M29 20c-3-6-8-8-12-9M35 20c3-6 8-8 12-9" /></svg>
}

function resolvedMessage(mode: 'practice' | 'journey', outcome: TrialOutcome | null, trial: TrainingSession['currentTrial']): string {
  if (!outcome) return 'Your response is safely stored.'
  if (outcome.centralCorrect && outcome.peripheralCorrect) return mode === 'practice' ? 'Both lights caught. That is the full rhythm.' : 'Both lights caught. The next glimpse will gently adapt.'
  if (mode === 'practice') {
    const correctPlace = sectorLabels[trial.sector]
    return `The center was ${trial.centralGlyph === 'leaf' ? 'Moonleaf' : 'Silkmoth'} and the edge light was ${correctPlace}. Practice stays unscored.`
  }
  return outcome.centralCorrect || outcome.peripheralCorrect ? 'One light caught. Keep following the same calm rhythm.' : 'That glimpse slipped by. The next one will open a little longer.'
}

function Results({ session, onHome, onAgain }: { session: TrainingSession; onHome: () => void; onAgain: () => void }) {
  const summary = summarizeSession(session)
  const correct = session.completedTrials.filter((trial) => trial.correct).length
  const accuracy = Math.round(summary.accuracy * 100)
  return (
    <section className="results page-card" aria-labelledby="results-title">
      <div className="result-sun" aria-hidden="true">✦</div><p className="eyebrow">Forest path I</p><h1 id="results-title">Journey complete</h1><p className="lede">A new cluster of moonflowers has opened beside the water.</p>
      <div className="stats"><div><span>Lumen accuracy</span><strong>{accuracy}%</strong><small>{correct} of {summary.completedTrials} glimpses</small></div><div><span>Presentation speed</span><strong>{summary.presentationSpeedMs}<small> ms</small></strong><small>Average measured exposure</small></div><div><span>Consistency</span><strong>{summary.consistency <= 180 ? 'Steady' : 'Building'}</strong><small>{summary.consistency} ms response variation</small></div></div>
      <p className="disclaimer">These results reflect your performance within Lumen. They are not a medical assessment.</p>
      <div className="button-row"><button className="button primary" onClick={onHome}>Return to forest</button><button className="button quiet" onClick={onAgain}>Play again</button></div>
    </section>
  )
}

function History({ journeys, onBack }: { journeys: readonly SavedJourney[]; onBack: () => void }) {
  const visibleSessions = journeys.map((journey) => ({ date: new Date(journey.completedAt).toLocaleDateString(), accuracy: `${Math.round(journey.accuracy * 100)}%`, speed: `${journey.averageResponseMs} ms`, note: 'Saved on this device' }))
  return (
    <section className="page-card" aria-labelledby="history-title"><p className="eyebrow">Last 30 sessions</p><h1 id="history-title">Recent journeys</h1>{visibleSessions.length ? <ul className="history-list">{visibleSessions.map((item, index) => <li key={`${item.date}-${index}`}><time>{item.date}</time><div><strong>{item.note}</strong><small>{item.accuracy} accuracy · {item.speed}</small></div><span aria-hidden="true">↗</span></li>)}</ul> : <div className="empty-state"><strong>No completed journeys yet</strong><p>Your first completed journey will appear here, saved only on this device.</p></div>}<button className="button quiet" onClick={onBack}>Back</button></section>
  )
}

function Settings({ preferences, status, onToggle, onChange, onExport, onDelete, onBack }: {
  preferences: Preferences
  status: string
  onToggle: (key: 'largeTargets' | 'highContrast' | 'reducedMotion' | 'sound' | 'reminders' | 'diagnostics') => void
  onChange: (patch: Partial<Preferences>) => void
  onExport: () => Promise<void>
  onDelete: () => Promise<void>
  onBack: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const deleteDialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!confirmDelete) return
    deleteCancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setConfirmDelete(false); requestAnimationFrame(() => deleteTriggerRef.current?.focus()) }
      if (event.key === 'Tab' && deleteDialogRef.current) {
        const buttons = [...deleteDialogRef.current.querySelectorAll<HTMLButtonElement>('button')]
        const first = buttons[0]
        const last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirmDelete])
  return (
    <section className="settings-page page-card" aria-labelledby="settings-title">
      <p className="eyebrow">Comfort, sound, and privacy</p><h1 id="settings-title">Settings</h1><p className="lede">Everything here is stored locally. Comfort choices never change how Lumen scores you.</p>

      <section className="settings-section" aria-labelledby="visual-settings"><div className="section-heading"><span>01</span><div><h2 id="visual-settings">Visual comfort</h2><p>Keep scored targets distinct from the atmosphere.</p></div></div><div className="choice-grid"><Toggle title="Larger targets" detail="Enlarge scored symbols and every response hit area." checked={preferences.largeTargets} onChange={() => onToggle('largeTargets')} /><Toggle title="High contrast" detail="Strengthen the independent stimulus layer." checked={preferences.highContrast} onChange={() => onToggle('highContrast')} /><Toggle title="Reduced motion" detail="Remove the inward ripple and decorative drift." checked={preferences.reducedMotion} onChange={() => onToggle('reducedMotion')} /></div><label className="select-row"><span><strong>Graphics quality</strong><small>Automatic adapts to the display before a trial.</small></span><select value={preferences.qualityTier} onChange={(event) => onChange({ qualityTier: event.target.value as Preferences['qualityTier'] })}><option value="auto">Automatic</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low effects</option></select></label></section>

      <section className="settings-section" aria-labelledby="input-settings"><div className="section-heading"><span>02</span><div><h2 id="input-settings">Input and pauses</h2><p>Pointer and keyboard remain available at all times.</p></div></div><label className="select-row"><span><strong>Preferred input</strong><small>Changes the hints Lumen emphasizes.</small></span><select value={preferences.inputMode} onChange={(event) => onChange({ inputMode: event.target.value as Preferences['inputMode'] })}><option value="auto">Automatic</option><option value="pointer">Pointer or trackpad</option><option value="keyboard">Keyboard</option></select></label><div className="shortcut-card"><strong>Keyboard map</strong><p>A/S or 1/2 choose the center. Arrow keys choose a cardinal position and Enter confirms. Number-pad positions choose all eight sectors. Escape pauses safely between scored presentations.</p></div></section>

      <section className="settings-section" aria-labelledby="audio-settings"><div className="section-heading"><span>03</span><div><h2 id="audio-settings">Sound</h2><p>Separate buses keep feedback calm and controllable.</p></div></div><Toggle title="Sound enabled" detail="Mute or restore every Lumen sound." checked={preferences.sound} onChange={() => onToggle('sound')} /><div className="volume-grid">{([['Master', 'masterVolume'], ['Music', 'musicVolume'], ['Ambience', 'ambienceVolume'], ['Feedback', 'feedbackVolume']] as const).map(([label, key]) => <label key={key}><span>{label}<output>{preferences[key]}%</output></span><input aria-label={`${label} volume`} type="range" min="0" max="100" step="5" value={preferences[key]} disabled={!preferences.sound} onChange={(event) => onChange({ [key]: Number(event.target.value) })} /></label>)}</div></section>

      <section className="settings-section" aria-labelledby="privacy-settings"><div className="section-heading"><span>04</span><div><h2 id="privacy-settings">Privacy and local data</h2><p>No account, ads, or analytics are active in this build.</p></div></div><div className="choice-grid"><Toggle title="In-app fatigue reminder" detail="After two journeys in one day, suggest an eye break. Off by default." checked={preferences.reminders} onChange={() => onToggle('reminders')} /><Toggle title="Local diagnostics" detail="Show frame quality and renderer details during play." checked={preferences.diagnostics} onChange={() => onToggle('diagnostics')} /></div><div className="data-actions"><button className="button quiet" onClick={() => void onExport()}>Export my Lumen data</button><button ref={deleteTriggerRef} className="button danger" onClick={() => setConfirmDelete(true)}>Delete local data</button></div>{confirmDelete && <div className="settings-modal-backdrop"><div ref={deleteDialogRef} className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><strong id="delete-title">Delete all local Lumen data?</strong><p>This removes preferences and journey history from this device. It cannot be undone.</p><div><button ref={deleteCancelRef} className="button quiet" onClick={() => { setConfirmDelete(false); requestAnimationFrame(() => deleteTriggerRef.current?.focus()) }}>Keep my data</button><button className="button danger" onClick={() => { void onDelete(); setConfirmDelete(false) }}>Delete everything</button></div></div></div>}</section>

      <section className="accessibility-note" aria-labelledby="accessibility-title"><h2 id="accessibility-title">About accessibility</h2><p>Lumen’s scored task is inherently visual and does not have an equivalent screen-reader mode. Menus, settings, history, and results remain keyboard and screen-reader accessible. Lumen never interprets performance as a medical result.</p></section>
      <p className="save-status" role="status">{status}</p><button className="button quiet" onClick={onBack}>Back</button>
    </section>
  )
}

function Sources({ onBack }: { onBack: () => void }) {
  const authors = ['Norma B. Coe', 'Katherine E. M. Miller', 'Chuxuan Sun', 'Elizabeth Taggert', 'Alden L. Gross', 'Richard N. Jones', 'Cynthia Felix', 'Marilyn S. Albert', 'George W. Rebok', 'Michael Marsiske', 'Karlene K. Ball', 'Sherry L. Willis']
  return <section className="sources-page page-card" aria-labelledby="sources-title"><p className="eyebrow">Evidence and boundaries · checked July 13, 2026</p><h1 id="sources-title">Research sources</h1><p className="lede">Lumen’s design is inspired by a line of research. Evidence for the studied regimen does not transfer automatically to this game.</p><article><h2>Peer-reviewed ACTIVE follow-up</h2><p><cite>Impact of cognitive training on claims-based diagnosed dementia over 20 years: evidence from the ACTIVE study</cite>, published in 2026. The adjusted hazard ratio was 0.74 (95% CI 0.59–0.93) for speed-training participants who completed booster sessions compared with control; the no-booster subgroup did not show the same reduction.</p><p><strong>Authors</strong></p><ul className="author-list">{authors.map((author) => <li key={author}>{author}</li>)}</ul><p className="source-actions"><a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC12884427/" target="_blank" rel="noreferrer">Open full peer-reviewed paper</a><a href="https://www.nih.gov/news-events/news-releases/cognitive-speed-training-over-weeks-may-delay-diagnosis-dementia-over-decades" target="_blank" rel="noreferrer">Read the NIH summary</a></p></article><article><h2>Preliminary biomarker presentation</h2><p>Hye Won Chai’s 53-person biomarker finding was presented at AAIC 2026. It is small, conference-stage evidence and should not be treated as replicated or as evidence for Lumen.</p><p className="source-actions"><a href="https://aaic.alz.org/" target="_blank" rel="noreferrer">AAIC 2026 conference site</a></p></article><aside>Lumen has not been clinically validated. It is not intended to diagnose, treat, cure, or prevent any disease or condition.</aside><button className="button quiet" onClick={onBack}>Back to Lumen</button></section>
}

function ResearchDialog({ onClose, onSources }: { onClose: () => void; onSources: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      openerRef.current?.focus()
    }
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="research-dialog" role="dialog" aria-modal="true" aria-labelledby="research-title">
        <button ref={closeRef} className="close-button" onClick={onClose} aria-label="Close research panel">×</button>
        <p className="eyebrow">Why Lumen exists</p><h2 id="research-title">The research behind Lumen</h2>
        <p>The ACTIVE research team began studying adaptive visual speed-of-processing training in adults 65 and older in the late 1990s.</p>
        <p>In 2026, <strong>Norma B. Coe and colleagues</strong> published a peer-reviewed 20-year follow-up. Participants assigned to speed training who completed booster sessions had a <strong>25 percent lower rate</strong> of claims-based dementia diagnosis than the control group. That is encouraging evidence for the specific training regimen, not proof that every brain game works.</p>
        <p>At the 2026 Alzheimer’s Association International Conference, <strong>Hye Won Chai</strong> of Clemson University presented a separate 53-person biomarker study. It reported a change in a blood beta-amyloid ratio among trained men, but not women. It was small, needs replication, and remains preliminary conference evidence.</p>
        <aside>Lumen is a redesigned consumer game inspired by this line of research. Lumen has not been clinically validated and is not intended to diagnose, treat, cure, or prevent any disease or condition. Your results describe performance inside this game.</aside>
        <p className="research-links"><a href="https://doi.org/10.1002/trc2.70197" target="_blank" rel="noreferrer">Read Coe et al.</a><a href="https://www.nih.gov/news-events/news-releases/cognitive-speed-training-over-weeks-may-delay-diagnosis-dementia-over-decades" target="_blank" rel="noreferrer">NIH summary</a><a href="https://aaic.alz.org/" target="_blank" rel="noreferrer">AAIC 2026</a></p>
        <div className="button-row"><button className="button primary" onClick={onClose}>I understand</button><button className="button quiet" onClick={onSources}>Sources and authors</button></div>
      </section>
    </div>
  )
}
