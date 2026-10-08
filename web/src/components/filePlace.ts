// Keeping the reader's place across a change of view: the top line in sight and how far into it (or how far down, for
// files drawn without lines), and the cursor put into the text where they read.
import { useCallback } from "react"
import type { EditorApi } from "@/editor/Editor"
import { scrollingBox } from "@/lib/utils"
import type { Mode } from "@/components/fileState"


/** Where the reader is: how far down (`y`, and as a share of what scrolls), and with an editor the body's line at the
 *  top of the scroller (negative: in source mode's frontmatter) and how far into it (a share of its height). */
export type Spot = { box: HTMLElement | null; y: number; ratio: number; line?: number; into?: number; text?: boolean }

const scrollMax = (box: HTMLElement | null) => (box ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight - innerHeight)


/** The Properties in sight after an undo changed them: the editor scrolls to its cursor (this frame), taken back. */
export function revealProps(article: HTMLElement | null) {
  const box = scrollingBox(article), y = box ? box.scrollTop : scrollY
  requestAnimationFrame(() => {
    if (box) box.scrollTop = y; else scrollTo(scrollX, y)
    article?.querySelector("[aria-label='Properties']")?.scrollIntoView({ block: "nearest" })
  })
}

// ---------- the cursor into the text ----------
// Switching to editing puts the cursor in the text (Vim: normal mode), so the keyboard goes on without a click.

/** The first line wholly in sight in an editor scrolled by `box`. */
function lineInSight(v: EditorApi["view"], box: HTMLElement | null) {
  const top = box ? box.getBoundingClientRect().top : 0
  const h = Math.max(0, top - v.documentTop)
  let b = v.lineBlockAtHeight(h)
  if (b.top + v.documentTop < top - 2 && b.to < v.state.doc.length) b = v.lineBlockAt(b.to + 1)
  return b.from
}

/** Once the shown view's editor is writable, put the cursor at `at` (null: first line in sight) without scrolling, or
 *  scroll to it with `reveal`. Gives up after a second or when the reader acts first. Returns a stop. */
export function useTextFocus(editor: { current: { api: EditorApi; source: boolean } | null }, article: { current: HTMLElement | null },
  shown: { current: Mode }, cur: { current: { fm: string; body: string } }) {
  return useCallback((at: [number, number] | null, reveal = false) => {
    let frame = 0, stopped = false
    const until = performance.now() + 1000
    const stop = () => {
      stopped = true
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
      // (A cursor out of sight would be scrolled to by the first key, and CodeMirror keeps its line drawn, which moves
      // the page under the reader as the lines between are measured: the first line in sight instead.)
      const seen = (pos: number) => {
        const b = v.lineBlockAt(pos), r = box?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight }
        return v.documentTop + b.top >= r.top - 1 && v.documentTop + b.bottom <= r.bottom + 1
      }
      let pos: number | null = null
      if (at && at[0] + above + 1 <= doc.lines) {
        const line = doc.line(at[0] + above + 1)
        pos = line.from + Math.min(at[1], line.length)
        if (reveal) {
          v.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
          v.contentDOM.focus({ preventScroll: true })
          return
        }
        if (!seen(pos)) pos = null
      }
      // Never into a drawn block (a ```block-person fence at the top): it would show its Markdown until a click elsewhere.
      pos = ed.api.offBlocks(pos ?? lineInSight(v, box))
      if (pos === null) return
      v.dispatch({ selection: { anchor: pos } })
      v.contentDOM.focus({ preventScroll: true })
    }
    land()
    return stop
  }, [editor, article, shown, cur])
}

/** How many lines are above the body in a file's editor: the frontmatter's (hidden but for source mode). */
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

/** A drawn page's place: the part at `top` (one under it when the top is in a gap), by the line it starts at, and how
 *  far into it. Markdown between blocks is many lines in the editor: the one as far into it. */
export function partLineAt(article: HTMLElement, top: number): { line: number; into: number } | null {
  const at = partAt(article, top)
  if (!at) return null
  const r = at.el.getBoundingClientRect()
  const line = Number(at.el.dataset.line), end = Number(at.el.dataset.end ?? line)
  const into = r.height > 0 ? Math.min(Math.max((top - r.top) / r.height, 0), 1) : 0
  return end > line ? { line: line + Math.min(Math.floor(into * (end - line + 1)), end - line), into: 0 } : { line, into }
}

/** The body's line (0-based; `above`: the frontmatter's lines in the editor) at `top` on the screen, and how far into it;
 *  null above or below the text. */
export function lineAtTop(v: EditorApi["view"], top: number, above: number): { line: number; into: number } | null {
  const h = top - v.documentTop
  if (h <= 0 || h >= v.contentHeight) return null
  // (a pixel's slack: a place set at a line's top reads back a fraction into the line above, scroll positions being
  // rounded, and switching back would then show the part before it)
  const b = v.lineBlockAtHeight(h + 1)
  return { line: v.state.doc.lineAt(b.from).number - 1 - above, into: b.height > 0 ? Math.max(h - b.top, 0) / b.height : 0 }
}

/** The drawn part (`[data-line]`) at `top` on the screen, or the first one under it. */
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

/** Scroll the new view to `s`, again each frame while it settles (lines measured late, blocks and pictures drawn late),
 *  until still for half a second (3 s at most) or the reader scrolls or types. Returns a stop. */
export function keepPlace(s: Spot, ed: EditorApi | null, above: number, article: HTMLElement | null, done?: () => void, there?: () => void): () => void {
  const box = s.box?.isConnected ? s.box : null
  const v = ed?.view.dom.isConnected && ed.view.dom.getClientRects().length ? ed.view : null
  // A drawn page with lines (a dashboard's cards), when there's no editor to find the line in.
  const parts = !v && s.line !== undefined && s.line >= 0 && article ? [...article.querySelectorAll<HTMLElement>("[data-line]")] : []
  const at = () => (box ? box.scrollTop : scrollY)
  const to = (y: number) => { if (box) box.scrollTop = y; else scrollTo(0, y) }
  const line = v && s.line !== undefined && s.line >= 0 ? Math.min(Math.max(s.line + above + 1, 1), v.state.doc.lines) : 0
  /** How far to scroll from where it is now. */
  const delta = (): number => {
    if (parts.length) {
      // The part that starts at that line, or the last one before it.
      let hit: HTMLElement | null = null
      for (const el of parts) if (Number(el.dataset.line) <= s.line! && (!hit || Number(el.dataset.line) >= Number(hit.dataset.line))) hit = el
      if (hit) {
        const r = hit.getBoundingClientRect()
        const line = Number(hit.dataset.line), end = Number(hit.dataset.end ?? line)
        // (Markdown between blocks: as far into it as that line is into its lines)
        const into = end > line ? (Math.min(s.line! - line, end - line) / (end - line + 1)) * r.height : line === s.line ? (s.into ?? 0) * r.height : 0
        return r.top + into - (box ? box.getBoundingClientRect().top : 0)
      }
    }
    // Off the text (above or below it) the same offset; from a drawn page (a dashboard's grid) how far down it was.
    if (!v || s.line === undefined) return (v && s.text) || s.ratio === 0 ? s.y - at() : s.ratio * scrollMax(box) - at()
    if (s.line < 0) return -at() // in source mode's frontmatter: the top of the file
    const b = v.lineBlockAt(v.state.doc.line(line).from)
    return v.documentTop + b.top + (s.into ?? 0) * b.height - (box ? box.getBoundingClientRect().top : 0)
  }
  // (until it's been still for half a second: blocks drawn late resize what's above; 3 s at most)
  let stopped = false, frame = 0, still = 0
  const until = performance.now() + 3000
  const events = ["wheel", "touchstart", "keydown", "pointerdown"]
  const stop = () => {
    if (stopped) return
    stopped = true
    cancelAnimationFrame(frame)
    for (const t of events) removeEventListener(t, stop, true)
    done?.()
  }
  for (const t of events) addEventListener(t, stop, { capture: true, passive: true })
  const apply = (d: number) => {
    if (stopped) return
    // (`there` out of the editor's measure cycle, which this is: it may put the cursor in the text)
    if (Math.abs(d) >= 1) { to(at() + d); still = 0 } else if (++still === 1 && there) setTimeout(there, 0)
    if (still > 30) return stop()
    frame = requestAnimationFrame(step)
  }
  const step = () => {
    if (stopped) return
    if (performance.now() > until || (v && !v.dom.isConnected)) return stop()
    if (v) v.requestMeasure({ read: delta, write: apply })
    else apply(delta())
  }
  if (line) ed!.reveal(line - 1)
  step()
  return stop
}
