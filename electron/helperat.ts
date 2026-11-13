import { app, nativeImage, screen, type WebContents } from "electron"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import { byLabel } from "../core/desktop/screenmarks.ts"
import { thingFrom, type Thing } from "../core/desktop/uimodel.ts"
import type { WalkPlace } from "../core/desktop/walks.ts"
import { cursorPlaces, placeKey } from "./cursorplaces.ts"
import { inApp } from "./cursorhandoff.ts"
import { bitmapsDiffer, closeCrop, floatingOver, offsetIn, openArgs, openedBundle, type Point, type ScreenWindow, THUMB } from "./helperlogic.ts"
import { overlayNumbers } from "./overlaywin.ts"
import { displayShot as shootDisplay, type AppWindowInfo, type Rect } from "./screen.ts"
import { clickedAt } from "./teach.ts"
import { happened, timelineOn } from "./timeline.ts"
import { displayShot, QUIET, screenAsk, SHOTS } from "./helperask.ts"
import { type Agent, draw, front, hidden, host, type Shot } from "./helperbase.ts"
import { live } from "./helperlive.ts"
import { ELEMENTS, type ScreenEvent, TEXT, UNDER, WINDOW, WINDOWS } from "./screenwire.ts"
import type { LiveMessage } from "./homewire.ts"

/** A closer look at what an ask points at (helperlogic.ts closeCrop): what they drew round, else by the pointer, at more
 *  pixels a point than its picture, for what's too small to read there (a logo, an icon); their rings or pointer on it. */
export async function closeShot(p: Point, drawn: Rect[]) {
  const c = QUIET ? null : closeCrop(screen.getDisplayNearestPoint(p).bounds, p, drawn)
  const r = c ? await shootDisplay(p, await excluded(), SHOTS(), c.crop, c.scale, drawn.length ? { rings: drawn } : { pointer: p }).catch(() => null) : null
  return r && c ? { shot: r.file, at: r.frame, scale: c.scale, mark: drawn.length ? "ring" : "pointer" } : null
}
export function leave(name: string) {
  places.unpark(name)
  live.say({ t: "home", agent: name })
}
/** Whether two pictures of the display differ where they overlap (a toast, a menu: not a caret's blink), each read
 *  small; mostly apart, they're taken as changed. */
export function shotChanged(a: Shot, b: Shot) {
  const x = Math.max(a.frame.x, b.frame.x), y = Math.max(a.frame.y, b.frame.y)
  const w = Math.min(a.frame.x + a.frame.width, b.frame.x + b.frame.width) - x, h = Math.min(a.frame.y + a.frame.height, b.frame.y + b.frame.height) - y
  if (w < a.frame.width / 2 || h < a.frame.height / 2) return true
  const small = (s: Shot) => {
    const img = nativeImage.createFromPath(s.file), k = img.getSize().width / s.frame.width
    if (img.isEmpty() || !k) return null
    return img.crop({ x: Math.round((x - s.frame.x) * k), y: Math.round((y - s.frame.y) * k), width: Math.round(w * k), height: Math.round(h * k) }).resize({ width: THUMB.w, height: THUMB.h, quality: "good" }).toBitmap()
  }
  const [p, q] = [small(a), small(b)]
  return !!p && !!q && bitmapsDiffer(p, q)
}
/** While what the companion opened comes to the front: that's its doing, not their moving on. */
export let openedUntil = 0
/** What the companion opens on this Mac, as a user could, then what's in front and in it, by id (as an ask's elements:
 *  what it points at, rings and acts on next). */
export async function openOn(m: Extract<LiveMessage, { t: "open" }>) {
  const reply = (r: object) => live.say({ t: "takeover-done", id: m.id, ...r })
  const o = { url: m.url, app: m.app, path: m.path }
  const args = openArgs(o, os.homedir())
  if (!Array.isArray(args)) return reply({ ok: false, why: "failed", text: args.why })
  if (o.path && !fs.existsSync(args.at(-1)!)) return reply({ ok: false, why: "failed", text: `there's no ${o.path} on this Mac` })
  if (QUIET) return reply({ ok: true, how: "open", args })
  const was = front?.window, wasTitle = front?.title, want = openedBundle(o)
  openedUntil = Date.now() + 10_000
  const failed = await new Promise<string>((done) => execFile("/usr/bin/open", args, { timeout: 10_000 }, (e, _out, err) => done(e ? String(err || e.message).trim().split("\n")[0] : "")))
  if (failed) return reply({ ok: false, why: "failed", text: `it didn't open: ${failed}` })
  // (its window, once there: an app starting takes seconds; then a moment for its content, which System Settings fills after)
  let w: AppWindowInfo | null = null
  for (const until = Date.now() + 8000; Date.now() < until;) {
    await new Promise((r) => setTimeout(r, 150))
    if (!want && !(front && front.window !== was)) continue
    w = await screenAsk("window", { window: 0, bundle: want || front?.bundle || "" }, WINDOW).catch(() => null)
    if (w?.window) break
  }
  if (!w?.window || hidden(w)) return reply({ ok: true, how: "open" })
  // (an app already open shows another pane in the same window: its title changes; then its elements, once they settle)
  for (const until = Date.now() + 1500; was === w.window && Date.now() < until && w.title === wasTitle;) {
    await new Promise((r) => setTimeout(r, 150))
    w = (await screenAsk("window", { window: w.window }, WINDOW).catch(() => null)) ?? w
  }
  const f = w.frame
  let near: Near[] = []
  for (let n = -1, since = Date.now(); f && Date.now() - since < 4000 && (near.length !== n || Date.now() - since < 1200);) { n = near.length; await new Promise((r) => setTimeout(r, 400)); near = await nearIn(f, w.window) }
  reply({ ok: true, how: "open", app: w.name, bundle: w.bundle, title: w.title, ...(f ? { frame: f } : {}), near })
}
/** A window's elements by id, from its middle out: what an ask's would be with the pointer there (finds search it). */
async function nearIn(f: Rect, window: number) {
  nearPoint = { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) }
  nearWindow = window
  lastNear = (await axThings(nearPoint, Math.max(f.width, f.height), 40, window)).map((e, i) => ({ ...e, id: `a${i + 1}` }))
  return lastNear
}
/** A click or a key while a companion's wait listens: a click with what's under it (never in a private app or
 *  Vaultite's own window, which tells its own); a key only that one was typed. */
let typedAt = 0
export async function inputHeard(m: Extract<ScreenEvent, { event: "input" }>) {
  if (m.kind === "type") { if (Date.now() - typedAt < 300) return; typedAt = Date.now() }
  if (m.kind !== "click") return void live.say({ t: "input", kind: m.kind })
  const x = Number(m.x), y = Number(m.y), u = await screenAsk("under", { x, y }, UNDER).catch(() => null)
  if (u?.vaultite || (u?.ok && hidden(u))) return
  live.say({ t: "input", kind: "click", x, y, ...(u?.ok && u.label ? { label: u.label, role: u.role } : {}) })
}
/** The element saying a mark's words in the window the last ask was over: its whole Accessibility tree, not only by
 *  the pointer. Answered as a step is. */
export async function findIn(m: Extract<LiveMessage, { t: "find" }>) {
  const p = nearPoint ?? screen.getCursorScreenPoint()
  const el = byLabel(await axThings(p, 5000, 400, nearWindow), m.text)
  live.say({ t: "takeover-done", id: m.id, ...(el ? { ok: true, found: { id: "", ...el } } : { ok: false, why: "none" }) })
}
/** What's under a point of the screen, in words (`Finder: folder "Taxes", in "Desktop"`); null on Vaultite, nothing, or a
 *  private app's. */
export async function underAt(p: Point): Promise<{ text: string; bundle: string; name: string } | null> {
  const u = await screenAsk("under", { x: p.x, y: p.y }, UNDER).catch(() => null)
  if (!u?.ok || u.vaultite || hidden(u)) return null
  const what = [u.role, u.label && JSON.stringify(u.label)].filter(Boolean).join(" ")
  if (!what) return null
  return { text: `${u.name || u.bundle}: ${what}${u.in && u.in !== u.label ? `, in ${JSON.stringify(u.in)}` : ""}`, bundle: u.bundle ?? "", name: u.name ?? "" }
}
const screenWindows = async () => (await screenAsk("windows", {}, WINDOWS).catch(() => null))?.windows ?? []
/** What a picture or a recording leaves out: our windows and a private app's (capture.swift leaves out their whole app too). */
const leftOut = (all: ScreenWindow[]) => [...overlayNumbers(), ...all.filter((w) => hidden(w)).map((w) => w.window)]
export const excluded = async () => leftOut(await screenWindows())
/** The display under `p` as a picture, without what's left out; and other apps' panels floating on it. */
export async function shotAt(p: Point) {
  const all = await screenWindows()
  return { shot: await displayShot(p, leftOut(all)), floating: floatingOver(all, screen.getDisplayNearestPoint(p).bounds, hidden) }
}
/** A thing near the pointer, in the UI model's shape; `ax`: its Accessibility role, to find it again by. */
type Near = Thing & { ax?: string }
/** The last ask's elements near the pointer, by id (global screen points): what `--ax` and drawings point at. */
export let lastNear: (Near & { id: string })[] = []
/** Where the last ask's elements were looked for: the window a find searches (by its number, one the companion opened). */
export let nearPoint: Point | null = null, nearWindow = 0
/** Every thing Accessibility lists in the window under `p` (not Vaultite's), nearest first: what a check or an anchor
 *  reads in another app. */
export async function axThings(p: Point, radius = 5000, most = 400, window = 0): Promise<Near[]> {
  const r = await screenAsk("near", { x: p.x, y: p.y, radius, max: most, ...(window ? { window } : {}) }, ELEMENTS).catch(() => null)
  return (r?.elements ?? []).flatMap((e) => thingFrom(e) ?? [])
}
/** What Accessibility finds near `p`, nearest first, each with an id the agent points by (companion say --ax a3). */
export async function nearAt(p: Point) {
  nearPoint = p
  nearWindow = 0
  lastNear = (await axThings(p, 260, 30)).map((e, i) => ({ ...e, id: `a${i + 1}` }))
  return lastNear
}
/** What's at a point asked about: its window (its cursor left there, `parks`), what it says, what's under and near the
 *  point, and the display's picture. A private app's ask is only what they said: not even which app. */
export async function pointedAt(name: string, p: Point, w: AppWindowInfo | null, parks = true): Promise<Record<string, unknown>> {
  const win = w?.window && !w.vaultite ? w : null
  if (win && hidden(win)) return { app: "private" }
  if (parks && win?.frame) park(name, win.window, offsetIn(win.frame, p))
  const [text, { shot, floating }, under, axNear, inApp] = await Promise.all([win ? screenAsk("text", { window: win.window, max: 20_000 }, TEXT) : null, shotAt(p), underAt(p), nearAt(p),
    w?.vaultite ? inAppAt(p) : null])
  // (over Vaultite's window, Accessibility reads nothing of it: its page names what's near, by the same ids)
  const { near: appNear, ...there } = inApp ?? {}, near = Array.isArray(appNear) && appNear.length ? pageNear(appNear) : axNear
  // (the app's name with its bundle id: an agent told only com.acme.utils took the name for a guess)
  const app = win ? { app: win.bundle, ...(win.name ? { appName: win.name } : {}), window: win.window, title: win.title } : under ? { app: under.bundle, ...(under.name ? { appName: under.name } : {}) } : {}
  return { ...there, ...app, sx: Math.round(p.x), sy: Math.round(p.y),
    ...(text?.ok && text.text ? { screen: text.text } : {}), ...(shot ? { shot: shot.file, shotAt: shot.frame } : {}), ...(under ? { under: under.text } : {}), ...(near.length ? { near } : {}),
    ...(floating.length ? { floating } : {}), ...(w?.window ? { shotWindow: w.window } : {}), displays: screen.getAllDisplays().map((d) => d.bounds) }
}
/** What's at a screen point of the home vault's window, as its page knows it (a note's line, a pane's row, the app's UI):
 *  a Talk key's ask there is about that too. Null off it, or when the page doesn't say in time. */
const placeAsked = new Map<number, (place: Record<string, unknown> | null) => void>()
let placeAsks = 0
function inAppAt(p: Point): Promise<Record<string, unknown> | null> {
  const w = host?.homeWindow(), b = w?.bounds
  if (!w || !b || w.page.isDestroyed() || p.x < b.x || p.y < b.y || p.x >= b.x + b.width || p.y >= b.y + b.height) return Promise.resolve(null)
  const id = ++placeAsks
  return new Promise((done) => {
    const late = setTimeout(() => { placeAsked.delete(id); done(null) }, 400)
    placeAsked.set(id, (place) => { clearTimeout(late); placeAsked.delete(id); done(place) })
    w.page.send("vaultite:place-at", { id, x: (p.x - b.x) / w.zoom, y: (p.y - b.y) / w.zoom })
  })
}
const PLACE_KEYS = new Set(["path", "line", "find", "selection", "pane", "ui", "row", "x", "y", "under", "title", "notices", "chrome"])
/** The page's elements near the point (CSS px of its window) as an ask's, in screen points, by id: what `--ax` and a
 *  drawing's `el` point at, as in another app. */
function pageNear(els: unknown[]): (Near & { id: string })[] {
  const t = pageThings(els)
  if (t) lastNear = t
  return lastNear
}
function pageThings(els: unknown[]): (Near & { id: string })[] | null {
  const w = host?.homeWindow(), b = w?.bounds
  if (!w || !b) return null
  return els.slice(0, 40).flatMap((e) => {
    const t = thingFrom(e), f = t?.frame
    return t && f ? [{ ...t, frame: { x: Math.round(b.x + f.x * w.zoom), y: Math.round(b.y + f.y * w.zoom), width: Math.round(f.width * w.zoom), height: Math.round(f.height * w.zoom) } }] : []
  }).map((e, i) => ({ ...e, id: `a${i + 1}` }))
}
/** The home window's page answering inAppAt: only what a place has (its elements near, as they are). */
export function placeTold(from: WebContents, m: { id?: unknown; place?: unknown }) {
  if (from !== host?.homeWindow()?.page || typeof m?.id !== "number") return
  const got = m.place && typeof m.place === "object" ? m.place as Record<string, unknown> : null
  const place = got ? { ...Object.fromEntries(Object.entries(got).filter(([k, v]) => PLACE_KEYS.has(k) && (typeof v === "string" || typeof v === "number"))),
    ...(Array.isArray(got.near) ? { near: got.near } : {}) } : null
  placeAsked.get(m.id)?.(place && Object.keys(place).length ? place : null)
}
/** What a walk's item was over (never the display's picture: that's walk.ts', only with screen recording allowed). */
export async function walkPlace(p: Point): Promise<{ place: WalkPlace; near: Thing[]; window?: Rect; private?: boolean }> {
  const w = await screenAsk("at", { x: p.x, y: p.y }, WINDOW).catch(() => null)
  const win = w?.window && !w.vaultite ? w : null
  if (win && hidden(win)) return { place: { appName: "a private app" }, near: [], private: true }
  const [text, under, near, inApp] = await Promise.all([win ? screenAsk("text", { window: win.window, max: 3000 }, TEXT).catch(() => null) : null, underAt(p),
    w?.vaultite ? null : axThings(p, 160, 30, win?.window ?? 0),
    w?.vaultite ? inAppAt(p) : null])
  const str = (v: unknown) => (typeof v === "string" ? v : undefined)
  const place: WalkPlace = { ...(win ? { app: win.bundle, appName: win.name, title: win.title } : w?.vaultite ? { vaultite: true, appName: app.getName(), title: w.title } : under ? { app: under.bundle, appName: under.name } : {}),
    ...(text?.ok && text.text ? { screen: text.text } : {}), ...(under ? { under: under.text } : {}),
    ...(inApp ? Object.fromEntries(Object.entries({ path: str(inApp.path), line: typeof inApp.line === "number" ? inApp.line : undefined, ui: str(inApp.ui), under: str(inApp.under) }).filter(([, v]) => v !== undefined)) : {}) }
  const things = inApp && Array.isArray(inApp.near) ? pageThings(inApp.near) ?? [] : near ?? []
  return { place, near: things, ...(w?.frame ? { window: w.frame } : {}) }
}
export const places = cursorPlaces({ ask: screenAsk, hidden, agents: () => live.state.agents.values(), draw })
export const { pointOf, park } = places
/** Where the window would draw its place there (a pane's row, the app's UI, a note's line), in screen points: its own
 *  cursor hides while it rides with the pointer, and the riding one flies there. Asked once a place, again after a while. */
export const inAppSpots = new Map<string, { p: Point | null; at: number; pending: boolean }>()
export function inAppPoint(a: Agent) {
  const k = placeKey(a), had = inAppSpots.get(k)
  if (!had || (!had.pending && Date.now() - had.at > 1000)) {
    const mine = { p: had?.p ?? null, at: Date.now(), pending: true }
    inAppSpots.set(k, mine)
    // (a moment for the window to place it: the agent's news reaches it as it reaches here)
    setTimeout(() => void inApp(host?.homeWindow() ?? null).then((m) => { if (inAppSpots.get(k) !== mine) return; const c = m.get(a.name); inAppSpots.set(k, { p: c && !c.loose ? c.to : null, at: Date.now(), pending: false }); draw() }), 60)
  }
  return inAppSpots.get(k)!.p
}
/** A click anywhere, while the timeline keeps them: where, and what's there (Accessibility's; never a private app's). */
export async function clicked(x: number, y: number) {
  if (!timelineOn() || hidden(front)) return
  const t = Date.now(), [under, on] = await Promise.all([underAt({ x, y }).catch(() => null), clickedAt({ x, y })])
  happened({ t, kind: "click", x, y, ...(under ? { under: under.text } : {}), ...on })
}
/** The things around a point for a lesson's step: Accessibility's, or over Vaultite's window its page's (screen points). */
export async function teachThings(p: Point, radius: number): Promise<Thing[]> {
  const w = host?.homeWindow(), b = w?.bounds
  if (b && p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height && front?.vaultite) {
    const place = await inAppAt(p)
    return place && Array.isArray(place.near) ? pageThings(place.near) ?? [] : []
  }
  return axThings(p, radius, 60)
}
