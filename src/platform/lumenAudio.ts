export interface AudioMix {
  readonly enabled: boolean
  readonly master: number
  readonly music: number
  readonly ambience: number
  readonly feedback: number
}

interface AudioGraph {
  readonly context: AudioContext
  readonly master: GainNode
  readonly music: GainNode
  readonly ambience: GainNode
  readonly feedback: GainNode
}

export class LumenAudio {
  private graph: AudioGraph | null = null
  private atmosphereStarted = false
  private mix: AudioMix = { enabled: true, master: 0.8, music: 0.35, ambience: 0.55, feedback: 0.7 }

  constructor(private readonly createContext: () => AudioContext = () => new AudioContext()) {}

  async start(): Promise<void> {
    if (!this.graph) {
      const context = this.createContext()
      const master = context.createGain()
      const music = context.createGain()
      const ambience = context.createGain()
      const feedback = context.createGain()
      music.connect(master)
      ambience.connect(master)
      feedback.connect(master)
      master.connect(context.destination)
      this.graph = { context, master, music, ambience, feedback }
    }
    if (this.graph.context.state === 'suspended') await this.graph.context.resume()
    this.startAtmosphere()
  }

  configure(mix: AudioMix): void {
    this.mix = mix
    const graph = this.graph
    if (!graph) return
    const now = graph.context.currentTime
    graph.master.gain.setValueAtTime(mix.enabled ? mix.master : 0, now)
    graph.music.gain.setValueAtTime(mix.music, now)
    graph.ambience.gain.setValueAtTime(mix.ambience, now)
    graph.feedback.gain.setValueAtTime(mix.feedback, now)
  }

  setPresentationQuiet(quiet: boolean): void {
    const graph = this.graph
    if (!graph) return
    graph.ambience.gain.setValueAtTime(this.mix.ambience * (quiet ? 0.18 : 1), graph.context.currentTime)
    graph.music.gain.setValueAtTime(this.mix.music * (quiet ? 0.35 : 1), graph.context.currentTime)
  }

  playFeedback(correct: boolean): void {
    const graph = this.graph
    if (!graph || graph.context.state !== 'running') return
    const oscillator = graph.context.createOscillator()
    const envelope = graph.context.createGain()
    const start = graph.context.currentTime + 0.01
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(correct ? 620 : 390, start)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.exponentialRampToValueAtTime(0.16, start + 0.025)
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + 0.2)
    oscillator.connect(envelope)
    envelope.connect(graph.feedback)
    oscillator.start(start)
    oscillator.stop(start + 0.21)
  }

  private startAtmosphere(): void {
    const graph = this.graph
    if (!graph || this.atmosphereStarted || typeof graph.context.createBuffer !== 'function') return
    this.atmosphereStarted = true

    const drone = graph.context.createOscillator()
    const droneLevel = graph.context.createGain()
    drone.type = 'sine'
    drone.frequency.setValueAtTime(146.83, graph.context.currentTime)
    droneLevel.gain.setValueAtTime(0.007, graph.context.currentTime)
    drone.connect(droneLevel)
    droneLevel.connect(graph.music)
    drone.start()

    const seconds = 2
    const buffer = graph.context.createBuffer(1, graph.context.sampleRate * seconds, graph.context.sampleRate)
    const channel = buffer.getChannelData(0)
    let noiseState = 0x6c756d65
    for (let index = 0; index < channel.length; index += 1) {
      noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0
      channel[index] = (noiseState / 0x1_0000_0000 * 2 - 1) * 0.025
    }
    const ambience = graph.context.createBufferSource()
    const ambienceLevel = graph.context.createGain()
    ambience.buffer = buffer
    ambience.loop = true
    ambienceLevel.gain.setValueAtTime(0.035, graph.context.currentTime)
    ambience.connect(ambienceLevel)
    ambienceLevel.connect(graph.ambience)
    ambience.start()
  }
}
