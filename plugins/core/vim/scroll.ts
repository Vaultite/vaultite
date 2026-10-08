// Moving through what's on screen outside the editor: the scroller j/k move (a sheet's, else the focused pane's),
// headings (a note's from its text, so undrawn ones count) and the note's editor itself, for `i`.
import { EditorView } from "@codemirror/view"
import { currentFile, runCommandById } from "@vaultite"
import { setPeek } from "./state"

const LINE = 60

// (The sizes first: they're cheap, the styles aren't.)
const scrollsY = (el: Element) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)
const scrollsX = (el: Element) => el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)
const shown = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === "fixed"

/** An open sheet (the app's one sheet system draws a <dialog>), which keys go to before the panes under it. */
export const openSheet = () => [...document.querySelectorAll<HTMLElement>("dialog[open]")].find(shown) ?? null

/** Where the keys act: an open sheet, else the focused pane. */
export const focusedRoot = (): HTMLElement | null => openSheet() ?? document.getElementById("main-scroll")

/** The biggest element under `root` (itself included) that scrolls this way, or null. */
function biggest(root: HTMLElement, test: (el: Element) => boolean) {
  if (test(root)) return root
  let best: HTMLElement | null = null, area = 0
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!test(el) || !shown(el)) continue
    const a = el.clientWidth * el.clientHeight
    if (a > area) { area = a; best = el }
  }
  return best
}

/** What j and k scroll. */
export function scroller() {
  const root = focusedRoot()
  return root ? biggest(root, scrollsY) : null
}

export function scroll(by: "line" | "half" | "page", dir: 1 | -1) {
  const el = scroller()
  if (!el) return
  const step = by === "line" ? LINE : by === "half" ? el.clientHeight / 2 : el.clientHeight - LINE
  el.scrollBy({ top: dir * step, behavior: by === "line" ? "auto" : "smooth" })
}

export function scrollSide(dir: 1 | -1) {
  const root = focusedRoot()
  const el = root && biggest(root, scrollsX)
  el?.scrollBy({ left: dir * LINE, behavior: "auto" })
}

export function scrollEdge(top: boolean) {
  const el = scroller()
  el?.scrollTo({ top: top ? 0 : el.scrollHeight, behavior: "auto" })
}

/** The note's own editor in the focused pane (reading view is the editor too, read-only): the outermost one, not an
 *  embed's or a drawn block's. */
export function mainEditor(root = document.getElementById("main-scroll")): EditorView | null {
  if (!root) return null
  for (const el of root.querySelectorAll<HTMLElement>(".cm-editor")) {
    if (el.parentElement?.closest(".cm-editor")) continue
    const v = EditorView.findFromDOM(el)
    if (v) return v
  }
  return null
}

/** Each heading's distance from the top of the scroller's content, in order: a note's (from its text), else the
 *  page's (<h1>...<h6>: a dashboard's sections, a sheet's). */
function headingTops(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const tops: number[] = []
  const view = mainEditor(el)
  if (view) {
    const doc = view.state.doc
    let fence: string | null = null
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i)
      const f = /^\s*(`{3,}|~{3,})/.exec(line.text)
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue }
      if (fence || !/^#{1,6}\s/.test(line.text)) continue
      tops.push(view.lineBlockAt(line.from).top + view.documentTop - box.top + el.scrollTop)
    }
  }
  // (A note's title isn't one of its headings: with a note there, only its text's count.)
  if (!view) for (const h of el.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
    if (h.closest(".cm-content") || !shown(h)) continue
    tops.push(h.getBoundingClientRect().top - box.top + el.scrollTop)
  }
  return tops.sort((a, b) => a - b)
}

/** The next (1) or previous (-1) heading, scrolled to just below the top. */
export function heading(dir: 1 | -1) {
  const el = scroller()
  if (!el) return
  const at = el.scrollTop + 12
  const tops = headingTops(el)
  const to = dir > 0 ? tops.find((t) => t > at + 2) : [...tops].reverse().find((t) => t < at - 2)
  if (to !== undefined) el.scrollTo({ top: Math.max(0, to - 12), behavior: "auto" })
}

/** The first line in sight in a note's editor. */
function lineInSight(view: EditorView, el: HTMLElement) {
  const top = el.getBoundingClientRect().top
  const height = Math.max(0, top - view.documentTop)
  let block = view.lineBlockAtHeight(height)
  if (block.top + view.documentTop < top - 2 && block.to < view.state.doc.length) block = view.lineBlockAt(block.to + 1)
  return block.from
}

/** Reading view: edit the note where you're reading (the cursor on the first line in sight; Escape in normal mode reads
 *  again). A note already in editing: into it, at its cursor when that's in sight. */
export function editHere() {
  const path = currentFile()
  const view = mainEditor()
  if (view?.state.facet(EditorView.editable)) {
    const el = scroller() ?? document.getElementById("main-scroll")
    const head = view.state.selection.main.head, box = el?.getBoundingClientRect()
    const y = view.coordsAtPos(head)?.top
    const seen = !box || (y !== undefined && y >= box.top && y < box.bottom)
    if (!seen && el) view.dispatch({ selection: { anchor: lineInSight(view, el) } })
    view.contentDOM.focus({ preventScroll: true })
    return
  }
  runCommandById("view:toggle")
  // (Not a note in reading view, a page drawn from blocks or a table: its own way of editing, if it has one.)
  if (view && path) setPeek(path)
}
