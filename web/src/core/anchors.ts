// Places in a file (`#Heading`, `#^id`), found in the text as it is on screen: every Markdown editor registers here.
// Where a heading or block is: core/sections.ts, shared with the server.
import { useEffect, useMemo, useState } from "react"
import { anchorKey, anchorLine, headingsOf, type Heading } from "../../../core/sections.ts"
import { openFile, readFile, stem } from "@/core/files"
import { useVaultChange } from "@/core/live"
import { notify } from "@/core/notify"
import { cancelRestores } from "@/core/viewstate"
import { signal } from "@/core/signal"

export type { Heading }

/** A file shown in an editor. */
export type DocView = {
  path: string
  /** The text the editor has: the file's whole text, frontmatter too. */
  text: () => string
  /** Scroll so this line (0-based, in `text`) is near the top, and flash it. */
  scrollTo: (line: number) => void
  /** The line (0-based) at the top of what's on screen. */
  topLine: () => number
  /** The editor's element (is it on screen? in the focused pane?). */
  dom: HTMLElement
}

const docs: DocView[] = []
const subs = signal()
let version = 0
const changed = () => { version++; subs.notify() }

/** An editor showing a file: registered until it goes (the returned function). */
export function registerDoc(d: DocView) {
  docs.push(d)
  changed()
  setTimeout(tryPending, 30)
  return () => { const i = docs.indexOf(d); if (i >= 0) docs.splice(i, 1); changed() }
}
/** An editor's text changed (the outline follows it). */
export const docChanged = () => changed()

/** The editor showing this file that's on screen, the focused pane's first. */
function viewOf(path: string): DocView | null {
  const shown = docs.filter((d) => d.path === path && d.dom.isConnected && d.dom.getClientRects().length > 0)
  return shown.find((d) => d.dom.closest("#main-scroll")) ?? shown[shown.length - 1] ?? null
}

let pending: { path: string; anchor: string; until: number } | null = null
/** A heading drawn outside an editor (a dashboard being read: the Markdown between its blocks), on screen. */
function drawnHeading(path: string, anchor: string): HTMLElement | null {
  if (anchor.startsWith("^")) return null
  const want = anchorKey(anchor.split("#").pop() ?? "")
  const hs = document.querySelectorAll<HTMLElement>(`.file-view[data-path="${CSS.escape(path)}"] :is(h1, h2, h3, h4, h5, h6)`)
  return [...hs].find((h) => h.getClientRects().length > 0 && anchorKey(h.textContent ?? "") === want) ?? null
}

function tryPending() {
  if (!pending) return
  if (Date.now() > pending.until) { pending = null; return }
  const v = viewOf(pending.path)
  const h = v ? null : drawnHeading(pending.path, pending.anchor)
  if (h) { pending = null; cancelRestores(); h.scrollIntoView({ block: "start", behavior: "smooth" }); return }
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

/** Open a file at a heading ("Heading", "Parent#Child") or a block ("^id"); no anchor: just open it. The file's editor
 *  may still be on its way, so the place is looked for as it registers (a few seconds at most). */
export function openAt(path: string, anchor: string, opts: { newTab?: boolean; pane?: string } = {}) {
  const a = anchor.trim()
  const v = viewOf(path)
  if (a && v && !opts.newTab && v.dom.closest("#main-scroll")) return go(v, a)
  openFile(path, opts)
  if (!a) return
  pending = { path, anchor: a, until: Date.now() + 4000 }
  let n = 0
  const t = setInterval(() => { tryPending(); if (!pending || ++n > 40) clearInterval(t) }, 100)
}

// ---------- editing a line: a block's "Edit source" ----------

/** A file's view on screen that can take the cursor to a line (FileView: into editing first). */
type LineTaker = { path: string; dom: () => HTMLElement | null; take: (line: number) => void }
const takers: LineTaker[] = []
let wanted: { path: string; line: number; until: number } | null = null

function deliver() {
  if (!wanted) return
  if (Date.now() > wanted.until) { wanted = null; return }
  const shown = takers.filter((t) => t.path === wanted!.path && !!t.dom()?.isConnected && t.dom()!.getClientRects().length > 0)
  const t = shown.find((x) => x.dom()!.closest("#main-scroll")) ?? shown[shown.length - 1]
  if (!t) return
  const { line } = wanted
  wanted = null
  t.take(line)
}

/** Open a file in editing with the cursor at a line (0-based, frontmatter counted: as the server numbers a file's
 *  lines), scrolled to it: a block's "Edit source" while it's read. The file's view may still be on its way. */
export function editAt(path: string, line: number) {
  openFile(path)
  wanted = { path, line, until: Date.now() + 4000 }
  let n = 0
  const t = setInterval(() => { deliver(); if (!wanted || ++n > 40) clearInterval(t) }, 100)
  deliver()
}

/** A file's view takes editAt's requests for its path while it's mounted. */
export function useEditAt(path: string, dom: () => HTMLElement | null, take: (line: number) => void) {
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
  const [file, setFile] = useState("")
  const [seen, setSeen] = useState(0)
  useVaultChange(() => setSeen(Date.now()), path ? [path] : [])
  useEffect(() => {
    if (!path || v || !/\.md$/i.test(path)) { setFile(""); return }
    let live = true
    readFile(path).then((r) => { if (live) setFile(r.text) }, () => { if (live) setFile("") })
    return () => { live = false }
  }, [path, !!v, seen])
  const text = v ? v.text() : file
  const headings = useMemo(() => headingsOf(text), [text])
  const [current, setCurrent] = useState(-1)
  useEffect(() => {
    if (!v) { setCurrent(-1); return }
    const at = () => {
      const top = v.topLine()
      let k = -1
      headings.forEach((h, i) => { if (h.line <= top) k = i })
      setCurrent(k)
    }
    at()
    // Scrolling anywhere (each pane is its own scroller; phones scroll the window): scroll events don't bubble.
    document.addEventListener("scroll", at, { capture: true, passive: true })
    return () => document.removeEventListener("scroll", at, { capture: true })
  }, [v, headings])
  return {
    headings,
    current,
    go: (h: Heading) => (v ? v.scrollTo(h.line) : openAt(path, h.text.replace(/#/g, " "))),
  }
}
