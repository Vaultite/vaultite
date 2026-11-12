export type Cue = "listen" | "sent" | "answer" | "missed" | "knock"
type Param = { setValueAtTime: (v: number, t: number) => unknown; linearRampToValueAtTime: (v: number, t: number) => unknown; exponentialRampToValueAtTime: (v: number, t: number) => unknown }
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a real AudioNode's connect overloads fit no narrower type
type Node = { connect: (n: any) => unknown }
export type CueContext = {
  currentTime: number; destination: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a real OscillatorNode and the test's stand-in both fit
  createOscillator: () => Node & { type: any; frequency: Param; start: (t: number) => void; stop: (t: number) => void }
  createGain: () => Node & { gain: Param }
}

export const CUE_PEAK = 0.06
const NOTES: Record<Cue, { at: number; dur: number; from: number; to?: number; level: number; wave?: string }[]> = {
  listen: [{ at: 0, dur: 0.07, from: 659, level: 0.8 }, { at: 0.075, dur: 0.11, from: 880, level: 1 }],
  sent: [{ at: 0, dur: 0.13, from: 784, to: 523, level: 0.9 }],
  answer: [{ at: 0, dur: 0.32, from: 1047, level: 0.8 }, { at: 0, dur: 0.22, from: 2093, level: 0.25 }, { at: 0.06, dur: 0.3, from: 1319, level: 0.5 }],
  missed: [{ at: 0, dur: 0.1, from: 523, level: 0.7 }, { at: 0.11, dur: 0.16, from: 392, level: 0.6 }],
  knock: [{ at: 0, dur: 0.07, from: 740, to: 494, level: 0.7, wave: "triangle" }, { at: 0.14, dur: 0.07, from: 740, to: 494, level: 0.55, wave: "triangle" }],
}
export const cueLength = (name: Cue) => Math.max(...NOTES[name].map((n) => n.at + n.dur))

export function playCue(ctx: CueContext, name: Cue, at = ctx.currentTime) {
  for (const n of NOTES[name]) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = at + n.at, peak = CUE_PEAK * n.level
    o.type = n.wave ?? "sine"
    o.frequency.setValueAtTime(n.from, t)
    if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, t + n.dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur)
    o.connect(g)
    g.connect(ctx.destination)
    o.start(t)
    o.stop(t + n.dur + 0.02)
  }
}
