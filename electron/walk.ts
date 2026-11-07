/** A QA walk (walks.ts' rules): hands-free, each sentence an item tied to the thing the pointer rested on (an Anchor),
 *  with a frame and clip from the timeline if screen recording is allowed (never asked); done sends them (walk-send). */
import { app, screen } from "electron"
import fs from "node:fs"
import path from "node:path"
import { anchorOf, anchorText } from "../plugins/core/companion/anchor.ts"
import type { Rect, Thing } from "../plugins/core/companion/uimodel.ts"
import { countText, dwellAt, type Point, sentences, thingAt, walkCommand, type WalkItem, type WalkPlace, type WalkScene } from "../plugins/core/companion/walks.ts"
import { happened, queryTimeline, timelineFilmed } from "./timeline.ts"

/** What helper.ts lends it. */
export type WalkHost = {
  /** Whether Vaultite may record the screen (asked of macOS without a prompt). */
  allowed: () => boolean
  /** What's at a point now, as an ask has it: the place, the things near it (screen points), its window's frame. */
  placeAt: (p: Point) => Promise<{ place: WalkPlace; near: Thing[]; window?: Rect; private?: boolean }>
  /** A picture of the screen there (cropped to `crop`), saved as `file`; false when it can't be had. */
  still: (p: Point, crop: Rect | undefined, file: string) => Promise<boolean>
  /** The walk handed to the server; answers where it went, in a few words. */
  deliver: (w: { items: WalkItem[]; since: number; clips: boolean }) => Promise<string>
  /** Its listening (a hands-free session of the helper's) is wanted, or not. */
  listening: (on: boolean) => void
  draw: () => void
}
type Item = WalkItem & { ready: Promise<void> }
type On = { phase: "on" | "sending"; since: number; items: Item[]; clips: boolean; heard: { text: string; since: number }; last: number; listening: boolean }

/** A pause this long ends a sentence they didn't end. */
const PAUSE_MS = 1600
/** With nothing said this long, it ends and sends what it has: the microphone isn't left open for nothing. */
const IDLE_MS = 20 * 60_000
/** A clip's seconds before their words began, and its longest. */
const LEAD_MS = 2000, CLIP_MOST_MS = 20_000
const NOTE_MS = 2600, TOLD_MS = 6000

let host: WalkHost | null = null
let walk: On | null = null
let note: { text: string; until: number } | null = null
let pause: ReturnType<typeof setTimeout> | null = null
let idle: ReturnType<typeof setInterval> | null = null

export function walkHost(h: WalkHost) { host = h }
export const walkOn = () => !!walk
/** Whether it keeps the screen's video (the timeline's, for its clips). */
export const walkFilms = () => !!walk && walk.clips
/** It should be listening now (the helper starts its session once nothing else has the microphone). */
export const walkListens = () => walk?.phase === "on"

function say(text: string, ms = NOTE_MS) {
  note = { text, until: Date.now() + ms }
  host?.draw()
  setTimeout(() => host?.draw(), ms + 50)
}
export function walkScene(): WalkScene | null {
  const n = note && note.until > Date.now() ? note.text : undefined
  if (!walk) return n ? { state: "told", count: 0, since: 0, clips: false, note: n } : null
  return { state: walk.phase === "sending" ? "sending" : walk.listening ? "on" : "paused", count: walk.items.length, since: walk.since, clips: walk.clips, ...(n ? { note: n } : {}) }
}

// ---------- on and off

/** Start one: listening at once, the screen kept for clips if it may be; `first`: words said with "start a QA walk". */
export function startWalk(first = "", at = Date.now()) {
  if (!host) return "No QA walk here: this Mac's helper isn't running"
  if (walk) { say("A QA walk is on already"); return "A QA walk is on already" }
  const clips = host.allowed()
  walk = { phase: "on", since: Date.now(), items: [], clips, heard: { text: "", since: 0 }, last: Date.now(), listening: false }
  idle = setInterval(() => { if (walk?.phase === "on" && Date.now() - walk.last > IDLE_MS) void endWalk(true, "nothing said for 20 minutes") }, 30_000)
  if (first) addItem(first, at, Date.now())
  host.listening(true)
  const said = clips ? "QA walk on: talk as you go" : "QA walk on, words only: allow Vaultite in Screen Recording for frames"
  say(said, clips ? NOTE_MS : 7000)
  return said
}
/** End it: what's still being heard becomes the last item, then all of it goes (`send`), or none (cancelled). */
export async function endWalk(send: boolean, why = ""): Promise<string> {
  const w = walk
  if (!w || w.phase !== "on") return w ? "It's being sent" : "No QA walk is on"
  heardEnd()
  host?.listening(false)
  if (!send) { stop(); say("QA walk cancelled: nothing sent"); return "Cancelled: nothing sent" }
  w.phase = "sending"
  host?.draw()
  await Promise.all(w.items.map((i) => i.ready))
  if (!w.items.length) { stop(); say("QA walk over: nothing noted"); return "Nothing noted" }
  try {
    const said = await host!.deliver({ items: w.items.map(({ ready: _, ...i }) => i), since: w.since, clips: w.clips })
    stop()
    say(why ? `${said} (${why})` : said, TOLD_MS)
    return said
  } catch (e) {
    // (nothing lost: it goes on, and done sends it again)
    w.phase = "on"
    host?.listening(true)
    const said = `Couldn't send the walk: ${(e as Error).message}. Say done to try again`
    say(said, TOLD_MS)
    return said
  }
}
function stop() {
  walk = null
  if (pause) clearTimeout(pause)
  if (idle) clearInterval(idle)
  pause = idle = null
  host?.draw()
}
/** Drop the last item (scratch that). */
function scratch() {
  const it = walk?.items.pop()
  say(it ? `Scratched: ${short(it.said)}` : "Nothing to scratch")
}
const short = (s: string) => (s.length > 48 ? `${s.slice(0, 47).replace(/\s+\S*$/, "")}…` : s)

/** A Talk key's words, or an ask typed or said into its box: handled here when they start, scratch or end a walk. */
export function walkHeard(text: string, at = Date.now()) {
  const c = walkCommand(text, !!walk)
  if (!c) return false
  if (c.do === "start") startWalk(c.rest, at)
  else act(c.do)
  return true
}
/** The chip's buttons and the op (`vau companion walk`): start, scratch, done, cancel, or how it goes. */
export async function walkCall(what: string): Promise<Record<string, unknown>> {
  const said = what === "start" ? startWalk() : what === "done" || what === "cancel" ? await endWalk(what === "done") : what === "scratch" ? (walk ? (scratch(), "Scratched the last item") : "No QA walk is on") : ""
  return { on: !!walk, ...(walk ? { items: walk.items.length, since: walk.since, clips: walk.clips, said: said || `A QA walk is on: ${countText(walk.items.length)}${walk.clips ? "" : ", words only (no screen recording)"}`, last: walk.items.slice(-3).map((i) => i.said) } : { said: said || "No QA walk is on" }) }
}
export function walkAct(what: string) {
  if (what === "scratch") scratch()
  else if (what === "done" || what === "cancel") void endWalk(what === "done")
}
const act = (what: "done" | "scratch" | "cancel") => walkAct(what)

// ---------- its listening: the helper's hands-free session tells what it hears

/** The helper's session for it began or ended (another took the microphone: what it heard counts). */
export function walkListening(on: boolean) {
  if (!walk) return
  walk.listening = on
  if (!on) heardEnd()
  host?.draw()
}
/** Words still changing: the sentence they begin starts now. */
export function walkPending(text: string) {
  if (walk && text.trim() && !walk.heard.text && !walk.heard.since) walk.heard.since = Date.now()
}
/** Words settled: whole sentences become items (or commands), the rest waits for more or a pause. */
export function walkFinal(text: string) {
  if (walk?.phase !== "on" || !text.trim()) return
  const h = walk.heard
  if (!h.since) h.since = Date.now()
  h.text = h.text ? `${h.text} ${text.trim()}` : text.trim()
  took(sentences(h.text))
  if (pause) clearTimeout(pause)
  pause = setTimeout(heardEnd, PAUSE_MS)
}
/** A pause, or its session ended: all of what was heard goes. */
function heardEnd() {
  if (pause) clearTimeout(pause)
  pause = null
  if (walk?.heard.text) took(sentences(walk.heard.text, true))
}
function took(s: { done: string[]; rest: string }) {
  const w = walk
  if (!w) return
  const since = w.heard.since, now = Date.now()
  w.heard = { text: s.rest, since: s.rest ? now : 0 }
  for (const said of s.done) {
    if (walk !== w) return
    const c = walkCommand(said, true)
    if (c && c.do !== "start") act(c.do)
    else addItem(said, since, now)
  }
}

// ---------- an item: where the pointer rested as it was said, the thing there, a frame and a clip

function addItem(said: string, from: number, to: number) {
  const w = walk
  if (!w) return
  w.last = Date.now()
  happened({ t: from, kind: "said", text: said })
  const it = { n: w.items.length + 1, said, from, to, at: screen.getCursorScreenPoint(), place: {} } as Item
  it.ready = fill(it, w.clips).catch((e) => console.error("vaultite: a QA walk's item:", e))
  w.items.push(it)
  say(`Noted: ${short(said)}`)
}
async function fill(it: Item, clips: boolean) {
  const back = Math.max(it.from - LEAD_MS, it.to - CLIP_MOST_MS)
  const moves = await queryTimeline({ from: it.from - 400, to: it.to, kinds: ["pointer"] })
  const ps = moves.ok ? moves.events.flatMap((e) => (e.kind === "pointer" ? [e] : [])) : []
  it.at = dwellAt(ps, it.from - 400, it.to) ?? it.at
  const got = await host!.placeAt(it.at)
  it.place = got.place
  const thing = thingAt(got.near, it.at)
  if (thing) it.anchor = anchorOf(thing, { app: got.place.vaultite ? "vaultite" : got.place.app, window: got.window })
  happened({ t: it.from, kind: "thing", x: it.at.x, y: it.at.y, thing: it.anchor ? anchorText(it.anchor) : got.place.under || "nothing named" })
  // (a private app's: its words only, never a picture)
  if (!clips || got.private) return
  const display = screen.getDisplayNearestPoint(it.at).bounds, box = got.window ? clipTo(got.window, display) : display
  if (timelineFilmed()) {
    const r = await queryTimeline({ from: back, to: it.to, kinds: [], clip: true, box })
    if (r.ok && r.clip) {
      const mid = (it.from + it.to) / 2 - r.from, f = r.clip.frames.filter((x) => x.t <= mid).at(-1) ?? r.clip.frames[0]
      Object.assign(it, { clip: r.clip.file, clipMs: r.clip.ms, ...(f ? { frame: f.file } : {}) })
      if (f) return
    }
  }
  // (no video kept, or it made no frame: a picture of the window now)
  const dir = path.join(app.getPath("userData"), "captures", new Date(it.from).toISOString().replace(/[:.]/g, "-"))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "frame.png")
  if (await host!.still(it.at, box, file)) it.frame = file
}
function clipTo(r: Rect, d: Rect): Rect {
  const x = Math.max(r.x, d.x), y = Math.max(r.y, d.y), x2 = Math.min(r.x + r.width, d.x + d.width), y2 = Math.min(r.y + r.height, d.y + d.height)
  return x2 - x >= 24 && y2 - y >= 24 ? { x, y, width: x2 - x, height: y2 - y } : d
}

export function stopWalk() {
  if (walk) host?.listening(false)
  stop()
  note = null
}
