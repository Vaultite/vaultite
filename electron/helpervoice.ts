import { app } from "electron"
import { type Heard, heardBeats } from "../core/desktop/screenmarks.ts"
import { voiceOf } from "../core/desktop/spoken.ts"
import { type Drawing, elementPlaces } from "./drawing.ts"
import { answerAloud, beatsWait, drawingHold, type Point, type Scene } from "./helperlogic.ts"
import { markSampler } from "./marksampler.ts"
import { drawingUp, panelOpen, penSounds, showDrawing, showOverlay } from "./overlay.ts"
import type { Press } from "./presslog.ts"
import { realtimeFront } from "./realtimefront.ts"
import type { AppWindowInfo } from "./screen.ts"
import { takeoverOffering } from "./takeover.ts"
import { companionVoice } from "./voice.ts"
import { QUIET, screenAsk } from "./helperask.ts"
import { type Agent, based, BUSY, draw, type Exchange, expectedWords, hint, host, type Note, notice, prefs, prefsAre, type Summon } from "./helperbase.ts"
import { axThings, lastNear } from "./helperat.ts"
import { live } from "./helperlive.ts"

let up: { readonly exchange: Exchange | null; readonly summon: Summon | null; readonly askedAloud: boolean
  quietHeld: { name: string; asked: number } | null; replaying: string | null; lastScene: Scene | null
  quietForCall: () => boolean; unheard: (name: string, asked: number, why: "call" | "off" | "silent", detail?: string) => void
  keptQuiet: (name: string, asked: number) => void; boxAgain: () => void
  answerBox: () => void; openAnswer: (name: string, p: Point, w: AppWindowInfo | null, since: number) => void; settle: () => void }
export const voiceHost = (h: typeof up) => { up = h }
const quietForCall = () => up.quietForCall()
const unheard = (name: string, asked: number, why: "call" | "off" | "silent", detail?: string) => up.unheard(name, asked, why, detail)
const keptQuiet = (name: string, asked: number) => up.keptQuiet(name, asked)
const boxAgain = () => up.boxAgain()
const answerBox = () => up.answerBox()
const openAnswer = (name: string, p: Point, w: AppWindowInfo | null, since: number) => up.openAnswer(name, p, w, since)
const settle = () => up.settle()
export const drawnIs = (d: Drawing | null) => { drawn = d }
export const lastAskIs = (x: typeof lastAsk) => { lastAsk = x }
export const frontedIs = (x: typeof fronted) => { fronted = x }

export function pressed() { hushedBefore = takeoverOffering() ? hushed : null; stopVoice(); live.say({ t: "interrupt" }); speaker.warm(); voiceFront.warm(); lastAsk = null }
/** One line of the helper's own, said aloud as the voice setting says (an ask by voice: auto says it) and shown: in the
 *  dictation pill, or only on its card (`card`). */
export function sayHere(text: string, card = false) {
  if (!card) hint(text)
  const name = live.state.name
  if (!name || prefs.voice.mode === "off" || quietForCall()) return
  stopVoice()
  const id = `here-${Date.now()}`
  speaker.begin(text, undefined, false, null)
  speaker.text(id, text)
  speaker.end(id)
}
export const spoken: Record<string, unknown>[] = []
/** The press whose ask went last, and when its key was let go: its answer's first sound is logged with it (`sounded`),
 *  and what its voice went through. */
export let lastAsk: { press: Press; up: number; sounded?: boolean } | null = null
/** The languages the user speaks, likeliest first (two letters): dictation's hints, then the Mac's. */
const hints = () => [...new Set([...(Array.isArray(prefs.dictation.languages) ? prefs.dictation.languages.map(String) : []), ...app.getPreferredSystemLanguages()]
  .map((l) => l.split(/[-_]/)[0].toLowerCase()).filter((l) => /^[a-z]{2}$/.test(l)))]
export const speaker = companionVoice({
  port: () => host?.home()?.port ?? null,
  prefs: () => prefs.voice,
  hints,
  level: (on, v) => voiceLevel(on, v),
  heard: (h) => voiceHeardLine(h),
  // (the press's log: how long from letting the key go to the answer's first sound, a voice failing over, and its
  // output changing under it (said again from a little before))
  told: (e) => {
    voiceTrouble(e)
    if (e.t === "silent" && voiced) unheard(voiced.name, voiced.asked, "silent", e.why ?? `${VOICES[e.by] ?? e.by}'s voice made no sound`)
    const x = lastAsk
    if (!x) return
    if (e.t === "fallback") return x.press.after("voice-fallback", { why: e.why, from: e.from, to: e.to })
    if (e.t === "silent") return x.press.after("voice-silent", { by: e.by, ...(e.why ? { why: e.why } : {}) })
    if (e.t === "reroute") return x.press.after("voice-reroute", { why: e.why, again: e.again })
    if (x.sounded) return
    x.sounded = true
    x.press.after("sound", { by: e.by, afterUp: Math.round(e.at - x.up), ...(e.out ? { out: e.out } : {}) })
  },
  ...(QUIET ? { record: (m: Record<string, unknown>) => void spoken.push(m) } : {}),
})
const VOICES: Record<string, string> = { elevenlabs: "ElevenLabs", soniox: "Soniox", mac: "this Mac" }
/** Its voice failing, told once a run: a cloud voice that didn't speak (not one merely slow), or none making a sound,
 *  whose answer then shows in its box by the pointer. */
function voiceTrouble(e: Parameters<NonNullable<Parameters<typeof companionVoice>[0]["told"]>>[0]) {
  if (e.t === "fallback" && !e.slow) notice(`voice-fallback-${e.from}`, `${VOICES[e.from] ?? e.from}'s voice didn't speak`,
    `${e.why[0].toUpperCase()}${e.why.slice(1)}: maybe its credits ran out or its key was refused. ${VOICES[e.to] ?? e.to}'s voice speaks meanwhile.`)
  if (e.t !== "silent") return
  const why = e.why ? `${e.why[0].toUpperCase()}${e.why.slice(1)}` : `${VOICES[e.by] ?? e.by}'s voice made no sound`
  notice("voice-silent", "The companion can't speak", `${why.replace(/^this/, "This")}, so its answer shows in its box by your pointer. vau companion status says what its voice runs on.`)
  if (up.exchange?.spoken && panelOpen() !== up.exchange.name) answerBox()
}
/** The realtime voice (realtimefront.ts): a spoken ask over the screen, its first sound at once: small talk it answers
 *  alone; for the screen two words, the summoned answer (asked at once) said after them. Callbacks are each press's. */
export const voiceFront = realtimeFront<Summon>({
  config: realtimeConfig,
  name: () => live.state.name,
  languages: hints,
  words: () => expectedWords().terms,
  player: speaker,
  route: (s, r) => {
    const mine = fronted?.s === s
    if (r.to !== "talk") { if (mine) speaker.through(); return }
    // (it answered alone: the summoned session's answer, asked meanwhile, goes unsaid and unkept)
    if (mine) { fronted = null; hushed = Date.now(); if (voiced?.quiet) clearTimeout(voiced.quiet); voiced = null; speaker.drop() }
    if (r.said) live.say({ t: "answered", agent: s.name, heard: r.heard, said: r.said, ...(mine ? { withdraw: true } : {}) })
    if (up.summon !== s) return
    s.m.send("arrived", "the realtime voice answered alone")
    s.m.send("done")
    const x = up.exchange?.name === s.name ? up.exchange : null
    openAnswer(s.name, s.p, s.w, x ? x.since : s.at)
    if (up.exchange) up.exchange.arrived = true
  },
  notice: (account) => notice("realtime-paused", `Realtime voice paused: ${account === "quota" ? "OpenAI account has no credits" : "OpenAI refused its key"}`,
    "The companion answers through dictation and its cloud voice meanwhile, and tries again every 10 minutes.",
    account === "quota" ? "https://platform.openai.com/settings/organization/billing" : "https://platform.openai.com/api-keys"),
  // (the server's status says so: vau companion status)
  paused: (p) => { realtimePaused = p; live.say({ t: "realtime", paused: p }) },
  // (in the press's log: what its part did, and cost)
  log: (s, t) => s.press?.after("realtime", { kind: t.kind, model: t.model, cost: Number(t.cost.toFixed(5)), ...(t.firstMs !== undefined ? { firstMs: t.firstMs } : {}), ...(t.failed ? { failed: t.failed } : {}) }),
})
/** The press the realtime voice gives the first sound for, its summoned answer said after it (held till its route);
 *  `begun`, that answer's voice begun. */
let fronted: { s: Summon; begun?: boolean } | null = null
export let realtimePaused: { account: string; why: string; until: number } | null = null
/** The realtime voice's key and settings: none when it's off (voice_front pipeline, the voice off, no OpenAI key). */
async function realtimeConfig() {
  const r = prefs.realtime, port = host?.home()?.port
  if (r.front !== "realtime" || prefs.voice.mode === "off" || quietForCall() || !port) return null
  const res = await fetch(`http://127.0.0.1:${port}/api/companion/realtime`, { headers: { "X-Vaultite-Client": "app/desktop" }, signal: AbortSignal.timeout(2000) })
  const k = (res.ok ? await res.json() : {}) as { url?: string; key?: string }
  return k.url && k.key ? { url: k.url, key: k.key, model: r.model, voice: r.voice } : null
}
/** The answer being said: the ask it answers (when it came), its says (the last still growing). Answers to asks before
 *  `hushed` are silent: stopped (the Talk key, Esc), or a newer ask came. */
export let voiced: { name: string; asked: number; notes: string[]; quiet: ReturnType<typeof setTimeout> | null; texts?: Map<string, string>
  /** The press the realtime voice spoke first for: told this answer once it's whole. */
  fronted?: Summon } | null = null
let hushed = 0
/** Where hushing stood before a press made while an offer was up: said to be its answer (the server tells), the turn
 *  it lets go on is heard, not hushed with the press. */
let hushedBefore: number | null = null
export function offerAnswered(m: Record<string, unknown>) {
  if (m.t !== "takeover-answer") return
  if (m.asked !== true && hushedBefore !== null) hushed = hushedBefore
  hushedBefore = null
}
export let speakingNow: Scene["speaking"] = null
/** When its voice was last turned on from off: the answer then coming (to an ask before it) is said, typed or not. */
let turnedOn = 0
/** Its voice setting as the server has it now (with each say, and as it's changed): followed at once, not at the next
 *  settings read, so the answer that turned it off shows as text, and the one that turned it on is said. */
export function voiceSetting(v: unknown) {
  if (v !== "auto" && v !== "always" && v !== "off") return
  const was = prefs.voice.mode
  if (v === was) return
  prefsAre({ ...prefs, voice: { ...prefs.voice, mode: v } })
  if (v === "off") { const x = up.exchange; stopVoice(); if (x?.spoken) { x.spoken = false; answerBox() } }
  else if (was === "off") turnedOn = Date.now()
}
/** One of its says, as its words come: an answer to a Talk key's ask said aloud as the setting says (`auto`: one asked
 *  by voice); its last words when the next say begins, or after a pause. */
export function voiceHeard(n: Note) {
  const a = n.answers, mode = prefs.voice.mode
  if (n.kind !== "say" || !a || a.realtime || !n.text || n.dismissed || a.t < hushed || (voiced && a.t < voiced.asked)) return
  if (quietForCall() && (mode === "always" || (mode === "auto" && a.voice))) return keptQuiet(n.agent, a.t)
  if (up.quietHeld && a.t > up.quietHeld.asked) up.quietHeld = null
  // (a newer ask's answer, or another agent's to the same one (a job handed the floor): the last stops, said or not; the
  // realtime voice's few words before it go on)
  if (!voiced || voiced.asked !== a.t || voiced.name !== n.agent) {
    const after = !!fronted && !fronted.begun && a.t >= (lastAsk?.up ?? Infinity)
    if (after) { fronted!.begun = true; hushed = Math.max(hushed, a.t); if (voiced?.quiet) clearTimeout(voiced.quiet); voiced = null } else stopVoice(a.t)
    if (!answerAloud(mode, a, n.t, turnedOn)) return void (mode === "off" && a.voice && unheard(n.agent, a.t, "off"))
    speaker.begin("", a.lang, after, voiceOf(n.agent, live.state.name, prefs.voice.name))
    heardLines = []
    voiced = { name: n.agent, asked: a.t, notes: [], quiet: null, ...(after ? { fronted: fronted!.s } : {}) }
  }
  const v = voiced
  if (!v.notes.includes(n.id)) { const was = v.notes.at(-1); if (was) speaker.end(was); v.notes.push(n.id) }
  if (v.fronted) (v.texts ??= new Map()).set(n.id, n.text)
  speaker.text(n.id, n.text)
  if (v.quiet) clearTimeout(v.quiet)
  v.quiet = setTimeout(() => { if (voiced === v) speaker.end(n.id) }, 1500)
}
export function voiceHeardAgent(a: Agent) {
  const v = voiced
  if (v?.name !== a.name || !v.notes.length || (a.state !== "watching" && a.state !== "away")) return
  speaker.end()
  // (the realtime voice's conversation told what was said after its few words, so a follow-up knows)
  if (v.fronted) { voiceFront.answer(v.fronted, [...v.texts?.values() ?? []].join(" ")); v.fronted = undefined }
}
export const penHeard = () => penSounds(!QUIET && prefs.sounds && !quietForCall())
export const marks = markSampler({ ask: screenAsk, things: axThings, near: () => lastNear, say: (m) => live.say(m) })
/** The drawing up, as the server sent it; the sentences of the answer said aloud so far, as heard (any voice's), and
 *  when its pacing last learnt something (a sentence heard, the drawing come). */
export let drawn: Drawing | null = null, heardLines: Heard[] = [], pacedAt = 0, waited = false, repace: ReturnType<typeof setTimeout> | null = null
/** Until when the drawing up is held for the user to see it (drawingHold): a spoken exchange doesn't settle sooner. */
export let drawingSeen = 0
export function drawingCame(d: Drawing) {
  if (drawn?.id === d.id && drawn.marks.length === d.marks.length) return
  drawingSeen = Date.now() + drawingHold(Math.max(0, ...d.marks.map((m) => m.beat ?? 0)))
  setTimeout(settle, drawingSeen - Date.now() + 20).unref?.()
}
/** How long a beat waits for its sentence to be heard, with nothing heard meanwhile, before it goes by the reading time. */
const WAIT_HEARD_MS = 4000
/** A sentence heard (the companion's voice, or another that plays its answer): its drawing's pen keeps to it. */
function voiceHeardLine(h: Heard) {
  heardLines.push({ text: h.text, at: h.at, dur: h.dur })
  // (only the one still up: one cleared or ended stays gone)
  if (drawn && drawingUp(drawn.id)) paceDrawing(true)
}
/** The drawing, each beat timed to when its sentence is heard (overlay: the pen draws while those words are said); while
 *  its words are still being said, a beat not heard yet waits for them. */
export function paceDrawing(learnt = true) {
  if (learnt) pacedAt = Date.now()
  if (repace) { clearTimeout(repace); repace = null }
  // (its words still to come, or being said: its answer's voice not begun yet, or not done)
  const aloud = prefs.voice.mode === "always" || (prefs.voice.mode === "auto" && up.askedAloud)
  const a = drawn && live.state.agents.get(drawn.agent)
  const waits = waited = !!drawn && Date.now() - pacedAt < WAIT_HEARD_MS && beatsWait({ saying: voiced ? voiced.name === drawn.agent && speaker.saying() : null,
    aloud: aloud && up.exchange?.name === drawn.agent, words: !!drawn.caption, working: !!a && BUSY.has(a.state) })
  if (waits) { repace = setTimeout(() => { repace = null; paceDrawing(false) }, pacedAt + WAIT_HEARD_MS - Date.now() + 20); repace.unref?.() }
  if (drawn) showDrawing(drawn.agent, heardLines.length || waits ? { ...drawn, spoken: heardBeats(drawn.caption ?? "", heardLines), ...(waits ? { waits } : {}) } : drawn, elementPlaces(lastNear))
}
/** Silence, at once: what's said now, and what's still to come of answers asked before `until` (now). */
export function stopVoice(until = Date.now()) {
  hushed = Math.max(hushed, until)
  fronted = null
  up.replaying = null
  if (voiced?.quiet) clearTimeout(voiced.quiet)
  voiced = null
  speaker.stop()
  voiceFront.stop()
}
/** Its cursor shows it speaking, its level as it goes: only the level changed, the overlay is told that alone. */
function voiceLevel(on: boolean, v: number) {
  const name = voiced?.name ?? up.replaying ?? speakingNow?.name ?? (voiceFront.speaking() ? live.state.name : undefined)
  const was = speakingNow
  speakingNow = on && name ? { name, level: Math.round(v * 20) / 20 } : null
  // (quiet now: said to its end, maybe, its exchange over, once the voice has moved on; its drawing waits no more; its
  // box's stop button back to play)
  if (!on) setTimeout(() => { if (!speaker.saying()) up.replaying = null; settle(); if (waited) paceDrawing(false); boxAgain() }, 50)
  if (!!was !== !!speakingNow) boxAgain()
  if (!!was !== !!speakingNow || was?.name !== speakingNow?.name) return draw()
  if (up.lastScene && speakingNow && was?.level !== speakingNow.level) { up.lastScene = { ...up.lastScene, speaking: speakingNow }; showOverlay(based || null, up.lastScene) }
}
