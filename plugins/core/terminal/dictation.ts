import type { Term } from "./vt/term"

export function dictationInput(t: Term) {
  let words = "", shown: HTMLElement | null = null, follow: { dispose: () => void } | null = null
  const text = document.createElement("span")
  const cell = () => {
    const screen = t.screenEl, cur = t.cursor()
    if (!screen || !t.cols || !cur) return null
    return { screen, x: cur.x, row: cur.y, w: screen.clientWidth / t.cols, h: screen.clientHeight / t.rows }
  }
  const draw = () => {
    const c = words ? cell() : null
    if (!c) { shown?.remove(); return }
    if (!shown) {
      shown = document.createElement("div")
      shown.dataset.termPending = ""
      shown.setAttribute("aria-hidden", "true")
      Object.assign(shown.style, { position: "absolute", left: "0", right: "0", zIndex: "8", pointerEvents: "none", whiteSpace: "pre-wrap",
        wordBreak: "break-all", color: "var(--muted-foreground)" })
      shown.append(text)
    }
    if (shown.parentElement !== c.screen) c.screen.append(shown)
    Object.assign(shown.style, { top: `${c.row * c.h}px`, textIndent: `${c.x * c.w}px`, lineHeight: `${c.h}px`, fontFamily: t.o.fontFamily,
      fontSize: `${t.o.fontSize}px` })
    text.style.background = t.o.theme.clear ? "" : `#${t.o.theme.background.toString(16).padStart(6, "0")}`
    text.textContent = words
  }
  return {
    send: (data: string) => t.input(data),
    bracketed: () => t.bracketedPaste,
    caret: () => {
      const c = cell()
      if (!c) return null
      const r = c.screen.getBoundingClientRect(), w = r.width / t.cols, h = r.height / t.rows
      return { rect: new DOMRect(r.left + c.x * w, r.top + c.row * h, 0, h), before: t.rowText(c.row, c.x) }
    },
    pending: (text: string) => {
      words = text
      if (words && !follow) follow = t.onRender(draw)
      if (!words) { follow?.dispose(); follow = null }
      draw()
    },
  }
}
