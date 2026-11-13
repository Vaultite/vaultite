import { useCallback } from "react"
import type { EditorApi } from "@/editor/Editor"
import { holdPlace, keepOnScreen } from "@/core/anchor"
import { lineInSight, wholly } from "@/core/sight"
import { scrollingBox } from "@/lib/utils"
import { trackSoon } from "@/core/unsaved"
import type { Mode } from "@/components/fileState"


export type Spot = { box: HTMLElement | null; y: number; ratio: number; line?: number; into?: number; text?: boolean }

const scrollMax = (box: HTMLElement | null) => (box ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight - innerHeight)


// After an undo CodeMirror scrolls to its cursor this frame: taken back, the Properties brought into sight.
export function revealProps(article: HTMLElement | null) {
  const box = scrollingBox(article), y = box ? box.scrollTop : scrollY
  requestAnimationFrame(() => {
    if (box) box.scrollTop = y; else scrollTo(scrollX, y)
    article?.querySelector("[aria-label='Properties']")?.scrollIntoView({ block: "nearest" })
  })
}

function followSight(api: EditorApi, box: HTMLElement | null, pos: number) {
  const v = api.view, scroller = box ?? window
  let at = pos
  const on = () => {
    if (!v.dom.isConnected || v.state.selection.main.head !== at) return end()
    if (wholly(v, at)) return
    const next = api.offBlocks(lineInSight(v))
    if (next !== null && next !== at) v.dispatch({ selection: { anchor: (at = next) } })
  }
  const timer = setTimeout(() => end(), 1000)
  const end = () => {
    clearTimeout(timer)
    scroller.removeEventListener("scroll", on)
    removeEventListener("pointerdown", end, true); removeEventListener("keydown", end, true)
  }
  scroller.addEventListener("scroll", on, { passive: true })
  addEventListener("pointerdown", end, true); addEventListener("keydown", end, true)
}

export type Reveal = { hold?: { line: number; y: number }; there?: () => void }

export function useTextFocus(editor: { current: { api: EditorApi; source: boolean } | null }, article: { current: HTMLElement | null },
  shown: { current: Mode }, cur: { current: { fm: string; body: string } }) {
  return useCallback((at: [line: number, col: number, find?: string] | null, reveal: boolean | Reveal = false) => {
    const { hold, there } = typeof reveal === "object" ? reveal : {}
    let frame = 0, stopped = false
    const until = performance.now() + (reveal ? 15_000 : 1000)
    const untrack = reveal ? trackSoon("a cursor going to its line", () => !stopped) : () => {}
    const stop = () => {
      stopped = true
      untrack()
      cancelAnimationFrame(frame)
      removeEventListener("pointerdown", stop, true); removeEventListener("keydown", stop, true)
    }
    addEventListener("pointerdown", stop, true); addEventListener("keydown", stop, true)
    const land = () => {
      if (stopped) return
      if (performance.now() > until) return stop()
      const ed = editor.current, v = ed?.api.view
      if (!ed || !v?.dom.isConnected || ed.source !== (shown.current === "source") || v.contentDOM.contentEditable !== "true") {
        frame = requestAnimationFrame(land)
        return
      }
      stop()
      const doc = v.state.doc, above = fmLines(cur.current)
      const box = scrollingBox(article.current)
      // CodeMirror scrolls to a cursor out of sight at the first key and keeps its line drawn, moving the page as the
      // lines between are measured: the first line in sight instead.
      const seen = (pos: number) => wholly(v, pos)
      if (!reveal && ed.api.restored && seen(v.state.selection.main.head)) { v.contentDOM.focus({ preventScroll: true }); return }
      let pos: number | null = null
      if (at && at[0] + above + 1 <= doc.lines) {
        const line = doc.line(at[0] + above + 1)
        pos = line.from + Math.min(at[1], line.length)
        if (reveal) {
          const i = at[2] ? line.text.toLowerCase().indexOf(at[2].toLowerCase()) : -1
          const selection = i >= 0 ? { anchor: line.from + i, head: line.from + i + at[2]!.length } : { anchor: pos }
          v.dispatch({ selection })
          v.contentDOM.focus({ preventScroll: true })
          const n = hold ? hold.line + above + 1 : 0, held = n >= 1 && n <= doc.lines ? doc.line(n).from : null
          const r = box?.getBoundingClientRect() ?? { top: 0, height: innerHeight }
          keepOnScreen(v, held ?? line.from, (p) => v.documentTop + v.lineBlockAt(p).top, held !== null ? hold!.y : r.top + r.height / 3, there)
          return
        }
        if (!seen(pos)) pos = null
      }
      const inSight = pos === null
      pos = ed.api.offBlocks(pos ?? lineInSight(v))
      if (pos === null) return
      v.dispatch({ selection: { anchor: pos } })
      v.contentDOM.focus({ preventScroll: true })
      if (inSight) followSight(ed.api, box, pos)
    }
    land()
    return stop
  }, [editor, article, shown, cur])
}

export const fmLines = ({ fm, body }: { fm: string; body: string }) => (fm ? (fm.match(/\n/g)?.length ?? 0) + (fm.endsWith("\n") || !body ? 0 : 1) : 0)

export function spotOf(article: HTMLElement | null, ed: EditorApi | null, above: number): Spot {
  const v = ed?.view ?? null
  const box = scrollingBox(article)
  const y = box ? box.scrollTop : scrollY, max = scrollMax(box)
  const spot: Spot = { box, y, ratio: max > 0 ? y / max : 0 }
  const top = box ? box.getBoundingClientRect().top : 0
  if (v?.dom.isConnected && v.dom.getClientRects().length) {
    spot.text = true
    const at = lineAtTop(v, top, above)
    if (at) { spot.line = at.line; spot.into = at.into }
  } else if (article && y > 0) {
    const at = partLineAt(article, top)
    if (at) { spot.line = at.line; spot.into = at.into }
  }
  return spot
}

export function partLineAt(article: HTMLElement, top: number): { line: number; into: number } | null {
  const at = partAt(article, top)
  if (!at) return null
  const r = at.el.getBoundingClientRect()
  const line = Number(at.el.dataset.line), end = Number(at.el.dataset.end ?? line)
  const into = r.height > 0 ? Math.min(Math.max((top - r.top) / r.height, 0), 1) : 0
  return end > line ? { line: line + Math.min(Math.floor(into * (end - line + 1)), end - line), into: 0 } : { line, into }
}

export function lineAtTop(v: EditorApi["view"], top: number, above: number): { line: number; into: number } | null {
  const h = top - v.documentTop
  if (h <= 0 || h >= v.contentHeight) return null
  // A pixel of slack: scroll positions are rounded, so a place set at a line's top reads back in the line above.
  const b = v.lineBlockAtHeight(h + 1)
  return { line: v.state.doc.lineAt(b.from).number - 1 - above, into: b.height > 0 ? Math.max(h - b.top, 0) / b.height : 0 }
}

function partAt(article: HTMLElement, top: number): { el: HTMLElement } | null {
  let below: HTMLElement | null = null
  for (const el of article.querySelectorAll<HTMLElement>("[data-line]")) {
    const r = el.getBoundingClientRect()
    if (!r.height) continue
    if (r.top <= top && r.bottom > top) return { el }
    if (r.top > top && (!below || r.top < below.getBoundingClientRect().top)) below = el
  }
  return below ? { el: below } : null
}

export function keepPlace(s: Spot, ed: EditorApi | null, above: number, article: HTMLElement | null, done?: () => void, there?: () => void): () => void {
  const box = s.box?.isConnected ? s.box : null
  const v = ed?.view.dom.isConnected && ed.view.dom.getClientRects().length ? ed.view : null
  const parts = !v && s.line !== undefined && s.line >= 0 && article ? [...article.querySelectorAll<HTMLElement>("[data-line]")] : []
  const at = () => (box ? box.scrollTop : scrollY)
  const line = v && s.line !== undefined && s.line >= 0 ? Math.min(Math.max(s.line + above + 1, 1), v.state.doc.lines) : 0
  const delta = (): number => {
    if (parts.length) {
      let hit: HTMLElement | null = null
      for (const el of parts) if (Number(el.dataset.line) <= s.line! && (!hit || Number(el.dataset.line) >= Number(hit.dataset.line))) hit = el
      if (hit) {
        const r = hit.getBoundingClientRect()
        const line = Number(hit.dataset.line), end = Number(hit.dataset.end ?? line)
        const into = end > line ? (Math.min(s.line! - line, end - line) / (end - line + 1)) * r.height : line === s.line ? (s.into ?? 0) * r.height : 0
        return r.top + into - (box ? box.getBoundingClientRect().top : 0)
      }
    }
    if (!v || s.line === undefined) return (v && s.text) || s.ratio === 0 ? s.y - at() : s.ratio * scrollMax(box) - at()
    if (s.line < 0) return -at()
    const b = v.lineBlockAt(v.state.doc.line(line).from)
    return v.documentTop + b.top + (s.into ?? 0) * b.height - (box ? box.getBoundingClientRect().top : 0)
  }
  if (line) ed!.reveal(line - 1)
  return holdPlace(box, delta, {
    measure: v ? (read, write) => v.requestMeasure({ read, write }) : undefined,
    gone: () => !!v && !v.dom.isConnected, done, there,
  })
}
