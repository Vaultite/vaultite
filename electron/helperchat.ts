// Its conversation: the answer's box, or a bubble clicked open (typed, or said into it).

import { joinText } from "../core/dictationtext.ts"
import { callShown } from "./calllogic.ts"
import type { Point } from "./helperlogic.ts"
import { openPanel, panelData, panelOpen, type PanelData } from "./overlay.ts"
import { type Agent, based, BUSY, draw, prefs } from "./helperbase.ts"
import { live } from "./helperlive.ts"
import { keysSaid } from "./helpermenu.ts"
import { call, quietForCall, quietHeld, replaying } from "./helperquiet.ts"
import { session } from "./helpersession.ts"
import { exchange } from "./helpertalk.ts"
import { speaker, speakingNow, voiced } from "./helpervoice.ts"
/** Words said into the box, the last time they were done: given it once. */
let chatWords: PanelData["words"] = undefined
let wordsId = 0
export function chatOf(name: string): PanelData | null {
  // (the companion not started yet: talking to it starts it, its box there meanwhile)
  const a = live.state.agents.get(name) ?? (name === live.state.name ? { name, tint: "orange", state: "away" } as Agent : null)
  if (!a) return null
  // (an exchange's box: only what was asked and said in it, its words as a caption)
  const since = exchange?.name === name ? exchange.since - 1000 : 0
  const items = live.state.said.filter((n) => n.agent === name && (n.kind === "say" || n.kind === "ask") && n.text && n.t >= since)
    .map((n) => ({ id: n.id, kind: n.kind, text: n.text, t: n.t, ...(n.question ? { question: true } : {}) }))
  const s = session?.into === "panel" ? session : null
  const words = s ? { text: [...s.finals, s.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim(), listening: true } : chatWords
  const busy = BUSY.has(a.state)
  // (an answer's box: how to reply without reaching for the mouse)
  const talk = prefs.talk.length ? keysSaid(prefs.talk.slice(0, 1)) : ""
  const hint = since && talk ? `Reply, or tap ${talk} to type, hold to talk` : undefined
  // (quiet for a call: its box says why, naming the app with the mic; an answer kept unsaid has a play button, one being
  // said a stop button)
  const quiet = quietForCall() && prefs.voice.mode !== "off" && call ? callShown(call.app) : ""
  const saying = replaying === name || speakingNow?.name === name || (voiced?.name === name && speaker.saying())
  const play = saying ? "stop" as const : quietHeld?.name === name && items.some((i) => i.kind === "say" && i.t >= quietHeld!.asked) ? "play" as const : undefined
  return { name, tint: a.tint, items, ...(words ? { words } : {}), ...(busy ? { busy } : {}), ...(hint ? { hint } : {}), ...(play ? { play } : {}), ...(quiet ? { quiet } : {}) }
}
/** Its conversation open by its cursor (`at`, the screen's), taking the keyboard: its bubble goes into it, all of it seen;
 *  `travels`: summoned, it goes with the companion. */
export function openChat(name: string, at: Point, travels = false) {
  if (!based) return
  chatWords = undefined
  const d = chatOf(name)
  if (!d) return
  for (const n of live.state.notes.values()) if (n.kind === "say" && n.agent === name && !n.dismissed) live.say({ t: "hide", id: n.id })
  openPanel(based, at, d, true, travels)
  seeSaid(name)
  draw()
}
function seeSaid(name: string) {
  const ids = live.state.said.filter((n) => n.agent === name && n.kind === "say" && !n.seen).map((n) => n.id)
  if (ids.length) live.say({ t: "saw", ids })
}
/** What it shows changed (its words, dictation into its box); `done`: words said, for its box. */
export function chatChanged(done?: PanelData["words"]) {
  const name = panelOpen()
  if (!name) return
  if (done) chatWords = { ...done, id: ++wordsId }
  const d = chatOf(name)
  if (d) panelData(d)
  seeSaid(name)
}
