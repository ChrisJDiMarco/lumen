import { describe, expect, it, vi } from 'vitest'

import { LumenAudio } from './lumenAudio'

describe('LumenAudio', () => {
  it('creates its graph only after an explicit start and applies independent buses', async () => {
    const gains: number[] = []
    const context = {
      currentTime: 2,
      state: 'suspended',
      destination: {},
      resume: vi.fn().mockResolvedValue(undefined),
      createGain: vi.fn(() => ({ gain: { setValueAtTime: (value: number) => gains.push(value) }, connect: vi.fn() })),
      createOscillator: vi.fn(),
    }
    const factory = vi.fn(() => context as unknown as AudioContext)
    const audio = new LumenAudio(factory)

    expect(factory).not.toHaveBeenCalled()
    await audio.start()
    audio.configure({ enabled: true, master: 0.8, music: 0.3, ambience: 0.5, feedback: 0.7 })

    expect(context.resume).toHaveBeenCalled()
    expect(gains).toEqual(expect.arrayContaining([0.8, 0.3, 0.5, 0.7]))
  })
})
