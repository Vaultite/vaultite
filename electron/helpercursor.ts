// The cursor over the screen: what the overlay draws, and who rides with the pointer.
import { screen } from "electron"
import { joinText } from "../core/dictationtext.ts"
import { cursorHandOff, keyOf } from "./cursorhandoff.ts"
import { onScreen, placeKey } from "./cursorplaces.ts"
import { REAL as captureReal, regionScene } from "./capture.ts"
import { besidePointer, type Scene, type ScreenAgent } from "./helperlogic.ts"
import { walkShown } from "./knockhelper.ts"
import { followPointer, panelAvoid, panelOpen, showOverlay } from "./overlay.ts"
import type { Rect } from "./screen.ts"
import { takeoverBehind, takeoverCaption } from "./takeover.ts"
import { keepsActs, lessonScene, watching } from "./teach.ts"
import { keepTimeline, timelineOn } from "./timeline.ts"
import { walkFilms, walkOn, walkScene } from "./walk.ts"
import { LIVE, QUIET, screenAsk } from "./helperask.ts"
import { type Agent, based, BUSY, frontHappened, hinted, host, type Note, prefs, type Session, type Summon } from "./helperbase.ts"
import { inAppPoint, leave, places, pointOf } from "./helperat.ts"
import { live } from "./helperlive.ts"
import { badge } from "./helpermenu.ts"
import { session } from "./helpersession.ts"
import { cue, exchange, inkDown, settle, summon, talkNow, trailed } from "./helpertalk.ts"
import { speakingNow } from "./helpervoice.ts"

export const ridingAgain = () => { ridingSaid = null }
export const lastSceneIs = (s: Scene | null) => { lastScene = s }
/** The screen's timeline kept in memory only while asked for (the setting, a QA walk, a lesson: video only for the first
 *  two), the companion on, and this the app that hears the keys; shortcuts named while what's done is kept. */
export function ringFollows() {
  // (a lesson needs no video: a scripted copy's QA watches one all the same)
  const here = (LIVE && !QUIET) || (QUIET && captureReal), on = !!live.state.name && live.state.mode !== "off", was = timelineOn()
  keepTimeline(on && ((here && (prefs.timeline || walkOn())) || ((here || QUIET) && watching())), here && (prefs.timeline || walkFilms()))
  // (just on: the app in front as it began)
  if (!was && timelineOn()) frontHappened()
  const keys = keepsActs()
  if (keys !== keysTold) { keysTold = keys; void screenAsk("keys", { on: keys }).catch(() => { keysTold = !keys }) }
}
let keysTold = false
export const glide = cursorHandOff({ window: () => host?.homeWindow() ?? null, agent: (name) => live.state.agents.get(name), last: () => lastScene?.agents, draw })
export const { handOff } = glide
/** Whether its own place, in the exchange of summon `s`, points at something (an element, a found text, another spot,
 *  a place in Vaultite's window): not where it was summoned nor where the ask parked it. */
const pointing = (a: Agent, s: Summon) => placeKey(a) !== s.was && (!onScreen(a) || !!a.frame || !!a.find || (typeof a.sx === "number" && typeof a.sy === "number" && Math.hypot(a.sx - s.p.x, a.sy! - s.p.y) > 4))
export let lastScene: Scene | null = null
/** What the overlay draws now (overlay.ts gives each display its part): only what's at work, nothing at rest. */
export function draw() {
  if (!host) return
  const agents: ScreenAgent[] = []
  const says = [...live.state.notes.values()].filter((n) => n.kind === "say" && !n.dismissed)
  const s = summon
  let aimed: { id: string; x: number; y: number; frame?: Rect } | null = null
  // (driving another app: what it does now, or that it waits for their hands, by its cursor)
  const tc = takeoverCaption(), doing = (name: string) => (tc?.agent === name ? { doing: tc.text, ...(tc.paused ? { paused: true } : {}) } : {})
  for (const a of live.state.agents.values()) {
    if (a.state === "away") continue
    // (summoned: one cursor, the summoned one, which flies to what its own place points at, on screen or in the window)
    if (s?.name === a.name) {
      if (!pointing(a, s)) continue
      if (!onScreen(a)) { const p = inAppPoint(a); if (p) aimed = { id: placeKey(a), x: p.x, y: p.y }; continue }
      const e = pointOf(a)
      if (e.p && !e.covered) aimed = { id: placeKey(a), x: e.p.x, y: e.p.y, frame: a.frame ?? e.target }
      continue
    }
    if (!onScreen(a)) continue
    // (a new place being found: it stays where it was meanwhile, or where it was summoned)
    const e = pointOf(a), p = e.p ?? (e.pending ? glide.drawnAt(keyOf(a)) ?? (s?.name === a.name ? s.p : undefined) : null)
    if (!p || e.covered) continue
    // (its conversation open: its words are there)
    const say = panelOpen() === a.name ? undefined : says.filter((n) => n.agent === a.name).at(-1)
    const target = a.frame ?? e.target
    agents.push({ name: a.name, tint: a.tint, state: a.state, sx: p.x, sy: p.y, t: a.t, ...(a.seen ? { seen: true } : {}), ...(a.why ? { why: a.why } : {}), ...(target ? { target } : {}), ...doing(a.name),
      ...(say?.text ? { say: { id: say.id, text: say.text, ...(say.question ? { question: true } : {}) } } : {}) })
  }
  // (held: it rides beside the pointer through the exchange, the overlay fed the pointer; a press that's a shortcut
  // shows nothing: it waits a moment to appear)
  const ph = s?.m.phase, listening = ph === "listening"
  if (s && listening) s.p = screen.getCursorScreenPoint()
  const words = session?.into === "summon" ? [...session.finals, session.pending].reduce((all, t) => (t ? all + joinText(all, t) : all), "").trim() : ""
  const own = s ? live.state.agents.get(s.name) : undefined, busy = !!own && BUSY.has(own.state)
  if (s && busy && (ph === "thinking" || ph === "answering")) { s.begun = true; s.m.send("busy") }
  // (its turn over and nothing still said: answered, its exchange open)
  else if (s?.begun && (ph === "working" || ph === "answering") && !busy && !talkNow().speaking) s.m.send("done")
  // (once its turn is seen at work, it's as busy as the agent is)
  const state = !s ? "watching" : listening ? "listening" : ph === "missed" || ph === "failed" ? "missed" : busy || talkNow().waiting ? "thinking" : "watching"
  const home = s && besidePointer(s.p, screen.getDisplayNearestPoint(s.p).bounds)
  const called: Scene["summon"] = s && home && (!listening || s.appeared)
    ? { name: s.name, tint: s.tint, state, sx: home.x, sy: home.y, follow: true, ...(words ? { words } : {}), ...doing(s.name), ...(state === "missed" && s.missed ? { missed: s.missed } : {}), ...(listening && session?.into === "summon" ? { level: Math.round(session.level * 20) / 20 } : {}), ...(aimed && !listening ? { aim: { id: aimed.id, x: Math.round(aimed.x), y: Math.round(aimed.y) } } : {}), ...(inkDown && listening ? { drag: true } : {}) } : null
  followPointer(!!called, trailed)
  // (it came: a soft cue, once a press)
  if (called && s && !s.cued) { s.cued = true; if (listening) cue("listen") }
  panelAvoid(aimed?.frame ? [aimed.frame] : [])
  for (const a of live.state.agents.values()) if (a.state !== "away") leaveWhenDone(a, says)
  places.watchWindows()
  const d = session
  const hintNow = hinted && hinted.until > Date.now() ? hinted : null
  const pill: Scene["pill"] = d && d.into === "field" ? { level: d.level, text: boxWords(d), pending: d.pending, ready: d.ready, ...(d.free ? { free: true } : {}) }
    : hintNow ? { level: 0, text: hintNow.text, ready: true, hint: true } : null
  lastScene = { ...handOff(agents, called), pill, speaking: speakingNow, region: regionScene(), behind: takeoverBehind() }
  // (a QA walk or a lesson shows on the island by the notch)
  walkShown(walkScene() ?? lessonScene())
  ringFollows()
  showOverlay(based || null, lastScene)
  badge()
  rides()
  settle()
}
/** Who rides with the pointer now (summoned: listening, thinking, its exchange on), as the server was last told: the
 *  windows draw no cursor of its, nor its arrow at work in the status bar, meanwhile. */
let ridingSaid: string | null = null
function rides() {
  const now = summon?.name ?? ""
  if (now === ridingSaid) return
  if (live.say({ t: "riding", agent: now })) ridingSaid = now
}
/** Its cursor shows on screen only while it works, answers or points: idle a while there after, its words gone and its
 *  exchange over, it leaves. */
const DONE_MS = 6000
const leaving = new Map<string, ReturnType<typeof setTimeout>>(), left = new Set<string>()
function leaveWhenDone(a: Agent, says: Note[]) {
  if (!onScreen(a) || a.state !== "watching" || exchange?.name === a.name || summon?.name === a.name || panelOpen() === a.name || says.some((n) => n.agent === a.name)) return
  const wait = DONE_MS - (Date.now() - (a.t ?? 0)), once = `${a.name}:${a.t ?? 0}`
  clearTimeout(leaving.get(a.name))
  if (wait > 0) { leaving.set(a.name, setTimeout(draw, wait + 50)); return }
  if (left.has(once)) return
  left.add(once)
  leave(a.name)
}
const boxWords = (s: Session) => s.finals.reduce((all, t) => all + joinText(all, t), "").slice(-800)
