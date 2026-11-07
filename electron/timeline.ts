/** The screen's timeline (plugins/core/screen/timeline.ts): the pointer, the app in front, clicks, the Talk key's words,
 *  the box and the video, kept in memory only while the setting and the companion are on; read with screen.timeline. */
import { screen } from "electron"
import type { BoxAt, Rect } from "../plugins/core/companion/clips.ts"
import { type Happened, KEEP_MS, kept, MOST, type Query, rangeOf, within } from "../plugins/core/screen/timeline.ts"
import { type Clip, holdVideo, saveClip, stopVideo, videoAt, videoOn } from "./recorder.ts"

/** What helper.ts lends it. */
export type TimelineHost = {
  /** Window numbers never in the video (the overlay's, a private app's), and private apps' bundle ids. */
  exclude: () => Promise<number[]>; bundles: () => string[]
  /** Clicks told by the screen helper (on while it keeps them). */
  clicks: (on: boolean) => void
  /** A private app in front: nothing of it is kept. */
  privateNow: () => boolean
  /** A recording holds the video (capture.ts): it isn't stopped meanwhile. */
  holding: () => boolean
}
let host: TimelineHost | null = null
let wanted = false
let h: Happened[] = []
let sampler: ReturnType<typeof setInterval> | null = null
/** When the video was last asked to start: refused (no screen recording), not again for a minute. */
let asked = 0
const RING = KEEP_MS + 2000

export function timelineHost(x: TimelineHost) { host = x }
export const timelineOn = () => wanted

/** On (the setting, the companion on, the app that hears the keys) or off (everything kept forgotten). */
export function keepTimeline(on: boolean) {
  if (on && wanted) { if (!videoOn() && Date.now() - asked > 60_000) void startVideo(); return }
  if (on === wanted) return
  wanted = on
  if (on) {
    sampler = setInterval(samplePointer, 100)
    host?.clicks(true)
    void startVideo()
  } else {
    if (sampler) clearInterval(sampler)
    sampler = null
    h = []
    host?.clicks(false)
    if (!host?.holding()) void stopVideo()
  }
}
async function startVideo(p = screen.getCursorScreenPoint()) {
  if (!host) return
  asked = Date.now()
  const r = await videoAt(p, await host.exclude(), host.bundles(), RING)
  if (r.ok) asked = 0
}
/** What's left out of the video looked at again (another app in front, our windows changed), on the display at `p`. */
export function timelineRefollow(p?: { x: number; y: number }) {
  if (wanted && videoOn() && !host?.holding()) void startVideo(p)
}

/** Something that happened, kept while it's on (never while a private app is in front, but that it came). */
export function happened(e: Happened) {
  if (!wanted || (host?.privateNow() && e.kind !== "app" && e.kind !== "said")) return
  h.push(e)
  if (h.length > MOST + 500 || e.t - h[0].t > KEEP_MS + 10_000) h = kept(h, e.t)
}
let lastP = { x: NaN, y: NaN }
function samplePointer() {
  const p = screen.getCursorScreenPoint()
  if (Math.abs(p.x - lastP.x) < 2 && Math.abs(p.y - lastP.y) < 2) return
  lastP = p
  happened({ t: Date.now(), kind: "pointer", x: p.x, y: p.y })
}

/** A stretch of it: what happened (`kinds`), and with `clip` its video cropped to `box` (or the box as it moved, `boxes`;
 *  else the display), saved now. */
export async function queryTimeline(q: Query & { clip?: boolean; box?: Rect; boxes?: BoxAt[] }): Promise<{ ok: false; why: string } | { ok: true; from: number; to: number; events: Happened[]; clip?: Clip; clipWhy?: string }> {
  if (!wanted) return { ok: false, why: "the timeline is off: it's kept only while the companion is on and its setting Keep a timeline of the last seconds is" }
  const now = Date.now()
  h = kept(h, now)
  const r = rangeOf(h, q, now)
  if ("why" in r) return { ok: false, why: r.why }
  const events = within(h, r, q.kinds)
  if (!q.clip) return { ok: true, ...r, events }
  const boxes: BoxAt[] = q.boxes?.length ? q.boxes : [{ t: r.from, rect: q.box ?? boxThen(r.from) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds }]
  const clip = await saveClip(r.from, r.to, boxes)
  return { ok: true, ...r, events, ...("why" in clip ? { clipWhy: clip.why } : { clip }) }
}
/** The box up at `t`, if one was. */
const boxThen = (t: number) => { const b = h.findLast((e) => e.kind === "box" && e.t <= t) ?? h.find((e) => e.kind === "box"); return b?.kind === "box" ? b.rect : null }
export { holdVideo }
