// What Markdown draws after it's HTML (math, mermaid, code copy and footnote buttons), lazily, for the editor and for
// Markdown drawn outside it alike, so a note reads the same everywhere.
import { isDark } from "@/lib/utils"
import { onLook } from "@/core/appearance"
import { haptic } from "@/core/haptics"
import type { Mounted } from "pele/lazy"

type Katex = typeof import("katex").default
let katex: Promise<Katex> | null = null
const loadKatex = () => (katex ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => k.default))

/** TeX into `el` (display: a centred block of its own). Bad TeX shows as its source, in red. */
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
// Diagrams on screen: Pele draws them in the scheme's tokens (index.css), so they follow it with no redraw. `mounted` is
// Pele's, until Mermaid drew one Pele couldn't (then `dark`: the look it was drawn in).
type Diagram = { src: string; mounted?: Mounted; dark?: boolean }
const diagrams = new Map<HTMLElement, Diagram>()
let watching = false

async function drawPele(el: HTMLElement, d: Diagram) {
  const p = await loadPele()
  const src = d.src
  try { await p.load(p.detectType(src)) } catch { /* mount shows why */ }
  if (diagrams.get(el) !== d || d.src !== src) return // redrawn with newer text meanwhile
  if (d.mounted) { d.mounted.update(src); return }
  el.textContent = ""
  d.mounted = p.mount(el, src, { fontSize: 14, onError: () => void drawMermaid(el, d) })
}

/** What Pele can't draw, drawn by Mermaid (loaded only then); if Mermaid can't either, Pele's error stays. */
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

/** A mermaid diagram into `el` (its source shows until it's drawn), in the colour scheme's colours, light or dark. */
export function renderMermaid(src: string, el: HTMLElement) {
  el.classList.add("mermaid-diagram")
  let d = diagrams.get(el)
  if (d?.src === src && el.querySelector("svg")) return
  if (d) d.src = src
  else diagrams.set(el, d = { src })
  if (!el.firstChild) { const pre = document.createElement("pre"); pre.textContent = src; el.append(pre) }
  if (!watching) {
    watching = true
    // Another font measures labels again; Mermaid's few are drawn again for light or dark.
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

/** Forget a diagram whose element went away (the editor's widget destroyed). */
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

const drawnHooks = new Set<(el: HTMLElement) => void>()
/** Call fn with each element Markdown was just drawn into as HTML (embeds, previews, callouts and tables in the editor):
 *  plugins that change rendered Markdown (another app's post-processors). Returns the way to stop. */
export function onMarkdownDrawn(fn: (el: HTMLElement) => void) {
  drawnHooks.add(fn)
  return () => { drawnHooks.delete(fn) }
}
export function markdownDrawn(el: HTMLElement) {
  for (const f of drawnHooks) { try { f(el) } catch (e) { console.error(e) } }
}

export const COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

/** Copy a code block's text; the button shows a tick for a moment. */
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

/** Copy text: the async clipboard, else the textarea way; false when neither could. */
export async function copyText(text: string) {
  try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch { /* the other way */ }
  return fallbackCopy(text)
}

// Clipboard without the async API (an http page on the tailnet): a hidden textarea and execCommand.
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

/** Clicks inside core/markdown.ts's HTML: a code block's copy button, a footnote (scrolls to its definition).
 *  True when it was one of them. */
export function richClick(e: { target: EventTarget | null; preventDefault: () => void; stopPropagation: () => void }, root: HTMLElement) {
  const t = e.target as Element | null
  const copy = t?.closest?.<HTMLElement>("[data-copy]")
  if (copy && root.contains(copy)) {
    e.preventDefault(); e.stopPropagation()
    copyCode(copy, copy.closest(".md-code")?.querySelector("pre")?.textContent ?? "")
    return true
  }
  const ref = t?.closest?.<HTMLElement>("[data-footnote]")
  if (ref && root.contains(ref)) {
    e.preventDefault(); e.stopPropagation()
    const def = [...root.querySelectorAll<HTMLElement>("[data-footnote-def]")].find((d) => d.dataset.footnoteDef === ref.dataset.footnote)
    if (def) { def.scrollIntoView({ block: "center", behavior: "smooth" }); flash(def) }
    return true
  }
  const back = t?.closest?.<HTMLElement>("[data-footnote-back]")
  if (back && root.contains(back)) {
    e.preventDefault(); e.stopPropagation()
    const r = [...root.querySelectorAll<HTMLElement>("[data-footnote]")].find((d) => d.dataset.footnote === back.dataset.footnoteBack)
    if (r) { r.scrollIntoView({ block: "center", behavior: "smooth" }); flash(r) }
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

// A task's line, as core/markdown.ts draws it a box: in a list, a quote or a callout (`> - [ ] `). Group 1: its mark.
const TASK = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?=[ \t]|$)/
const FENCE = /^(?:[ \t]*>[ \t]?)*[ \t]{0,3}(`{3,}|~{3,})/

/** Where each task's mark (the space or x between its brackets) is in Markdown `text`, in the order its boxes are drawn
 *  (none in code). */
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

/** Makes the boxes Markdown drew in `root` tick (not those of a note embedded in it): `toggle` with which one (the nth
 *  of `taskMarks`) and its new state, or null to leave them as they are (they can't be changed). */
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

/** `text` with its nth task ticked (or not), or null when it has no such task. */
export function tickTask(text: string, nth: number, on: boolean): string | null {
  const at = taskMarks(text)[nth]
  return at === undefined ? null : text.slice(0, at) + (on ? "x" : " ") + text.slice(at + 1)
}
