/** Take-over (the helper's): a step in another app as the user watches (an offer, a border, its cursor's caption); a
 *  click or Esc stops it, their hands on it pause what needs them; the steps are takeover.swift's (takeoverlogic.ts). */
import { app, BrowserWindow, screen } from "electron"
import path from "node:path"
import { HEX } from "../core/desktop/screenmarks.ts"
import { takeoverSwift } from "./swiftbuild.ts"
import { type Json, lineHelper } from "./linehelper.ts"
import { overlayWindow } from "./overlaywin.ts"
import { quiet, takePointer } from "./quiet.ts"
import { privateApp } from "../core/privateapps.ts"
import { hostOf, siteIn } from "../core/desktop/places.ts"
import { aimedAt, type Answer, type Call, cardSpot, declined, handGrace, intentOf, keepsYes, kindOf, OFFER_MS, outward, PAUSED_MS, pausedLine, plan, type Rect, refusal, REST_MS,
  spotOf, type Step, tookText, types, probeThing, behindPlan, behindRefusal, cursorIn, inFront, LOOK_MS, type Readback, SETTLE_MS, unsureLine, verified,
  type TakeoverMessage, DID, PROBE, TAKEOVER_EVENT, WINDOW } from "./takeoverlogic.ts"
import type { z } from "zod"

type Point = { x: number; y: number }
type Near = { id: string; role: string; label: string; frame: Rect }
/** What helper.ts lends it: its socket to the server, the private apps, and what's near a point (its ids, as an ask's). */
export type TakeoverHost = { reply: (m: object) => void; isPrivate: (a: { bundle: string; name: string }) => boolean; near: (p: Point) => Promise<Near[]>
  /** Its cursor's caption changed (takeoverCaption): drawn again. */
  redraw: () => void }

const QUIET = !!process.env.VAULTITE_QUIET
/** How long its cursor takes to fly to a step before it's done, and how long it keeps driving after one for the next. */
const FLY_MS = 450, DRIVE_MS = 2500
/** How long a yes lasts with no step (the exchange ends it sooner). */
const YES_MS = 120_000
/** How long the offer and the border take to fade out (the page's takeover-out). */
const FADE_MS = 160
/** How long a step's caption stays once it's done, unless the next one comes. */
const CAPTION_MS = 1200

// ---------- takeover.swift

const helper = lineHelper({ binary: () => takeoverSwift.binary(path.join(app.getPath("userData"), "bin")),
  // (gone mid-drive: its guard went with it, so nothing more is done blind)
  exited: () => { if (drive) stop("helper") },
  events: TAKEOVER_EVENT,
  event: (m) => {
    if (m.event === "user") stop(`user-${m.why}`)
    else if (m.event === "busy") handsOn(m.why === "keys" ? "keys" : "mouse")
    else if (m.event === "rested") handsOff()
  } })
const ask = <S extends z.ZodType>(call: Call, answer: S, ms = 15_000): Promise<z.output<S>> => helper.ask(call, answer, ms)
export function stopTakeover() {
  stop("quit")
  helper.quit()
}

// ---------- the offer, and the border while it drives

const page = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>
:root { color-scheme: light dark; font: 13px/1.35 -apple-system, system-ui, sans-serif; --tint: #e8590c }
html, body { margin: 0; overflow: hidden; background: transparent; user-select: none; cursor: default }
/* (as a question bubble of the companion's: its colour is the ring and a tint, no dot; the window takes its height) */
.card { margin: 8px 14px 18px; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; transform-origin: top left;
  background: color-mix(in srgb, var(--tint) 9%, light-dark(rgb(255 255 255 / .97), rgb(38 38 40 / .97))); color: light-dark(#1d1d1f, #f5f5f7);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 70%, transparent), 0 8px 24px rgb(0 0 0 / .25) }
.line { font-weight: 600; overflow-wrap: anywhere } .sub { opacity: .65; font-size: 12px } .row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 2px }
a { text-decoration: none; padding: 4px 12px; border-radius: 7px; line-height: 18px; white-space: nowrap; color: inherit; background: light-dark(rgb(0 0 0 / .06), rgb(255 255 255 / .1)) }
a.yes { background: var(--tint); color: #fff } a:hover { filter: brightness(1.08) }
.edge { position: fixed; inset: 0; border: 4px solid var(--tint); border-radius: 12px; box-shadow: inset 0 0 28px color-mix(in srgb, var(--tint) 45%, transparent) }
.pill { position: fixed; top: 34px; left: 50%; transform: translateX(-50%); padding: 5px 14px; border-radius: 999px; background: var(--tint); color: #fff;
  font-weight: 500; white-space: nowrap; box-shadow: 0 4px 14px rgb(0 0 0 / .25) }
/* (hidden till shown, then IN starts it: a window that isn't on screen yet may not run its animations) */
body > div { opacity: 0 }
@keyframes takeover-in { from { opacity: 0; scale: .92 } to { opacity: 1; scale: 1 } } @keyframes takeover-out { from { opacity: 1 } to { opacity: 0; scale: .97 } }
@keyframes takeover-show { from { opacity: 0 } to { opacity: 1 } } @keyframes takeover-hide { from { opacity: 1 } to { opacity: 0 } }
@media (prefers-reduced-motion: reduce) { @keyframes takeover-in { from { opacity: 0 } to { opacity: 1 } } @keyframes takeover-out { from { opacity: 1 } to { opacity: 0 } } }
</style><body>${body}</body>`)}`
export const IN = `.card { animation: takeover-in .26s cubic-bezier(.2,.9,.3,1.2) both } .edge, .pill { animation: takeover-show .2s ease-out both }`
export const OUT = `.card { animation: takeover-out ${FADE_MS}ms ease-in both !important } .edge, .pill { animation: takeover-hide ${FADE_MS}ms ease-in both !important }`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const tintOf = (t: string) => HEX[t] ?? HEX.orange

function floating(b: Electron.Rectangle, mouse: boolean, sized = false) {
  const w = overlayWindow({ ...b, focusable: false, acceptFirstMouse: true, webPreferences: { sandbox: true, contextIsolation: true, javascript: false, enablePreferredSizeMode: sized } }, "screen")
  if (!mouse) takePointer(w, false)
  return w
}
/** Shown without taking focus, then faded in. */
function appear(w: BrowserWindow) {
  w.showInactive()
  void w.webContents.insertCSS(IN).catch(() => {})
}
/** Faded out, then gone; it takes no click meanwhile. */
function fadeAway(w: BrowserWindow | null) {
  if (!w || w.isDestroyed()) return
  if (!w.isVisible()) return void w.destroy()
  takePointer(w, false)
  void w.webContents.insertCSS(OUT).catch(() => {})
  setTimeout(() => { if (!w.isDestroyed()) w.destroy() }, FADE_MS + 40)
}

/** When they clicked a yes: their hand coming off it right after isn't them taking over. */
let yesClicked = 0
/** The offers up, by their request's id: several may be (a command asked while another waits), each answered alone. */
const cards = new Map<string, (a: Answer) => void>()
const shown = new Map<string, BrowserWindow>()
/** The take-over step's offer up (one at a time: its steps queue). */
let stepOffer: string | null = null
type Card = { line: string; sub: string; yes: string; name: string; tint: string; at: Point }
/** Offer `c` (their yes: a click on its yes, or said with the pointer by it) as `id`; `sent` once it's up. */
function offer(id: string, c: Card, sent: () => void, ms = OFFER_MS): Promise<Answer> {
  show(id, c)
  sent()
  return new Promise((done) => {
    const late = setTimeout(() => answered(id, "forgotten"), ms)
    cards.set(id, (a) => { clearTimeout(late); done(a) })
  })
}
function show(id: string, c: Card) {
  // (as tall as its words need: a long ask takes two or three lines, and the buttons stay in; below the ones up)
  const W = 368, d = screen.getDisplayNearestPoint(c.at).workArea
  const others = () => [...shown.entries()].filter(([k, w]) => k !== id && !w.isDestroyed()).map(([, w]) => w.getBounds())
  const place = (h: number) => ({ width: W, height: h, ...cardSpot(c.at, { width: W, height: h }, d, others()) })
  const w = floating(place(118), true, true)
  // (a scripted copy's is drawn but unseen: its Run is clicked through the page)
  quiet(w, w.webContents)
  shown.set(id, w)
  w.webContents.on("preferred-size-changed", (_e, size) => { if (!w.isDestroyed() && size.height > 0) w.setBounds({ ...w.getBounds(), height: Math.ceil(size.height) }) })
  w.webContents.on("will-navigate", (e, url) => {
    e.preventDefault()
    if (url === "takeover:yes") yesClicked = Date.now()
    answered(id, url === "takeover:yes" ? "yes" : "no")
  })
  void w.loadURL(offerPage(c.line, c.sub, c.yes, c.tint)).then(() => { if (shown.get(id) === w) appear(w) }, () => {})
}
export const offerPage = (line: string, sub: string, yes: string, tint: string) => page(`<style>:root { --tint: ${tintOf(tint)} }</style><div class="card"><div class="line">${esc(line)}</div>
<div class="sub">${esc(sub)}</div>
<div class="row"><a href="takeover:no">Not now</a><a class="yes" href="takeover:yes">${esc(yes)}</a></div></div>`)
const driveSub = (name: string) => `${name} will use your mouse and keys while you watch. Using your mouse pauses it; a click or Esc stops it.`
/** Offer `id` answered (null: every one up). */
function answered(id: string | null, how: Answer) {
  for (const k of id === null ? [...cards.keys()] : [id]) {
    const done = cards.get(k)
    cards.delete(k)
    fadeAway(shown.get(k) ?? null)
    shown.delete(k)
    if (stepOffer === k) stepOffer = null
    done?.(how)
  }
  // (the exchange may settle now: it waited on this)
  redraw()
}
/** An offer of the helper's own, no agent's step (turn the timeline on): by their pointer for `ms`, answered by a click
 *  or `offerSaid`. */
export const offerHere = (id: string, c: Omit<Card, "at">, ms: number) => offer(id, { ...c, at: screen.getCursorScreenPoint() }, () => {}, ms)
export function offerSaid(id: string, how: Answer) { if (cards.has(id)) answered(id, how) }
/** Their spoken answer: for the offer by their pointer, when several are up. */
function spoken(how: Answer) {
  if (how === "asked") return answered(null, how)
  const p = screen.getCursorScreenPoint()
  const id = aimedAt([...shown.entries()].filter(([k, w]) => cards.has(k) && !w.isDestroyed()).map(([k, w]) => ({ id: k, rect: w.getBounds() })), p) ?? [...cards.keys()].at(-1)
  if (id) answered(id, how)
}

let border: BrowserWindow | null = null, borderPaused: Promise<string> | null = null
function showBorder(name: string, tint: string, at: Point) {
  if (QUIET) return
  const d = screen.getDisplayNearestPoint(at)
  if (border && !border.isDestroyed()) { border.setBounds(d.bounds); return }
  const w = floating(d.bounds, false)
  border = w
  void w.loadURL(page(`<style>:root { --tint: ${tintOf(tint)} } .wait { display: none }</style><div class="edge"></div><div class="pill"><span class="go">${esc(name)} is using your Mac · click or press Esc to stop</span><span class="wait">${esc(name)} waits till you're done with the mouse</span></div>`))
    .then(() => { if (border === w) appear(w) }, () => {})
}
/** The border's pill says it waits while their hands are on it. */
function borderWaits(on: boolean) {
  const w = border
  if (!w || w.isDestroyed() || on === !!borderPaused) return
  if (on) borderPaused = w.webContents.insertCSS(".go { display: none } .wait { display: inline }").catch(() => "")
  else { const k = borderPaused; borderPaused = null; void k?.then((key) => { if (key && !w.isDestroyed()) void w.webContents.removeInsertedCSS(key).catch(() => {}) }) }
}
function hideBorder() { fadeAway(border); border = null; borderPaused = null }

// ---------- driving

/** Their yes for this exchange (whose, and since when). */
let consent: { agent: string; at: number } | null = null
/** While it drives: whether it moved the pointer, its end once no step comes, and its cursor's caption (what it does,
 *  or that it waits for their hands). */
type Drive = { name: string; moved: boolean; idle: ReturnType<typeof setTimeout> | null; stopped?: string; caption: string; paused: Hands | null; fade: ReturnType<typeof setTimeout> | null }
let drive: Drive | null = null
let queue: Promise<void> = Promise.resolve()
let redraw = () => {}

/** Driving ends: its steps done (their yes kept for the next), they stopped it (a click, Esc, typing where it typed),
 *  the exchange ended or another drives (it stops at once, their yes with it). */
function stop(why: string) {
  if (stepOffer) answered(stepOffer, "no")
  if (!keepsYes(why)) consent = null
  const d = drive
  if (!d) return
  d.stopped = why
  drive = null
  if (d.idle) clearTimeout(d.idle)
  if (d.fade) clearTimeout(d.fade)
  hideBorder()
  handsOff()
  redraw()
  // (done: their pointer glides back where they left it, unless they've had it since; stopped by them, it's theirs)
  if (helper.running()) void ask({ op: "release", back: d.moved && !why.startsWith("user") }, DID)
}
/** A step behind their windows, as its card shows it (helper.ts draws it): the window's live picture, the agent's cursor
 *  in it (where the step acts, as fractions of the window), and what it does. */
export type BehindCard = { agent: string; tint: string; app: string; title: string; img: string; aspect: number
  cursor: { x: number; y: number } | null; caption: string
  /** How the step ended: done (read back), or it couldn't tell (it offers to do it in front). */
  end?: "done" | "unsure" }
let card: BehindCard | null = null
/** The card of the step being done behind their windows, if one is. */
export const takeoverBehind = (): BehindCard | null => card
/** While it drives, the app in front changing is its doing, not their moving on. */
export const takeoverDriving = () => !!drive
/** Its cursor's caption while it drives (helper.ts draws it by its cursor): what it does, or that it waits for them. */
export function takeoverCaption(): { agent: string; text: string; paused: boolean } | null {
  const d = drive
  if (!d) return null
  if (d.paused) return { agent: d.name, text: pausedLine(d.paused), paused: true }
  return d.caption ? { agent: d.name, text: d.caption, paused: false } : null
}
function caption(d: Drive, text: string) {
  if (d.fade) clearTimeout(d.fade)
  d.fade = null
  if (d.caption === text) return
  d.caption = text
  redraw()
}
/** A click the exchange saw (true: take-over's, not their moving on): its own while it drives, theirs on its offer; a
 *  click away from the offer is a no. */
export function takeoverClick(x: number, y: number) {
  if (drive) return true
  if (!cards.size) return false
  const on = [...shown.values()].some((w) => { if (w.isDestroyed()) return false; const b = w.getBounds(); return x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height })
  if (on) return true
  answered(null, "no")
  return false
}
/** An offer waits for their answer: the exchange goes on till it's given (its turn waits on it). */
export const takeoverOffering = () => cards.size > 0
/** The exchange is over (Esc, they moved on): no more steps on its yes, and no offer left waiting. */
export const takeoverEnded = () => { answered(null, "no"); stop("ended") }

// ---------- their hands: on the mouse or the keys (takeover.swift's busy), till they're still a moment (rested)

type Hands = "mouse" | "keys"
let hands: Hands | null = null
let stilled: (() => void)[] = []
function handsOn(h: Hands) { hands = h }
function handsOff() { hands = null; for (const f of stilled.splice(0)) f() }
/** Before a step with the pointer or the keys: their hands off first, its caption and border saying it waits. false:
 *  nothing to wait for; true: it waited (what's there is looked at again); null: stopped, or they kept at it. */
async function calm(d: Drive): Promise<boolean | null> {
  if (!hands) return false
  const since = Date.now()
  while (hands && !d.stopped && Date.now() - since < PAUSED_MS) {
    if (d.paused !== hands) { d.paused = hands; borderWaits(true); redraw() }
    await new Promise<void>((done) => { stilled.push(done); setTimeout(done, 500) })
  }
  d.paused = null
  borderWaits(false)
  redraw()
  return d.stopped || hands ? null : true
}

async function driving(name: string, tint: string, at: Point): Promise<string | null> {
  if (drive && drive.name === name) { if (drive.idle) clearTimeout(drive.idle); drive.idle = null; return null }
  if (drive) stop("another")
  const g = await ask({ op: "guard", on: true, grace: handGrace(yesClicked, Date.now()), rest: REST_MS }, DID)
  yesClicked = 0
  if (!g.ok) return "it can't tell when they take back the mouse (Vaultite needs Accessibility): it won't drive blind"
  hands = null
  drive = { name, moved: false, idle: null, caption: "", paused: null, fade: null }
  showBorder(name, tint, at)
  return null
}
function idle() {
  const d = drive
  if (!d) return
  if (d.idle) clearTimeout(d.idle)
  d.idle = setTimeout(() => { if (drive === d) stop("done") }, DRIVE_MS)
  // (its caption stays a moment after the step, then goes unless the next one says another)
  if (d.fade) clearTimeout(d.fade)
  d.fade = setTimeout(() => { if (drive === d) { d.fade = null; d.caption = ""; redraw() } }, CAPTION_MS)
}
const pointerNow = (): Promise<Point> => ask({ op: "pointer" }, DID).then((p) => ({ x: p.x || 0, y: p.y || 0 }))
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const mid = (f: Rect): Point => ({ x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) })

type Done = { ok: boolean; [k: string]: Json }
type Ask = { id: string; agent: string; tint: string; step: Step; ask?: string; apps: string[]; sites: string[] }
/** Their yes, asked by `at` unless they gave it this exchange (a send, post or delete is asked each time, `out` naming
 *  it). null: go on; else what act answers. */
async function agree(m: Ask, out: string | null, line: string, at: Point, host: TakeoverHost): Promise<Done | null> {
  const agreed = consent?.agent === m.agent && Date.now() - consent.at < YES_MS
  if (out || !agreed) {
    if (stepOffer) answered(stepOffer, "no")
    stepOffer = m.id
    const said = await offer(m.id, { line: (out ?? line).slice(0, 120), sub: driveSub(m.agent), yes: "Do it", name: m.agent, tint: m.tint, at }, () => host.reply({ t: "takeover-asking", id: m.id, agent: m.agent, ms: OFFER_MS }))
    if (said !== "yes") return { ok: false, why: "declined", text: declined[said] }
    if (!out) consent = { agent: m.agent, at: Date.now() }
  }
  consent = consent ? { ...consent, at: Date.now() } : consent
  return null
}
const privateOf = (m: Ask, host: TakeoverHost) => (a: { bundle: string; name: string; url?: string }) => host.isPrivate(a) || privateApp(a, m.apps) || (!!a.url && siteIn(hostOf(a.url), m.sites))
async function run(m: Ask, host: TakeoverHost): Promise<Done> {
  const { step } = m
  if (step.app) return runBehind(m, host)
  const probeAt: Call = step.el ? { op: "probe", frame: step.el.frame, role: step.el.role ?? "", label: step.el.label ?? "" }
    : step.at ? { op: "probe", frame: { ...step.at, width: 1, height: 1 }, role: "", label: "" } : { op: "probe", focused: true }
  const hidden = privateOf(m, host)
  const there = await ask(probeAt, PROBE)
  const no = refusal(step, there, hidden)
  if (no) return { ok: false, why: "refused", text: no }
  const spot: Point = spotOf(step, there) ?? await pointerNow()
  // (the field with the keys: its cursor flies there too, as to an element)
  if (!step.el && !step.at) host.reply({ t: "takeover-at", id: m.id, agent: m.agent, sx: spot.x, sy: spot.y })
  // (sending out, or not yet agreed: asked first; a send is asked each time, naming it)
  const out = outward(step, there), no2 = await agree(m, out, m.ask?.trim() || `Want me to do it while you watch?`, spot, host)
  if (no2) return no2
  const blind = await driving(m.agent, m.tint, spot)
  if (blind) return { ok: false, why: "refused", text: blind }
  const d = drive!
  caption(d, intentOf(step, there))
  await wait(FLY_MS)
  if (d.stopped) return took(d.stopped)
  // (the offer may have waited: what's there now is checked again, and a send that wasn't offered isn't done)
  const now = await ask(probeAt, PROBE)
  const changed = refusal(step, now, hidden) ?? (outward(step, now) && !out ? "it changed into a send, post or delete since you offered: offer it again" : null)
  if (changed) { idle(); return { ok: false, why: "refused", text: changed } }
  // (their typing while this step types is into its field: theirs, so it stops; else their keys only pause it)
  await ask({ op: "expect", keys: types(step) }, DID)
  /** After waiting for their hands: where the step goes now (what's there looked at again), or why it can't go on. */
  const reaim = async (call: Call): Promise<Call | string> => {
    const fresh = await ask(probeAt, PROBE), gone = refusal(step, fresh, hidden) ?? (outward(step, fresh) && !out ? "it changed into a send, post or delete while they used the mouse: offer it again" : null)
    if (gone) return gone
    if (kindOf(call.op) === "keys") {
      if (step.el) return (await ask({ ...probeAt, op: "focus" }, DID)).ok ? call : "its field can't take the keys again after they used them: look again"
      return !now.frame || (fresh.frame && Math.abs(fresh.frame.x - now.frame.x) < 4 && Math.abs(fresh.frame.y - now.frame.y) < 4) ? call : "the keys went to another field while they typed: ask where to type"
    }
    if (call.x === undefined) return call
    // (the same element by its words, where it is now: their window may have moved or scrolled)
    const same = (e: { label?: string; role?: string }) => !step.el?.label || e.label === step.el.label
    let f = fresh.ok && same(fresh) ? fresh.frame : null
    if (!f && step.el) f = (await host.near({ x: Number(call.x), y: Number(call.y) }).catch(() => [])).find((e) => same(e) && (!step.el!.role || e.role === step.el!.role))?.frame ?? null
    if (!f && step.el) return `after they used the mouse, "${step.el.label || "it"}" isn't where it was: look again`
    if (step.at && (fresh.label ?? "") !== (now.label ?? "")) return "what's at that point changed while they used the mouse: look again"
    const p = f && step.el ? mid(f) : { x: Number(call.x), y: Number(call.y) }
    host.reply({ t: "takeover-at", id: m.id, agent: m.agent, sx: p.x, sy: p.y })
    return { ...call, ...p }
  }
  let did: z.output<typeof DID> | null = null, why = ""
  for (const attempt of plan(step, now)) {
    let ok = true
    for (let call of attempt) {
      const kind = kindOf(call.op)
      if (kind === "pointer") d.moved = true
      let r: z.output<typeof DID> = {}
      for (let tries = 0; tries < 20; tries++) {
        // (the pointer or the keys: only once their hands are off them; a step through Accessibility doesn't wait)
        if (kind !== "ax") {
          const waited = await calm(d)
          if (waited === null) return d.stopped ? took(d.stopped) : { ok: false, why: "stopped", text: tookText("paused") }
          if (waited) {
            const aimed = await reaim(call)
            if (typeof aimed === "string") { idle(); return { ok: false, why: "refused", text: aimed } }
            call = aimed
          }
        }
        r = await ask(call, DID, 60_000)
        if (d.stopped) return took(d.stopped)
        if (r.why !== "busy") break
        // (their hands came on it mid-way: what's typed stays, the rest goes once they're still)
        if (call.op === "type" && Number(r.typed) > 0) call = { ...call, text: String(call.text).slice(r.typed) }
      }
      if (!r.ok) { ok = false; why = String(r.why ?? ""); break }
      did = r
    }
    if (ok) { did ??= { how: "none" }; break }
    did = null
  }
  void ask({ op: "expect", keys: false }, DID)
  if (!did) { idle(); return { ok: false, why: "failed", text: why === "secure" ? "that's a password field: the companion never types secrets" : why === "vaultite" ? "that's Vaultite's own window: act there with --ui or --pane" : `it didn't work there (${why || "no way to"}): point at it again, or tell them how` } }
  idle()
  await wait(350)
  const near = await host.near(spot).catch(() => [])
  const after = await ask({ op: "probe", focused: true }, PROBE).catch(() => null)
  // (its element read back: whether the step did what it meant, the server judges from before and after)
  const target = step.el ? probeThing(await ask(probeAt, PROBE).catch(() => null)) : null, was = probeThing(now)
  return { ok: true, how: did.how, ...(did.moved === false ? { moved: false } : {}), ...(near.length ? { near } : {}), ...(was ? { before: was } : {}), ...(target ? { target } : {}),
    ...(after?.ok && !hidden({ bundle: after.bundle ?? "", name: after.name ?? "", url: after.url }) ? { app: after.name, title: after.title } : {}) }
}
const took = (why: string) => ({ ok: false, why: "stopped", text: tookText(why) })

// ---------- behind their windows: a step in an app's window they aren't looking at. No border, no pause for their
// hands: their pointer, keys and front app stay theirs. Its card shows the window, its cursor there and what it does.

/** Who acts in an app behind, till when: one agent an app at a time. */
const lease = new Map<number, { agent: string; until: number }>()
let cardIdle: ReturnType<typeof setTimeout> | null = null, cardWindow = 0, shots = 0
function showCard(c: BehindCard, window: number) {
  if (cardIdle) clearTimeout(cardIdle)
  cardIdle = null
  card = c
  redraw()
  if (cardWindow !== window) { cardWindow = window; void shoot(window, ++shots) }
}
/** Its window's picture, a few times a second while the card shows. */
async function shoot(window: number, gen: number) {
  while (card && gen === shots) {
    const r = await ask({ op: "shot", window, width: 320 }, DID, 4000)
    if (!card || gen !== shots) return
    if (r.ok && r.img) { card = { ...card, img: r.img, aspect: r.w && r.h ? r.w / r.h : card.aspect }; redraw() }
    await wait(r.ok ? 300 : 1000)
  }
}
function hideCard() { card = null; cardWindow = 0; shots++; if (cardIdle) clearTimeout(cardIdle); cardIdle = null; redraw() }
function endCard(end: "done" | "unsure") {
  if (!card) return
  card = { ...card, end }
  redraw()
  cardIdle = setTimeout(hideCard, DRIVE_MS)
}

async function runBehind(m: Ask, host: TakeoverHost): Promise<Done> {
  const step = m.step, app = step.app ?? ""
  const w = await ask({ op: "window", app }, WINDOW), hidden = privateOf(m, host)
  const no = behindRefusal(app, w)
  if (no) return { ok: false, why: "refused", text: no }
  if (hidden({ bundle: w.bundle ?? "", name: w.name ?? "" })) return { ok: false, why: "refused", text: "that app is private: the companion never acts there" }
  const name = w.name || app, at = { pid: w.pid, window: w.window }
  const probeAt: Call = step.find ? { op: "probe", find: step.find, role: step.role ?? "", ...at }
    : step.el ? { op: "probe", frame: step.el.frame, role: step.el.role ?? "", label: step.el.label ?? "", ...at }
    : step.at ? { op: "probe", frame: { ...step.at, width: 1, height: 1 }, role: "", label: "", ...at } : { op: "probe", focused: true, ...at }
  const there = await ask(probeAt, PROBE)
  if (step.find && !there.ok) return { ok: false, why: "refused", text: `nothing in ${name} says "${step.find}": check its words, or point with --sx --sy` }
  // (found by its words: from here on it's that element, by its frame)
  const s: Step = { ...step, find: undefined, ...(step.find && there.frame ? { el: { frame: there.frame, role: there.role ?? "", label: there.label ?? "" } } : {}) }
  const refused = refusal(s, there, hidden)
  if (refused) return { ok: false, why: "refused", text: refused }
  // (their own front app, in view, or a Mac that can't act behind: today's take-over, in front as they watch)
  if (inFront(w) || !w.behind) return run({ ...m, step: { ...s, app: undefined } }, host)
  const held = lease.get(w.pid ?? 0)
  if (held && held.agent !== m.agent && held.until > Date.now()) return { ok: false, why: "refused", text: `${held.agent} is working in ${name} right now: wait till they're done` }
  lease.set(w.pid ?? 0, { agent: m.agent, until: Date.now() + 60_000 })
  try {
    const spot = spotOf(s, there)
    const no2 = await agree(m, outward(s, there), m.ask?.trim() || `Want me to do it in ${name}, behind your window?`, await pointerNow(), host)
    if (no2) return no2
    showCard({ agent: m.agent, tint: m.tint, app: name, title: w.title ?? "", img: card && cardWindow === w.window ? card.img : "", aspect: w.frame ? w.frame.width / w.frame.height : 1.5,
      cursor: cursorIn(spot, w.frame), caption: intentOf(s, there) }, w.window ?? 0)
    await wait(FLY_MS)
    const probeEl: Call = s.el ? { op: "probe", frame: s.el.frame, role: s.el.role ?? "", label: s.el.label ?? "", ...at } : probeAt
    const read = async (): Promise<Readback> => {
      const d = await ask({ op: "digest", ...at }, DID), t = s.at ? null : await ask(probeEl, PROBE)
      return { digest: d.ok ? d.digest : undefined, ...(t?.ok && !t.secure && t.value !== undefined ? { value: t.value } : {}),
        ...(t?.checked !== undefined ? { checked: t.checked } : {}), ...(t?.expanded !== undefined ? { expanded: t.expanded } : {}) }
    }
    // (each way in turn, Accessibility first; each read back till its effect shows, else the next is tried)
    let before = await read(), how = "", why = "", ok = false
    for (const attempt of behindPlan(s, there)) {
      if (!attempt.length) { ok = true; how = "none"; break }
      let r: z.output<typeof DID> = { ok: true }
      for (const call of attempt) { r = await ask({ ...call, ...at }, DID, 60_000); if (!r.ok) break }
      if (!r.ok) { why = String(r.why ?? ""); continue }
      how = r.how ?? ""
      for (const since = Date.now(); !ok && Date.now() - since < SETTLE_MS; await wait(LOOK_MS)) ok = verified(s, before, await read())
      if (ok) break
      before = await read()
    }
    if (ok) {
      endCard("done")
      const target = s.el ? probeThing(await ask(probeEl, PROBE).catch(() => null)) : null, was = probeThing(there)
      return { ok: true, how, behind: true, app: name, title: w.title, ...(was ? { before: was } : {}), ...(target ? { target } : {}) }
    }
    endCard("unsure")
    if (why === "secure") return { ok: false, why: "failed", text: "that's a password field: the companion never types secrets" }
    // (not confirmed: today's take-over, in front, if they want it; they see the window before anything's done)
    if (stepOffer) answered(stepOffer, "no")
    stepOffer = `${m.id}-front`
    const said = await offer(stepOffer, { line: unsureLine(name), sub: driveSub(m.agent), yes: "Bring it forward", name: m.agent, tint: m.tint, at: await pointerNow() },
      () => host.reply({ t: "takeover-asking", id: m.id, agent: m.agent, ms: OFFER_MS }))
    if (said !== "yes") return { ok: false, why: "unsure", text: `it couldn't tell whether that worked in ${name} behind their window${why ? ` (${why})` : ""}: look (vau companion check), or ask them` }
    await ask({ op: "raise", ...at }, DID)
    hideCard()
    await wait(300)
    consent = { agent: m.agent, at: Date.now() }
    return run({ ...m, step: { ...s, app: undefined } }, host)
  } finally { lease.set(w.pid ?? 0, { agent: m.agent, until: Date.now() + DRIVE_MS }) }
}

export function takeoverHeard(m: TakeoverMessage, host: TakeoverHost) {
  redraw = host.redraw
  if (m.t === "takeover-answer") return void (cards.size && spoken(m.yes ? "yes" : m.asked ? "asked" : "no"))
  if (m.t === "confirm") return void confirm(m, host)
  if (!m.step) return void host.reply({ t: "takeover-done", id: m.id, ok: false, why: "refused", text: "that isn't a step take-over knows: an action, and an element (its frame), a point or neither" })
  const req = { id: m.id, agent: m.agent, tint: m.tint, step: m.step, ...(m.ask !== undefined ? { ask: m.ask } : {}), apps: m.apps, sites: m.sites }
  queue = queue.then(() => run(req, host).catch((e: Error) => ({ ok: false, why: "failed", text: e.message })).then((r) => host.reply({ t: "takeover-done", id: req.id, ...r })))
}

/** The server's `confirm`: their yes or no to `line` (a command to run), by their pointer, apart from any step's. */
async function confirm(m: Extract<TakeoverMessage, { t: "confirm" }>, host: TakeoverHost) {
  const { id, agent: name } = m
  const said = await offer(id, { line: m.line.slice(0, 160), sub: m.sub, yes: "Run", name, tint: m.tint, at: screen.getCursorScreenPoint() },
    () => host.reply({ t: "takeover-asking", id, agent: name, ms: OFFER_MS }))
  host.reply({ t: "takeover-done", id, ok: said === "yes", why: said })
}
