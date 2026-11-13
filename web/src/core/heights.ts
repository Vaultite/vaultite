import { useLayoutEffect, useRef } from "react"
import { trace } from "@/core/trace"
import { trackSoon } from "@/core/unsaved"
import { elementOf } from "@/core/dom"
import { isNumber, isObj } from "../../../core/values.ts"
import { keptEntries } from "@/core/keptEntries"

type Seen = { w: number; h: number }
const KEPT = "vaultite.heights"
const MAX = 800
const NEAR = 24
let heights: Map<string, Seen[]> | null = null
const isSeenList = (v: unknown): v is Seen[] => Array.isArray(v) && v.every((s) => isObj(s) && isNumber(s.w) && isNumber(s.h))

function all() {
  if (heights) return heights
  heights = new Map()
  try {
    heights = new Map(keptEntries(JSON.parse(localStorage.getItem(KEPT) ?? "null"), isSeenList))
  } catch { /* private mode, or not JSON */ }
  return heights
}

let saving: ReturnType<typeof setTimeout> | null = null
const save = () => {
  if (saving) clearTimeout(saving)
  saving = null
  try { localStorage.setItem(KEPT, JSON.stringify([...all()])) } catch { /* private mode, or full */ }
}
addEventListener("pagehide", () => { if (saving) save() })
function remember(key: string, w: number, h: number) {
  const m = all()
  const was = m.get(key) ?? []
  const exact = Math.round(h * 100) / 100
  if (was[0] && Math.abs(was[0].w - w) < 1 && was[0].h === exact) return
  const next = [{ w: Math.round(w), h: exact }, ...was.filter((s) => Math.abs(s.w - w) >= NEAR)].slice(0, 3)
  m.delete(key)
  m.set(key, next)
  while (m.size > MAX) m.delete(m.keys().next().value!)
  saving ??= setTimeout(save, 1000)
}

export function heightOf(key: string, width?: number): number | undefined {
  const seen = all().get(key)
  if (!seen?.length) return undefined
  if (width === undefined) return seen[0].h
  return seen.find((s) => Math.abs(s.w - width) < NEAR)?.h
}

/** A short, stable name for some text (a block's options), for keys. */
export function textKey(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return `${text.length.toString(36)}.${(h >>> 0).toString(36)}`
}

/** A ```block-<name>'s key in a file: the same in a dashboard's grid (`where`: page, sheet) and in the editor (editor),
 *  so one can guess the other's size. `n`: which of the same block it is. */
export const blockHeightKey = (where: string, path: string, name: string, text: string, n = 1) => `${where}:${path}:block-${name}:${textKey(text)}:${n}`

const busy = (el: HTMLElement) => !!el.querySelector("[aria-busy=true]")

type Held = { el: HTMLElement; key: string; held: number; since: number; release: (why: string, natural?: number) => void
  shrinks: boolean
  changed: boolean }
const holding = new Set<Held>()
const LONGEST = 4000
let ticking: ReturnType<typeof setInterval> | null = null
function tick() {
  const now = performance.now()
  const shown: Held[] = []
  for (const h of holding) {
    if (!h.el.isConnected) holding.delete(h)
    else if (now - h.since > LONGEST) h.release("longest")
    else if (h.changed && h.el.getClientRects().length) { h.changed = false; shown.push(h) }
  }
  for (const h of shown) h.el.style.height = ""
  const natural = shown.map((h) => h.el.getBoundingClientRect().height)
  shown.forEach((h, i) => { if ((h.shrinks || natural[i] >= h.held - 1) && !busy(h.el)) h.release("ready", natural[i]); else h.el.style.height = `${h.held}px` })
  if (!holding.size && ticking) { clearInterval(ticking); ticking = null }
}

// Reads before writes, batched in a microtask: one by one, each read after a write would lay the page out again.
const reads: { read: () => number; write: (n: number) => void }[] = []
function batched(read: () => number, write: (n: number) => void) {
  if (!reads.length) queueMicrotask(() => {
    const all = reads.splice(0)
    const values = all.map((r) => r.read())
    all.forEach((r, i) => r.write(values[i]))
  })
  reads.push({ read, write })
}

/** Hold `el` at `key`'s remembered height (at its width; `anyWidth`: the latest at once, then its width's) while its content comes in, then
 *  remember its height as it changes (`shrinks`: let go once nothing inside loads, shorter too; a function `key`: read at each, a height per fold). */
export function holdHeight(el: HTMLElement, key: string | (() => string), anyWidth = false, shrinks = false): () => void {
  const at = typeof key === "string" ? () => key : key, first = at()
  let stopped = false
  let note: ReturnType<typeof setTimeout> | null = null
  let h: Held | null = null
  let size: { w: number; h: number } | null = null
  const record = () => {
    note = null
    if (h || !size || size.w <= 0 || !el.isConnected || busy(el)) return
    remember(at(), size.w, size.h)
  }
  const hold = (held: number | undefined) => {
    if (stopped || held === undefined) return
    el.style.height = `${held}px`
    el.style.overflow = "clip"
    const now = performance.now()
    const changes = new MutationObserver((rs) => { if (h && rs.some((r) => r.target !== el)) h.changed = true })
    changes.observe(el, { childList: true, subtree: true, characterData: true, attributes: true })
    h = {
      el, key: first, held, since: now, changed: true, shrinks,
      release: (why, natural) => {
        if (!h) return
        trace("heights", { key: first, held, why, natural: natural === undefined ? undefined : Math.round(natural), after: Math.round(performance.now() - h.since) })
        holding.delete(h)
        h = null
        changes.disconnect()
        el.style.height = el.style.overflow = ""
      },
    }
    trace("heights", { key: first, held, why: "hold" })
    holding.add(h)
    ticking ??= setInterval(tick, 150)
  }
  if (anyWidth) {
    hold(heightOf(first))
    batched(() => el.getBoundingClientRect().width, (w) => {
      if (!h || w <= 0) return
      const exact = heightOf(first, w)
      if (exact === undefined) { h.shrinks = true; return }
      if (Math.abs(exact - h.held) < 1) return
      trace("heights", { key: first, held: exact, why: "width", was: h.held })
      h.held = exact
      el.style.height = `${exact}px`
    })
  } else batched(() => el.getBoundingClientRect().width, (w) => hold(heightOf(first, w)))
  const sizes = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1]
    const box = e.borderBoxSize?.[0]
    size = box ? { w: box.inlineSize, h: box.blockSize } : { w: e.contentRect.width, h: e.contentRect.height }
    if (h) return
    if (note) clearTimeout(note)
    note = setTimeout(record, 300)
  })
  sizes.observe(el)
  // A summary's click (the keyboard's too), not `toggle`: a fold opened by code fires that as well.
  const toggled = (e: Event) => { if (elementOf(e.target)?.closest("summary")) h?.release("toggle") }
  el.addEventListener("click", toggled, true)
  return () => {
    stopped = true
    h?.release("gone")
    sizes.disconnect()
    el.removeEventListener("click", toggled, true)
    if (note) { clearTimeout(note); record() }
  }
}

/** holdHeight for a React element: put the ref on it. `key` null: nothing held or kept. `anyWidth`: held before what's
 *  around it is measured (a sidebar's panels, laid out in their own layout effect), at the latest height. */
export function useHeldHeight<T extends HTMLElement>(key: string | null, shrinks = false, anyWidth = false) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => (key && ref.current ? holdHeight(ref.current, key, anyWidth, shrinks) : undefined), [key, shrinks, anyWidth])
  return ref
}

const COUNTS = "vaultite.counts"
let counts: Map<string, number> | null = null
function allCounts() {
  if (counts) return counts
  counts = new Map()
  try {
    counts = new Map(keptEntries(JSON.parse(localStorage.getItem(COUNTS) ?? "null"), isNumber))
  } catch { /* private mode, or not JSON */ }
  return counts
}
let savingCounts: ReturnType<typeof setTimeout> | null = null
trackSoon("heights", () => saving !== null || savingCounts !== null, true)

/** How many rows to draw while list `key` loads: `now` (how many it has; undefined while loading) is kept for next time,
 *  and while loading, what it had last time, at most `most` (`first`: never seen). */
export function useKeptCount(key: string | null, now: number | undefined, first = 3, most = 12): number {
  useLayoutEffect(() => {
    if (key === null || now === undefined || allCounts().get(key) === now) return
    const m = allCounts()
    m.delete(key)
    m.set(key, now)
    while (m.size > MAX) m.delete(m.keys().next().value!)
    savingCounts ??= setTimeout(() => {
      savingCounts = null
      try { localStorage.setItem(COUNTS, JSON.stringify([...allCounts()])) } catch { /* private mode, or full */ }
    }, 1000)
  }, [key, now])
  if (now !== undefined) return now
  return Math.min(key === null ? first : allCounts().get(key) ?? first, most)
}
