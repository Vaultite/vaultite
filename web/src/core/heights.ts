// Remembered heights of blocks, embeds and cards, per width, so drawing one again starts at its size instead of a
// "Loading…" line that grows: the page keeps its shape and the editor estimates off-screen blocks right.

import { useLayoutEffect, useRef } from "react"
import { trace } from "@/core/trace"

type Seen = { w: number; h: number }
const KEPT = "vaultite.heights"
const MAX = 800
/** How close a width must be for a remembered height to hold an element (px). */
const NEAR = 24
let heights: Map<string, Seen[]> | null = null

function all() {
  if (heights) return heights
  heights = new Map()
  try {
    const kept = JSON.parse(localStorage.getItem(KEPT) ?? "null") as [string, Seen[]][] | null
    if (Array.isArray(kept)) heights = new Map(kept)
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
  if (was[0] && Math.abs(was[0].w - w) < 1 && Math.abs(was[0].h - h) < 1) return
  // The latest first, three widths at most (a pane or two; a sheet).
  const next = [{ w: Math.round(w), h: Math.round(h) }, ...was.filter((s) => Math.abs(s.w - w) >= NEAR)].slice(0, 3)
  m.delete(key)
  m.set(key, next)
  while (m.size > MAX) m.delete(m.keys().next().value!)
  saving ??= setTimeout(save, 1000)
}

/** The height `key` had at about `width` (any width when left out), or undefined. */
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

/** Anything inside still loading (the core's `Loading` line and other placeholders say so with aria-busy). */
const busy = (el: HTMLElement) => !!el.querySelector("[aria-busy=true]")

// Held elements are checked together, a few times a second, while any is held.
type Held = { el: HTMLElement; key: string; held: number; since: number; release: (why: string, natural?: number) => void
  /** Something inside changed since it was last measured. */
  changed: boolean }
const holding = new Set<Held>()
/** Let go once nothing inside is loading (`aria-busy`) and it's at
 *  least the remembered height, or after 4 s: rather room left for a moment than a card that shrinks and grows back. */
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
  // How tall each is without its hold (what's inside may fill it: h-full), measured all at once and put back before
  // anything is drawn: one layout for all of them.
  for (const h of shown) h.el.style.height = ""
  const natural = shown.map((h) => h.el.getBoundingClientRect().height)
  shown.forEach((h, i) => { if (natural[i] >= h.held - 1 && !busy(h.el)) h.release("ready", natural[i]); else h.el.style.height = `${h.held}px` })
  if (!holding.size && ticking) { clearInterval(ticking); ticking = null }
}

// Layout reads before writes, batched in a microtask: held one by one (each card in its layout effect), they'd lay the
// page out once each.
const reads: { read: () => number; write: (n: number) => void }[] = []
function batched(read: () => number, write: (n: number) => void) {
  if (!reads.length) queueMicrotask(() => {
    const all = reads.splice(0)
    const values = all.map((r) => r.read())
    all.forEach((r, i) => r.write(values[i]))
  })
  reads.push({ read, write })
}

/** Hold `el` at `key`'s remembered height (at its width; `anyWidth`: the latest) while its content comes in, then
 *  remember its height as it changes. Returns a stop. */
export function holdHeight(el: HTMLElement, key: string, anyWidth = false): () => void {
  let stopped = false
  let note: ReturnType<typeof setTimeout> | null = null
  let h: Held | null = null
  // Its size as the ResizeObserver last saw it (no layout to read it again).
  let size: { w: number; h: number } | null = null
  const record = () => {
    note = null
    // (a hidden tab measures nothing: not a height to come back to; a block that draws nothing is 0 tall, and is one)
    if (h || !size || size.w <= 0 || !el.isConnected || busy(el)) return
    remember(key, size.w, size.h)
  }
  const hold = (held: number | undefined) => {
    if (stopped || held === undefined) return
    el.style.height = `${held}px`
    el.style.overflow = "clip"
    const now = performance.now()
    // (measured again only once something inside has changed: a measure lays the page out)
    // (not its own style: holding and measuring it changes that)
    const changes = new MutationObserver((rs) => { if (h && rs.some((r) => r.target !== el)) h.changed = true })
    changes.observe(el, { childList: true, subtree: true, characterData: true, attributes: true })
    h = {
      el, key, held, since: now, changed: true,
      // (its new size comes to the ResizeObserver, which remembers it)
      release: (why, natural) => {
        if (!h) return
        trace("heights", { key, held, why, natural: natural === undefined ? undefined : Math.round(natural), after: Math.round(performance.now() - h.since) })
        holding.delete(h)
        h = null
        changes.disconnect()
        el.style.height = el.style.overflow = ""
      },
    }
    trace("heights", { key, held, why: "hold" })
    holding.add(h)
    ticking ??= setInterval(tick, 150)
  }
  if (anyWidth) hold(heightOf(key))
  else batched(() => el.getBoundingClientRect().width, (w) => hold(heightOf(key, w)))
  const sizes = new ResizeObserver((entries) => {
    const e = entries[entries.length - 1]
    const box = e.borderBoxSize?.[0]
    size = box ? { w: box.inlineSize, h: box.blockSize } : { w: e.contentRect.width, h: e.contentRect.height }
    if (h) return
    if (note) clearTimeout(note)
    note = setTimeout(record, 300)
  })
  sizes.observe(el)
  return () => {
    stopped = true
    h?.release("gone")
    sizes.disconnect()
    if (note) { clearTimeout(note); record() }
  }
}

/** holdHeight for a React element: put the ref on it. `key` null: nothing held or kept. */
export function useHeldHeight<T extends HTMLElement>(key: string | null) {
  const ref = useRef<T>(null)
  useLayoutEffect(() => (key && ref.current ? holdHeight(ref.current, key) : undefined), [key])
  return ref
}
