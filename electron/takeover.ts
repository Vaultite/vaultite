/** Take-over (the helper's): the companion doing a step in another app as the user watches: an offer first, a border
 *  while it drives, their mouse or a key stops it; the steps are takeover.swift's (takeoverlogic.ts says how). */
import { app, BrowserWindow, screen } from "electron"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { HEX } from "../plugins/core/companion/screenmarks.ts"
import { buildTakeover, takeoverHelperName } from "./takeover-build.ts"
import { privateApp } from "../core/privateapps.ts"
import { hostOf, siteIn } from "../plugins/core/companion/places.ts"
import { type Call, handGrace, keepsYes, outward, plan, type Probe, type Rect, refusal, spotOf, type Step } from "./takeoverlogic.ts"

type Point = { x: number; y: number }
type Near = { id: string; role: string; label: string; frame: Rect }
/** What helper.ts lends it: its socket to the server, the private apps, and what's near a point (its ids, as an ask's). */
export type TakeoverHost = { reply: (m: object) => void; isPrivate: (a: { bundle: string; name: string }) => boolean; near: (p: Point) => Promise<Near[]> }

const QUIET = !!process.env.VAULTITE_QUIET
/** How long its cursor takes to fly to a step before it's done, and how long it keeps driving after one for the next. */
const FLY_MS = 450, DRIVE_MS = 2500
/** How long an offer waits for their answer, and how long a yes lasts with no step (the exchange ends it sooner). */
const OFFER_MS = 30_000, YES_MS = 120_000
/** How long the offer and the border take to fade out (the page's takeover-out). */
const FADE_MS = 160

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
let answer: ((yes: boolean) => void) | null = null
/** Offer `line` by `at` (their yes: a click on Do it, or said); false on No, Esc, the exchange ending, or no answer. */
function offer(line: string, name: string, tint: string, at: Point, sent: () => void): Promise<boolean> {
  answered(false)
  if (!QUIET) show(line, name, tint, at)
  sent()
  return new Promise((done) => {
    const late = setTimeout(() => { if (answer === settle) answered(false) }, OFFER_MS)
    const settle = (yes: boolean) => { clearTimeout(late); done(yes) }
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
    answered(url === "takeover:yes")
  })
  void w.loadURL(offerPage(line, name, tint)).then(() => { if (card === w) appear(w) }, () => {})
}
export const offerPage = (line: string, name: string, tint: string) => page(`<style>:root { --tint: ${tintOf(tint)} }</style><div class="card"><div class="line">${esc(line)}</div>
<div class="sub">${esc(name)} will use your mouse and keys while you watch. Move the mouse or press Esc to stop.</div>
<div class="row"><a href="takeover:no">Not now</a><a class="yes" href="takeover:yes">Do it</a></div></div>`)
function answered(yes: boolean) {
  const a = answer
  answer = null
  fadeAway(card)
  card = null
  a?.(yes)
}

let border: BrowserWindow | null = null
function showBorder(name: string, tint: string, at: Point) {
  if (QUIET) return
  const d = screen.getDisplayNearestPoint(at)
  if (border && !border.isDestroyed()) { border.setBounds(d.bounds); return }
  const w = floating(d.bounds, false)
  border = w
  void w.loadURL(page(`<style>:root { --tint: ${tintOf(tint)} }</style><div class="edge"></div><div class="pill">${esc(name)} is using your Mac · move the mouse or press Esc to take over</div>`))
    .then(() => { if (border === w) appear(w) }, () => {})
}
function hideBorder() { fadeAway(border); border = null }

// ---------- driving

/** Their yes for this exchange (whose, and since when). */
let consent: { agent: string; at: number } | null = null
/** While it drives: where the pointer was, whether it moved it, and its end once no step comes. */
let drive: { name: string; pointer: Point | null; moved: boolean; idle: ReturnType<typeof setTimeout> | null; stopped?: string } | null = null
let queue: Promise<void> = Promise.resolve()

/** Driving ends: its steps done (their yes kept for the next), or they took it back (moved the mouse, a key, Esc), the
 *  exchange ended or another drives (it stops at once, their yes with it). */
function stop(why: string) {
  answered(false)
  if (!keepsYes(why)) consent = null
  const d = drive
  if (!d) return
  d.stopped = why
  drive = null
  if (d.idle) clearTimeout(d.idle)
  hideBorder()
  void ask({ op: "guard", on: false })
  // (moved the mouse: the pointer is theirs where it is; else it goes back where it was)
  if (d.moved && d.pointer && why !== "user-mouse") void ask({ op: "warp", ...d.pointer })
}
/** While it drives, the app in front changing is its doing, not their moving on. */
export const takeoverDriving = () => !!drive
/** A click the exchange saw (true: take-over's, not their moving on): its own while it drives, theirs on its offer; a
 *  click away from the offer is a no. */
export function takeoverClick(x: number, y: number) {
  if (drive) return true
  if (!card || card.isDestroyed()) return false
  const b = card.getBounds()
  if (x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height) return true
  answered(false)
  return false
}
/** The exchange is over (Esc, they moved on): no more steps on its yes. */
export const takeoverEnded = () => stop("ended")

async function driving(name: string, tint: string, at: Point): Promise<string | null> {
  if (drive && drive.name === name) { if (drive.idle) clearTimeout(drive.idle); drive.idle = null; return null }
  if (drive) stop("another")
  const g = await ask<{ ok?: boolean }>({ op: "guard", on: true, grace: handGrace(yesClicked, Date.now()) })
  yesClicked = 0
  if (!g.ok) return "it can't tell when they take back the mouse (Vaultite needs Accessibility): it won't drive blind"
  const p = await ask<{ ok?: boolean; x?: number; y?: number }>({ op: "pointer" })
  drive = { name, pointer: p.ok ? { x: Number(p.x), y: Number(p.y) } : null, moved: false, idle: null }
  showBorder(name, tint, at)
  return null
}
function idle() {
  const d = drive
  if (!d) return
  if (d.idle) clearTimeout(d.idle)
  d.idle = setTimeout(() => { if (drive === d) stop("done") }, DRIVE_MS)
}
const pointerNow = (): Promise<Point> => ask<{ x?: number; y?: number }>({ op: "pointer" }).then((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

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
    const yes = await offer(line.slice(0, 120), m.agent, m.tint, spot, () => host.reply({ t: "takeover-asking", id: m.id, agent: m.agent }))
    if (!yes) return { ok: false, why: "declined", text: "they didn't say yes: don't do it; tell them how in a few words instead, or ask again only if they ask you to" }
    if (!out) consent = { agent: m.agent, at: Date.now() }
  }
  consent = consent ? { ...consent, at: Date.now() } : consent
  const blind = await driving(m.agent, m.tint, spot)
  if (blind) return { ok: false, why: "refused", text: blind }
  const d = drive!
  // (its cursor flies there first, so every step is seen)
  await wait(FLY_MS)
  if (d.stopped) return took(d.stopped)
  // (the offer may have waited: what's there now is checked again, and a send that wasn't offered isn't done)
  const now = await ask<Probe>(probeAt)
  const changed = refusal(step, now, hidden) ?? (outward(step, now) && !out ? "it changed into a send, post or delete since you offered: offer it again" : null)
  if (changed) { idle(); return { ok: false, why: "refused", text: changed } }
  let did: Record<string, unknown> | null = null, why = ""
  for (const attempt of plan(step, now)) {
    let ok = true
    for (const call of attempt) {
      if (["click", "hover", "scroll"].includes(call.op)) d.moved = true
      const r = await ask(call, 60_000)
      if (d.stopped) return took(d.stopped)
      if (!r.ok) { ok = false; why = String(r.why ?? ""); break }
      did = r
    }
    if (ok) { did ??= { how: "none" }; break }
    did = null
  }
  if (!did) { idle(); return { ok: false, why: "failed", text: why === "secure" ? "that's a password field: the companion never types secrets" : why === "vaultite" ? "that's Vaultite's own window: act there with --ui or --pane" : `it didn't work there (${why || "no way to"}): point at it again, or tell them how` } }
  idle()
  // (what's there now, by fresh ids: the next step points at those)
  await wait(350)
  const near = await host.near(spot).catch(() => [])
  const after = await ask<Probe>({ op: "probe", focused: true }).catch(() => null)
  return { ok: true, how: did.how, ...(near.length ? { near } : {}), ...(after?.ok && !hidden({ bundle: after.bundle ?? "", name: after.name ?? "", url: after.url }) ? { app: after.name, title: after.title } : {}) }
}
const took = (why: string) => ({ ok: false, why: "stopped", text: why.startsWith("user") ? `they took over (${why === "user-mouse" ? "moved the mouse" : "pressed a key"}): stop, and don't act again unless they ask` : "the exchange ended: stop" })

/** The server's take-over messages: a step to do (`takeover`), their spoken answer to an offer (`takeover-answer`). */
export function takeoverHeard(m: Record<string, unknown>, host: TakeoverHost) {
  if (m.t === "takeover-answer") return void (answer && answered(m.yes === true))
  if (m.t !== "takeover" || typeof m.id !== "string" || !m.step || typeof m.step !== "object") return
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : [])
  const req = { id: m.id, agent: String(m.agent ?? ""), tint: String(m.tint ?? "orange"), step: m.step as Step, ...(typeof m.ask === "string" ? { ask: m.ask } : {}), apps: list(m.apps), sites: list(m.sites) }
  queue = queue.then(() => run(req, host).catch((e: Error) => ({ ok: false, why: "failed", text: e.message })).then((r) => host.reply({ t: "takeover-done", id: req.id, ...r })))
}
