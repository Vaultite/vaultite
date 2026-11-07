/** Region capture: a box dragged with the Talk key held; "record this" records it, "stop" sends it, "that, just now"
 *  sends the timeline's last seconds; companion.capture hands what's sent to the job on that surface, or saves it. */
import { screen } from "electron"
import { type BoxAt, boxesSince, boxMoved, boxOf, captureCommand, type Narration, type Point, RECORD_MOST_MS, type Rect, type RegionScene, REPLAY_MS } from "../plugins/core/companion/clips.ts"
import { type Clip, holdVideo, onVideoStopped, REAL, saveClip, stopVideo, videoAt } from "./recorder.ts"
import { happened, queryTimeline, timelineOn, timelineRefollow } from "./timeline.ts"

/** What helper.ts lends it. */
export type CaptureHost = {
  /** Window numbers never recorded (the overlay's, a private app's), and private apps' bundle ids. */
  exclude: () => Promise<number[]>; bundles: () => string[]
  /** What's at a point now (its app, window and its frame, title, what's under it), as an ask has it. */
  placeAt: (p: Point) => Promise<Record<string, unknown>>
  /** The capture handed to the server; answers where it went, in a few words. */
  deliver: (c: Capture) => Promise<string>
  hint: (text: string) => void
  draw: () => void
}
/** What's sent: the clip and its frames (files on this Mac), their words as it played, the box, what was there. */
export type Capture = Omit<Clip, "file"> & { kind: "recording" | "replay"; clip: string; narration: Narration[]; box: Rect; at: number; place: Record<string, unknown>; end?: Record<string, unknown>
  /** The job it's for (Still broken after its proof), else the one on that surface. */
  job?: string }
export { REAL }

type Box = { rect: Rect; display: Rect; tint: string }
let host: CaptureHost | null = null
let region: Box | null = null
/** The box's moves (what a clip is cropped to), while one is up. */
let boxes: BoxAt[] = []
/** A drag with the Talk key held, as it goes: from where it began. */
let dragging: { from: Point; display: Rect; was: Box | null } | null = null
let recording: { since: number; narration: Narration[]; place: Record<string, unknown>; timer: ReturnType<typeof setTimeout>; job?: string } | null = null
let saving = false
/** A recording asked for and on its way (its video starting): a second ask meanwhile isn't another. */
let opening = false

export function captureHost(h: CaptureHost) { host = h }
export const recordingNow = () => !!recording
onVideoStopped(() => { if (recording) void stopRecording(true) })

// ---------- the box

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const inside = (r: Rect, d: Rect) => r.x >= d.x && r.y >= d.y && r.x + r.width <= d.x + d.width && r.y + r.height <= d.y + d.height
/** A drag with the Talk key held (its ink): a box from where it began, shown as it grows. */
export function regionDrag(phase: "down" | "move" | "up", p: Point, tint: string) {
  if (phase === "down") { dragging = { from: p, display: screen.getDisplayNearestPoint(p).bounds, was: region }; return }
  if (!dragging) return
  const r = boxOf(dragging.from, p, dragging.display)
  if (phase === "move") {
    // (as it grows; too small yet, the box there before stays)
    if (r) region = { rect: r, display: dragging.display, tint }
    return host?.draw()
  }
  const d = dragging
  dragging = null
  if (!r) { region = d.was; return host?.draw() }
  setRegion({ rect: r, display: d.display, tint })
}
function setRegion(r: Box | null) {
  const now = Date.now()
  region = r
  if (r) boxes = boxMoved(boxes, r.rect, now, now - REPLAY_MS - 5000)
  else if (!recording) boxes = []
  happened({ t: now, kind: "box", rect: r?.rect ?? null })
  // (the video follows the box to its display)
  if (r && !recording && !inside(r.rect, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds)) timelineRefollow(centre(r.rect))
  host?.draw()
}
/** The overlay moved or resized the box (screen points). */
export function regionMoved(rect: Rect) { if (region) setRegion({ ...region, rect }) }
/** Its close: the box goes, and a recording with it, sent nowhere. */
export function regionClosed() {
  if (recording) { clearTimeout(recording.timer); recording = null; void letGo() }
  setRegion(null)
}
export const regionRect = () => region?.rect ?? null
export function regionScene(): RegionScene | null {
  if (!region) return null
  return { rect: region.rect, tint: region.tint, ...(recording ? { recording: recording.since } : {}), ...(saving ? { saving } : {}), ...(timelineOn() ? { replay: true } : {}) }
}
/** A press on the box's pill (the overlay's). */
export function regionAct(what: string) {
  if (what === "record") void startRecording("")
  else if (what === "stop") void stopRecording()
  else if (what === "replay") void replay("")
  else if (what === "close") regionClosed()
}

// ---------- their words

/** A Talk key's words (`at`: when its key went down): handled here when they ask capture for something, or while it
 *  records (their narration). False: an ask like any, for the companion. */
export function captureHeard(text: string, at: number) {
  const c = captureCommand(text, !!recording)
  if (recording) {
    const said = c ? c.rest : text.trim()
    if (said) recording.narration.push({ t: Math.max(0, at - recording.since), text: said })
    if (c?.do === "stop") void stopRecording()
    else host?.hint("Noted")
    return true
  }
  if (!c) return false
  if (c.do === "record") void startRecording(c.rest)
  else void replay(c.rest)
  return true
}

/** The box to record: theirs, else the window under the pointer, else the display. */
async function boxNow(): Promise<Rect> {
  if (region) return region.rect
  const p = screen.getCursorScreenPoint(), f = (await host!.placeAt(p).catch(() => ({} as Record<string, unknown>))).frame as Rect | undefined, d = screen.getDisplayNearestPoint(p).bounds
  return (f && boxOf({ x: f.x, y: f.y }, { x: f.x + f.width, y: f.y + f.height }, d)) || d
}

/** Still broken, after job `job`'s proof: what they show and say recorded (their box, else the window under the pointer),
 *  sent to that job when they say stop. */
export function recordFor(job: string) { void startRecording("", job) }

async function startRecording(first: string, job?: string) {
  if (recording || saving || opening || !host) return
  opening = true
  try { await openRecording(first, job) } finally { opening = false }
}
async function openRecording(first: string, job?: string) {
  if (!host) return
  const rect = await boxNow(), now = Date.now()
  if (!region) setRegion({ rect, display: screen.getDisplayNearestPoint(centre(rect)).bounds, tint: "red" })
  const r = await videoAt(centre(rect), await host.exclude(), host.bundles(), REPLAY_MS + 7000)
  if (!r.ok) { host.hint(r.why === "quiet" ? "Can't record here" : "Can't record the screen: allow Vaultite in Screen Recording"); return }
  await holdVideo(now)
  const place = await host.placeAt(centre(rect)).catch(() => ({}))
  recording = { since: now, narration: first ? [{ t: 0, text: first }] : [], place, timer: setTimeout(() => void stopRecording(), RECORD_MOST_MS), ...(job ? { job } : {}) }
  host.draw()
}
async function stopRecording(lost = false) {
  const r = recording
  if (!r || !host) return
  clearTimeout(r.timer)
  recording = null
  if (lost) { host.hint("The recording stopped"); return host.draw() }
  const to = Date.now()
  await send("recording", r.since, r.narration, r.place, () => saveClip(r.since, to, boxesSince(boxes, r.since, to)), r.job)
  await letGo()
}
/** The video let go after a recording: back to the timeline's ring, or off when it isn't kept. */
async function letGo() {
  await holdVideo(null)
  if (!timelineOn()) await stopVideo()
}

/** "That, just now": the timeline's last seconds, cropped to the box (else the window under the pointer), with what
 *  they said meanwhile. */
async function replay(said: string) {
  if (!host || saving) return
  if (!timelineOn()) { host.hint("Nothing kept: turn on Keep a timeline of the last seconds in the companion's settings"); return }
  const rect = await boxNow(), place = await host.placeAt(centre(rect)).catch(() => ({}))
  await send("replay", Date.now() - REPLAY_MS, [], place, async () => {
    const r = await queryTimeline({ last: REPLAY_MS / 1000, kinds: ["said"], clip: true, ...(region ? { boxes: boxesSince(boxes, Date.now() - REPLAY_MS) } : { box: rect }) })
    if (!r.ok) return { why: r.why }
    if (!r.clip) return { why: r.clipWhy ?? "no video" }
    // (their words meanwhile, not the ones that asked for it)
    const words = r.events.flatMap((e) => (e.kind === "said" && !captureCommand(e.text, false) ? [{ t: e.t - r.from, text: e.text }] : []))
    return { ...r.clip, narration: [...words, ...(said ? [{ t: r.to - r.from, text: said }] : [])] }
  })
}

/** A clip made (`make`) and handed on; the box stays for the next. */
async function send(kind: Capture["kind"], at: number, narration: Narration[], place: Record<string, unknown>, make: () => Promise<(Clip & { narration?: Narration[] }) | { why: string }>, job?: string) {
  saving = true
  host!.draw()
  try {
    const box = boxesSince(boxes, at)[0]?.rect ?? region?.rect
    const c = await make()
    if ("why" in c) { host!.hint(`Couldn't save it: ${c.why}`); return }
    const end = await host!.placeAt(screen.getCursorScreenPoint()).catch(() => undefined)
    host!.hint(await host!.deliver({ kind, clip: c.file, ms: c.ms, width: c.width, height: c.height, frames: c.frames, narration: c.narration ?? narration,
      box: box ?? { x: 0, y: 0, width: c.width, height: c.height }, at, place, ...(end ? { end } : {}), ...(job ? { job } : {}) }))
  } catch (e) {
    host!.hint(`Couldn't send it: ${(e as Error).message}`)
  } finally {
    saving = false
    host!.draw()
  }
}
export function stopCapture() {
  if (recording) clearTimeout(recording.timer)
  recording = null; region = null; boxes = []
}
