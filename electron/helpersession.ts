import { app, clipboard, type WebContents } from "electron"
import path from "node:path"
import { joinText } from "../core/dictationtext.ts"
import { fnKey, HOLD_MS, type FnAction } from "../core/fnkey.ts"
import type { AppWindow } from "./appwindow.ts"
import type { DictationSink, Roam } from "./dictation.ts"
import { land, landedSaid } from "./dictationroam.ts"
import { micSaid } from "./miclogic.ts"
import { panelFocused, type PanelData } from "./overlay.ts"
import { type Press, pressLog } from "./presslog.ts"
import { teachDeaf, teachFinal, teachListening, teachListens, teachPending } from "./teach.ts"
import { endWalk, walkFinal, walkListening, walkListens, walkPending } from "./walk.ts"
import { QUIET, screenAsk, screenAsked, stubs } from "./helperask.ts"
import { FOCUS, INSERTED } from "./screenwire.ts"
import type { DictationMessage } from "./dictation.ts"
import type { Prefs } from "./helperprefs.ts"
import { dictate, dictating, dictationEngines, draw, freeFor, front, handOver, HELD, hidden, hint, host, keptLanded, notice, op, DONE, prefs, releaseMic, type Session, stopFor, type Summon } from "./helperbase.ts"
import { askPage, backWhereItBegan, dropOrigin, following, followFix } from "./helperlearn.ts"
import { live } from "./helperlive.ts"
import { frontedIs, speaker, stopVoice, voiceFront } from "./helpervoice.ts"

let up: { readonly summon: Summon | null; saidInBox: number
  talkNow: () => { listening: boolean; pressing: boolean; answering: boolean; speaking: boolean }
  startSummon: () => Promise<void>; failed: (s: Summon, why: string, words: string, heard?: string) => void; inkOff: () => void
  missed: (s: Summon | null, why: string, words?: string) => void; closeSummon: (s: Summon, why: string) => void
  captured: (s: Summon, text: string) => boolean; sendSummon: (s: Summon, text: string, how?: { front?: "realtime"; talk?: string[] }) => Promise<void>
  quietForCall: () => boolean; chatChanged: (done?: PanelData["words"]) => void }
export const sessionHost = (h: typeof up) => { up = h }
const talkNow = () => up.talkNow()
const startSummon = () => up.startSummon()
const failed = (s: Summon, why: string, words: string, heard?: string) => up.failed(s, why, words, heard)
const inkOff = () => up.inkOff()
const missed = (s: Summon | null, why: string, words?: string) => up.missed(s, why, words)
const closeSummon = (s: Summon, why: string) => up.closeSummon(s, why)
const captured = (s: Summon, text: string) => up.captured(s, text)
const sendSummon = (s: Summon, text: string, how?: { front?: "realtime"; talk?: string[] }) => up.sendSummon(s, text, how)
const quietForCall = () => up.quietForCall()
const chatChanged = (done?: PanelData["words"]) => up.chatChanged(done)
export const pageIs = (p: WebContents | null) => { page = p }
export function stopListening() {
  for (const t of [freeTimer, holding]) if (t) clearInterval(t)
  freeTimer = holding = null
}

export const key = fnKey()
export let session: Session | null = null
/** The window's page that has this press (fn there is its ⌘J), till it's let go. */
export let page: WebContents | null = null
/** A session on its way (the field asked for, the recognizer starting): a release meanwhile waits for it. */
export let starting = false, startingTalk = false, after: FnAction = null
export function act(a: FnAction, talk = false) {
  if (a === "start") {
    starting = true
    startingTalk = talk
    after = null
    void (talk ? startSummon() : begin()).finally(() => { starting = false; startingTalk = false; const then = after; after = null; if (then) act(then) })
  } else if (starting && (a === "stop" || a === "cancel" || a === "free")) after = a
  else if (a === "free" && session) { session.free = true; freeFor(session.sink); session.log?.step("free"); draw() }
  else if (a === "stop" && session) stopFor(session.sink)
  else if (a === "cancel" && session) stopFor(session.sink, true)
}
/** The recognizer, as the page picks it (plugins/core/dictation): Parakeet for English when it's here, else Apple's. */
async function engineFor(s: Prefs["dictation"]) {
  const language = s.language?.trim() ?? ""
  if (s.engine === "apple" || s.engine === "parakeet") return { engine: s.engine, language }
  if (language && !/^en\b/i.test(language)) return { engine: "apple", language }
  const e: { parakeet: boolean; locale?: unknown } = await dictationEngines(language)
  return { engine: e.parakeet && (language || !e.locale || /^en\b/i.test(String(e.locale))) ? "parakeet" : "apple", language }
}
async function begin() {
  if (panelFocused()) return listenFor({ into: "panel", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: true } })
  // (kept: where its words go if no other field has them when it stops)
  const focus = await screenAsk("focus", { keep: true }, FOCUS)
  if (dictating()) return
  // (a password field gets nothing said; with no field it listens: one may be clicked by the time it stops)
  if (focus.field && focus.secure) return
  await listenFor({ into: "field", focus })
}
/** A window's session (or one with nowhere in it to go, `start`) carries on here, the words in the box: its page keeps
 *  where it began. The page's key goes with it. False: it can't, and the page does as it can. */
export function roamIn(win: AppWindow, sink: DictationSink, o: Roam) {
  if (session?.into === "field") { if (o.start) stopFor(session.sink); return !!o.start }
  if (session || starting) return false
  if (o.start) {
    if (!prefs.fn) return false
    page = null
    if (o.held) key.down(Date.now(), false)
    act("start")
    return true
  }
  const mine: Session = { sink: { tell: (e) => told(mine, e) }, into: "field", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: false }, finals: [], pending: o.pending ?? "", level: 0, ready: true,
    free: o.free, origin: win.webContents, log: dictations.start("dictation", "roam", { from: "window", ...(o.free ? { free: true } : {}) }) }
  if (!handOver(sink, mine.sink)) return false
  session = mine
  page = null
  // (still held: letting go stops it, however long it's been)
  if (o.held) key.down(Date.now() - HOLD_MS, false)
  draw()
  return true
}
export async function listenFor(o: Pick<Session, "into" | "focus" | "talk" | "of" | "free">) {
  // (a Talk key's is the companion's, whatever else listens: that ends, its words landing; other keys leave a session under way alone)
  // (hands-free listening gives way to any press, and comes back once it's done)
  if (session?.into === "free") { const was = session; session = null; freeBy?.listening(false); stopFor(was.sink) }
  if (dictating() && !o.talk && !(o.into === "free" && !session)) return
  if (session?.into === "field") { const was = session; session = null; void finish(was, false) }
  stopVoice()
  holdEnd()
  const s = prefs.dictation
  // (held over the screen: the realtime voice hears the microphone too)
  const tap = o.into === "summon" && prefs.realtime.front === "realtime" && !quietForCall() && voiceFront.available()
  const mine: Session = { sink: { tell: (e) => told(mine, e), ...(tap ? { audio: (b: Buffer) => voiceFront.audio(b) } : {}) }, ...o, finals: [], pending: "", level: 0, ready: false,
    ...(o.into === "field" ? { log: dictations.start("dictation", "start", { front: o.focus.bundle, field: !!o.focus.field }) } : {}) }
  session = mine
  draw()
  chatChanged()
  const how = await engineFor(s)
  // (a Talk key's audio is kept a while: a press that went nowhere can be heard again)
  // (an answer said aloud follows a Talk key's: a Bluetooth mic stays open till it's said, holdMic)
  const answered = mine.into === "summon" || !!mine.talk
  // (the Dictations list keeps a field's words, not a private app's; a Talk key's ask is the companion's to keep)
  const where = mine.into === "field" && !hidden(mine.focus) ? { kind: "app", ...(mine.focus.name ? { name: mine.focus.name } : {}), ...(mine.focus.bundle ? { bundle: mine.focus.bundle } : {}) } : false
  const r = await dictate(mine.sink, { ...how, silence: s.silence, keep: s.keep_audio === true || mine.into === "summon", ...(tap ? { tap } : {}),
    microphone: s.microphone, hold: answered, where })
  if (r.mic) { mine.bluetooth = r.mic.bluetooth; micTold(r.mic) }
  // (the recognizer that hears it: Soniox, or this Mac's and why not Soniox; one failing later logs stt-fallback; the mic
  // and why that one, mic-change should it go mid-press)
  if (mine.into === "summon") mine.of?.press?.step("stt", { engine: r.engine ?? how.engine, ...(r.why ? { why: r.why } : {}), ...(r.ok ? {} : { failed: r.code ?? "?" }),
    ...(r.mic ? { mic: r.mic.name, micWhy: r.mic.why, ...(r.mic.bluetooth ? { bluetooth: true } : {}) } : {}) })
  if (r.ok || session !== mine) return
  session = null
  const of = mine.into === "summon" ? mine.of : undefined, why = `the recognizer didn't start (${r.code ?? "?"})`
  // (still held: said so till it's let go; let go already: missed)
  if (of?.m.phase === "listening") failed(of, why, r.code === "permission" ? "Vaultite can't use the mic" : "The mic didn't start")
  else if (of?.m.phase === "sending") { void inkOff(); missed(of, why) }
  draw()
  chatChanged()
  if (r.code === "permission") notice("mic", "Vaultite isn't allowed to use the microphone", "Allow it in System Settings, Privacy & Security, Microphone.",
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone")
  else if (r.code === "model") notice("model", "Parakeet's model isn't on this Mac", "Handy or Hex downloads it, or pick Apple's recognizer in Dictation's settings.")
}
/** Who listens hands-free: the first that wants to, one at a time; its words go to it, never into a field or an ask. */
type FreeOwner = { wants: () => boolean; listening: (on: boolean) => void; pending: (text: string) => void; final: (text: string) => void; failed: (why: string) => void }
const freeOwners: FreeOwner[] = [
  { wants: walkListens, listening: walkListening, pending: walkPending, final: walkFinal, failed: (why) => void endWalk(true, why) },
  { wants: teachListens, listening: teachListening, pending: teachPending, final: teachFinal, failed: teachDeaf },
]
export let freeBy: FreeOwner | null = null
function freeTold(s: Session, e: DictationMessage) {
  const by = freeBy
  if (e.type === "start") { s.ready = true; by?.listening(true) }
  else if (e.type === "level") s.level = Number(e.v) || 0
  else if (e.type === "pending") { s.pending = String(e.text ?? ""); by?.pending(s.pending) }
  else if (e.type === "final") { s.pending = ""; by?.final(String(e.text ?? "")) }
  else if (e.type === "end") {
    session = null
    // (cut short: what it had heard counts)
    if (s.pending.trim()) by?.final(s.pending)
    by?.listening(false)
    freeTick()
  }
}
let freeTimer: ReturnType<typeof setInterval> | null = null, freeRetry = 0, freeFails = 0
/** While one wants it, it listens whenever nothing else has the microphone and nothing is said aloud (its answers would
 *  be heard as theirs); a press, a dictation or a spoken answer pauses it, and it comes back after. */
export function freeTick() {
  const want = (!QUIET || !!process.env.VAULTITE_DICTATION_FILE) ? freeOwners.find((o) => o.wants()) ?? null : null
  if (session?.into === "free" && freeBy !== want) stopFor(session.sink)
  if (!want) {
    if (freeTimer) clearInterval(freeTimer)
    freeTimer = null
    return
  }
  freeTimer ??= setInterval(freeTick, 700)
  const t = talkNow(), talking = t.speaking || t.pressing
  if (session?.into === "free") { if (talking) stopFor(session.sink); return }
  if (talking || session || dictating() || starting || Date.now() < freeRetry) return
  void listenFree(want)
}
async function listenFree(by: FreeOwner) {
  freeRetry = Date.now() + 1500
  freeBy = by
  await listenFor({ into: "free", focus: { bundle: "", name: "", pid: 0, window: 0, title: "", field: false }, free: true })
  if (session?.into === "free") { freeFor(session.sink); freeFails = 0; return }
  // (the mic didn't start: tried again a little later, and its owner told after a few)
  freeRetry = Date.now() + 5000
  if (++freeFails >= 3) { freeFails = 0; by.failed("the microphone didn't start") }
}
function told(s: Session, e: DictationMessage) {
  if (session !== s) return
  if (s.into === "free") return freeTold(s, e)
  const said = (t: unknown) => String(t ?? "")
  if (s.into === "summon" && (e.type === "start" || e.type === "error" || e.type === "end" || e.type === "fallback"))
    s.of?.press?.step(`stt-${e.type}`, { ...(e.reason ? { reason: e.reason } : {}), ...(e.code ? { code: e.code } : {}), ...(e.message ? { message: String(e.message).slice(0, 200) } : {}),
      ...(e.type === "end" ? { chars: s.finals.join(" ").length } : {}) })
  if (e.type === "mic") {
    // (its device gone or changed mid-press, it went on with the next; or the one picked wasn't there by the start)
    s.bluetooth = e.bluetooth === true
    if ((e.why || e.missing) && s.into === "summon") s.of?.press?.step("mic-change", { name: String(e.name ?? ""), why: String(e.why ?? "not there at the start"), ...(e.bluetooth ? { bluetooth: true } : {}) })
    if (e.why || e.missing) micTold({ name: String(e.name ?? ""), why: `${e.why ?? "the one picked wasn't there"}: went on with it` })
  } else if (e.type === "error" && s.into === "field") {
    s.failed = String(e.message ?? "the recognizer stopped")
    s.log?.step("error", { code: String(e.code ?? ""), message: s.failed.slice(0, 200) })
  } else if (e.type === "start") s.ready = true
  else if (e.type === "level") s.level = Number(e.v) || 0
  else if (e.type === "speech" && s.into === "summon") voiceFront.speech()
  else if (e.type === "pending") s.pending = said(e.text)
  else if (e.type === "final") { const t = said(e.text).trim(); if (t) s.finals.push(t); s.pending = "" }
  else if (e.type === "end") {
    session = null
    // (cut short: what it had heard counts)
    if ((e.reason === "error" || e.reason === "elsewhere") && s.pending.trim()) s.finals.push(s.pending.trim())
    s.log?.step("end", { reason: String(e.reason ?? "") })
    if (s.bluetooth) holdMic(s.of?.press ?? undefined)
    void finish(s, e.reason === "cancel")
  }
  draw()
  if (s.into === "panel") chatChanged()
}
async function finish(s: Session, cancelled: boolean) {
  const text = s.finals.reduce((all, t) => all + joinText(all, t), "").trim()
  if (s.into === "panel") {
    if (!cancelled && text) up.saidInBox = Date.now()
    return chatChanged(cancelled || !text ? undefined : { text, listening: false, done: true, ...(s.talk ? { send: true } : {}) })
  }
  if (s.into === "summon") {
    const m = s.of ?? up.summon
    if (!m || !HELD.has(m.m.phase) && m.m.phase !== "sending") return
    if (cancelled) { m.press?.end("cancelled"); closeSummon(m, "cancelled"); return draw() }
    // (the recognizer stopped while it's still held (an error, its silence): what it heard waits for the let-go)
    if (HELD.has(m.m.phase)) return failed(m, `the recognizer stopped while held${text ? "" : ", nothing heard"}`, "Stopped hearing you", text)
    // (the realtime voice gives its first sound: the summoned session is asked at once all the same, its answer said
    // after the realtime voice's few words, or dropped if it answered alone)
    if (captured(m, text)) return
    const front = voiceFront.heard(m, text)
    if (front === "done") { m.press?.end("realtime", { front: "talk" }); return }
    if (!front) return sendSummon(m, text)
    m.press?.step("realtime", { route: front === "held" ? "waiting" : "look" })
    frontedIs({ s: m })
    if (front === "held") speaker.hold()
    return sendSummon(m, text, { front: "realtime", talk: voiceFront.talk() })
  }
  if (cancelled || !text) {
    s.log?.end(cancelled ? "cancelled" : "nothing said")
    if (s.failed) hint(`Dictation stopped: ${s.failed}`)
    return dropOrigin(s)
  }
  following?.done()
  const to = await land(text, {
    // (a scripted copy's window never has the keyboard: a stub says it does)
    page: async (t) => { const p = host?.focusedPage() ?? (QUIET && stubs.has("page") ? host?.homeWindow()?.page : null); return p ? askPage(p, "here", t) : null },
    front: () => screenAsk("focus", {}, FOCUS),
    insert: (t) => screenAsk("insert", { text: t }, INSERTED),
    origin: (t) => backWhereItBegan(s, t),
    copy: (t) => { if (QUIET) screenAsked.push({ op: "copy", text: t }); else clipboard.writeText(t) },
    capture: async (t) => !!(await op("inbox.voice", { text: t, from: "Dictation", keep: true }, DONE)),
    secret: (f) => hidden(f) || hidden(s.focus),
  })
  s.log?.end("landed", { to: to.to, chars: text.length, ...(to.how ? { how: to.how } : {}), ...(to.to === "clipboard" ? { kept: !!to.kept } : {}) })
  keptLanded(s.sink, { to: to.to, name: to.to === "page" ? "Vaultite" : to.name, text, ...(to.kept ? { inbox: true } : {}) })
  dropOrigin(s)
  const said = landedSaid(to, s.focus.name)
  if (s.failed) hint(`Dictation stopped: ${s.failed}`)
  else if (said) hint(said)
  // (a private app's field is never read: not where they began, nor in front)
  if (to.text && !hidden(s.focus) && !(to.to === "front" && hidden(front)) && (to.to === "front" || (to.to === "origin" && !s.origin))) void followFix(to.text, to.to === "front" ? "front" : "kept", to.how === "paste")
}
/** What dictation logs, beside the Talk key's (no words: what happened, and where they went). */
const dictations = pressLog(() => path.join(app.getPath("userData"), "talk"), "dictation")
/** A Bluetooth mic stays open past its press (dictation.swift `hold`): closing it would take the headset out of its call
 *  profile ~2 s on, cutting the answer said meanwhile. Released once nothing is listened for, worked on or said, a moment on. */
let holding: ReturnType<typeof setInterval> | null = null
const HOLD_TAIL_MS = 1000, HOLD_MOST_MS = 60_000
function holdMic(press?: Press) {
  holdEnd()
  const since = Date.now()
  let quietFrom = 0
  holding = setInterval(() => {
    const t = talkNow(), busy = t.listening || t.pressing || t.answering || t.speaking
    if (busy) quietFrom = 0
    else quietFrom ||= Date.now()
    if (Date.now() - since < HOLD_MOST_MS && (busy || Date.now() - quietFrom < HOLD_TAIL_MS)) return
    holdEnd()
    releaseMic()
    press?.after("mic-release", { heldMs: Date.now() - since })
  }, 250)
}
function holdEnd() { if (holding) { clearInterval(holding); holding = null } }
/** The mic it hears with here and why, for its status (vau companion status), told when it changes. */
export let micSent = ""
export function micTold(m: { name: string; why: string }) {
  const said = micSaid(m)
  if (said === micSent) return
  micSent = said
  live.say({ t: "mic", mic: said })
}
