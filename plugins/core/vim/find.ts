// Vim's / and n outside the editor: matches in the focused pane highlighted with the CSS Custom Highlight API; a note is
// searched in its editor's document, so lines not drawn yet count. Smartcase; the highlights stay until Escape.
import type { EditorView } from "@codemirror/view"
import { onTabLayoutChange } from "@vaultite"
import { mainEditor, scroller } from "./scroll"

type Match = { y: number } & ({ dom: Range } | { view: EditorView; from: number; to: number })

let query = ""
let matches: Match[] = []
let current = -1
let root: HTMLElement | null = null

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined"

function needle(q: string) {
  const exact = /[A-Z]/.test(q)
  return { exact, q: exact ? q : q.toLowerCase() }
}

/** The DOM matches of `q` under `el`, outside the note's editor (searched in its text instead). */
function domMatches(el: HTMLElement, q: string, exact: boolean) {
  const out: Range[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement
      if (!p || p.closest(".cm-editor, script, style, [aria-hidden=true], [data-vim-find]")) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = exact ? n.nodeValue ?? "" : (n.nodeValue ?? "").toLowerCase()
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange()
      r.setStart(n, i)
      r.setEnd(n, i + q.length)
      out.push(r)
    }
  }
  return out
}

/** A note match as a DOM range, if CodeMirror has drawn it. */
function rangeOf(m: Match) {
  if ("dom" in m) return m.dom
  const { view, from, to } = m
  if (from < view.viewport.from || to > view.viewport.to) return null
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
  matches.forEach((m, i) => { const r = rangeOf(m); if (r) (i === current ? cur : all).add(r) })
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
  const { exact, q: n } = needle(q)
  const box = root.getBoundingClientRect()
  const found: Match[] = []
  for (const r of domMatches(root, n, exact)) found.push({ dom: r, y: r.getBoundingClientRect().top - box.top + root.scrollTop })
  const view = mainEditor(root)
  if (view) {
    const text = exact ? view.state.doc.toString() : view.state.doc.toString().toLowerCase()
    for (let i = text.indexOf(n); i >= 0; i = text.indexOf(n, i + n.length)) {
      found.push({ view, from: i, to: i + n.length, y: view.lineBlockAt(i).top + view.documentTop - box.top + root.scrollTop })
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
  // (A note's editor draws the lines it scrolled to on its next frame.)
  repaint()
  requestAnimationFrame(repaint)
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
