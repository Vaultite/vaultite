import { app, screen } from "electron"
import fs from "node:fs"
import path from "node:path"
import { TAP_MS, talkGesture, type FnEvent, type TalkAction } from "../core/fnkey.ts"
import { keyOf } from "./cursorhandoff.ts"
import { onScreen, placeKey } from "./cursorplaces.ts"
import { besidePointer, drawnShapes, inkOf, offsetIn, type Point, trailStrokes } from "./helperlogic.ts"
import { captureHeard, recordingNow, regionDrag, regionRect } from "./capture.ts"
import { knockSaid, toPresence } from "./knockhelper.ts"
import { closePanel, cue as playCue, drawingUp, endDrawing, openPanel, panelOpen, type PanelData } from "./overlay.ts"
import { type Press, pressLog } from "./presslog.ts"
import { pressMachine, type Phase } from "./pressmachine.ts"
import type { AppWindowInfo, Rect } from "./screen.ts"
import { talkState } from "./talkstate.ts"
import { teachHeard } from "./teach.ts"
import { happened } from "./timeline.ts"
import { offerHeard } from "./timelineoffer.ts"
import { takeoverEnded, takeoverOffering } from "./takeover.ts"
import { walkHeard } from "./walk.ts"
import { asked, QUIET, screenAsk, screenDo } from "./helperask.ts"
import { type ScreenEvent, WINDOW } from "./screenwire.ts"
import { based, BUSY, draw, type Exchange, front, HELD, hidden, hint, host, notice, prefs, type Summon, dictating, stopFor } from "./helperbase.ts"
import { closeShot, inAppSpots, leave, park, pointedAt, shotAt, shotChanged, underAt } from "./helperat.ts"
import { live } from "./helperlive.ts"
import { listenFor, session, starting, startingTalk, act } from "./helpersession.ts"
import { drawingSeen, drawn, lastAskIs, pressed, speaker, speakingNow, stopVoice, voiceFront } from "./helpervoice.ts"

/** The Talk keys: the companion summoned at the pointer (HeyClicky's gesture, core/fnkey.ts talkGesture). */
let up: { quietForCall: () => boolean; chatOf: (name: string) => PanelData | null; openChat: (name: string, at: Point, travels?: boolean) => void
  drawnAt: (key: string) => Point | undefined }
export const talkHost = (h: typeof up) => { up = h }
const quietForCall = () => up.quietForCall()
const chatOf = (name: string) => up.chatOf(name)
const openChat = (name: string, at: Point, travels?: boolean) => up.openChat(name, at, travels)
const drawnAt = (key: string) => up.drawnAt(key)
export const saidInBoxIs = (t: number) => { saidInBox = t }
export function holdAppear(hold: boolean) { if (hold) heldAppear ??= []; else { const due = heldAppear ?? []; heldAppear = null; for (const fn of due) fn() } }

const gesture = talkGesture()
/** What each press of the Talk key did, a day at a time beside the app's own (presslog.ts); `press`: the latest. */
export const presses = pressLog(() => path.join(app.getPath("userData"), "talk"), "talk")
let press: Press | null = null
const MISSED_MS = 2400
/** A press of the Talk key that went nowhere (`why`, logged): its cursor says so a moment (`words`) with a soft cue,
 *  then goes (or rides on, its exchange on); its audio is kept beside the log, to hear again. Never silence. */
export function missed(s: Summon | null, why: string, words = "Didn't catch that") {
  endMissed(s, why)
  if (!s || summon !== s || !s.m.send("miss", why)) return draw()
  s.missed = words
  cue("missed")
  draw()
  setTimeout(() => {
    if (summon !== s || s.m.phase !== "missed") return
    s.missed = undefined
    if (exchange) s.m.send("shown")
    else closeSummon(s, "missed shown")
    draw()
  }, MISSED_MS)
}
function endMissed(s: Summon | null, why: string) {
  const kept = s?.press && !s.press.ended() ? keepAudio(s.press.id) : null
  s?.press?.end("missed", { why, ...(kept ? { audio: kept } : {}) })
}
/** Held, but nothing hears any more (the recognizer didn't start, or stopped): its cursor says so till it's let go, then
 *  what was heard goes (`heard`), else it's missed. Never sent while held. */
export function failed(s: Summon, why: string, words: string, heard = "") {
  if (!heard) endMissed(s, why)
  if (!s.m.send("fail", why)) return
  Object.assign(s, { missed: words, heard })
  cue("missed")
  draw()
}
/** A summon over (its exchange ended, its miss shown, cancelled, a new press): its machine closed, the cursor gone. */
export function closeSummon(s: Summon, why: string) {
  s.m.send("close", why)
  if (summon === s) summon = null
}
/** The last press's audio (dictation.ts keeps it in the logs), copied beside the log as `<press>.wav`; the last few kept. */
function keepAudio(id: string) {
  try {
    const from = path.join(app.getPath("logs"), "dictation-last.wav"), dir = path.join(app.getPath("userData"), "talk")
    if (!fs.existsSync(from) || Date.now() - fs.statSync(from).mtimeMs > 60_000) return null
    fs.mkdirSync(dir, { recursive: true })
    const to = path.join(dir, `${id}.wav`)
    fs.copyFileSync(from, to)
    const wavs = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const w of wavs.slice(10)) fs.rmSync(path.join(dir, w.f), { force: true })
    return to
  } catch { return null }
}
/** A held press's cursor shows a moment after it (a shortcut's press shows nothing). A test holds the moment
 *  (vaultiteHelper.holdAppear), so a stalled runner never shows the cursor before its check looks. */
let heldAppear: (() => void)[] | null = null
const appear = (fn: () => void) => void (heldAppear ? heldAppear.push(fn) : setTimeout(fn, 130))
export let summon: Summon | null = null
export let exchange: Exchange | null = null
/** A Talk key (alone, or a chord), as its gesture: the companion summoned at the pointer, in any app and in Vaultite's
 *  windows alike (one companion, over the screen: the page never gets the key). */
export function talkHeard(m: FnEvent) {
  // (Control's double tap: no Talk key is Control)
  if (!host?.home() || "double" in m) return
  const now = "t" in m && m.t ? m.t : Date.now(), kind = "other" in m ? "other" : m.down ? "down" : "up"
  // (hands-free that ended by itself (its box closed, silence): the next press is a press again, not half a double tap)
  if (kind === "down" && gesture.state === "free" && session?.into !== "panel" && !freeStarting) gesture.reset()
  const a = "other" in m ? gesture.other() : m.down ? gesture.down(now) : gesture.up(now)
  if (kind === "down" && gesture.state === "bounce") {
    // (pressed again just after a send: a bounce of the chord unless still held a tap's time on; nothing stops meanwhile)
    const p = bounced = presses.start("talk", "down", { front: front?.bundle ?? "", bounce: true })
    setTimeout(() => { if (bounced === p && gesture.held() === "listen") { bounced = null; press = p; p.step("held"); pressed(); talkAct("listen") } }, TAP_MS)
    return
  }
  if (kind !== "down" && bounced) { const p = bounced; bounced = null; if (gesture.state === "idle") return void p.end("ignored", { gesture: "bounce" }) }
  if (kind === "down") pressed()
  // (each press logged, what it did or that it did nothing: presses that go nowhere can be traced)
  if (a === "listen") press = presses.start("talk", "down", { front: front?.bundle ?? "" })
  else if (kind === "down" && !a) presses.start("talk", "down", { front: front?.bundle ?? "" }).end("ignored", { gesture: gesture.state })
  else press?.step(kind, { action: a ?? "none" })
  if (!a) return
  talkAct(a)
}
/** A press that may still turn out a bounce (core/fnkey.ts talkGesture), logged as one. */
let bounced: Press | null = null
function talkAct(a: NonNullable<TalkAction>) {
  if (a === "listen") return act("start", true)
  if (a === "cancel") { void inkOff(); press?.end("cancelled", { why: "another key with it" }); return act("cancel", true) }
  if (a === "send") {
    // (hands-free in its box: what's in it goes; held: let go here, it thinks here)
    if (session?.into === "summon" || (starting && startingTalk)) {
      if (summon?.m.send("up")) { Object.assign(summon, { p: screen.getCursorScreenPoint(), released: Date.now() }); summon.place = gather(summon); if (!recordingNow()) voiceFront.release(whereOf(summon)) }
      // (something to send, said or drawn: it's heard as it's let go)
      if (summon && ((session && (session.finals.length || session.pending.trim())) || trailStrokes(summon.trail, Date.now()).length)) cue("sent")
      void inkOff(); draw()
    }
    // (let go with nothing listening: it never started or stopped early, and nothing's coming of it)
    else if (!session && summon?.m.phase === "listening") { void inkOff(); return missed(summon, "no recognizer running at let-go") }
    // (held after the recognizer stopped: what it heard goes now, else it's missed)
    else if (summon?.m.phase === "failed") {
      const s = summon
      void inkOff()
      if (!s.heard) return missed(s, "nothing heard: the recognizer had stopped", s.missed)
      s.m.send("up")
      Object.assign(s, { p: screen.getCursorScreenPoint(), released: Date.now() })
      s.place = gather(s)
      return void sendSummon(s, s.heard)
    }
    return act("stop", true)
  }
  if (a === "type") {
    // (a tap: its box, focused, to type in; nothing heard)
    summon?.m.send("tap")
    press?.end("typed")
    void inkOff()
    act("cancel", true)
    return openTyping()
  }
  void freeTalk()
}
/** A Talk key held: its cursor at the pointer, listening, the words by it; the pointer leaves a trail
 *  meanwhile (drags too: the screen helper keeps them from the app). */
export async function startSummon() {
  // (the server's socket reconnecting (a restart): it's asked again at once, and the press waits a moment for it)
  if (!live.state.name) { live.now(); for (let i = 0; i < 30 && !live.state.name && press && !press.ended(); i++) await new Promise((r) => setTimeout(r, 50)) }
  const name = live.state.name
  if (live.state.mode === "off") { press?.end("dropped", { why: "the companion is off" }); return notice("off", "The companion is off", "Turn it on in the companion's settings to talk to it.") }
  if (!name) { press?.end("dropped", { why: "no companion yet" }); return hint("The companion isn't ready yet: open Vaultite") }
  const p = screen.getCursorScreenPoint(), at = Date.now(), own = live.state.agents.get(name)
  const mine = press
  const m = pressMachine({ log: (t) => mine?.after("state", t), stuck: (phase) => stuck(s, phase) })
  const s: Summon = { name, tint: own?.tint ?? "orange", p, w: null, m, trail: [], at, was: own ? placeKey(own) : "", press }
  // (one still sending goes on to be sent, then closes: a newer press has the cursor)
  if (summon && summon.m.phase !== "sending") closeSummon(summon, "a new press")
  summon = s
  s.down = shotAt(p).then((r) => r.shot, () => null)
  live.say({ t: "summoning" })
  // (a press that's a shortcut shows nothing: it appears after a moment)
  appear(() => { s.appeared = true; draw() })
  void screenDo("ink", { on: true })
  void screenAsk("at", { x: p.x, y: p.y }, WINDOW).then((w) => { s.w = w.window ? w : null }, () => {})
  draw()
  // (its realtime turn begins now: a let-go while the last press's words finish is this one's)
  // (while it records, their words are narration: the realtime voice never answers them)
  if (!recordingNow()) voiceFront.press(s)
  // (pressed again as its last words are still being finished (or it speaks): those go first, then this one listens)
  for (let i = 0; i < 60 && session?.into === "summon"; i++) await new Promise((r) => setTimeout(r, 25))
  if (session?.into === "summon") s.press?.step("took over a press still finishing")
  await listenFor({ into: "summon", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true, of: s })
}
export const inkOff = () => screenDo("ink", { on: false }).catch(() => {})
/** A press stuck in a phase past its limit (pressmachine.ts LIMITS): held 10 min (a lost key-up), let go with nothing
 *  sent, or asked with no turn begun. Its cursor never stays stuck. */
function stuck(s: Summon, phase: Phase) {
  s.press?.after("stuck", { phase })
  if (phase === "listening") { s.m.send("stuck"); if (session?.of === s) stopFor(session.sink, true); void inkOff(); if (summon === s) summon = null; return draw() }
  missed(s, `stuck ${phase}`, phase === "thinking" ? "No answer came" : "Something went wrong")
  if (phase === "thinking") setTimeout(() => { if (summon === s) endExchange(false) }, MISSED_MS + 50)
}
/** A drag while the Talk key is held: a box (capture.ts), the pointer leaving no trail meanwhile. */
export let inkDown = false
export function inkHeard(m: Extract<ScreenEvent, { event: "ink" }>) {
  const s = summon, phase = m.phase, p = { x: m.x, y: m.y }
  if (phase === "up") inkDown = false
  if (!s || !HELD.has(s.m.phase) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
  if (phase === "down") inkDown = true
  regionDrag(phase, p, s.tint)
}
/** A click while the Talk key is held (screen.swift let it go on to the app): what was clicked, for its ask. */
export function heldClick(p: Point) {
  const s = summon
  if (!s || !HELD.has(s.m.phase) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (s.clicks?.length ?? 0) >= 8) return
  ;(s.clicks ??= []).push(underAt(p).then((u) => u?.text ?? "", () => "").then((under) => ({ sx: Math.round(p.x), sy: Math.round(p.y), ...(under ? { under } : {}) })))
}
export function trailed(p: Point, t: number) {
  const s = summon
  if (!s || s.m.phase !== "listening" || inkDown) return
  s.trail.push({ x: p.x, y: p.y, t })
  if (s.trail.length > 400 || t - s.trail[0].t > 4000) s.trail = s.trail.filter((q) => t - q.t <= 4000).slice(-400)
}
/** The summoned companion's ask (`text`; none, a point at what its trail marks): about the point let go at, with what's
 *  there, the display's picture and what Accessibility finds near it; its answer comes in its box, open by it. */
export async function sendSummon(s: Summon, text: string, how: { front?: "realtime"; talk?: string[] } = {}) {
  if (captured(s, text)) return
  const ink = drawnShapes(inkOf(trailStrokes(s.trail, s.released ?? Date.now())))
  if (!text && !ink.length) return missed(s, "nothing heard nor drawn")
  draw()
  const { w, place } = await (s.place ?? gather(s))
  const clicks = await Promise.all(s.clicks ?? [])
  const win = w?.window && !w.vaultite && place.app !== "private" ? w : null
  if (win?.frame) park(s.name, win.window, offsetIn(win.frame, s.p))
  // (the realtime voice's press: its few words go on, this answer said after them)
  if (!how.front) stopVoice()
  const sent = live.say({ t: "moment", kind: text ? "ask" : "point", agent: s.name, ...(text ? { text } : {}), ...place, ...(ink.length ? { ink } : {}), ...(regionRect() ? { region: regionRect() } : {}), ...(clicks.length ? { clicks } : {}), voice: true, ...(s.released ? { keyUp: s.released } : {}),
    ...(how.front ? { front: how.front, ...(how.talk?.length ? { talk: how.talk } : {}) } : {}) })
  if (!sent) return missed(s, "Vaultite's server isn't connected", "Can't reach Vaultite")
  s.press?.end("sent", { chars: text.length, drew: ink.length, shot: !!place.shot, ...(how.front ? { front: how.front } : {}) })
  s.m.send("sent")
  if (summon !== s) s.m.send("close", "a newer press")
  if (s.press) lastAskIs({ press: s.press, up: s.released ?? Date.now() })
  askedAloud = true
  // (held again in an exchange: the same thread)
  openAnswer(s.name, s.p, w?.window ? w : null, exchange?.name === s.name ? exchange.since : s.at)
}
/** Words for region capture (record this, stop, that just now; anything while it records is narration): handled
 *  there, never an ask. */
export function captured(s: Summon, text: string) {
  if (text && !s.told) { s.told = true; happened({ t: s.at, kind: "said", text }) }
  // (the app's: a QA walk's words, capture's, a short answer to a knock by the notch ("not now"), words over a session
  // there)
  const why = !text ? "" : offerHeard(text) ? "offer" : walkHeard(text, s.at) ? "walk" : teachHeard(text, s.at) ? "teach" : captureHeard(text, s.at) ? "capture" : knockSaid(text) ? "knock" : toPresence(text, s.p) ? "session" : ""
  if (!why) return false
  voiceFront.stop()
  s.press?.end(why)
  closeSummon(s, why)
  draw()
  return true
}
/** The window at the point let go at and what's there (pointedAt), its cursor left there only once it's asked. */
async function gather(s: Summon) {
  const w = s.w ?? await screenAsk("at", { x: s.p.x, y: s.p.y }, WINDOW).catch(() => null)
  // (its closer look taken with its picture, not after: the ask waits for neither)
  const drawn = drawnShapes(inkOf(trailStrokes(s.trail, s.released ?? Date.now()))).map((k) => k.box)
  const [place, close] = await Promise.all([pointedAt(s.name, s.p, w?.window ? w : null, false), closeShot(s.p, drawn)]), down = await s.down
  if (close && place.shot && place.app !== "private") place.closeUp = close
  // (the screen changed as they spoke: the picture from the key-down too, what they meant may be only there)
  if (down && place.shot && place.app !== "private" && shotChanged(down, { file: String(place.shot), frame: place.shotAt as Rect })) Object.assign(place, { shotDown: down.file, shotDownAt: down.frame })
  return { w, place }
}
/** Where a summon is, as words for the realtime voice (it never sees the screen): the app and its window's title. */
function whereOf(s: Summon) {
  const w = s.w, drew = drawnShapes(inkOf(trailStrokes(s.trail, s.released ?? Date.now()))).length > 0
  const app = w && !w.vaultite ? (hidden(w) ? "a private app" : `${w.name}${w.title ? `, its window "${w.title.slice(0, 120)}"` : ""}`) : ""
  return app || drew ? `(Where they are: ${app || "their screen"}${drew ? "; they drew on the screen as they spoke" : ""}.)` : undefined
}
/** A tap: its box at the pointer, focused, to type the ask in (its answer's box already up: into its field). */
function openTyping() {
  const name = live.state.name
  if (!name) return
  const p = summon?.p ?? screen.getCursorScreenPoint(), w = summon?.w ?? null
  if (exchange?.name === name && panelOpen() === name) { const d = chatOf(name); if (d && based) openPanel(based, besidePointer(screen.getCursorScreenPoint(), screen.getDisplayNearestPoint(p).bounds), d, true, true); return }
  openChat(name, p, !!summon)
  if (panelOpen() !== name) return
  exchange = { name, p, w, since: Date.now() }
  void screenDo("exchange", { on: true })
}
/** A double tap: hands-free, into its box, till the next double tap. */
async function freeTalk() {
  if (panelOpen() !== live.state.name) openTyping()
  freeStarting = true
  try {
    for (let i = 0; i < 20 && dictating(); i++) await new Promise((r) => setTimeout(r, 50))
    if (panelOpen()) await listenFor({ into: "panel", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true }, talk: true })
  } finally { freeStarting = false }
}
let freeStarting = false
/** Its answer's box, by where it was asked, unfocused till clicked (spoken: none, its voice says it): typing there, or
 *  holding the key again, goes on; Esc ends it, a click elsewhere or another app moves on (moveOn). */
export function openAnswer(name: string, p: Point, w: AppWindowInfo | null, since: number) {
  if (!based) return
  // (an answer said aloud needs no box: the box comes only by a tap of the key)
  const spoken = prefs.voice.mode !== "off" && !quietForCall()
  exchange = { name, p, w, since, ...(spoken ? { spoken } : {}) }
  void screenDo("exchange", { on: true })
  if (spoken) return draw()
  answerBox()
}
export function answerBox() {
  if (!based || !exchange) return
  const d = chatOf(exchange.name)
  if (!d) return
  // (it travels with the companion beside the pointer; its field is there, the keyboard left with their app)
  const now = screen.getCursorScreenPoint()
  openPanel(based, besidePointer(now, screen.getDisplayNearestPoint(now).bounds), d, false, true)
  draw()
}
export function answerArrived() {
  const x = exchange
  if (!x || x.arrived) return
  x.arrived = true
  if (summon?.name === x.name) summon.m.send("arrived")
  cue("answer")
}
/** A soft cue (the companion's `sounds`; a scripted copy only notes it). */
export function cue(name: "listen" | "sent" | "answer" | "missed" | "knock") {
  // (on a call, none: the call would hear them)
  if (QUIET) return void asked.push({ cue: name, ...(quietForCall() ? { quiet: true } : {}) })
  if (prefs.sounds && !quietForCall()) playCue(name)
}
/** The exchange over (Esc; `stop`: its voice too): its box closed, its cursor gone (at once when it's done; else once it is). */
export function endExchange(stop = true) {
  // (Esc: its words and its turn on them stop)
  if (stop) { stopVoice(); live.say({ t: "interrupt" }) }
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
  if (!exchange && !summon) return
  const name = exchange?.name ?? summon?.name
  exchange = null
  if (summon) closeSummon(summon, stop ? "esc" : "over")
  takeoverEnded()
  inAppSpots.clear()
  const a = name ? live.state.agents.get(name) : undefined
  if (a && onScreen(a) && a.state === "watching") leave(a.name)
  if (name) endDrawing(name, stop)
  gesture.reset()
  void screenDo("exchange", { on: false }).catch(() => {})
  if (panelOpen()) closePanel()
  draw()
}
/** They clicked elsewhere, went to another app, or its box closed: the box goes, but a spoken answer goes on to its end
 *  (only the Talk key, Esc or a new ask stop it), its cursor leaving once it's said (settle). */
export function moveOn() {
  // (held: the press is theirs, a drag its trail)
  if (summon && HELD.has(summon.m.phase)) return
  if (talkNow().answering) { if (panelOpen()) closePanel(); return draw() }
  endExchange(false)
}
const LINGER_MS = 1500
let settleTimer: ReturnType<typeof setTimeout> | null = null
/** A spoken exchange done (its words said to their end, its turn over), its box not open: a moment on, its cursor leaves. */
export function settle() {
  const x = exchange
  const done = (): boolean => !!x && exchange === x && !talkNow().answering && panelOpen() !== x.name && !(summon && HELD.has(summon.m.phase)) && (x.arrived || !!summon?.begun) &&
    !(drawn?.agent === x.name && drawingUp(drawn.id) && Date.now() < drawingSeen)
  if (!x?.spoken || settleTimer || !done()) return
  settleTimer = setTimeout(() => { settleTimer = null; if (done()) endExchange(false); else settle() }, LINGER_MS)
}
/** An ask typed (or said) in its conversation: about the point of its exchange, else where its cursor is on screen,
 *  else the pointer. */
export async function askFrom(name: string, text: string) {
  if (walkHeard(text) || teachHeard(text, Date.now())) { saidInBox = 0; return }
  const a = live.state.agents.get(name), x = exchange?.name === name ? exchange : null
  const p = x?.p ?? (a && onScreen(a) ? drawnAt(keyOf(a)) : undefined) ?? screen.getCursorScreenPoint()
  const w = x ? x.w : await screenAsk("at", { x: p.x, y: p.y }, WINDOW).catch(() => null)
  // (said into its box a moment ago: spoken; typed, its answer stays silent unless its voice is always on)
  const said = Date.now() - saidInBox < 60_000
  saidInBox = 0
  stopVoice()
  askedAloud = said
  live.say({ t: "moment", kind: "ask", agent: name, text, ...(await pointedAt(name, p, w?.window ? w : null)), summoned: true, ...(said ? { voice: true } : {}) })
  if (!x) { exchange = { name, p, w: w?.window ? w : null, since: Date.now() }; void screenDo("exchange", { on: true }) }
}
/** When words were last said into a cursor's box: the ask they make is a spoken one. */
export let saidInBox = 0
/** The last ask was spoken (its answer is said aloud, as the setting `voice` is `auto`). */
export let askedAloud = false
export function talkNow() {
  const x = exchange, s = summon, a = x ? live.state.agents.get(x.name) : undefined
  return talkState({ session: !!session, starting, box: !!panelOpen(), level: !!speakingNow, saying: speaker.saying(), realtime: voiceFront.speaking(),
    press: s ? { phase: s.m.phase, begun: !!s.begun, ofExchange: s.name === x?.name } : null,
    exchange: x ? { spoken: !!x.spoken, working: !!a && BUSY.has(a.state) } : null, offering: takeoverOffering() })
}
