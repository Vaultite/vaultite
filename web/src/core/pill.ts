// The dictation pill (Wispr Flow's): bars that move with the voice, and words not settled yet where nothing shows them.
// The window's (core/dictation.ts) and the screen overlay's (screen.tsx); plain DOM, as the level changes often.

const SHAPE = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45]

export function makePill() {
  const el = document.createElement("div")
  el.className = "dictation-pill"
  el.setAttribute("role", "status")
  el.setAttribute("aria-label", "Listening")
  const bars = document.createElement("span")
  bars.className = "dictation-bars"
  for (let i = 0; i < SHAPE.length; i++) bars.append(document.createElement("i"))
  const text = document.createElement("span")
  text.className = "dictation-pending"
  text.hidden = true
  el.append(bars, text)
  return {
    el,
    /** The voice's level (0 to 1), whether it's listening yet, and the words to show ("" none); `t`: now, in ms. */
    set(level: number, ready: boolean, words: string, t: number) {
      el.toggleAttribute("data-ready", ready)
      const kids = bars.children
      for (let i = 0; i < kids.length; i++) {
        // (each bar its own wobble, so a steady voice still moves)
        const wobble = 0.7 + 0.3 * Math.sin(t / 95 + i * 1.9)
        ;(kids[i] as HTMLElement).style.transform = `scaleY(${(0.2 + Math.min(1, level * 1.6) * SHAPE[i] * wobble * 0.8).toFixed(3)})`
      }
      const shown = words.length > 80 ? `…${words.slice(-80)}` : words
      if (text.textContent !== shown) { text.textContent = shown; text.hidden = !shown }
    },
  }
}
