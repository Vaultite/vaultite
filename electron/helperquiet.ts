import { voiceOf } from "../core/desktop/spoken.ts"
import { type Call, callFrom, callSaid, type MicUser } from "./calllogic.ts"
import { panelData, panelOpen, type PanelData } from "./overlay.ts"
import { LIVE, QUIET, screenAsk } from "./helperask.ts"
import { prefs, stopFor } from "./helperbase.ts"
import { live } from "./helperlive.ts"
import { session } from "./helpersession.ts"
import { answerBox, exchange, talkNow } from "./helpertalk.ts"
import { lastAsk, penHeard, speaker, stopVoice, voiced } from "./helpervoice.ts"

/** Quiet on calls: while another app has the mic (calllogic.ts), answers show as text, said only when asked. */
let up: { chatOf: (name: string) => PanelData | null }
export const quietHost = (h: typeof up) => { up = h }
const chatOf = (name: string) => up.chatOf(name)
export const quietHeldIs = (q: typeof quietHeld) => { quietHeld = q }
export const replayingIs = (name: string | null) => { replaying = name }

export let call: Call | null = null, callTimer: ReturnType<typeof setInterval> | null = null
const micSince = new Map<string, number>()
/** Apps the user said aren't on a call (its box's Not a call): left out till they let go of the mic (calllogic.ts). */
const excused = new Map<string, number>()
/** The agent whose answer its play button says now (the voice outside an answer as it comes). */
export let replaying: string | null = null
/** This app's processes (its children too, by their parents): its own mic is never a call. */
const OWN = new Set([process.pid])
/** The answer kept quiet for a call (its agent, the ask it answers): its box has a play button. */
export let quietHeld: { name: string; asked: number } | null = null
export const quietForCall = () => prefs.quietOnCalls && !!call
export function followCalls(on = prefs.quietOnCalls && process.platform === "darwin" && (LIVE || QUIET)) {
  if (on === !!callTimer) return
  if (on) { callTimer = setInterval(() => void callLook(), 1500); void callLook(); return }
  clearInterval(callTimer!); callTimer = null; micSince.clear(); excused.clear()
  if (call) callChanged(null)
}
async function callLook() {
  const r = await screenAsk<{ ok?: boolean; users?: MicUser[] }>("mics").catch(() => null)
  if (!callTimer || !r?.ok || !Array.isArray(r.users)) return
  const next = callFrom(r.users, OWN, call, micSince, Date.now(), excused)
  if (next?.bundle !== call?.bundle) callChanged(next)
  else call = next
}
function callChanged(next: Call | null) {
  call = next
  live.say({ t: "call", call: callSaid(next) })
  penHeard()
  boxAgain()
  if (!quietForCall()) return
  // (a call began while it spoke: it stops, and its answer shows)
  const x = exchange
  if (talkNow().speaking) { const v = voiced; stopVoice(); if (v) { quietHeld = { name: v.name, asked: v.asked }; unheard(v.name, v.asked, "call", callSaid(call)) } }
  if (x?.spoken) { x.spoken = false; answerBox() }
  // (hands-free talk in its box would hear the call: it stops, its words so far kept; their own press still works)
  if (session?.into === "panel" && session.talk) stopFor(session.sink)
}
/** An answer that would be said, kept quiet for the call: its box shows it, with a play button. */
export function keptQuiet(name: string, asked: number) {
  if (quietHeld?.name === name && quietHeld.asked === asked) return
  quietHeld = { name, asked }
  lastAsk?.press.after("quiet", { call: call?.app ?? "" })
  unheard(name, asked, "call", callSaid(call))
  if (exchange?.name === name && exchange.spoken) { exchange.spoken = false; return answerBox() }
  const d = chatOf(name)
  if (d) panelData(d)
}
/** An answer not said aloud, and why, told the server once (its next asks' heads say so). */
let unheardLast = ""
export function unheard(name: string, asked: number, why: "call" | "off" | "silent", detail = "") {
  if (unheardLast === `${name}:${asked}:${why}`) return
  unheardLast = `${name}:${asked}:${why}`
  live.say({ t: "unheard", agent: name, asked, why, detail })
}
/** Its play button: the answer kept quiet (or stopped), said now from its start (they asked: the call or not). */
export function playQuiet(name: string) {
  const h = quietHeld
  if (!h || h.name !== name) return
  const says = live.state.said.filter((n) => n.agent === name && n.kind === "say" && n.text && n.answers?.t === h.asked)
  if (!says.length) return
  unheardLast = ""
  live.say({ t: "heard", agent: name, asked: h.asked })
  stopVoice()
  replaying = name
  speaker.begin("", says[0].answers?.lang, false, voiceOf(name, live.state.name, prefs.voice.name))
  for (const n of says) { speaker.text(n.id, n.text!); speaker.end(n.id) }
  boxAgain()
}
/** Its stop button: the answer being said stops, kept to say again from its play button. */
export function stopFromBox(name: string) {
  const v = voiced
  if (v?.name === name) quietHeld = { name, asked: v.asked }
  stopVoice()
  boxAgain()
}
/** Its Not a call: the app holding the mic isn't on one. The companion speaks again till that app lets go of the mic (the
 *  next hold counts again), starting with the answer it kept quiet. */
export function notCall(name: string) {
  if (!call) return
  excused.set(call.bundle, Date.now())
  lastAsk?.press.after("not-a-call", { call: call.app })
  callChanged(null)
  if (quietHeld?.name === name) playQuiet(name)
}
/** Its box drawn again, for what its buttons show (quiet, said, stopped). */
export function boxAgain() {
  const n = panelOpen(), d = n ? chatOf(n) : null
  if (d) panelData(d)
}
