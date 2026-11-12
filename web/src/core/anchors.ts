import type { Text } from "@codemirror/state"
import type { ViewUpdate } from "@codemirror/view"
import { useEffect, useMemo, useState } from "react"
import { useStateFor } from "@/core/statefor"
import { anchorKey, anchorLine, headingsOf, type Heading } from "../../../core/sections.ts"
import { openFile, readFile, stem } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { notify } from "@/core/notify"
import { cancelRestores } from "@/core/viewstate"
import { signal } from "@/core/signal"
import { glide } from "@/core/animation"
import { trackSoon } from "@/core/unsaved"

export type { Heading }

export type DocView = {
  path: string
  text: () => string
  scrollTo: (line: number) => void
  topLine: () => number
  dom: HTMLElement
}

const docs: DocView[] = []
const subs = signal()
let version = 0
const changed = () => { version++; subs.notify() }

export function registerDoc(d: DocView) {
  docs.push(d)
  changed()
  setTimeout(tryPending, 30)
  return () => { const i = docs.indexOf(d); if (i >= 0) docs.splice(i, 1); changed() }
}
const OUTLINED = /^\s{0,3}(?:#{1,6}(?:\s|$)|=+\s*$|-+\s*$|`{3}|~{3})|^\s*(?:[-*+]|\d+[.)])(?:\s|$)/
export function docChanged(u: ViewUpdate) {
  const a = u.startState.doc, b = u.state.doc
  let moved = a.lines !== b.lines
  const heads = (doc: Text, from: number, to: number) => {
    for (let n = doc.lineAt(from).number, end = Math.min(doc.lineAt(to).number + 1, doc.lines); n <= end; n++) if (OUTLINED.test(doc.line(n).text)) return true
    return false
  }
  if (!moved) u.changes.iterChangedRanges((fa, ta, fb, tb) => { moved ||= heads(a, fa, ta) || heads(b, fb, tb) })
  if (moved) changed()
}

function viewOf(path: string, within?: Element | null): DocView | null {
  const shown = docs.filter((d) => d.path === path && d.dom.isConnected && d.dom.getClientRects().length > 0 && (!within || within.contains(d.dom)))
  return shown.find((d) => d.dom.closest("#main-scroll")) ?? shown[shown.length - 1] ?? null
}

let pending: { path: string; anchor: string; until: number; within?: Element | null } | null = null
function drawnHeading(path: string, anchor: string, within?: Element | null): HTMLElement | null {
  if (anchor.startsWith("^")) return null
  const want = anchorKey(anchor.split("#").pop() ?? "")
  const hs = (within ?? document).querySelectorAll<HTMLElement>(`.file-view[data-path="${CSS.escape(path)}"] :is(h1, h2, h3, h4, h5, h6)`)
  return [...hs].find((h) => h.getClientRects().length > 0 && anchorKey(h.textContent ?? "") === want) ?? null
}

function tryPending() {
  if (!pending) return
  if (Date.now() > pending.until) { pending = null; return }
  const v = viewOf(pending.path, pending.within)
  const h = v ? null : drawnHeading(pending.path, pending.anchor, pending.within)
  if (h) { pending = null; cancelRestores(); h.scrollIntoView({ block: "start", behavior: glide() }); return }
  if (!v) return
  const { anchor } = pending
  pending = null
  go(v, anchor)
}

function go(v: DocView, anchor: string) {
  const line = anchorLine(v.text(), anchor)
  if (line === null) { notify(`No ${anchor.startsWith("^") ? "block" : "heading"} "${anchor}" in ${stem(v.path)}`); return }
  cancelRestores()
  v.scrollTo(line)
}

/** Open a file at a heading ("Heading", "Parent#Child") or a block ("^id"); no anchor: just open it. */
export function openAt(path: string, anchor: string, opts: { newTab?: boolean; pane?: string } = {}) {
  const a = anchor.trim()
  const v = viewOf(path)
  if (a && v && !opts.newTab && v.dom.closest("#main-scroll")) return go(v, a)
  openFile(path, opts)
  if (a) awaitAnchor({ path, anchor: a })
}

/** Scroll a file shown inside `within` (a glance's sheet) to a heading or block, once its editor is there. */
export const showAnchorIn = (within: Element, path: string, anchor: string) => { if (anchor.trim()) awaitAnchor({ path, anchor: anchor.trim(), within }) }

/** How long a place asked for waits for its file's view: a loaded machine or a phone's network can take seconds. */
const ON_ITS_WAY_MS = 15_000
function whileOnItsWay(look: () => void, done: () => boolean, drop: () => void) {
  const t = setInterval(() => { look(); if (done()) end() }, 100)
  const off = () => { drop(); end() }
  const end = () => { clearInterval(t); removeEventListener("pointerdown", off, true); removeEventListener("keydown", off, true) }
  addEventListener("pointerdown", off, true); addEventListener("keydown", off, true)
  look()
  if (done()) end()
}

function awaitAnchor(p: { path: string; anchor: string; within?: Element }) {
  const asked = pending = { ...p, until: Date.now() + ON_ITS_WAY_MS }
  whileOnItsWay(tryPending, () => pending !== asked, () => { if (pending === asked) pending = null })
}

export type DrawnLine = { line: number; y: number }
type LineTaker = { path: string; dom: () => HTMLElement | null; take: (line: number, find?: string, from?: DrawnLine, col?: number) => void }
const takers: LineTaker[] = []
let wanted: { path: string; line: number; find?: string; from?: DrawnLine; col?: number; until: number } | null = null
trackSoon("a line's edit on its way", () => !!wanted && Date.now() <= wanted.until)

function deliver() {
  if (!wanted) return
  if (Date.now() > wanted.until) { wanted = null; return }
  const shown = takers.filter((t) => t.path === wanted!.path && !!t.dom()?.isConnected && t.dom()!.getClientRects().length > 0)
  const t = shown.find((x) => x.dom()!.closest("#main-scroll")) ?? shown[shown.length - 1]
  if (!t) return
  const { line, find, from, col } = wanted
  wanted = null
  t.take(line, find, from, col)
}

/** Open a file in editing (its view may be on its way), the cursor at a 0-based line counting frontmatter (`col` in it,
 *  or `find` selected there), scrolled to; `from`: a line (numbered the same) on screen now, kept where it is. */
export function editAt(path: string, line: number, opts: { newTab?: boolean; pane?: string; find?: string; col?: number; from?: DrawnLine } = {}) {
  openFile(path, { newTab: opts.newTab, pane: opts.pane })
  const asked = wanted = { path, line, find: opts.find, from: opts.from, col: opts.col, until: Date.now() + ON_ITS_WAY_MS }
  whileOnItsWay(deliver, () => wanted !== asked, () => { if (wanted === asked) wanted = null })
}

export function useEditAt(path: string, dom: () => HTMLElement | null, take: LineTaker["take"]) {
  useEffect(() => {
    const t: LineTaker = { path, dom, take }
    takers.push(t)
    setTimeout(deliver, 30)
    return () => { const i = takers.indexOf(t); if (i >= 0) takers.splice(i, 1) }
  }, [path, dom, take])
}

/** A file's headings (from its editor when it's on screen, else from the file), the one at the top of the screen, and
 *  going to one. For the Outline panel. */
export function useOutline(path: string) {
  subs.use(() => version)
  const v = path ? viewOf(path) : null
  const [file, setFile] = useState({ path: "", text: "" })
  const [seen, setSeen] = useState(0)
  useVaultChange(() => setSeen(Date.now()), path ? [path] : [])
  const md = !!path && /\.md$/i.test(path)
  useEffect(() => {
    if (!md || v) { setFile({ path, text: "" }); return }
    let live = true
    readFile(path).then((r) => { if (live) setFile({ path, text: r.text }) }, () => { if (live) setFile({ path, text: "" }) })
    return () => { live = false }
  }, [path, !!v, seen])
  const text = v ? v.text() : file.path === path ? file.text : ""
  const headings = useMemo(() => headingsOf(text), [text])
  const [current, setCurrent] = useStateFor([!!v], () => -1)
  useEffect(() => {
    if (!v) return
    const at = () => {
      const top = v.topLine()
      let k = -1
      headings.forEach((h, i) => { if (h.line <= top) k = i })
      setCurrent(k)
    }
    at()
    // scroll events don't bubble: each pane is its own scroller, and phones scroll the window.
    document.addEventListener("scroll", at, { capture: true, passive: true })
    return () => document.removeEventListener("scroll", at, { capture: true })
  }, [v, headings, setCurrent])
  return {
    headings,
    /** Its text is on its way (neither its editor nor the file is here yet): a list drawn now would grow. */
    loading: md && !v && file.path !== path,
    current,
    go: (h: Heading) => (v ? v.scrollTo(h.line) : openAt(path, h.text.replace(/#/g, " "))),
    /** Its text as the outline read it (the editor's, else the file's). */
    text,
    /** Go to a line that isn't a heading (a list item): there in its editor, else just open the file. */
    goLine: (line: number) => (v ? v.scrollTo(line) : openFile(path)),
  }
}
