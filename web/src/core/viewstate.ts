// Where you left a place (scroll, cursor, Properties open), per place, device and vault, so coming back shows it as it
// was. A text file's place is also its top line: the editor guesses unseen heights, so a scrollTop can drift.
import { getStore } from "@/core/data"

type Place = { y?: number; props?: boolean; at?: [number, number]
  /** The body's line at the top (0-based) and how far into it (a share of its height). */
  line?: number; into?: number }
const KEPT = "vaultite.places"
const MAX = 200
let places = new Map<string, Place>()
let keptFor: string | null = null

function all() {
  const vault = getStore()?.vault.path ?? ""
  if (keptFor !== vault) {
    keptFor = vault
    places = new Map()
    try {
      const kept = JSON.parse(localStorage.getItem(KEPT) ?? "null") as { vault: string; places: [string, Place][] } | null
      if (kept?.vault === vault && Array.isArray(kept.places)) places = new Map(kept.places)
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
// (and before the page goes: a reload right after scrolling comes back there)
addEventListener("pagehide", () => { if (saving) save() })
function update(key: string, change: Place) {
  const m = all()
  const next = { ...m.get(key), ...change }
  m.delete(key) // the latest last, so the oldest go first
  m.set(key, next)
  while (m.size > MAX) m.delete(m.keys().next().value!)
  if (saving) clearTimeout(saving)
  saving = setTimeout(save, 500)
}

type Line = { line: number; into: number }
const readers = new Map<HTMLElement | null, () => Line | null>()
/** What's drawn in `box` (null: the window) says which line is at its top, kept with each scroll. Returns a stop. */
export function readPlace(box: HTMLElement | null, read: () => Line | null) {
  readers.set(box, read)
  return () => { if (readers.get(box) === read) readers.delete(box) }
}

/** How far `key` was scrolled when it was left (0: its top). */
export const scrollOf = (key: string) => all().get(key)?.y ?? 0
/** `key` scrolled to `y` in `box` (null: the window). */
export const keepScroll = (key: string, y: number, box: HTMLElement | null = null) => {
  if (Math.abs((all().get(key)?.y ?? 0) - y) < 1) return
  const read = readers.get(box)
  const line = (at: Line | null): Place => ({ line: at?.line, into: at ? Math.round(at.into * 1000) / 1000 : undefined })
  update(key, { y: Math.round(y), ...line(read?.() ?? null) })
  // Read again once the scrolling stops: an editor measures what came on screen after the scroll, and until then its
  // line at the top is a guess from the heights it estimated.
  if (!read) return
  clearTimeout(settling.get(box))
  settling.set(box, setTimeout(() => {
    settling.delete(box)
    if (readers.get(box) === read && all().get(key)?.y === Math.round(y)) update(key, line(read()))
  }, 200))
}
const settling = new Map<HTMLElement | null, ReturnType<typeof setTimeout>>()

/** A file or folder was renamed or moved: its places go with it, so a tab that follows it (a report archived by a reply
 *  sent from it) stays where it was read. */
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

/** Whether a file's Properties are open (folded unless they were opened). */
export const propsOpen = (path: string) => all().get(`file:${path}`)?.props ?? false
export const keepPropsOpen = (path: string, open: boolean) => update(`file:${path}`, { props: open })
/** Show a file's Properties, open (its view goes to editing if it's being read): a block's "This file's properties". */
export function revealProperties(path: string) {
  keepPropsOpen(path, true)
  dispatchEvent(new CustomEvent("vau:properties", { detail: path }))
}

/** Where a file's cursor was left: its body's line (0-based) and column, or null. */
export const cursorOf = (path: string) => all().get(`file:${path}`)?.at ?? null
export const keepCursor = (path: string, line: number, ch: number) => {
  const at = all().get(`file:${path}`)?.at
  if (at?.[0] !== line || at?.[1] !== ch) update(`file:${path}`, { at: [line, ch] })
}

const restores = new Set<() => void>()
/** Stop scrolling back to where places were left: something else is taking the reader somewhere (a link to a heading). */
export const cancelRestores = () => [...restores].forEach((stop) => stop())
/** Another way of scrolling back to a place (an editor finding its line), stopped like the others. Returns a stop. */
export function addRestore(stop: () => void) { restores.add(stop); return () => { restores.delete(stop) } }

/** Places still being found (scrolled back to, or found by their line), and what waits for them to be (the cursor put
 *  into the text: the first line in sight then is the right one). */
const finding = new Set<string>()
const waiting = new Map<string, (() => void)[]>()
const found = (key: string | undefined) => {
  if (key === undefined || !finding.delete(key)) return
  const fns = waiting.get(key)
  waiting.delete(key)
  fns?.forEach((f) => f())
}
/** Run `fn` once `key`'s place has been found (at once when it isn't being found). Returns a stop. */
export function afterPlaced(key: string, fn: () => void): () => void {
  if (!finding.has(key)) { fn(); return () => {} }
  waiting.set(key, [...(waiting.get(key) ?? []), fn])
  return () => { const l = waiting.get(key); if (l) waiting.set(key, l.filter((f) => f !== fn)) }
}

/** Places being scrolled back to by restoreScroll, by key, while their line can still take over. */
const pending = new Map<string, { box: HTMLElement | null; stop: (taken?: boolean) => void; show: () => void; hideToo: (el: HTMLElement) => void }>()
/** What draws `key` can find its place itself now: it takes over a restore of it, now or when one starts (the file may
 *  draw before or after its tab starts scrolling back). Returns a stop. */
const offers = new Map<string, () => void>()
export function offerPlace(key: string, take: () => void): () => void {
  if (pending.has(key)) { take(); return () => {} }
  offers.set(key, take)
  return () => { if (offers.get(key) === take) offers.delete(key) }
}
/** `el` (a file that came while its place is being found: the app reloaded) stays hidden until the place is found. */
export const hideUntilPlaced = (key: string, el: HTMLElement | null) => { if (el) pending.get(key)?.hideToo(el) }
/** `key` is being scrolled back to a line: stop scrolling by pixels and say where to find that line instead. Null when
 *  it isn't (already there, the reader scrolled, no line kept). */
export function takeRestore(key: string): { box: HTMLElement | null; line: number; into: number; show: () => void } | null {
  const p = pending.get(key)
  const at = all().get(key)
  if (!p || at?.line === undefined) return null
  p.stop(true)
  // (shown whatever happens, a moment later)
  const show = () => { clearTimeout(late); p.show(); found(key) }
  const late = setTimeout(show, 400)
  return { box: p.box, line: at.line, into: at.into ?? 0, show }
}

/** Scroll `box` (or the window) back to `y` as its content loads, each frame for 1.5 s, until there or the user scrolls.
 *  A place kept at a line waits instead for what draws it to take over (box hidden up to 600 ms so the text doesn't jump). */
export function restoreScroll(box: HTMLElement | null, y: number, done?: () => void, key?: string, hide: HTMLElement | null = box): () => void {
  const byLine = key !== undefined && all().get(key)?.line !== undefined
  const start = performance.now()
  // (by its line: as long as its editor may take to load, shown after a moment meanwhile, at the top)
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
  /** Something that came on the page meanwhile (the file, once it's loaded) hidden with the rest. */
  const hideToo = (el: HTMLElement) => { if (byLine && !shown) { hidden.push(el); el.style.visibility = "hidden" } }
  /** Stopped: by the user (or something else scrolling), when it's there, or taken over (`taken`: the box is shown
   *  by whoever took it, once the place is found). */
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
  // (what draws it already offered to find the place: it does)
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
