// A text file's place is also its top line: CodeMirror guesses unseen heights, so a scrollTop can drift.
import { getStore } from "@/core/data"
import { trackSoon } from "@/core/unsaved"
import { keptEntries } from "@/core/keptEntries"
import { isNumber, isObj } from "../../../core/values.ts"

type Place = { y?: number; props?: boolean; at?: [number, number]
  line?: number; into?: number }
const KEPT = "vaultite.places"
const isPlace = (v: unknown): v is Place => isObj(v) && [v.y, v.line, v.into].every((n) => n === undefined || isNumber(n))
  && (v.props === undefined || v.props === true || v.props === false) && (v.at === undefined || (Array.isArray(v.at) && v.at.length === 2 && v.at.every(isNumber)))
const MAX = 200
let places = new Map<string, Place>()
let keptFor: string | null = null

function all() {
  const vault = getStore()?.vault.path ?? ""
  if (keptFor !== vault) {
    keptFor = vault
    places = new Map()
    try {
      const kept: unknown = JSON.parse(localStorage.getItem(KEPT) ?? "null")
      if (isObj(kept) && kept.vault === vault) places = new Map(keptEntries(kept.places, isPlace))
    } catch { /* private mode, or not JSON */ }
  }
  return places
}

let saving: ReturnType<typeof setTimeout> | null = null
const save = () => {
  if (saving) clearTimeout(saving)
  saving = null
  try { localStorage.setItem(KEPT, JSON.stringify({ vault: keptFor, places: [...all()] })) } catch { /* private mode, or full */ }
}
addEventListener("pagehide", () => { if (saving) save() })
function update(key: string, change: Place) {
  const m = all()
  const next = { ...m.get(key), ...change }
  m.delete(key)
  m.set(key, next)
  while (m.size > MAX) m.delete(m.keys().next().value!)
  if (saving) clearTimeout(saving)
  saving = setTimeout(save, 500)
}

type Line = { line: number; into: number }
const readers = new Map<HTMLElement | null, () => Line | null>()
export function readPlace(box: HTMLElement | null, read: () => Line | null) {
  readers.set(box, read)
  return () => { if (readers.get(box) === read) readers.delete(box) }
}

export const scrollOf = (key: string) => all().get(key)?.y ?? 0
export const keepScroll = (key: string, y: number, box: HTMLElement | null = null) => {
  if (Math.abs((all().get(key)?.y ?? 0) - y) < 1) return
  const read = readers.get(box)
  const line = (at: Line | null): Place => ({ line: at?.line, into: at ? Math.round(at.into * 1000) / 1000 : undefined })
  update(key, { y: Math.round(y), ...line(read?.() ?? null) })
  // Read again once scrolling stops: until CodeMirror measures what came on screen, its top line is a guess.
  if (!read) return
  clearTimeout(settling.get(box))
  settling.set(box, setTimeout(() => {
    settling.delete(box)
    if (readers.get(box) === read && all().get(key)?.y === Math.round(y)) update(key, line(read()))
  }, 200))
}
const settling = new Map<HTMLElement | null, ReturnType<typeof setTimeout>>()
trackSoon("places", () => saving !== null || settling.size > 0, true)

export function movePlaces(from: string, to: string) {
  const m = all()
  let changed = false
  for (const [key, place] of [...m]) {
    const p = key.startsWith("file:") ? key.slice(5) : null
    if (p === null || (p !== from && !p.startsWith(`${from}/`))) continue
    m.delete(key)
    m.set(`file:${to}${p.slice(from.length)}`, place)
    changed = true
  }
  if (changed) save()
}

export const propsOpen = (path: string) => all().get(`file:${path}`)?.props ?? false
export const keepPropsOpen = (path: string, open: boolean) => update(`file:${path}`, { props: open })
export function revealProperties(path: string) {
  keepPropsOpen(path, true)
  dispatchEvent(new CustomEvent("vau:properties", { detail: path }))
}

export const cursorOf = (path: string) => all().get(`file:${path}`)?.at ?? null
export const keepCursor = (path: string, line: number, ch: number) => {
  const at = all().get(`file:${path}`)?.at
  if (at?.[0] !== line || at?.[1] !== ch) update(`file:${path}`, { at: [line, ch] })
}

const restores = new Set<() => void>()
export const cancelRestores = () => [...restores].forEach((stop) => stop())
export function addRestore(stop: () => void) { restores.add(stop); return () => { restores.delete(stop) } }

const finding = new Set<string>()
const waiting = new Map<string, (() => void)[]>()
const found = (key: string | undefined) => {
  if (key === undefined || !finding.delete(key)) return
  const fns = waiting.get(key)
  waiting.delete(key)
  fns?.forEach((f) => f())
}
export function afterPlaced(key: string, fn: () => void): () => void {
  if (!finding.has(key)) { fn(); return () => {} }
  waiting.set(key, [...(waiting.get(key) ?? []), fn])
  return () => { const l = waiting.get(key); if (l) waiting.set(key, l.filter((f) => f !== fn)) }
}

const pending = new Map<string, { box: HTMLElement | null; stop: (taken?: boolean) => void; show: () => void; hideToo: (el: HTMLElement) => void }>()
const offers = new Map<string, () => void>()
export function offerPlace(key: string, take: () => void): () => void {
  if (pending.has(key)) { take(); return () => {} }
  offers.set(key, take)
  return () => { if (offers.get(key) === take) offers.delete(key) }
}
export const hideUntilPlaced = (key: string, el: HTMLElement | null) => { if (el) pending.get(key)?.hideToo(el) }
export function takeRestore(key: string): { box: HTMLElement | null; line: number; into: number; show: () => void } | null {
  const p = pending.get(key)
  const at = all().get(key)
  if (!p || at?.line === undefined) return null
  p.stop(true)
  const show = () => { clearTimeout(late); p.show(); found(key) }
  const late = setTimeout(show, 400)
  return { box: p.box, line: at.line, into: at.into ?? 0, show }
}

export function restoreScroll(box: HTMLElement | null, y: number, done?: () => void, key?: string, hide: HTMLElement | null = box): () => void {
  const byLine = key !== undefined && all().get(key)?.line !== undefined
  const start = performance.now()
  const until = start + (byLine ? 3000 : 1500)
  let stopped = false
  let frame = 0
  const height = () => (box ? box.scrollHeight - box.clientHeight : document.documentElement.scrollHeight - innerHeight)
  const at = () => (box ? box.scrollTop : scrollY)
  const to = (top: number) => (box ? (box.scrollTop = top) : scrollTo(0, top))
  const hidden = byLine && hide ? [hide] : []
  for (const el of hidden) el.style.visibility = "hidden"
  let shown = false
  const show = () => { shown = true; for (const el of hidden) el.style.visibility = "" }
  const hideToo = (el: HTMLElement) => { if (byLine && !shown) { hidden.push(el); el.style.visibility = "hidden" } }
  const stop = (taken = false) => {
    if (stopped) return
    stopped = true
    restores.delete(cancel)
    if (key !== undefined && pending.get(key)?.stop === stop) pending.delete(key)
    cancelAnimationFrame(frame)
    removeEventListener("touchstart", cancel); removeEventListener("wheel", cancel); removeEventListener("keydown", cancel)
    if (!taken) { show(); found(key) }
    done?.()
  }
  const cancel = () => stop()
  restores.add(cancel)
  if (key !== undefined) { pending.set(key, { box, stop, show, hideToo }); finding.add(key) }
  addEventListener("touchstart", cancel, { passive: true }); addEventListener("wheel", cancel, { passive: true }); addEventListener("keydown", cancel)
  const offer = byLine && key !== undefined ? offers.get(key) : undefined
  if (offer) { offers.delete(key!); offer() }
  const step = () => {
    if (stopped) return
    if (hidden.length && !shown && performance.now() > start + 600) show()
    if (performance.now() > until) {
      if (byLine && height() >= y - 1) to(y)
      return stop()
    }
    if (!byLine && height() >= y - 1) { to(y); if (Math.abs(at() - y) <= 1) return stop() }
    frame = requestAnimationFrame(step)
  }
  step()
  return cancel
}
