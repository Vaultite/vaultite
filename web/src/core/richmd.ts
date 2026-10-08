// What Markdown draws after it's HTML (math, mermaid, code copy and footnote buttons), lazily, for the editor and for
// Markdown drawn outside it alike, so a note reads the same everywhere.
import { isDark } from "@/lib/utils"

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

type Mermaid = typeof import("mermaid").default
let mermaid: Promise<Mermaid> | null = null
let mermaidTheme = ""
const loadMermaid = () => (mermaid ??= import("mermaid").then((m) => m.default))
let seq = 0
// Diagrams on screen, drawn again when the app switches between light and dark.
const diagrams = new Map<HTMLElement, string>()
let watching = false

/** The scheme's colours for mermaid's "base" theme, so diagrams follow every scheme: tokens read back as hex (painted
 *  over the background first, since a token may be oklch() or see-through). */
function mermaidVars() { return vars ??= readVars() }
/** The colours above, read once per theme: reading them makes the browser work out the page's styles and paints a
 *  canvas, too slow to do for every diagram (a page with several). Forgotten when the theme or scheme changes. */
let vars: ReturnType<typeof readVars> | null = null
function readVars() {
  const cs = getComputedStyle(document.documentElement)
  const cv = document.createElement("canvas")
  cv.width = cv.height = 1
  const x = cv.getContext("2d", { willReadFrequently: true })
  const token = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const bg = token("--background", "#fff")
  const rgb = (css: string) => {
    if (!x) return [128, 128, 128]
    for (const f of ["#fff", bg, css]) { x.fillStyle = f; x.fillRect(0, 0, 1, 1) }
    const d = x.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const hex = (v: number[]) => `#${v.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`
  const mix = (a: number[], b: number[], t: number) => hex(a.map((n, i) => n * t + b[i] * (1 - t)))
  const card = rgb(token("--card", bg)), fg = rgb(token("--foreground", "#000")), primary = rgb(token("--primary", "#36c"))
  const muted = rgb(token("--muted-foreground", "#888")), note = rgb(token("--yellow", "#fc0"))
  return {
    darkMode: isDark(), background: hex(rgb(bg)), fontFamily: "var(--font-sans)", fontSize: "14px",
    primaryColor: mix(primary, card, 0.14), primaryBorderColor: mix(primary, card, 0.55), primaryTextColor: hex(fg),
    secondaryColor: mix(muted, card, 0.14), secondaryBorderColor: mix(muted, card, 0.5), secondaryTextColor: hex(fg),
    tertiaryColor: mix(muted, card, 0.07), tertiaryBorderColor: mix(muted, card, 0.4), tertiaryTextColor: hex(fg),
    lineColor: hex(muted), textColor: hex(fg), titleColor: hex(fg), edgeLabelBackground: hex(card),
    clusterBkg: mix(muted, card, 0.07), clusterBorder: mix(muted, card, 0.4),
    noteBkgColor: mix(note, card, 0.18), noteBorderColor: mix(note, card, 0.55), noteTextColor: hex(fg),
  }
}

async function drawMermaid(src: string, el: HTMLElement) {
  const m = await loadMermaid()
  const vars = mermaidVars()
  const theme = JSON.stringify(vars)
  if (theme !== mermaidTheme) {
    m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: vars, fontFamily: "var(--font-sans)" })
    mermaidTheme = theme
  }
  const id = `vau-mermaid-${++seq}`
  try {
    const { svg } = await m.render(id, src)
    if (diagrams.get(el) !== src) return // redrawn with newer text meanwhile
    el.innerHTML = svg
    el.classList.remove("is-error")
  } catch (e) {
    document.getElementById(id)?.remove()
    document.getElementById(`d${id}`)?.remove()
    if (diagrams.get(el) !== src) return
    el.classList.add("is-error")
    el.textContent = `Mermaid: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`
  }
}

/** A mermaid diagram into `el` (its source shows until it's drawn), in the colour scheme's colours, light or dark. */
export function renderMermaid(src: string, el: HTMLElement) {
  el.classList.add("mermaid-diagram")
  if (diagrams.get(el) === src && el.querySelector("svg")) return
  diagrams.set(el, src)
  if (!el.firstChild) { const pre = document.createElement("pre"); pre.textContent = src; el.append(pre) }
  if (!watching) {
    watching = true
    // Light or dark, or another colour scheme: drawn again in its colours.
    new MutationObserver(() => {
      vars = null
      if (JSON.stringify(mermaidVars()) === mermaidTheme) return
      for (const [d, s] of diagrams) { if (d.isConnected) void drawMermaid(s, d); else diagrams.delete(d) }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-scheme", "style"] })
  }
  void drawMermaid(src, el)
}

/** Forget a diagram whose element went away (the editor's widget destroyed). */
export const dropMermaid = (el: HTMLElement) => { diagrams.delete(el) }

/** Draw what core/markdown.ts left for later inside `root`: math and mermaid diagrams. */
export function hydrate(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-math]")) {
    if (el.dataset.drawn) continue
    const tex = el.textContent ?? ""
    el.dataset.drawn = "1"
    renderMath(tex, el, el.dataset.math === "display")
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
