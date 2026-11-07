/** Take-over (the helper's): a step in another app as the user watches (an offer, a border, its cursor's caption); a
 *  click or Esc stops it, their hands on it pause what needs them; the steps are takeover.swift's (takeoverlogic.ts). */
import { app, BrowserWindow, screen } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { HEX } from "../plugins/core/companion/screenmarks.ts"
import { buildTakeover, takeoverHelperName } from "./takeover-build.ts"
import { privateApp } from "../core/privateapps.ts"
import { hostOf, siteIn } from "../plugins/core/companion/places.ts"
import { type Answer, type Call, declined, handGrace, intentOf, keepsYes, kindOf, OFFER_MS, outward, PAUSED_MS, pausedLine, plan, type Probe, type Rect, refusal, REST_MS,
  spotOf, type Step, tookText, types } from "./takeoverlogic.ts"

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

let child: ChildProcess | null = null
let starting: Promise<ChildProcess> | null = null
let next = 1
const waiting = new Map<number, (r: Record<string, unknown>) => void>()
async function binary() {
  const shipped = path.join(import.meta.dirname, "bin", takeoverHelperName())
  return fs.existsSync(shipped) ? shipped : buildTakeover(path.join(app.getPath("userData"), "bin"))
}
function started(): Promise<ChildProcess> {
  if (child && child.exitCode === null && !child.killed) return Promise.resolve(child)
  starting ??= binary().then((bin) => {
    const c = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] })
    let buf = ""
    c.stdout!.on("data", (b: Buffer) => {
      buf += b.toString()
      for (let i; (i = buf.indexOf("\n")) >= 0;) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        let m: Record<string, unknown>
        try { m = JSON.parse(line) } catch { continue }
        if (typeof m.id === "number") { waiting.get(m.id)?.(m); waiting.delete(m.id) }
        else if (m.event === "user") stop(`user-${String(m.why)}`)
        else if (m.event === "busy") handsOn(m.why === "keys" ? "keys" : "mouse")
        else if (m.event === "rested") handsOff()
      }
    })
    c.stdin!.on("error", () => {})
    c.once("exit", () => {
      if (child !== c) return
      child = null
      for (const done of waiting.values()) done({ ok: false, why: "helper" })
      waiting.clear()
    })
    child = c
    return c
  }).finally(() => { starting = null })
  return starting
}
async function ask<T = Record<string, unknown>>(call: Call, ms = 15_000): Promise<T> {
  const c = await started()
  const id = next++
  return new Promise((done) => {
    const timer = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "timeout" } as T) }, ms)
    waiting.set(id, (m) => { clearTimeout(timer); done(m as T) })
    c.stdin!.write(JSON.stringify({ ...call, id }) + "\n")
  })
}
export function stopTakeover() {
  stop("quit")
  const c = child
  child = null
  c?.stdin?.end()
  if (c) setTimeout(() => { if (c.exitCode === null) c.kill() }, 2000)
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
  const w = new BrowserWindow({ ...b, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, focusable: false, skipTaskbar: true, show: false, type: "panel", acceptFirstMouse: true, backgroundColor: "#00000000",
    webPreferences: { sandbox: true, contextIsolation: true, javascript: false, enablePreferredSizeMode: sized } })
  if (!mouse) w.setIgnoreMouseEvents(true)
  // (as the overlay's: every Space, over full screen apps, and the app stays in the Dock)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver")
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
  w.setIgnoreMouseEvents(true)
  void w.webContents.insertCSS(OUT).catch(() => {})
  setTimeout(() => { if (!w.isDestroyed()) w.destroy() }, FADE_MS + 40)
}

let card: BrowserWindow | null = null
/** When they clicked Do it: their hand coming off it right after isn't them taking over. */
let yesClicked = 0
let answer: ((a: Answer) => void) | null = null
/** Offer `line` by `at` (their yes: a click on Do it, or said). */
function offer(line: string, name: string, tint: string, at: Point, sent: () => void): Promise<Answer> {
  answered("no")
  if (!QUIET) show(line, name, tint, at)
  sent()
  return new Promise((done) => {
    const late = setTimeout(() => { if (answer === settle) answered("forgotten") }, OFFER_MS)
    const settle = (a: Answer) => { clearTimeout(late); done(a) }
    answer = settle
  })
}
function show(line: string, name: string, tint: string, at: Point) {
  // (as tall as its words need: a long ask takes two or three lines, and the buttons stay in)
  const W = 368, d = screen.getDisplayNearestPoint(at).workArea
  const place = (h: number) => ({ width: W, height: h, x: Math.round(Math.min(Math.max(at.x + 18, d.x + 8), d.x + d.width - W - 8)),
    y: Math.round(Math.min(Math.max(at.y + 18, d.y + 8), d.y + d.height - h - 8)) })
  const w = floating(place(118), true, true)
  card = w
  w.webContents.on("preferred-size-changed", (_e, size) => { if (!w.isDestroyed() && size.height > 0) w.setBounds(place(Math.ceil(size.height))) })
  w.webContents.on("will-navigate", (e, url) => {
    e.preventDefault()
    if (url === "takeover:yes") yesClicked = Date.now()
    answered(url === "takeover:yes" ? "yes" : "no")
  })
  void w.loadURL(offerPage(line, name, tint)).then(() => { if (card === w) appear(w) }, () => {})
}
export const offerPage = (line: string, name: string, tint: string) => page(`<style>:root { --tint: ${tintOf(tint)} }</style><div class="card"><div class="line">${esc(line)}</div>
<div class="sub">${esc(name)} will use your mouse and keys while you watch. Using your mouse pauses it; a click or Esc stops it.</div>
<div class="row"><a href="takeover:no">Not now</a><a class="yes" href="takeover:yes">Do it</a></div></div>`)
function answered(how: Answer) {
  const a = answer
  answer = null
  fadeAway(card)
  card = null
  a?.(how)
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
  answered("no")
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
  void ask({ op: "release", back: d.moved && !why.startsWith("user") })
}
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
  if (!card || card.isDestroyed()) return false
  const b = card.getBounds()
  if (x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height) return true
  answered("no")
  return false
}
/** The exchange is over (Esc, they moved on): no more steps on its yes. */
export const takeoverEnded = () => stop("ended")

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
  const g = await ask<{ ok?: boolean }>({ op: "guard", on: true, grace: handGrace(yesClicked, Date.now()), rest: REST_MS })
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
const pointerNow = (): Promise<Point> => ask<{ x?: number; y?: number }>({ op: "pointer" }).then((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const mid = (f: Rect): Point => ({ x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) })

type Ask = { id: string; agent: string; tint: string; step: Step; ask?: string; apps: string[]; sites: string[] }
async function run(m: Ask, host: TakeoverHost): Promise<Record<string, unknown>> {
  const { step } = m
  const probeAt: Call = step.el ? { op: "probe", frame: step.el.frame, role: step.el.role ?? "", label: step.el.label ?? "" }
    : step.at ? { op: "probe", frame: { ...step.at, width: 1, height: 1 }, role: "", label: "" } : { op: "probe", focused: true }
  // (private: the screen plugin's apps, and the companion's own apps and sites, the server's)
  const hidden = (a: { bundle: string; name: string; url?: string }) => host.isPrivate(a) || privateApp(a, m.apps) || (!!a.url && siteIn(hostOf(a.url), m.sites))
  const there = await ask<Probe>(probeAt)
  const no = refusal(step, there, hidden)
  if (no) return { ok: false, why: "refused", text: no }
  const spot: Point = spotOf(step, there) ?? await pointerNow()
  // (the field with the keys: its cursor flies there too, as to an element)
  if (!step.el && !step.at) host.reply({ t: "takeover-at", id: m.id, agent: m.agent, sx: spot.x, sy: spot.y })
  // (sending out, or not yet agreed: asked first; a send is asked each time, naming it)
  const out = outward(step, there), agreed = consent?.agent === m.agent && Date.now() - consent.at < YES_MS
  if (out || !agreed) {
    const line = out ?? (m.ask?.trim() || `Want me to do it while you watch?`)
    const said = await offer(line.slice(0, 120), m.agent, m.tint, spot, () => host.reply({ t: "takeover-asking", id: m.id, agent: m.agent, ms: OFFER_MS }))
    if (said !== "yes") return { ok: false, why: "declined", text: declined[said] }
    if (!out) consent = { agent: m.agent, at: Date.now() }
  }
  consent = consent ? { ...consent, at: Date.now() } : consent
  const blind = await driving(m.agent, m.tint, spot)
  if (blind) return { ok: false, why: "refused", text: blind }
  const d = drive!
  // (its cursor flies there first with its caption, so every step is seen and said)
  caption(d, intentOf(step, there))
  await wait(FLY_MS)
  if (d.stopped) return took(d.stopped)
  // (the offer may have waited: what's there now is checked again, and a send that wasn't offered isn't done)
  const now = await ask<Probe>(probeAt)
  const changed = refusal(step, now, hidden) ?? (outward(step, now) && !out ? "it changed into a send, post or delete since you offered: offer it again" : null)
  if (changed) { idle(); return { ok: false, why: "refused", text: changed } }
  // (their typing while this step types is into its field: theirs, so it stops; else their keys only pause it)
  await ask({ op: "expect", keys: types(step) })
  /** After waiting for their hands: where the step goes now (what's there looked at again), or why it can't go on. */
  const reaim = async (call: Call): Promise<Call | string> => {
    const fresh = await ask<Probe>(probeAt), gone = refusal(step, fresh, hidden) ?? (outward(step, fresh) && !out ? "it changed into a send, post or delete while they used the mouse: offer it again" : null)
    if (gone) return gone
    if (kindOf(call.op) === "keys") {
      if (step.el) return (await ask({ ...probeAt, op: "focus" })).ok ? call : "its field can't take the keys again after they used them: look again"
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
  let did: Record<string, unknown> | null = null, why = ""
  for (const attempt of plan(step, now)) {
    let ok = true
    for (let call of attempt) {
      const kind = kindOf(call.op)
      if (kind === "pointer") d.moved = true
      let r: Record<string, unknown> = {}
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
        r = await ask(call, 60_000)
        if (d.stopped) return took(d.stopped)
        if (r.why !== "busy") break
        // (their hands came on it mid-way: what's typed stays, the rest goes once they're still)
        if (call.op === "type" && Number(r.typed) > 0) call = { ...call, text: String(call.text).slice(Number(r.typed)) }
      }
      if (!r.ok) { ok = false; why = String(r.why ?? ""); break }
      did = r
    }
    if (ok) { did ??= { how: "none" }; break }
    did = null
  }
  void ask({ op: "expect", keys: false })
  if (!did) { idle(); return { ok: false, why: "failed", text: why === "secure" ? "that's a password field: the companion never types secrets" : why === "vaultite" ? "that's Vaultite's own window: act there with --ui or --pane" : `it didn't work there (${why || "no way to"}): point at it again, or tell them how` } }
  idle()
  // (what's there now, by fresh ids: the next step points at those)
  await wait(350)
  const near = await host.near(spot).catch(() => [])
  const after = await ask<Probe>({ op: "probe", focused: true }).catch(() => null)
  return { ok: true, how: did.how, ...(did.moved === false ? { moved: false } : {}), ...(near.length ? { near } : {}),
    ...(after?.ok && !hidden({ bundle: after.bundle ?? "", name: after.name ?? "", url: after.url }) ? { app: after.name, title: after.title } : {}) }
}
const took = (why: string) => ({ ok: false, why: "stopped", text: tookText(why) })

/** The server's take-over messages: a step to do (`takeover`), their spoken answer to an offer (`takeover-answer`). */
export function takeoverHeard(m: Record<string, unknown>, host: TakeoverHost) {
  if (m.t === "takeover-answer") return void (answer && answered(m.yes === true ? "yes" : m.asked === true ? "asked" : "no"))
  if (m.t !== "takeover" || typeof m.id !== "string" || !m.step || typeof m.step !== "object") return
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : [])
  const req = { id: m.id, agent: String(m.agent ?? ""), tint: String(m.tint ?? "orange"), step: m.step as Step, ...(typeof m.ask === "string" ? { ask: m.ask } : {}), apps: list(m.apps), sites: list(m.sites) }
  redraw = host.redraw
  queue = queue.then(() => run(req, host).catch((e: Error) => ({ ok: false, why: "failed", text: e.message })).then((r) => host.reply({ t: "takeover-done", id: req.id, ...r })))
}
