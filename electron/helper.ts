/** The menu-bar helper (a Mac's; one per Mac, a lock): the app and its home vault's server kept with no window: the keys
 *  (dictation's; the companion summoned over the screen, overlay.ts), screen reading, what's in front. electron/CLAUDE.md. */
import { app, ipcMain, screen, systemPreferences } from "electron"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { type FnEvent } from "../core/fnkey.ts"
import { freeAll, listen as hear, onFree } from "./helperscope.ts"
import { pickMic } from "./miclogic.ts"
import { hideFromShares } from "./overlaywin.ts"
import { jobNews } from "./helperlogic.ts"
import { captureHeard, captureHost, recordFor, recordingNow, regionAct, regionMoved, stopCapture } from "./capture.ts"
import { quitRecorder } from "./recorder.ts"
import { keepTimeline, timelineHost, timelineRefollow } from "./timeline.ts"
import { islandNow, knockHost, knockSaid, knocksHeard, stopKnocks, toPresence } from "./knockhelper.ts"
import { closePanel, drawingActs, dropDrawings, onPanel, overlayActs, panelBounds, showDrawing, showOverlay, watchLayers } from "./overlay.ts"
import { displayShot as shootDisplay, onScreenEvent, screenAsk as askHelper, startScreen, stopScreen, type AppWindowInfo } from "./screen.ts"
import { elementPlaces } from "./drawing.ts"
import { keyHeard, lessonAct, lessonScene, stopTeach, teachFinal, teachHeard, teachHost, teachPending, typedHeard, watching } from "./teach.ts"
import { stopWalk, walkAct, walkCall, walkFinal, walkHeard, walkHost, walkOn, walkPending } from "./walk.ts"
import { offerHere, offerSaid, stopTakeover, takeoverClick, takeoverDriving, takeoverHeard } from "./takeover.ts"
import { type Needs, offerHeard, offerHost, offerScene, offerTimeline, OFFER_UP_MS } from "./timelineoffer.ts"
import { asked, LIVE, QUIET, screenAsk, screenAsked, stubs, switched } from "./helperask.ts"
import { based, basedAt, BUSY, defaults, dictating, drawWith, front, frontHappened, frontIs, hidden, hint, host, hostIs, notice, op, DONE, prefs, prefsAre, stopFor, type HelperHost } from "./helperbase.ts"
import { logger } from "../core/log.ts"

const log = logger("helper")

export type { Dictation, HelperHost, HelperPrefs, Home } from "./helperbase.ts"
import { live, liveHooks } from "./helperlive.ts"
import { type Heard, SAID } from "./homewire.ts"
import { COMPANION_SETTINGS, DICTATION_SETTINGS, prefsOf, SCREEN_SETTINGS } from "./helperprefs.ts"
import type { z } from "zod"
import { axThings, clicked, excluded, findIn, inputHeard, nearAt, nearPoint, lastNear, openedUntil, openOn, places, placeTold, pointedAt, teachThings, walkPlace } from "./helperat.ts"
import { badge, badged, followInbox, hideTray, jobNotice, login, menuHost, menuItems, mutedUntil, openIn, openPresence, panelMenu, showTray } from "./helpermenu.ts"
import { drawingCame, drawn, drawnIs, marks, offerAnswered, paceDrawing, penHeard, realtimePaused, sayHere, speaker, spoken, stopVoice, voiceFront, voiceHeard, voiceHeardAgent, voiceHost, voiceSetting, waited } from "./helpervoice.ts"
import { followHeard, landAsks, learnHost } from "./helperlearn.ts"
import { act, freeBy, freeTick, micSent, micTold, roamIn, session, sessionHost, starting, stopListening } from "./helpersession.ts"
import { answerArrived, answerBox, askedAloud, askFrom, saidInBoxIs, captured, closeSummon, cue, endExchange, exchange, failed, heldClick, holdAppear, inkHeard, inkOff, missed, moveOn, openAnswer, presses, saidInBox, sendSummon, settle, startSummon, summon, talkHeard, talkHost, talkNow } from "./helpertalk.ts"
import { boxAgain, followCalls, keptQuiet, notCall, playQuiet, quietForCall, quietHeld, quietHeldIs, quietHost, replaying, replayingIs, stopFromBox, unheard } from "./helperquiet.ts"
import { chatChanged, chatOf, openChat } from "./helperchat.ts"
import { chordHeard, fnHeard, followKeys, listen, modHeard } from "./helperkeys.ts"
import { draw, glide, lastScene, lastSceneIs, ridingAgain, ringFollows } from "./helpercursor.ts"
import { voiceCall } from "./helperscreen.ts"
export { screenCall, voiceCall } from "./helperscreen.ts"

drawWith(draw)
quietHost({ chatOf })
talkHost({ quietForCall, chatOf, openChat, drawnAt: glide.drawnAt })
sessionHost({ get summon() { return summon }, get saidInBox() { return saidInBox }, set saidInBox(v) { saidInBoxIs(v) },
  talkNow, startSummon, failed, inkOff, missed, closeSummon, captured, sendSummon, quietForCall, chatChanged })
learnHost({ get session() { return session } })
menuHost({ refresh, openChat })
voiceHost({ get exchange() { return exchange }, get summon() { return summon }, get askedAloud() { return askedAloud },
  get quietHeld() { return quietHeld }, set quietHeld(v) { quietHeldIs(v) }, get replaying() { return replaying }, set replaying(v) { replayingIs(v) },
  get lastScene() { return lastScene }, set lastScene(v) { lastSceneIs(v) },
  quietForCall, unheard, keptQuiet, boxAgain, answerBox, openAnswer, settle })

// (a scripted copy's or one run from source: its own lock, never the user's app's)
const LOCK_NAME = LIVE ? "vaultite-helper" : `vaultite-helper-${process.pid}`
// (Windows listens only on a named pipe, never a file's path)
const LOCK = process.platform === "win32" ? `\\\\.\\pipe\\${LOCK_NAME}-${os.userInfo().username}` : path.join(os.tmpdir(), `${LOCK_NAME}.sock`)
let lock: net.Server | null = null

export const helperOn = () => !!host

/** The lock: a socket only one app can listen on; a dead app's is taken over. */
function takeLock(): Promise<net.Server | null> {
  const listen = () => new Promise<net.Server | null>((done) => {
    const s = net.createServer((c) => c.end())
    s.once("error", () => done(null))
    s.listen(LOCK, () => done(s))
  })
  return listen().then((s) => s ?? new Promise((done) => {
    const probe = net.connect(LOCK)
    probe.once("connect", () => { probe.destroy(); done(null) })
    probe.once("error", () => { if (process.platform !== "win32") fs.rmSync(LOCK, { force: true }); void listen().then(done) })
  }))
}

export async function startHelper(h: HelperHost) {
  if (host) return true
  lock = await takeLock()
  if (!lock) return false
  hostIs(h)
  hear(app, "will-quit", stopHelper)
  if (QUIET) Object.assign(globalThis, { vaultiteHelper: { heard: (m: Record<string, unknown>) => heard(m), stub: (op: string, v?: Record<string, unknown> | null) => (v == null ? stubs.delete(op) : stubs.set(op, v)), presses: () => presses.read(),
    asked: () => [...asked], screenAsked: () => [...screenAsked], spoken: () => [...spoken], scene: () => lastScene, island: islandNow, knocks: knocksHeard, islandSaid: (text: string, x: number, y: number) => knockSaid(text) || toPresence(text, { x, y }), badge: () => badged, menu: () => menuItems(),
    walk: (what: string) => walkCall(what), talkSaid: (text: string) => walkHeard(text), walkSaid: (text: string) => { walkPending(text); walkFinal(text) },
    teach: (text: string) => teachHeard(text, Date.now()), capture: (text: string) => captureHeard(text, Date.now()), offer: offerScene, offerSaid: (text: string) => offerHeard(text), refresh: () => refresh(), teachSaid: (text: string) => { teachPending(text); teachFinal(text) }, lesson: lessonScene,
    layers: () => marks.layers(), watched: () => marks.areas(), near: (x: number, y: number) => nearAt({ x, y }),
    holdAppear } })
  onScreenEvent(heard)
  hear(ipcMain, "vaultite:place", (e: Electron.IpcMainEvent, m: { id?: unknown; place?: unknown }) => placeTold(e.sender, m))
  hear(ipcMain, "vaultite:dictation-landed", (_e: unknown, m: { id?: unknown; ok?: boolean; elsewhere?: boolean }) => { if (typeof m?.id === "number") landAsks.get(m.id)?.(m) })
  h.dictation.onRoam({ take: roamIn, stop: () => { if (session?.into !== "field") return false; stopFor(session.sink); return true } })
  onFree(() => h.dictation.onRoam(null))
  onFree(h.dictation.onDictating(() => stopVoice()))
  // (the mic it would hear with now, for its status: devices plugged, the output changed)
  onFree(h.dictation.onAudioDevices((d) => micTold(pickMic(prefs.dictation.microphone, d))))
  overlayActs({ open: openChat, stop: () => { if (session) stopFor(session.sink) }, region: regionMoved, regionAct })
  timelineHost({ exclude: excluded, bundles: () => prefs.privateApps, holding: recordingNow, privateNow: () => hidden(front),
    clicks: (on) => void screenAsk("clicks", { on }).catch(() => {}) })
  offerHost({ offer: (id, line, sub, yes) => offerHere(id, { line, sub, yes, name: live.state.name, tint: live.state.agents.get(live.state.name)?.tint ?? "orange" }, OFFER_UP_MS),
    answer: offerSaid, say: sayHere, turnOn: () => op("screen.keep", {}, DONE).then(refresh) })
  captureHost({ exclude: excluded, bundles: () => prefs.privateApps, hint, draw, unkept: () => unkept("replay"),
    placeAt: async (p) => { const w = await screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).catch(() => null); return { ...await pointedAt(live.state.name, p, w?.window ? w : null, false), ...(w?.frame ? { frame: w.frame } : {}) } },
    deliver: async (c) => String((await op("companion.capture", c, SAID)).said ?? "Sent") })
  walkHost({ draw, listening: (on) => { if (!on && session?.into === "free" && freeBy?.final === walkFinal) stopFor(session.sink); freeTick() },
    allowed: () => (QUIET ? stubs.get("screen-access")?.granted === true : systemPreferences.getMediaAccessStatus("screen") === "granted"),
    placeAt: walkPlace,
    still: async (p, crop, file) => { if (QUIET) return false; const r = await shootDisplay(p, await excluded(), path.dirname(file), crop).catch(() => null); if (!r) return false; fs.renameSync(r.file, file); return true },
    deliver: async (w) => String((await op("companion.walk-send", w, SAID)).said ?? "Sent") })
  teachHost({ draw, hint, unkept: () => unkept("skill"), privateNow: () => hidden(front), refollow: ringFollows, listening: () => freeTick(),
    trusted: () => (QUIET ? stubs.get("ax-access")?.granted !== false : systemPreferences.isTrustedAccessibilityClient(false)),
    things: teachThings, windowAt: async (p) => { const w = await screenAsk<AppWindowInfo>("at", { x: p.x, y: p.y }).catch(() => null); return w ? { ...(w.frame ? { frame: w.frame } : {}), vaultite: !!w.vaultite, private: !!w.window && !w.vaultite && hidden(w) } : null },
    focus: () => screenAsk("focus", {}),
    deliver: async (l) => String((await op("companion.teach", l, SAID)).said ?? "Saved") })
  drawingActs((a) => live.say({ t: "drawing-act", ...a }))
  watchLayers(marks.changed)
  knockHost({ say: (m) => live.say(m), talking: () => { const t = talkNow(); return t.listening || t.box || t.speaking || t.pressing || t.answering },
    base: () => (live.state.mode === "off" && !walkOn() && !watching() ? null : based || null), ask: (o, r) => screenAsk(o, r ?? {}), cue: (n) => cue(n),
    walk: (what) => (watching() ? lessonAct(what) : walkAct(what)),
    speak: (text) => { if (prefs.voice.mode !== "off" && !quietForCall()) void voiceCall("voice:sample", [{ text, after: true }]).catch(() => {}) },
    open: (p) => void openPresence(p), hint, view: (to) => void openIn(to), muted: () => mutedUntil > Date.now(),
    send: (id, text) => op("terminal.send", { id, text }, DONE).then(() => true, () => false), ...(QUIET ? { still: () => Number(process.env.VAULTITE_QA_STILL ?? 2000) } : {}) })
  onPanel({ send: (name, text) => void askFrom(name, text), mic: () => act(session || starting ? "stop" : "start"), more: panelMenu, play: playQuiet, stop: stopFromBox, notCall,
    // (Esc in its box ends the exchange; the box closed otherwise (clicked away, its close) leaves what it says going on)
    closed: (_name, why) => { if (session?.into === "panel") stopFor(session.sink, true); if (why === "esc") endExchange(); else moveOn(); draw() } })
  if (!QUIET) await startScreen().catch((e) => log.error("the screen helper didn't start", e))
  // (a copy a script drives (web/qa/helper.mjs) shows nothing in the menu bar and never hears the user's fn)
  if (!QUIET) {
    void listen()
    showTray(h.icon)
    login(h.prefs().login ?? app.isPackaged)
  }
  refreshing = setInterval(() => void refresh(), 10_000)
  refreshing.unref()
  await refresh()
  return true
}

let refreshing: ReturnType<typeof setInterval> | null = null
export function stopHelper() {
  if (!host) return
  hostIs(null)
  if (refreshing) clearInterval(refreshing)
  refreshing = null
  stopListening()
  marks.stop()
  followCalls(false)
  voiceFront.close()
  speaker.quit()
  live.close()
  stopKnocks()
  closePanel()
  showOverlay(null)
  stopScreen()
  stopTakeover()
  stopCapture()
  stopWalk()
  stopTeach()
  keepTimeline(false)
  quitRecorder()
  hideTray()
  lock?.close()
  lock = null
  // (started again, in this copy or another: it follows the home vault afresh)
  basedAt("")
  freeAll()
}

/** What a reload onto another code root would cut short now (a press, a dictation, its voice, a walk...), or null. */
export function helperBusy(): string | null {
  if (!host) return null
  const t = talkNow()
  if (t.listening || t.starting) return "it's dictating"
  if (t.pressing) return "a Talk key's press is under way"
  if (t.answering) return "an exchange with the companion is on"
  if (t.speaking) return "the companion is speaking"
  if (t.box) return "the companion's box is open"
  if (walkOn()) return "a QA walk is on"
  if (watching()) return "a lesson is being taught"
  if (recordingNow()) return "a replay is being kept"
  if (takeoverDriving()) return "an agent drives another app"
  if (dictating()) return "a window's dictation is under way"
  return null
}

/** The home vault may have changed (a window opened, closed or focused): follow it now. */
export const homeChanged = () => { if (host) void refresh() }
/** Follow the home vault: its server (the overlay's page, the companion's socket) and its settings. */
async function refresh() {
  const home = host?.home()
  const base = home ? `http://127.0.0.1:${home.port}` : ""
  if (base !== based) { basedAt(base); live.open(home ? home.port : null) }
  if (!home) return draw()
  const get = <S extends z.ZodType>(name: string, settings: S) => op("settings.get", { name }, settings).catch(() => settings.parse({}))
  const [d, c, s] = await Promise.all([get("plugin/dictation", DICTATION_SETTINGS), get("plugin/companion", COMPANION_SETTINGS), get("plugin/screen", SCREEN_SETTINGS)])
  prefsAre(prefsOf(d, c, s, defaults()))
  await followInbox()
  penHeard()
  hideFromShares(prefs.hideFromShares)
  followCalls()
  followKeys()
  ringFollows()
  draw()
}

liveHooks({ heard: liveHeard,
  opened: (s) => { if (realtimePaused) s.send(JSON.stringify({ t: "realtime", paused: realtimePaused })); if (micSent) s.send(JSON.stringify({ t: "mic", mic: micSent })) },
  closed: () => { drawnIs(null); dropDrawings() } })
function liveHeard({ voice, message: m }: Heard) {
  const state = live.state
  voiceSetting(voice)
  if (!m || m.t === "voice") return
  // (a session's layer: the one of the answer coming is paced to its words, the others drawn as they are)
  if (m.t === "drawing") {
    const d = m.drawing
    if (d && !d.past && !d.hidden && (!exchange || exchange.name === m.agent)) { answerArrived(); drawingCame(d); drawnIs(d); return paceDrawing() }
    if (drawn?.agent === m.agent) drawnIs(d && !d.past ? d : null)
    return void showDrawing(m.agent, d, elementPlaces(lastNear))
  }
  if (m.t === "state") {
    state.mode = m.mode; state.name = m.name
    state.agents = new Map(m.agents.map((a) => [a.name, a]))
    state.notes = new Map(m.notes.map((n) => [n.id, n]))
    state.said = m.said ?? []
    // (connected again: the server hears who rides with the pointer now)
    ridingAgain()
  } else if (m.t === "said") state.said = m.said ?? []
  else if (m.t === "agent") { const a = m.agent; state.agents.set(a.name, a); voiceHeardAgent(a); if (waited && drawn?.agent === a.name && !BUSY.has(a.state)) paceDrawing(false) }
  else if (m.t === "note") { const n = m.note; state.notes.set(n.id, n); voiceHeard(n); if (n.kind === "say" && n.agent === exchange?.name && n.t >= exchange.since) answerArrived() }
  else if (m.t === "drop") state.notes.delete(m.id)
  else if (m.t === "hush") return stopVoice()
  else if (m.t === "takeover" || m.t === "takeover-answer" || m.t === "confirm") return void (offerAnswered(m), takeoverHeard(m, { reply: (r) => live.say(r), isPrivate: hidden, near: nearAt, redraw: draw }))
  else if (m.t === "open") return void openOn(m)
  else if (m.t === "find") return void findIn(m)
  else if (m.t === "things") return void axThings(nearPoint ?? screen.getCursorScreenPoint()).then((things) => live.say({ t: "takeover-done", id: m.id, ok: true, things }))
  else if (m.t === "inputs") return void screenAsk("inputs", { on: m.on }).catch(() => {})
  else if (m.t === "knocks") return knocksHeard(m)
  else if (m.t === "record") return void recordFor(m.job)
  else {
    for (const j of jobNews(state.jobs, m.jobs, prefs.jobNews)) jobNotice(j)
    state.jobs = m.jobs
    return badge()
  }
  draw()
  chatChanged()
}

function heard(m: Record<string, unknown>) {
  if (!host) return
  if (m.event === "fn") return prefs.talk.includes("fn") ? talkHeard(m as FnEvent) : prefs.keys.includes("fn") ? fnHeard(m) : undefined
  if (m.event === "mod") return modHeard(m)
  if (m.event === "chord") return chordHeard(m)
  if (m.event === "moved") return places.windowMoved(m)
  if (m.event === "ink") return inkHeard(m)
  // (its exchange on: a click elsewhere moves on, Esc ends it, its voice with it)
  // (one let go while the Talk key was held: it went on to the app, and goes with the ask)
  if (m.event === "click" && m.held) { void clicked(Number(m.x), Number(m.y)); return heldClick({ x: Number(m.x), y: Number(m.y) }) }
  if (m.event === "click") { void clicked(Number(m.x), Number(m.y)); if (m.exchange === false) return; if (takeoverClick(Number(m.x), Number(m.y))) return; const b = panelBounds(), x = Number(m.x), y = Number(m.y); if (!b || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) moveOn(); return }
  if (m.event === "esc") return endExchange()
  if (m.event === "input") return void inputHeard(m)
  if (m.event === "key" && typeof m.key === "string") return void keyHeard(m.key)
  if (m.event === "typed") return typedHeard()
  if (m.event === "follow") return followHeard(m)
  if (m.event === "front") {
    if (exchange && !m.vaultite && front && m.bundle !== front.bundle && !takeoverDriving() && Date.now() > openedUntil) moveOn()
    const now = m as unknown as AppWindowInfo
    frontIs(now)
    frontHappened()
    timelineRefollow()
    places.lookAgain()
    host?.event("screen:front", hidden(now) ? { bundle: now.bundle, name: now.name, private: true } : { bundle: now.bundle, name: now.name, title: now.title, window: now.window, vaultite: !!now.vaultite })
    return draw()
  }
  if (m.event === "tap" && (m.ok === false || m.ink === false)) notice("tap", m.ok === false ? "Dictation and Talk keys need Vaultite in Accessibility" : "Drawing while you talk needs Vaultite in Accessibility",
    "Allow it in System Settings, Privacy & Security, Accessibility, then press one again.", "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
  if (m.event === "exit" && host) setTimeout(() => { if (host) void startScreen().then(() => Promise.all([...switched].map(([op, req]) => askHelper(op, req)))).catch(() => {}) }, 2000)
}

/** The timeline isn't kept, for what needs it: off by their choice, an offer to turn it on; on but not kept here (the
 *  companion off), only why. */
function unkept(needs: Needs) {
  if (!prefs.timeline) return void offerTimeline(needs)
  hint(needs === "replay" ? "Nothing kept: the companion isn't keeping your screen right now" : "I wasn't watching: say \"watch me\" first")
}
