// The screen under the companion's marks (helper.ts samples it, small and grey, while a mark that points is up): a mark
// on a thing that moved follows it (found again by Accessibility); changed for good there, a mark fades. No Electron.
import { anchorOf, type Anchor, refind, type Seen } from "../core/desktop/anchor.ts"
import { z } from "zod"
import { type Drawing, lifeOf, type Rect, rectOf, spots } from "../core/desktop/screenmarks.ts"

/** How often the areas are sampled (ms). */
export const SAMPLE_MS = 500
/** A mark's area: its layer, its id, where it is (screen points), and the thing it's on when one is known (`on`: its
 *  anchor and where that thing is, kept for the mark's life as it follows). */
export type Area = { layer: string; mark: string; rect: Rect; on?: On; key: string }
export type On = { anchor: Anchor; at: { x: number; y: number } }
/** A sample of an area: `w` by `h` grey pixels. */
export type Sample = { w: number; h: number; px: Uint8Array }

/** Around a point mark (an arrow's tip), what's watched (points). */
const POINT_BOX = 36
/** The areas to watch in `layers`: marks living till the next ask or the screen's change, at a known place; anchored the
 *  first time to `things` (what the last ask found on screen), kept in `known` (by layer and mark) after. */
export function watchedAreas(layers: Drawing[], things: (Seen & { id?: string })[] = [], known = new Map<string, On | null>()): Area[] {
  const out: Area[] = []
  for (const d of layers) {
    if (d.hidden) continue
    for (const m of d.marks) {
      if (m.gone || !m.id || lifeOf(m) === "dismiss") continue
      for (const s of spots([m])) {
        if ("area" in s) continue
        const r = rectOf(s, d.places)
        if (!r) continue
        const rect = r.w || r.h ? r : { x: r.x - POINT_BOX / 2, y: r.y - POINT_BOX / 2, w: POINT_BOX, h: POINT_BOX }
        const id = `${d.id}/${m.id}`
        if (!known.has(id)) {
          const t = "el" in s ? things.find((x) => x.id === s.el) : thingAt(r, things)
          known.set(id, t?.label.trim() ? { anchor: anchorOf(t), at: { x: t.frame.x, y: t.frame.y } } : null)
        }
        const on = known.get(id)
        out.push({ layer: d.id, mark: m.id, rect, key: `${id}/${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`, ...(on ? { on } : {}) })
      }
    }
  }
  return out
}
/** The thing a mark at `r` is on: the one its box mostly is (a ring round a button), else for a point the smallest one
 *  under it. */
export function thingAt(r: Rect, things: Seen[]): Seen | undefined {
  const f = (t: Seen) => ({ x: t.frame.x, y: t.frame.y, w: t.frame.width, h: t.frame.height })
  if (!r.w && !r.h) return things.filter((t) => within(r, f(t))).sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height)[0]
  let best: Seen | undefined, most = 0.5
  for (const t of things) { const k = overlap(r, f(t)); if (k > most) { most = k; best = t } }
  return best
}
const within = (p: Rect, r: Rect) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h
/** How much two boxes are one: their intersection over their union. */
export function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const i = w * h
  return i / (a.w * a.h + b.w * b.h - i)
}
/** A sample's size for an area: up to 48 pixels across, its shape kept. */
export function sampleSize(r: Rect) {
  const w = Math.max(4, Math.min(48, Math.round(r.w))), h = Math.max(4, Math.min(48, Math.round((r.h / Math.max(1, r.w)) * w)))
  return { w, h }
}

/** Whether two samples show something else: enough of their pixels changed clearly (a dialog, a page, a scroll), not a
 *  hover's tint, a caret or a few letters. */
export function differs(a: Sample, b: Sample, by = 28, share = 0.12) {
  if (a.w !== b.w || a.h !== b.h) return true
  let n = 0
  const most = a.px.length * share
  for (let i = 0; i < a.px.length; i++) if (Math.abs(a.px[i] - b.px[i]) > by && ++n > most) return true
  return false
}

/** What an area's samples say against its first (the screen as the mark came): `changed`, something else there and
 *  held (two samples running alike), or `moving`, in flux (a scroll, a video), or nothing. */
type Watch = { base: Sample; last: Sample }
export function makeWatch() {
  const by = new Map<string, Watch>()
  return {
    /** Area `a`'s new sample. */
    saw(a: Area, s: Sample): "changed" | "moving" | null {
      const w = by.get(a.key)
      if (!w) { by.set(a.key, { base: s, last: s }); return null }
      const moving = differs(w.last, s)
      w.last = s
      if (!differs(w.base, s)) return null
      return moving ? "moving" : "changed"
    },
    /** Area `a` as it is now is how it looks (its mark just followed its thing there, mid-scroll as it came). */
    settled(a: Area) { const w = by.get(a.key); if (w) w.base = w.last },
    /** Forget the areas not in `keys` (their marks went, moved or changed). */
    keep(keys: Set<string>) { for (const k of by.keys()) if (!keys.has(k)) by.delete(k) },
    has: (key: string) => by.has(key),
    size: () => by.size,
  }
}

/** Where area `a`'s thing is among `now` (what Accessibility reads near it): `moved` by how much, `stayed`, or `gone`. */
export function followed(a: Area, now: Seen[]): { kind: "moved"; dx: number; dy: number } | { kind: "stayed" } | { kind: "gone" } {
  if (!a.on) return { kind: "gone" }
  const r = refind(a.on.anchor, now)
  if (!r.ok || !r.shown) return { kind: "gone" }
  const f = r.seen.frame, dx = f.x - a.on.at.x, dy = f.y - a.on.at.y
  if (Math.hypot(dx, dy) < 3) return { kind: "stayed" }
  // (where it is now, for its next move)
  a.on.at = { x: f.x, y: f.y }
  return { kind: "moved", dx: Math.round(dx), dy: Math.round(dy) }
}

/** Decode a sample from the helper's reply. */
const SAMPLE = z.object({ w: z.number(), h: z.number(), px: z.string() })
export function sampleFrom(v: unknown): Sample | null {
  const o = SAMPLE.safeParse(v).data
  if (!o) return null
  const px = Uint8Array.from(Buffer.from(o.px, "base64"))
  return px.length === o.w * o.h ? { w: o.w, h: o.h, px } : null
}
