const SHAPE = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45]

export function makePill() {
  const el = document.createElement("div")
  el.className = "dictation-pill"
  el.setAttribute("role", "status")
  el.setAttribute("aria-label", "Listening")
  const bars = document.createElement("span")
  bars.className = "dictation-bars"
  const kids = SHAPE.map(() => document.createElement("i"))
  bars.append(...kids)
  const text = document.createElement("span")
  text.className = "dictation-pending"
  text.hidden = true
  el.append(bars, text)
  return {
    el,
    set(level: number, ready: boolean, words: string, t: number) {
      el.toggleAttribute("data-ready", ready)
      for (const [i, kid] of kids.entries()) {
        const wobble = 0.7 + 0.3 * Math.sin(t / 95 + i * 1.9)
        kid.style.transform = `scaleY(${(0.2 + Math.min(1, level * 1.6) * SHAPE[i] * wobble * 0.8).toFixed(3)})`
      }
      const shown = words.length > 80 ? `…${words.slice(-80)}` : words
      if (text.textContent !== shown) { text.textContent = shown; text.hidden = !shown }
    },
  }
}
