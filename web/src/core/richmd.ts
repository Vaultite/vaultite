import { isDark } from "@/lib/utils"
import { onLook } from "@/core/appearance"
import { haptic } from "@/core/haptics"
import type { Mounted } from "pele/lazy"
import { glide } from "@/core/animation"
import { elementOf } from "@/core/dom"

type Katex = typeof import("katex").default
let katex: Promise<Katex> | null = null
const loadKatex = () => (katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default))

export function renderMath(tex: string, el: HTMLElement, display: boolean) {
  el.classList.add("math", display ? "math-display" : "math-inline")
  if (!el.firstChild) el.textContent = tex
  loadKatex().then((k) => {
    k.render(tex, el, { displayMode: display, throwOnError: false, output: "htmlAndMathml" })
  }).catch(() => { el.textContent = tex })
}

type Pele = typeof import("pele/lazy")
let pele: Promise<Pele> | null = null
const loadPele = () => (pele ??= import("pele/lazy"))
type Mermaid = typeof import("mermaid").default
let mermaid: Promise<Mermaid> | null = null
const loadMermaid = () => (mermaid ??= import("mermaid").then((m) => m.default))
let seq = 0
type Diagram = { src: string; mounted?: Mounted; dark?: boolean }
const diagrams = new Map<HTMLElement, Diagram>()
let watching = false

async function drawPele(el: HTMLElement, d: Diagram) {
  const p = await loadPele()
  const src = d.src
  try { await p.load(p.detectType(src)) } catch { /* mount shows why */ }
  if (diagrams.get(el) !== d || d.src !== src) return
  if (d.mounted) { d.mounted.update(src); return }
  el.textContent = ""
  d.mounted = p.mount(el, src, { fontSize: 14, onError: () => void drawMermaid(el, d) })
}

async function drawMermaid(el: HTMLElement, d: Diagram) {
  const src = d.src
  const m = await loadMermaid()
  const dark = isDark()
  m.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "var(--font-sans)" })
  const id = `vau-mermaid-${++seq}`
  try {
    const { svg } = await m.render(id, src)
    if (diagrams.get(el) !== d || d.src !== src) return
    d.mounted?.destroy()
    d.mounted = undefined
    d.dark = dark
    el.innerHTML = svg
  } catch {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
  }
}

export function renderMermaid(src: string, el: HTMLElement) {
  el.classList.add("mermaid-diagram")
  let d = diagrams.get(el)
  if (d?.src === src && el.querySelector("svg")) return
  if (d) d.src = src
  else diagrams.set(el, d = { src })
  if (!el.firstChild) { const pre = document.createElement("pre"); pre.textContent = src; el.append(pre) }
  if (!watching) {
    watching = true
    onLook(() => {
      for (const [e, x] of diagrams) {
        if (!e.isConnected) { x.mounted?.destroy(); diagrams.delete(e) }
        else if (x.mounted) x.mounted.refresh()
        else if (x.dark !== undefined && x.dark !== isDark()) void drawMermaid(e, x)
      }
    })
  }
  void drawPele(el, d)
}

export const dropMermaid = (el: HTMLElement) => { diagrams.get(el)?.mounted?.destroy(); diagrams.delete(el) }

/** Draw what core/markdown.ts left for later inside `root`: math, code's colours and mermaid diagrams. */
export function hydrate(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-math]")) {
    if (el.dataset.drawn) continue
    const tex = el.textContent ?? ""
    el.dataset.drawn = "1"
    renderMath(tex, el, el.dataset.math === "display")
  }
  for (const el of root.querySelectorAll<HTMLElement>("pre > code[class^='language-']")) {
    if (el.dataset.drawn) continue
    el.dataset.drawn = "1"
    const lang = el.className.slice("language-".length)
    void import("@/editor/languages").then((l) => l.highlightInto(el, lang)).catch(() => { /* stays plain */ })
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-mermaid]")) {
    if (el.dataset.drawn) continue
    el.dataset.drawn = "1"
    const src = el.textContent ?? ""
    el.textContent = ""
    renderMermaid(src, el)
  }
}

function folded(el: Element, root: HTMLElement) {
  for (let d = el.parentElement?.closest("details"); d && root.contains(d); d = d.parentElement?.closest("details")) {
    if (!d.open && !d.querySelector(":scope > summary")?.contains(el)) return true
  }
  return false
}

export function drawEmbeds(root: HTMLElement, draw: (el: HTMLElement, target: string) => (() => void) | void): () => void {
  const waiting = new Set(root.querySelectorAll<HTMLElement>("[data-md-embed]")), undo: (() => void)[] = []
  const pass = () => {
    for (const el of waiting) {
      if (folded(el, root)) continue
      waiting.delete(el)
      const u = draw(el, el.dataset.mdEmbed!)
      if (u) undo.push(u)
    }
    if (!waiting.size) root.removeEventListener("toggle", pass, true)
  }
  // toggle doesn't bubble: heard on the way down.
  root.addEventListener("toggle", pass, true)
  pass()
  return () => { root.removeEventListener("toggle", pass, true); waiting.clear(); for (const u of undo.splice(0)) u() }
}

/** Where drawn Markdown is in its file (a note's block in the editor): its lines (0-based) now and the file's text,
 *  null once it's gone. */
export type DrawnLines = () => { lineStart: number; lineEnd: number; doc: string } | null
type DrawnHook = (el: HTMLElement, lines: DrawnLines | null) => void
const drawnHooks = new Set<DrawnHook>()
/** Call fn with each element Markdown was just drawn into as HTML (embeds, previews, a note's callouts and tables, with
 *  their lines): plugins that change rendered Markdown (another app's post-processors). Returns the way to stop. */
export function onMarkdownDrawn(fn: DrawnHook) {
  drawnHooks.add(fn)
  return () => { drawnHooks.delete(fn) }
}
export function markdownDrawn(el: HTMLElement, lines: DrawnLines | null = null) {
  // CodeMirror draws a widget before it puts it in the page: its lines are known once it's there.
  if (lines && !el.isConnected) { queueMicrotask(() => tell(el, lines)); return }
  tell(el, lines)
}
function tell(el: HTMLElement, lines: DrawnLines | null) {
  for (const f of drawnHooks) { try { f(el, lines) } catch (e) { console.error(e) } }
}
export const blockLines = (line: () => number | null, text: () => string, doc: () => string): DrawnLines => () => {
  const at = line()
  return at == null ? null : { lineStart: at, lineEnd: at + text().split("\n").length - 1, doc: doc() }
}

export const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

export function copyCode(button: HTMLElement, text: string) {
  const done = () => {
    button.innerHTML = CHECK_ICON
    button.classList.add("is-copied")
    button.dataset.tip = "Copied"
    setTimeout(() => { button.innerHTML = COPY_ICON; button.classList.remove("is-copied"); button.dataset.tip = "Copy" }, 1500)
  }
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) && done())
  else if (fallbackCopy(text)) done()
}

export async function copyText(text: string) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch { /* the other way */ }
  return fallbackCopy(text)
}

// navigator.clipboard needs a secure context: an http page copies with a textarea and execCommand.
function fallbackCopy(text: string) {
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0"
  document.body.append(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand("copy") } catch { ok = false }
  ta.remove()
  return ok
}

export function richClick(e: { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }, root: HTMLElement) {
  const t = elementOf(e.target)
  const copy = t?.closest<HTMLElement>("[data-copy]")
  if (copy && root.contains(copy)) {
    e.preventDefault(); e.stopPropagation()
    copyCode(copy, copy.closest(".md-code")?.querySelector("pre")?.textContent ?? "")
    return true
  }
  const ref = t?.closest?.<HTMLElement>("[data-footnote]")
  if (ref && root.contains(ref)) {
    e.preventDefault(); e.stopPropagation()
    const def = [...root.querySelectorAll<HTMLElement>("[data-footnote-def]")].find((d) => d.dataset.footnoteDef === ref.dataset.footnote)
    if (def) { def.scrollIntoView({ block: "center", behavior: glide() }); flash(def) }
    return true
  }
  const back = t?.closest?.<HTMLElement>("[data-footnote-back]")
  if (back && root.contains(back)) {
    e.preventDefault(); e.stopPropagation()
    const r = [...root.querySelectorAll<HTMLElement>("[data-footnote]")].find((d) => d.dataset.footnote === back.dataset.footnoteBack)
    if (r) { r.scrollIntoView({ block: "center", behavior: glide() }); flash(r) }
    return true
  }
  return false
}

function flash(el: HTMLElement) {
  el.classList.remove("is-flash")
  void el.offsetWidth
  el.classList.add("is-flash")
  setTimeout(() => el.classList.remove("is-flash"), 1200)
}

const TASK = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?=[ \t]|$)/
const FENCE = /^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})/

export function taskMarks(text: string): number[] {
  const out: number[] = []
  let fence = "", at = 0
  for (const line of text.split("\n")) {
    const f = FENCE.exec(line)?.[1]
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? "" : f
    else if (!fence) { const m = TASK.exec(line); if (m) out.push(at + m[0].length - 2) }
    at += line.length + 1
  }
  return out
}

export function wireTasks(root: HTMLElement, toggle: ((nth: number, on: boolean) => void) | null) {
  const boxes = [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].filter((b) => {
    const embed = b.closest("[data-md-embed], [data-embed]")
    return !embed || embed === root || !root.contains(embed)
  })
  boxes.forEach((b, i) => {
    b.disabled = !toggle
    b.setAttribute("aria-label", b.checked ? "Done" : "Not done")
    if (toggle) b.onclick = (e) => { e.stopPropagation(); haptic(); toggle(i, b.checked) }
  })
}

export function wireDoIt(root: HTMLElement, run: (nth: number, button: HTMLButtonElement) => void) {
  const boxes = [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].filter((b) => {
    const embed = b.closest("[data-md-embed], [data-embed]")
    return !embed || embed === root || !root.contains(embed)
  })
  boxes.forEach((b, i) => {
    const li = b.closest("li")
    if (!li || b.checked || b.dataset.status || li.querySelector(":scope > .md-do-it")) return
    const go = document.createElement("button")
    go.type = "button"
    go.className = "md-do-it"
    go.dataset.doIt = ""
    go.textContent = "Do it"
    go.onclick = (e) => { e.preventDefault(); e.stopPropagation(); run(i, go) }
    li.insertBefore(go, li.querySelector(":scope > ul, :scope > ol"))
  })
}

export function tickTask(text: string, nth: number, on: boolean): string | null {
  const at = taskMarks(text)[nth]
  return at === undefined ? null : text.slice(0, at) + (on ? "x" : " ") + text.slice(at + 1)
}
