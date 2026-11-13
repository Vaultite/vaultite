import { canvasOf, canvasShown, selectTab, getTabLayout, tabOfPane, notify, openFile, seenArea } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { pointFor } from "./canvas"
import { resolveDom, uiElement } from "./uidom"
import { type Agent, type Target, typing, viewOf } from "./live"
import { interfaceZoom, type Screen, screenOf } from "./locate"
import { nearest } from "./text"

export type Spot = { x: number; y: number; parked?: boolean; low?: boolean; drawn?: boolean; docked?: boolean; rides?: boolean
  away?: boolean
  over?: boolean
  faded?: boolean
  out?: boolean
  loose?: true
  target?: { x: number; y: number; width: number; height: number } }
export type Place = { at: Target & Pick<Agent, "box">; i: number; shift: number; dx: number; dy: number; screen?: { x: number; y: number; over: boolean }; left?: Left }
export type Left = { last: string; echo: number }
export const placeOf = (a: Partial<Agent>): Place["at"] => ({ path: a.path, line: a.line, find: a.find, x: a.x, y: a.y, pane: a.pane, ui: a.ui, row: a.row, el: a.el, box: a.box })
export const placeKey = (a: Agent) => JSON.stringify(placeOf(a))
const FLAG = 44

export function posIn(v: EditorView, t: { line?: number; find?: string }) {
  const doc = v.state.doc
  if (t.find) { const i = nearest(doc.toString(), t.find, t.line); if (i >= 0) return i }
  return t.line ? doc.line(Math.max(1, Math.min(t.line, doc.lines))).from : null
}

export function coords(v: EditorView, pos: number, side: -1 | 1 = 1) {
  const r = (v.dom.closest("[data-pane]") ?? v.scrollDOM).getBoundingClientRect()
  const bars = [...document.querySelectorAll("[data-status-bar], [data-phone-bar]")].map((el) => el.getBoundingClientRect()).filter((b) => b.height && b.left < r.right && b.right > r.left)
  const k = seenArea(v.dom)
  const box = { left: Math.max(r.left, k.left), right: Math.min(r.right, k.right), top: Math.max(r.top, k.top), bottom: Math.min(r.bottom, k.bottom, ...bars.map((b) => b.top)) }
  let c: { left: number; top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos, side) } catch {}
  const y = c ? c.top : pos < v.viewport.from ? box.top : box.bottom
  return { x: c ? c.left : box.left + 24, y: Math.max(box.top + 2, Math.min(box.bottom - 30, y)), shown: !!c && c.top >= box.top - 4 && c.bottom <= box.bottom + 4, box }
}

function rowOf(path: string): Spot | null {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)].filter((e) => e.offsetParent && e.getBoundingClientRect().height)
  const seen = (e: HTMLElement) => { const r = e.getBoundingClientRect(), c = seenArea(e); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right }
  const el = rows.find(seen) ?? rows.find((e) => !e.closest("[data-pin-tree]")) ?? rows[0]
  if (!el) return null
  const r = el.getBoundingClientRect(), c = seenArea(el)
  if (c.bottom - c.top < 12) {
    let s = el.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    const list = s && seenArea(s), b = s?.getBoundingClientRect()
    if (list && b) Object.assign(c, { top: Math.max(list.top, b.top), bottom: Math.min(list.bottom, b.bottom) })
  }
  if (c.bottom - c.top < 12 || c.right - c.left < 12) return null
  const x = Math.max(c.left + 4, Math.min(c.right - 24, r.left + Math.min(r.width - 24, 120)))
  const y = Math.max(c.top + 2, Math.min(c.bottom - 24, r.top + 4))
  return { x, y, low: y + FLAG > Math.min(c.bottom, innerHeight - 40), rides: !!el.closest("aside[data-peek]") || undefined, out: !seen(el) || undefined }
}

export const lastShown = new Map<string, Spot>()
export function home(a: Agent, _i: number): Spot | null {
  const was = lastShown.get(a.name)
  return was ? { ...was, parked: true, docked: true, faded: true } : null
}
export const IDLE_MS = 8000

function rowEnd(v: EditorView, pos: number, to: number) {
  let c: { top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos, -1) } catch {}
  if (!c) return to
  return Math.max(pos, Math.min(to, v.posAtCoords({ x: v.contentDOM.getBoundingClientRect().right - 1, y: (c.top + c.bottom) / 2 }, false)))
}

export function spotOf(a: Agent, i: number, held = false): Spot | null {
  if (a.state === "away") return null
  const canvas = a.path ? canvasOf(a.path) : null
  if (canvas && canvasShown(canvas)) {
    const p = canvas.toScreen(pointFor(canvas, a)), r = canvas.el.getBoundingClientRect()
    return { x: Math.max(r.left + 4, Math.min(r.right - 24, p.x)), y: Math.max(r.top + 4, Math.min(r.bottom - 24, p.y)), drawn: true }
  }
  if (!held && typing && typing.agent === a.name && typing.view.dom.isConnected) {
    const c = coords(typing.view, Math.min(typing.pos, typing.view.state.doc.length))
    return { x: c.x, y: c.y, low: c.y + FLAG > c.box.bottom }
  }
  if (!a.path && (a.ui || a.pane)) { const at = a.ui ? uiSpot(a.ui, a.find) : paneSpot(a); if (at) return at }
  const v = a.path ? viewOf(a.path) : null
  const pos = v ? posIn(v, a) : null
  if (!v || pos === null) return (a.path && rowOf(a.path)) || home(a, i)
  const line = v.state.doc.lineAt(pos)
  const c = coords(v, a.find ? rowEnd(v, Math.min(line.to, pos + a.find.length), line.to) : line.to, -1)
  return { x: Math.min(c.box.right - 40, c.x + 28), y: c.y, low: c.y + FLAG > c.box.bottom, out: !c.shown || undefined }
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const rectOf = (r: { left: number; top: number; width: number; height: number }) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
export const screenSpot = (p: { x: number; y: number; over: boolean }): Spot => {
  const x = clamp(p.x, 4, innerWidth - 24), y = clamp(p.y, 4, innerHeight - 24)
  return { x, y, low: y + FLAG > innerHeight - 40, over: p.over || undefined }
}
function atElement(el: HTMLElement): Spot {
  const r = el.getBoundingClientRect(), x = r.left + Math.min(r.width * 0.6, Math.max(4, r.width - 6)), y = r.top + r.height * 0.6
  return { x, y, low: y + FLAG > innerHeight - 40, rides: !!el.closest("aside[data-peek]") || undefined, target: rectOf(r) }
}
const found = new Map<string, HTMLElement>()
const uiSpot = (id: string, find?: string) => {
  const el = uiElement(id)
  if (!el || !find) return el ? atElement(el) : null
  const k = `${id}\0${find}`, was = found.get(k), at = was?.isConnected && el.contains(was) ? was : (resolveDom({ name: find }, undefined, el)?.e as HTMLElement | undefined) ?? null
  if (at) { found.clear(); found.set(k, at) }
  return atElement(at ?? el)
}

function rowIn(s: Screen, t: { row?: number; find?: string }) {
  if (t.row) return clamp(t.row, 1, s.lines.length)
  const found = t.find ? s.lines.findLastIndex((l) => l.includes(t.find!)) : -1
  if (found >= 0) return found + 1
  return Math.max(1, s.lines.findLastIndex((l) => l.trim()) + 1)
}
export function paneBox(t: Target & Pick<Agent, "box">): (DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) & { over?: boolean; row?: Screen } | null {
  const el = t.pane ? paneEl(t.pane) : null
  if (!el) return null
  const scr = screenOf(el)
  if (scr) { const row = rowIn(scr, t), top = scr.r.top + (row - 1) * scr.rowH, w = Math.max(scr.cw * 2, (scr.lines[row - 1]?.trimEnd().length ?? 0) * scr.cw)
    return { left: scr.r.left, top, right: scr.r.left + w, bottom: top + scr.rowH, width: w, height: scr.rowH, row: scr } }
  const page = el.querySelector<HTMLElement>("[data-web-box]")
  if (page) {
    const b = page.getBoundingClientRect(), z = (t.box?.zoom ?? 1) / interfaceZoom()
    if (!t.box) return Object.assign(b, { over: true })
    const left = b.left + t.box.x * z, top = b.top + t.box.y * z, width = t.box.w * z, height = t.box.h * z
    return { left, top, right: left + width, bottom: top + height, width, height, over: true }
  }
  return el.getBoundingClientRect()
}
function paneEl(id: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(`pane:${id}`)}"]`)].find((e) => !e.matches("[data-pane-half], [data-place], [data-tab-row]") && e.getClientRects().length > 0) ?? null
}
function tabSpot(pane: string): Spot | null {
  const half = [...document.querySelectorAll<HTMLElement>(`[data-pane-half="${CSS.escape(pane)}"]`)].find((e) => e.getClientRects().length > 0)
  if (half) return atElement(half)
  const tab = tabOfPane(getTabLayout(), pane)
  return tab ? uiSpot(`tab:${tab.id}`) : null
}
function paneSpot(a: Agent): Spot | null {
  const el = paneEl(a.pane!)
  if (!el) return tabSpot(a.pane!)
  const r = el.getBoundingClientRect(), b = paneBox(a)
  if (!b) return null
  const whole = b.width === r.width && b.height === r.height && !b.row
  if (whole || (b.over && !a.box)) return looseIn(a.name, r, b.over)
  const x = b.right + (b.row ? 10 : 6), y = b.top
  return { x: clamp(x, r.left + 4, r.right - 40), y: clamp(y, r.top + 2, r.bottom - 30), low: y + FLAG > r.bottom, over: b.over, target: rectOf(b) }
}
function looseIn(name: string, r: DOMRect, over?: boolean): Spot {
  const was = lastShown.get(name), inside = was && was.x >= r.left && was.x <= r.right - 24 && was.y >= r.top && was.y <= r.bottom - 24
  const x = inside ? was.x : r.left + r.width / 2, y = inside ? was.y : r.top + Math.min(r.height / 3, 200)
  return { x: clamp(x, r.left + 4, r.right - 40), y: clamp(y, r.top + 2, r.bottom - 30), low: y + FLAG > r.bottom, over, loose: true }
}

export const scroller = (v: EditorView, pos: number) => v.dispatch({ effects: (v.constructor as typeof EditorView).scrollIntoView(pos, { y: "center" }) })
export function follow(a: Target & { name: string }) {
  if (!a.path && a.pane) return void selectTab(a.pane)
  if (!a.path && a.ui) return void uiElement(a.ui)?.scrollIntoView({ block: "nearest" })
  if (!a.path) return notify(`${a.name} isn't in a note now`)
  const path = a.path, go = () => {
    const v = viewOf(path)
    if (!v) return false
    scroller(v, posIn(v, { find: a.find, line: a.line || 1 })!)
    return true
  }
  if (go()) return
  openFile(path)
  let n = 0
  const t = setInterval(() => { if (go() || ++n > 40) clearInterval(t) }, 100)
}