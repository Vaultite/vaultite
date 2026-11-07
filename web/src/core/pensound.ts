// The companion's pen heard as it inks a drawing (screen.tsx): a soft scratch of grainy noise, louder and brighter the
// faster it moves, gone as it lifts. Very quiet, under the cues; its audio sleeps when the pen is still.

/** How loud the pen gets at its fastest (of full scale): a third of a cue's peak. */
export const PEN_PEAK = 0.02
/** How loud it is at `speed` (px/s, the pen's tip): silent when slow, rising quickly, then easing off. */
export function penLevel(speed: number) {
  if (!(speed > 40)) return 0
  return Math.sqrt(Math.min(1, (speed - 40) / 1600))
}

/** A pen's voice on an audio context `make` gives when first needed: `ink(speed)` each frame it draws, `lift()` when
 *  it doesn't. Its noise stops a moment after it lifts, then `rested()`: the context is shared (the cues'), its owner
 *  suspends it. */
export function penSound(make: () => AudioContext, rested: () => void = () => {}) {
  let ctx: AudioContext | null = null, gain: GainNode | null = null, band: BiquadFilterNode | null = null, src: AudioBufferSourceNode | null = null
  let sleep: ReturnType<typeof setTimeout> | null = null
  function wake() {
    ctx ??= make()
    if (ctx.state === "suspended") void ctx.resume()
    if (src) return
    // (noise in short grains of varying strength: paper's tooth under a pen, not a hiss)
    const n = Math.round(ctx.sampleRate * 1.3), buf = ctx.createBuffer(1, n, ctx.sampleRate), data = buf.getChannelData(0), grain = Math.round(ctx.sampleRate * 0.006)
    let amp = 0.6
    for (let i = 0; i < n; i++) { if (i % grain === 0) amp = 0.35 + Math.random() * 0.65; data[i] = (Math.random() * 2 - 1) * amp }
    src = ctx.createBufferSource(); src.buffer = buf; src.loop = true
    band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 2600; band.Q.value = 0.8
    gain = ctx.createGain(); gain.gain.value = 0
    src.connect(band).connect(gain).connect(ctx.destination)
    src.start()
  }
  function rest() {
    if (sleep) clearTimeout(sleep)
    sleep = setTimeout(() => {
      sleep = null
      try { src?.stop() } catch { /* (already stopped) */ }
      src?.disconnect(); src = null
      rested()
    }, 700)
  }
  return {
    /** Its noise is playing. */
    busy: () => !!src,
    ink(speed: number) {
      const level = penLevel(speed)
      if (!level && !src) return
      wake()
      const t = ctx!.currentTime
      gain!.gain.setTargetAtTime(PEN_PEAK * level, t, 0.025)
      band!.frequency.setTargetAtTime(1900 + 2400 * level, t, 0.04)
      rest()
    },
    lift() {
      if (!src || !ctx || !gain) return
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02)
      rest()
    },
  }
}
