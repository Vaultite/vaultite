import { DRAWN, OWN } from "./uidom.ts"
type Rect = { x: number; y: number; w: number; h: number; q?: number }
type Sized = { interfaceSize?: { get: () => Promise<number>; on: (fn: (zoom: number) => void) => void } }
let zoom = 1
const sized = typeof window === "undefined" ? undefined : (window as unknown as { vaultite?: Sized }).vaultite?.interfaceSize
if (sized) { void sized.get().then((z) => { zoom = z }, () => {}); sized.on((z) => { zoom = z }) }
export const interfaceZoom = () => zoom
export function locate(places: unknown, near?: unknown): Record<string, Rect> {
  const out: Record<string, Rect> = {}
  if (!Array.isArray(places)) return out
  const z = zoom, ox = window.screenX, oy = window.screenY + Math.max(0, window.outerHeight - window.innerHeight * z)
  const n = near as { x?: unknown; y?: unknown } | undefined, hint = n && Number.isFinite(n.x) && Number.isFinite(n.y) ? { x: (Number(n.x) - ox) / z, y: (Number(n.y) - oy) / z } : undefined
  const put = (k: string, r: { left: number; top: number; width: number; height: number }, q?: number) => {
    out[k] = { x: Math.round(ox + r.left * z), y: Math.round(oy + r.top * z), w: Math.round(r.width * z), h: Math.round(r.height * z), ...(q ? { q } : {}) }
  }
  for (const p of places.slice(0, 40)) {
    if (typeof p !== "string") continue
    if (p === "pages") {
      for (const pane of document.querySelectorAll<HTMLElement>("[data-ui^='pane:']")) {
        const web = pane.querySelector<HTMLElement>("[data-web-box]"), r = web?.getBoundingClientRect()
        if (web && r && shown(r) && web.checkVisibility()) put(`page:${pane.dataset.ui!.slice(5)}`, r)
      }
      continue
    }
    if (p.startsWith("find:")) { const f = findText(p.slice(5), hint); if (f) put(p, f.r, f.q); continue }
    const r = box(p.startsWith("ui:") ? p.slice(3) : p.startsWith("pane:") ? p : null, hint)
    if (r) put(p, r)
  }
  return out
}
function box(id: string | null, near?: { x: number; y: number }) {
  const all = id ? [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(id)}"]`)].flatMap((e) => { const r = e.getBoundingClientRect(); return shown(r) && e.checkVisibility() ? [r] : [] }) : []
  const gap = (r: DOMRect) => (near ? Math.hypot(Math.max(r.left - near.x, 0, near.x - r.right), Math.max(r.top - near.y, 0, near.y - r.bottom)) : 0)
  return all.sort((a, b) => gap(a) - gap(b))[0] ?? null
}

export type Screen = { r: DOMRect; lines: string[]; rowH: number; cw: number }
export function screenOf(pane: HTMLElement): Screen | null {
  const host = pane.querySelector<HTMLElement & { terminalText?: () => string; terminalCell?: () => { width: number } | null }>("[data-terminal]")
  const scr = host?.querySelector<HTMLElement>("[data-term-screen]")
  if (!host?.terminalText || !scr) return null
  const lines = host.terminalText().split("\n"), r = scr.getBoundingClientRect()
  return { r, lines, rowH: r.height / Math.max(1, lines.length), cw: host.terminalCell?.()?.width || 8 }
}

const shown = (r: { width: number; height: number; bottom: number; right: number; top: number; left: number }) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
export function onTop(el: Element, r: { left: number; top: number; width: number; height: number }) {
  if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 12))), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))
  const top = document.elementsFromPoint(x, y).find((e) => !e.closest(DRAWN))
  return !!top && (el.contains(top) || top.contains(el))
}
export const normWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const BLOCK = "p, div, li, dt, dd, td, th, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, section, article, header, footer, nav, aside, main, figcaption, label, button, option, summary, .cm-line"

function letterBox([n, i]: [Text, number]) {
  const r = document.createRange()
  r.setStart(n, i)
  r.setEnd(n, Math.min(i + 1, n.length))
  return r.getBoundingClientRect()
}
function oneRow(flat: string, at: [Text, number][], blocks: number[], i: number, end: number) {
  for (let k = i + 1; k <= end; k++) {
    if (blocks[k] === blocks[k - 1]) continue
    let a = k - 1, b = k
    while (a > i && flat[a] === " ") a--
    while (b < end && flat[b] === " ") b++
    const x = letterBox(at[a]), y = letterBox(at[b]), h = Math.max(x.height, y.height, 1)
    if (Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) < Math.min(x.height, y.height) / 2 || y.left < x.left || y.left - x.right > 4 * h) return false
  }
  return true
}

export function findText(text: string, near?: { x: number; y: number }): { r: DOMRect; q: number } | null {
  const want = normWords(text)
  if (!want) return null
  const found: { r: DOMRect; q: number }[] = []
  for (const el of document.querySelectorAll<HTMLElement>("[aria-label], [data-tip], button, a, [role]")) {
    const names = [el.getAttribute("aria-label"), el.dataset.tip, el.children.length ? null : el.textContent].filter((x): x is string => !!x)
    if (!names.some((n) => normWords(n) === want) || el.closest(OWN)) continue
    const r = el.getBoundingClientRect()
    if (shown(r) && onTop(el, r)) found.push({ r, q: 3 })
  }
  let flat = ""
  const at: [Text, number][] = [], blocks: number[] = []
  let block: Element | null = null, nb = 0
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!(n instanceof Text)) continue
    const v = n.nodeValue ?? "", p = n.parentElement
    if (!v.trim() || !p || p.closest("script, style, noscript, template") || p.closest(OWN)) continue
    const b = p.closest(BLOCK)
    if (b !== block) { nb++; if (flat && !flat.endsWith(" ")) { flat += " "; at.push([n, 0]); blocks.push(nb) } }
    block = b
    for (let i = 0; i < v.length; i++) {
      const c = v[i].toLowerCase()
      if (/[\p{L}\p{N}]/u.test(c)) { flat += c[0]; at.push([n, i]); blocks.push(nb) } else if (flat && !flat.endsWith(" ")) { flat += " "; at.push([n, i]); blocks.push(nb) }
    }
  }
  for (let i = flat.indexOf(want), k = 0; i >= 0 && k < 40; i = flat.indexOf(want, i + 1), k++) {
    const whole = (i === 0 || flat[i - 1] === " ") && (i + want.length === flat.length || flat[i + want.length] === " ")
    if (!whole && want.length < 6) continue
    if (!oneRow(flat, at, blocks, i, i + want.length - 1)) continue
    const [a, ai] = at[i], [b, bi] = at[i + want.length - 1], range = document.createRange()
    range.setStart(a, ai)
    range.setEnd(b, bi + 1)
    const r = range.getBoundingClientRect(), el = a.parentElement!
    if (shown(r) && onTop(el, r)) found.push({ r, q: whole ? 2 : 1 })
  }
  for (const pane of document.querySelectorAll<HTMLElement>("[data-ui^='pane:']")) {
    const s = screenOf(pane)
    if (!s || !shown(s.r) || !onTop(pane.querySelector("[data-term-screen]")!, s.r)) continue
    s.lines.forEach((l, row) => {
      if (!` ${normWords(l)} `.includes(` ${want} `)) return
      const exact = l.toLowerCase().indexOf(text.trim().toLowerCase()), col = exact >= 0 ? exact : l.length - l.trimStart().length
      const w = (exact >= 0 ? text.trim().length : l.trim().length) * s.cw
      found.push({ r: new DOMRect(s.r.left + col * s.cw, s.r.top + row * s.rowH, Math.max(s.cw * 2, w), s.rowH), q: 2 })
    })
  }
  const gap = (r: DOMRect) => (near ? Math.hypot(Math.max(r.left - near.x, 0, near.x - r.right), Math.max(r.top - near.y, 0, near.y - r.bottom)) : 0)
  return found.sort((x, y) => y.q - x.q || gap(x.r) - gap(y.r))[0] ?? null
}
