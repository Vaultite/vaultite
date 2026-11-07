/** Teach by showing (companion/teach.ts' rules): "watch me" keeps the timeline for a lesson, each act on its thing and
 *  their words; "that's it" makes it a draft tour or skill (companion.teach), as does "make what I just did a skill". */
import { ACTS, type El, type Kind } from "../plugins/core/screen/timeline.ts"
import { clickedThing, keptValue, recentStretch, teachCommand, type Act, type As } from "../plugins/core/companion/teach.ts"
import type { Rect, Thing } from "../plugins/core/companion/uimodel.ts"
import type { WalkScene } from "../plugins/core/companion/walks.ts"
import { happened, queryTimeline, timelineOn } from "./timeline.ts"

type Point = { x: number; y: number }
/** What helper.ts lends it. */
export type TeachHost = {
  /** Whether Accessibility lets it read what's on screen (asked of macOS without a prompt). */
  trusted: () => boolean
  /** The things around a point (the ui model's, screen points), and the window there. */
  things: (p: Point, radius: number) => Promise<Thing[]>
  windowAt: (p: Point) => Promise<{ frame?: Rect; vaultite?: boolean; private?: boolean } | null>
  /** The focused element: whether it's a field, a password's, Vaultite's own, its frame. */
  focus: () => Promise<{ editable?: boolean; secure?: boolean; vaultite?: boolean; frame?: Rect } | null>
  /** A private app is in front: nothing of it is kept. */
  privateNow: () => boolean
  /** The keeping looked at again (a lesson keeps the timeline on, and the keys' names told). */
  refollow: () => void
  /** Hands-free listening for their words while it watches, or not. */
  listening: (on: boolean) => void
  deliver: (l: { acts: Act[]; about?: string; as?: As; title?: string }) => Promise<string>
  hint: (text: string) => void
  draw: () => void
}
let host: TeachHost | null = null
let lesson: { since: number; about: string; as?: As; timer: ReturnType<typeof setTimeout> } | null = null
let saving = false
/** The longest lesson: past it, what was shown is made into one anyway. */
const LESSON_MOST_MS = 10 * 60_000
/** Typing in a field this long still: what it says is read. */
const SETTLE_MS = 1200
const DOING: Kind[] = [...ACTS]

export function teachHost(h: TeachHost) { host = h }
export const watching = () => !!lesson
/** Shortcuts and fields are kept while what's done is: the timeline on, or a lesson. */
export const keepsActs = () => !!lesson || timelineOn()
/** A lesson as the island shows it (as a QA walk, screenisland.tsx): listening or not, its steps so far, making it. */
export function lessonScene(): WalkScene | null {
  if (!lesson && !saving) return null
  return { of: "lesson", state: saving ? "sending" : listeningNow ? "on" : "paused", count: steps, since: lesson?.since ?? Date.now(), clips: false }
}
/** Its chip's buttons: done (make it), cancel (forget it). */
export function lessonAct(what: string) {
  if (what === "done") void finish(undefined, true)
  else if (what === "cancel") stop("Forgot that lesson")
}
let steps = 0

// ---------- hands-free, while it watches (helper.ts listens for whoever wants it)

let listeningNow = false, deaf = false, heardSince = 0
export const teachListens = () => !!lesson && !deaf
export function teachListening(on: boolean) { listeningNow = on; host?.draw() }
export function teachPending(text: string) { if (!heardSince && text.trim()) heardSince = Date.now() - 700 }
/** Their words, a sentence at a time: narration on the timeline from when they began, or what ends the lesson. */
export function teachFinal(text: string) {
  const at = heardSince || Date.now() - 1500
  heardSince = 0
  for (const s of text.replace(/\s+/g, " ").trim().match(/[^.!?]+(?:[.!?]+|$)/g) ?? []) if (s.trim()) teachSaid(s.trim(), at)
}
/** The microphone didn't start: it goes on watching, without their words. */
export function teachDeaf(why: string) { deaf = true; listeningNow = false; host?.hint(`Can't hear you (${why}): still watching, say "that's it" with the Talk key`); host?.draw() }

// ---------- their words

/** A Talk key's words (`at`: when its key went down): a lesson's command, or narration while one is on (kept on the
 *  timeline as said, never an ask). False: an ask like any. */
export function teachHeard(text: string, at: number) {
  const c = teachCommand(text, !!lesson)
  if (lesson) {
    if (c?.do === "done") void finish()
    else if (c?.do === "cancel") stop("Forgot that lesson")
    else if (c?.do === "last") void finish(c.as)
    else host?.hint("Noted")
    return true
  }
  if (!c || saving) return false
  if (c.do === "start") begin(c.rest, at)
  else if (c.do === "last") void fromLast(c.as, c.rest)
  else return false
  return true
}
/** A sentence heard hands-free while it watches: narration, or what ends it. */
export function teachSaid(text: string, at: number) {
  if (!lesson) return
  const c = teachCommand(text, true)
  if (c?.do === "done") return void finish()
  if (c?.do === "cancel") return stop("Forgot that lesson")
  if (c?.do === "last") return void finish(c.as)
  happened({ t: Math.max(at, lesson.since + 1), kind: "said", text })
}

function begin(about: string, at: number) {
  if (!host) return
  if (!host.trusted()) { host.hint("To learn by watching, allow Vaultite in Accessibility (System Settings, Privacy & Security)"); return }
  lesson = { since: at, about: about.replace(/[.!?]+$/, ""), timer: setTimeout(() => { host?.hint("That's ten minutes: making what you showed me"); void finish() }, LESSON_MOST_MS) }
  steps = 0
  deaf = false
  heardSince = 0
  host.refollow()
  host.listening(true)
  host.hint("Watching: show me, then say \"that's it\"")
  host.draw()
}
function stop(said?: string) {
  if (!lesson) return
  clearTimeout(lesson.timer)
  lesson = null
  listeningNow = false
  host?.listening(false)
  host?.refollow()
  if (said) host?.hint(said)
  host?.draw()
}
async function finish(as?: As, byChip = false) {
  const l = lesson
  if (!l || !host) return
  await settleTyping()
  const r = await queryTimeline({ from: l.since, kinds: DOING }), now = Date.now()
  stop()
  if (!r.ok) return host.hint(`Couldn't keep what you showed me: ${r.why}`)
  // (Done pressed on the island: that click isn't a step)
  const acts = (r.events as Act[]).filter((a) => !(byChip && a.kind === "click" && a.t > now - 1500))
  await deliver({ acts, ...(l.about ? { about: l.about } : {}), ...(as ?? l.as ? { as: as ?? l.as } : {}) })
}
/** "Make what I just did a skill": the timeline's last minutes, back to their last pause. */
async function fromLast(as: As | undefined, title: string) {
  if (!host) return
  if (!timelineOn()) return host.hint("I wasn't watching: say \"watch me\" first, or turn on Keep a timeline in the companion's settings")
  await settleTyping()
  const r = await queryTimeline({ last: 300, kinds: DOING })
  if (!r.ok) return host.hint(`Nothing kept: ${r.why}`)
  await deliver({ acts: recentStretch(r.events as Act[]), ...(as ? { as } : {}), ...(title ? { title } : {}) })
}
async function deliver(l: Parameters<TeachHost["deliver"]>[0]) {
  saving = true
  host!.draw()
  try { host!.hint(await host!.deliver(l)) } catch (e) { host!.hint(`Couldn't make it: ${(e as Error).message.replace(/^nothing to learn from: /, "nothing to learn from, ")}`) } finally { saving = false; host!.draw() }
}

// ---------- what's done, on the thing it acted on

const toEl = (t: Thing): El => ({ role: t.role, label: t.label.replace(/\s+/g, " ").trim().slice(0, 120), frame: t.frame, ...(t.inside.length ? { inside: t.inside.slice(0, 3) } : {}) })
/** The thing a click at `p` was on, and its window's frame: what a lesson's step finds again. */
export async function clickedAt(p: Point): Promise<{ el?: El; window?: Rect }> {
  if (!host || !keepsActs()) return {}
  await settleTyping()
  if (lesson) steps++
  const [things, w] = await Promise.all([host.things(p, 120).catch(() => []), host.windowAt(p).catch(() => null)])
  if (w?.private) return {}
  const t = clickedThing(things, p)
  return { ...(t ? { el: toEl(t) } : {}), ...(w?.frame ? { window: w.frame } : {}) }
}
/** A shortcut or Return, Tab, Esc (screen.swift names only those): after the field it ends. */
export async function keyHeard(key: string) {
  if (!keepsActs() || host?.privateNow()) return
  const t = Date.now()
  await settleTyping()
  if (lesson && key !== "tab") steps++
  happened({ t, kind: "key", key })
  host?.draw()
}

/** Typing under way: the field it's in (found as it began), when it began, till it settles. */
let typing: { t: number; field: Promise<{ el: El; frame: Rect; window?: Rect } | null>; timer: ReturnType<typeof setTimeout> } | null = null
/** A key was typed (never which): the field's value is read once it's still. */
export function typedHeard() {
  if (!host || !keepsActs() || host.privateNow()) return
  if (typing) { clearTimeout(typing.timer); typing.timer = setTimeout(() => void settleTyping(), SETTLE_MS); return }
  typing = { t: Date.now(), field: fieldNow(), timer: setTimeout(() => void settleTyping(), SETTLE_MS) }
}
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
const off = (a: Rect, b: Rect) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height)
/** The focused field as the ui model has it (never a password's, a private app's or Vaultite's own). */
async function fieldNow() {
  const f = await host!.focus().catch(() => null)
  const frame = f?.frame
  if (!f?.editable || f.secure || f.vaultite || !frame || host!.privateNow()) return null
  const [things, w] = await Promise.all([host!.things(centre(frame), 60).catch(() => []), host!.windowAt(centre(frame)).catch(() => null)])
  const t = things.filter((x) => x.label.trim() && off(x.frame, frame) < 40).sort((a, b) => off(a.frame, frame) - off(b.frame, frame))[0]
  return t ? { el: toEl(t), frame, ...(w?.frame ? { window: w.frame } : {}) } : null
}
/** The field typed in, as it says now: on the timeline at when the typing began. */
async function settleTyping() {
  const x = typing
  if (!x || !host) return
  typing = null
  clearTimeout(x.timer)
  const f = await x.field
  if (!f) return
  const things = await host.things(centre(f.frame), 60).catch(() => [] as Thing[])
  const now = things.filter((t) => t.role === f.el.role && off(t.frame, f.frame) < 60).sort((a, b) => off(a.frame, f.frame) - off(b.frame, f.frame))[0]
  happened({ t: x.t, kind: "field", el: f.el, value: keptValue(now?.state.value ?? ""), ...(f.window ? { window: f.window } : {}) })
  host.draw()
}
export function stopTeach() { if (lesson) clearTimeout(lesson.timer); if (typing) clearTimeout(typing.timer); lesson = null; typing = null }
