import { noticesSince } from "@vaultite"
import { domTree } from "./uidom"
import type { Thing } from "../../../core/desktop/uimodel"
import { type Target, views } from "./live"
import { onTop, screenOf } from "./locate"
import { clamp } from "./spots"

function noteAt(x: number, y: number): (Target & { path: string; line: number; selection?: string }) | null {
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".companion-overlay") && e.closest(".cm-editor"))
  const v = el ? [...views.keys()].find((x) => x.dom === el.closest(".cm-editor")) : undefined
  const pos = v?.posAtCoords({ x, y })
  if (!v || pos === null || pos === undefined) return null
  const st = v.state, sel = st.selection.main, on = !sel.empty && pos >= sel.from && pos <= sel.to
  const word = on ? null : st.wordAt(pos), selection = on ? st.sliceDoc(sel.from, sel.to) : undefined
  const find = on ? selection!.split("\n")[0].slice(0, 200) : word ? st.sliceDoc(word.from, word.to) : undefined
  return { path: views.get(v)!, line: st.doc.lineAt(on ? sel.from : pos).number, find: find || undefined, ...(selection ? { selection } : {}) }
}

type PanePlace = { pane?: string; ui?: string; row?: number; x?: number; y?: number; text?: string; title?: string }
function paneAt(x: number, y: number): PanePlace | null {
  const hit = document.elementsFromPoint(x, y).filter((e) => !e.closest(".companion-overlay")).map((e) => e.closest<HTMLElement>("[data-ui]")).find(Boolean)
  const el = hit?.dataset.ui?.startsWith("pane:") ? hit.parentElement?.closest<HTMLElement>('[data-ui^="tab:"]') ?? hit : hit
  const id = el?.dataset.ui
  if (!el || !id) return null
  const words = (e: HTMLElement) => (e.innerText || "").trim().slice(0, 1200) || undefined
  if (!id.startsWith("pane:")) return { ui: id, text: words(el), title: el.getAttribute("aria-label") ?? el.dataset.heading ?? undefined }
  const pane = id.slice(5), scr = screenOf(el)
  if (scr) { const row = clamp(Math.floor((y - scr.r.top) / scr.rowH) + 1, 1, scr.lines.length); return { pane, row, text: scr.lines[row - 1]?.trim() || undefined } }
  const page = el.querySelector<HTMLElement>("[data-web-box]")?.getBoundingClientRect()
  if (page) return { pane, x: Math.round(x - page.left), y: Math.round(y - page.top) }
  return { pane, text: words(el) }
}
const CHROME: [string, string][] = [['[role="menu"], [role="menubar"], [data-menu-list]', "menu"], ['[role="listbox"]', "list"], ['[role="tooltip"]', "tooltip"],
  ["[data-web-bar]", "web viewer's bar"], ["[data-pane-bar]", "pane's bar"], ['[role="dialog"], [data-flyout]', "dialog"]]
function chromeAt(x: number, y: number): { kind: string; words?: string } | null {
  const top = document.elementsFromPoint(x, y).find((e) => !e.closest(".companion-overlay"))
  if (!top || top.closest(".cm-editor, [data-web-box], [data-term]")) return null
  for (const [sel, kind] of CHROME) {
    const el = top.closest<HTMLElement>(sel)
    if (!el) continue
    const named = top.closest<HTMLElement>(NAMED) ?? el
    return { kind, words: ((named.innerText || named.getAttribute("aria-label") || "").trim() || (el.innerText || "").trim()).slice(0, 1200) || undefined }
  }
  return null
}

export function placeAt(x: number, y: number): Record<string, unknown> | null {
  const told = noticesText(), notices = told ? { notices: told } : {}
  const own = chromeAt(x, y)
  if (own) {
    const p = paneAt(x, y), near = elementsNear(x, y)
    return { ...(p?.pane ? { pane: p.pane } : p?.ui ? { ui: p.ui } : {}), chrome: own.kind, ...(own.words ? { under: own.words } : {}), ...(near.length ? { near } : {}), ...notices }
  }
  const at = noteAt(x, y) ?? paneAt(x, y)
  if (!at) return told ? notices : null
  if ("path" in at && at.path) {
    const near = landmarks(x, y, new Set())
    return { path: at.path, line: at.line, ...(at.find ? { find: at.find } : {}), ...(at.selection ? { selection: at.selection } : {}), ...(near.length ? { near } : {}), ...notices }
  }
  const { text, ...p } = at as PanePlace, near = elementsNear(x, y)
  return { ...p, ...(text ? { under: text } : {}), ...(near.length ? { near } : {}), ...notices }
}

const NAMED = "button, a[href], input, select, textarea, h1, h2, h3, h4, [role], [data-ui], [aria-label], [data-tip]"
export function elementsNear(x: number, y: number, radius = 260, most = 30): Thing[] {
  const seen = new Set<string>(), out: (Thing & { d: number })[] = [], tree = domTree()
  for (const el of document.querySelectorAll<HTMLElement>(NAMED)) {
    if (el.closest(".companion-overlay")) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth || r.width * r.height > innerWidth * innerHeight * 0.3) continue
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    if (d > radius || !onTop(el, r)) continue
    const aria = el.getAttribute("role")
    if (aria === "none" || aria === "presentation") continue
    const t = tree.thing(el)
    if (!t || !t.label || seen.has(key(t.frame))) continue
    seen.add(key(t.frame))
    out.push({ ...t, d })
  }
  const area = (e: { frame: { width: number; height: number } }) => e.frame.width * e.frame.height
  const nearest = out.sort((a, b) => a.d - b.d || area(a) - area(b)).slice(0, most).map(({ d: _, ...e }) => e)
  return [...nearest, ...landmarks(x, y, new Set(nearest.map((e) => key(e.frame))), tree)]
}
export const key = (f: { x: number; y: number; width: number; height: number }) => `${f.x},${f.y},${f.width},${f.height}`
const LANDMARKS = "[data-ui^='panel:'], section[data-pane-frame]:not([data-away]), [data-status-bar], [data-sidebar-foot]"
function landmarks(x: number, y: number, seen: Set<string>, tree = domTree()) {
  const out: (Thing & { d: number })[] = []
  for (const el of document.querySelectorAll<HTMLElement>(LANDMARKS)) {
    const r = shownRect(el), frame = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    if (r.width < 4 || r.height < 4 || seen.has(key(frame)) || el.closest(".companion-overlay") || !onTop(el, r)) continue
    const t = tree.thing(el), label = t?.label || (el.innerText || "").trim().split("\n")[0].trim().slice(0, 120)
    if (!t || !label) continue
    seen.add(key(frame))
    const fold = el.id ? document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"][aria-expanded]`) : null
    const role = t.role !== "generic" ? t.role : el.matches("[data-status-bar]") ? "status" : "region"
    out.push({ ...t, role, label, frame, state: fold ? { ...t.state, expanded: fold.getAttribute("aria-expanded") === "true" } : t.state,
      d: Math.hypot(Math.max(r.left - x, 0, x - r.left - r.width), Math.max(r.top - y, 0, y - r.top - r.height)) })
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 10).map(({ d: _, ...e }) => e)
}
function shownRect(el: HTMLElement) {
  const b = el.getBoundingClientRect()
  let left = Math.max(0, b.left), top = Math.max(0, b.top), right = Math.min(innerWidth, b.right), bottom = Math.min(innerHeight, b.bottom)
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a)
    if (s.overflowX === "visible" && s.overflowY === "visible") continue
    const c = a.getBoundingClientRect()
    left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom)
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
export function noticesText(now = Date.now()) {
  return noticesSince(now - 60_000).slice(-5).map((n) => `${JSON.stringify(n.text)} (${n.kind === "error" ? "an error, " : ""}${Math.max(0, Math.round((now - n.at) / 1000))} s ago)`).join("; ")
}