// Vim's / and n outside the editor: matches in the focused pane lit with CSS highlights; a note is searched in what its
// editor shows (not its frontmatter or a link's address), drawn tables included. Smartcase; lit until Escape.
import type { EditorView } from "@codemirror/view"
import { editorOf, onTabLayoutChange, openAround, textRanges } from "@vaultite"
import { mainEditor, scroller } from "./scroll"

type Match = { y: number } & ({ dom: Range } | { view: EditorView; from: number; to: number })

let query = ""
let matches: Match[] = []
let current = -1
let root: HTMLElement | null = null

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

/** The query as a pattern: smartcase (any capital, and case counts). */
function needle(q: string) {
  return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), /[A-Z]/.test(q) ? "g" : "gi")
}

/** Each drawn block's matches in a paint, found once (its element, and what's lit in it). */
type Drawn = { from: number; to: number; ranges: Range[]; first?: number }
let drawn: Map<EditorView, Drawn[]> | null = null
function drawnIn(view: EditorView): Drawn[] {
  drawn ??= new Map()
  let list = drawn.get(view)
  if (!list) {
    const re = needle(query)
    list = (editorOf(view)?.blocks?.() ?? []).filter((b) => b.text && b.el).map((b) => ({ from: b.from, to: b.to, ranges: textRanges(b.el!.querySelector<HTMLElement>(".cm-block-body") ?? b.el!, re) }))
    drawn.set(view, list)
  }
  return list
}

/** A note match as a DOM range, if CodeMirror has drawn it: in a drawn table or callout, the block's k-th match drawn
 *  for its k-th in the text. */
function rangeOf(m: Match, i: number) {
  if ("dom" in m) return m.dom
  const { view, from, to } = m
  if (from < view.viewport.from || to > view.viewport.to) return null
  const block = drawnIn(view).find((b) => b.from <= from && from < b.to)
  if (block) {
    // (a block's matches are next to each other in the list: one place down the page)
    block.first ??= matches.findIndex((x) => "view" in x && x.view === view && x.from >= block.from && x.from < block.to)
    return block.ranges.length ? block.ranges[Math.min(i - block.first, block.ranges.length - 1)] : null
  }
  try {
    const a = view.domAtPos(from), b = view.domAtPos(to)
    const r = document.createRange()
    r.setStart(a.node, a.offset)
    r.setEnd(b.node, b.offset)
    return r.collapsed ? null : r
  } catch { return null }
}

/** Draw the highlights (again after a scroll: the note's editor draws other lines). */
function paint() {
  if (!supported()) return
  const all = new Highlight(), cur = new Highlight()
  drawn = null
  matches.forEach((m, i) => { const r = rangeOf(m, i); if (r) (i === current ? cur : all).add(r) })
  CSS.highlights.set("vim-find", all)
  CSS.highlights.set("vim-find-current", cur)
}

let frame = 0
const repaint = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint) }
let watching: HTMLElement | null = null
function watch(el: HTMLElement | null) {
  if (watching === el) return
  watching?.removeEventListener("scroll", repaint)
  watching = el
  el?.addEventListener("scroll", repaint, { passive: true })
}

/** Put the highlights away (Escape, another tab). */
export function clearFind() {
  matches = []
  current = -1
  watch(null)
  if (supported()) { CSS.highlights.delete("vim-find"); CSS.highlights.delete("vim-find-current") }
}
export const findActive = () => matches.length > 0

/** Find `q` in what's in sight; answers how many matches. */
export function search(q: string) {
  query = q
  clearFind()
  root = scroller()
  if (!root || !q) return 0
  const re = needle(q)
  const box = root.getBoundingClientRect()
  const found: Match[] = []
  for (const r of textRanges(root, re, 5000, ".cm-editor, [data-vim-find]")) found.push({ dom: r, y: r.getBoundingClientRect().top - box.top + root.scrollTop })
  const view = mainEditor(root)
  if (view) {
    const { state } = view, ed = editorOf(view), start = ed?.start?.(state) ?? 0
    const text = state.doc.toString()
    re.lastIndex = start
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const from = m.index, to = from + m[0].length
      if (ed?.findable && !ed.findable(state, from, to)) continue
      found.push({ view, from, to, y: view.lineBlockAt(from).top + view.documentTop - box.top + root.scrollTop })
    }
  }
  matches = found.sort((a, b) => a.y - b.y)
  followTabs()
  watch(root)
  paint()
  return matches.length
}

/** Go to the next match below what's in sight (1) or above it (-1), or the one after the current one. */
export function go(dir: 1 | -1) {
  if (!matches.length && query) search(query)
  if (!matches.length || !root) return false
  if (current < 0) {
    const at = root.scrollTop + root.clientHeight / 3
    const i = dir > 0 ? matches.findIndex((m) => m.y >= root!.scrollTop) : matches.findLastIndex((m) => m.y < at)
    current = i < 0 ? (dir > 0 ? 0 : matches.length - 1) : i
  } else current = (current + dir + matches.length) % matches.length
  root.scrollTo({ top: Math.max(0, matches[current].y - root.clientHeight / 3), behavior: "auto" })
  // (A note's editor draws the lines it scrolled to on its next frame; one in a drawn table is then taken to its row.)
  repaint()
  const m = matches[current], i = current, el = root
  requestAnimationFrame(() => {
    drawn = null
    const r = rangeOf(m, i)
    if (r && "view" in m) {
      openAround(r)
      const at = r.getBoundingClientRect(), box = el.getBoundingClientRect()
      if (at.top < box.top || at.bottom > box.bottom - el.clientHeight / 4) el.scrollTop += at.top - box.top - el.clientHeight / 3
    }
    repaint()
  })
  return true
}

export const findQuery = () => query

// Another tab or pane: what was found was found there. (Listened for from the first search: the plugin API isn't
// called while the module loads.)
let following = false
function followTabs() {
  if (following) return
  following = true
  onTabLayoutChange(() => { if (matches.length && root && !root.isConnected) clearFind() })
}
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && matches.length && !e.defaultPrevented) clearFind()
}, true)
