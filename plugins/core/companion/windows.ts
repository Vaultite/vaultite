import type { IncomingMessage } from "node:http"
import path from "node:path"
import { type RawData, WebSocket } from "ws"
import { LOCAL, vaultPath, type Who } from "../../../core/plugins.ts"
import { bridges } from "./bridge.ts"
import { rooms } from "./rooms.ts"
import type { Hunk } from "./text.ts"
import { paneSource, PLACE_KEYS, type Target } from "../../../core/desktop/places.ts"
import { screenDrawings } from "./drawings.ts"
import { screenMedia } from "./media.ts"
import { bestFound, byLabel, checkMarks, type Found, type Mark, type Rect as ScreenRect, rectOf, spots } from "../../../core/desktop/screenmarks.ts"
import { beforeLayer, FLIPS, layerOwner } from "./proof.ts"
import { sitesOf } from "./guides.ts"
import { type Screen, toursOf } from "./tours.ts"
import type { Tour } from "./tour.ts"
import type { Seen } from "../../../core/desktop/anchor.ts"
import { markOf, type Spot, type Tag } from "./tags.ts"
import { takeovers } from "./takeover.ts"
import { check as checkOn, listView, thingFrom, type Verdict } from "../../../core/desktop/uimodel.ts"
import { drawing, point, answer, saw, hide, keepSaid, reopen, pin } from "./comments.ts"
import { plugin } from "./self.ts"
import type { Moment, Rect, Near, Note } from "./types.ts"
import { sayMs, str, mode, hidden, privatePage, ownName } from "./settings.ts"
import { moments, agents, notes, said, setSaid, acts, passedAt, showedAt, did, windows, asked, send, broadcast, snapshot, key, isMain, addMoment, agentOf, setAgent, putNote, dropNote } from "./state.ts"
import { panesFrom, privatePane, screenUnheard, type BrowserTab, resolve, paneMoment } from "./windowpanes.ts"
import { askWindow, stopStreams } from "./edits.ts"
import { AS_TOOL } from "./chat.ts"
import { READ_ONLY, lane } from "./lane.ts"
import { turning } from "./chatturns.ts"
import { target, who } from "./args.ts"
import { awayIn } from "./next.ts"
import { shown, askOf, jobs, knocks } from "./wiring.ts"
import { review } from "./propose.ts"
import { openedFor } from "./opening.ts"
import { personComment, mentioned, askIn } from "./people.ts"

/** Notes open in windows, typed in together (rooms.ts). */
export const co = rooms(plugin)
plugin.onChange((paths) => co.changed(paths))
/** The user as others in a note see them (never this machine's login name). */
const OWNER = "Owner"
const YOU: Who = { client: "app/web", agent: null, label: "You", source: "app" }
/** A note a window names, as the vault's path (`./a.md` is `a.md`), or null. */
const notePath = (p: unknown) => { try { return vaultPath(p, false, plugin.vault) } catch { return null } }

/** Notes another machine of the vault shares typed in there, with its guests (bridge.ts). */
const there = bridges(plugin, (ws, m, path) => void co.heard(ws, m, path))
plugin.onUnload(() => there.stop())
const roomMessage = (m: Record<string, unknown>) => typeof m.t === "string" && (m.t.startsWith("y") || m.t === "aw")

/** The desktop app's helper (electron/helper.ts): it draws the agents outside the window, and says what the user asks or
 *  points at on screen; it opens no notes. */
export const screens = new Set<WebSocket>()
/** Its steps in other apps (takeover.ts): sent to the helper the ask came from. */
export const takeover = takeovers(send, (name, sx, sy) => void resolve(target({ sx, sy }, true), name).then((t) => setAgent(name, { ...t, state: "writing", pointed: Date.now() }), () => {}))
/** The companion's drawing over the screen (drawings.ts). */
export const screenDrawing = screenDrawings(plugin, {
  send: (m) => { for (const ws of screens) send(ws, m) },
  locate: (places) => windowRects(places),
  tint: (a) => agentOf(layerOwner(a)).tint,
  elements: (a) => Object.fromEntries((nearBy.get(key(a)) ?? []).map((e) => [`el:${e.id}`, rectOfNear(e)])),
  // (Vaultite's own elements by their data-ui id, found again where they are now: the ask's frames may be stale)
  live: async (a, ids) => {
    const ask = askOf(a), ui = (e: Near) => e.ui
    if (!ask || awayIn([ask])) return {}
    const els = (nearBy.get(key(a)) ?? []).filter((e) => ids.includes(e.id) && ui(e))
    const now = await Promise.all(els.map((e) => windowRects([`ui:${ui(e)}`], { x: e.frame.x + e.frame.width / 2, y: e.frame.y + e.frame.height / 2 }).then((r) => r[`ui:${ui(e)}`])))
    return Object.fromEntries(els.flatMap((e, i) => (now[i] ? [[`el:${e.id}`, { ...now[i], label: e.label }]] : [])))
  },
  find: (a, text) => screenFind(a, text),
  drawn: (a) => (askOf(a)?.ink ?? []).map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })),
  words: (a) => {
    const asked = moments.findLast((m) => m.for === a && (m.kind === "ask" || m.kind === "point"))?.t ?? 0
    return [...notes.values()].findLast((n) => n.kind === "say" && n.agent === a && n.t >= asked)?.text
  },
  displays: (a) => (screens.size ? displaysOf(layerOwner(a)).map((d) => ({ x: d.x, y: d.y, w: d.width, h: d.height })) : null),
  // (a file of this Mac: where its read-only commands may look)
  media: screenMedia(plugin, { readable: (abs) => READ_ONLY.dirs.some((d) => abs.startsWith(`${d}${path.sep}`)) && !abs.startsWith(`${path.resolve(LOCAL)}${path.sep}`) && !/(^|\/)\.env/.test(abs) }),
})
// ---------- tours (tours.ts): played on the screen of each agent's last ask, without the model

// (a tour of Vaultite's own plays on its window, wherever the last ask was, as a proof does; with none open, where they asked)
export const tours = toursOf(plugin, { screen: (name, t) => (t && ownTour(t) ? screenOf(name, { vaultite: true }) : null) ?? screenOf(name), who: (p) => who(p) })
/** The window used last: where a tour over Vaultite plays. */
const lastWindow = () => [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0]
/** A thing as Vaultite's window lists it (tourwindow.ts): `within`, the data-ui around one that has none. */
type Shown = Seen & { within?: string }
/** How the marks up become `next` when only their places changed (the same kinds, in order, each at a box): each one's
 *  move, by id. Null: they differ more than that. */
function glides(up: Mark[], marks: unknown[]) {
  let next: Mark[]
  try { next = checkMarks(marks) } catch { return null }
  if (up.length !== next.length) return null
  const box = (v: unknown) => (v && typeof v === "object" && "x" in v && "w" in v ? v as ScreenRect : null)
  const out: { mark: string; dx: number; dy: number }[] = []
  for (const [i, m] of up.entries()) {
    const n = next[i], a = "at" in m ? box(m.at) : null, b = "at" in n ? box(n.at) : null
    if (!m.id || m.type !== n.type || !a || !b || Math.abs(a.w - b.w) > 4 || Math.abs(a.h - b.h) > 4) return null
    out.push({ mark: m.id, dx: b.x - a.x, dy: b.y - a.y })
  }
  return out
}
export type ScreenRectLike = { x: number; y: number; width: number; height: number }
/** Where agent `name`'s marks can show: its last ask's displays, else those of a proof being shown. */
export function displaysOf(name: string): ScreenRectLike[] {
  const asked = askOf(name)?.displays ?? []
  return asked.length ? asked : shown?.displays ?? []
}
/** A step's before picture flipping with how its thing is now (a proof's): its layer, and the flips still to come. */
let flipping: { layer: string; timers: ReturnType<typeof setTimeout>[] } | null = null
export function stopFlips() {
  if (!flipping) return
  for (const t of flipping.timers) clearTimeout(t)
  screenDrawing.clear({ agent: flipping.layer })
  flipping = null
}
/** Picture `src` laid over `at` (screen points) on agent `name`'s before layer, then flipped: before, now, before, now. */
async function flip(name: string, src: string, at: { x: number; y: number; width: number; height: number }) {
  stopFlips()
  const layer = beforeLayer(name)
  try {
    await screenDrawing.draw(layer, [{ type: "image", src, at: [at.x, at.y, at.width, at.height], over: true, caption: "Before", life: "dismiss" }])
  } catch (e) { return void console.error(`companion: a before picture didn't show: ${(e as Error).message}`) }
  const mine: NonNullable<typeof flipping> = { layer, timers: [] }
  mine.timers = FLIPS.map(([ms, on]) => setTimeout(() => { if (flipping === mine) screenDrawing.toggle(layer, on) }, ms))
  flipping = mine
}
/** A tour of Vaultite's own (its app, or none named): it plays on Vaultite's window. */
export const ownTour = (t: Pick<Tour, "app" | "site">) => !t.site.length && (!t.app.length || t.app.includes("vaultite"))
/** Agent `name`'s screen for a tour: the app its last ask was over (the Mac's helper reads it), else Vaultite's window
 *  (`vaultite`: that window whatever the ask was over, as a proof of Vaultite's own). */
export function screenOf(name: string, o: { vaultite?: boolean } = {}): Screen | null {
  const ask = askOf(name), away = ask && !o.vaultite ? awayIn([ask]) : ""
  if (away === "a private app") return null
  const call = (op: string, p: Record<string, unknown>) => plugin.host.call(op, { ...p, ...(isMain(name) ? {} : { as: name }) }, AS_TOOL, { report: "companion tour" })
  const mid = (s: Seen) => ({ sx: Math.round(s.frame.x + s.frame.width / 2), sy: Math.round(s.frame.y + s.frame.height / 2) })
  const spot = (s: Seen): Spot => ({ sx: s.frame.x, sy: s.frame.y, w: s.frame.width, h: s.frame.height })
  const sayIt = async (text: string) => { await call("companion.say", { text }) }
  /** Draw's marks for a step's, at the frames found (a point is its cursor's, not a mark). */
  const drawnOf = (marks: Parameters<Screen["show"]>[1]) => marks.filter((m) => m.at).flatMap((m) => {
    const x = m.kind === "point" ? null : markOf({ kind: m.kind as Tag["kind"], at: spot(m.at!), ...(m.to ? { to: spot(m.to) } : {}), ...(m.label ? { label: m.label } : {}), ...(m.n !== undefined ? { n: m.n } : {}), ...(m.dir ? { dir: m.dir } : {}), offset: 0 })
    return x ? [x] : []
  })
  const overScreen = () => screens.size > 0 && displaysOf(name).length > 0
  let drewCard = false
  async function show(text: string, marks: Parameters<Screen["show"]>[1], before?: string, draw?: Record<string, unknown>[]) {
    stopFlips()
    // (a step's own drawing goes as the next step comes; its cards, unless they say, stay till their next ask)
    if (drewCard) { drewCard = false; screenDrawing.clear({ agent: name }) }
    const placed = marks.filter((m) => m.at)
    // (words pointing at nothing: said by their pointer as they asked, its bubble there, as an answer is)
    const asked = askOf(name), here = overScreen() && asked?.sx !== undefined ? { sx: asked.sx, sy: asked.sy } : {}
    if (draw?.length) {
      drewCard = true
      const at = drawnOf(placed), point = placed.find((m) => m.kind === "point")
      if (point || "sx" in here) await call("companion.look", point ? mid(point.at!) : here)
      return void await call("companion.draw", { marks: [...at, ...draw.map((d) => ({ life: "ask", ...d }))], ...(text ? { say: text } : {}) })
    }
    // (its picture before over its first thing, as it is now, while its words are said)
    if (before && overScreen() && placed[0]) void flip(name, before, placed[0].at!.frame)
    if (overScreen() && placed.length) {
      // (over the screen: marks at the frames found, a point its cursor there)
      const drawn = drawnOf(placed)
      const point = placed.find((m) => m.kind === "point")
      if (point) await call("companion.look", mid(point.at!))
      if (drawn.length) return void await call("companion.draw", { marks: drawn, ...(text ? { say: text } : {}) })
      if (text) await call("companion.say", { text, ...(point ? mid(point.at!) : {}) })
      return
    }
    // (in Vaultite's window: its cursor and bubble at the thing, by its data-ui id, else its words in the UI around it)
    const places = placed.flatMap((m) => { const s = m.at as Shown; return s.ui ? [{ ui: s.ui }] : s.within ? [{ ui: s.within, find: s.label }] : [] })
    for (const p of places.slice(1)) await call("companion.highlight", p).catch(() => {})
    if (text) await call("companion.say", { text, ...(places[0] ?? here) })
    else if (places[0]) await call("companion.look", places[0])
  }
  async function act(d: Parameters<Screen["act"]>[0], at: Seen | null) {
    try {
      if (away) {
        const step = d.action === "click" ? { action: "click" } : d.action === "type" ? { action: "type", value: d.value ?? "" } : d.action === "press" ? { action: "press", key: d.key } : { action: "scroll", direction: d.dir ?? "down" }
        const r = (await call("companion.act", { ...step, ...(at ? mid(at) : {}) })).result as { ok?: boolean; text?: string }
        return r?.ok === false ? { ok: false, why: r.text ?? "it didn't work" } : { ok: true }
      }
      if (d.action !== "click") return { ok: false, why: `in Vaultite's own UI it only clicks: ${d.action} isn't something it can do there, so the user does it` }
      const s = at as Shown | null
      if (!s) return { ok: false, why: "nothing to click: name it by its words" }
      const r = (await call("companion.act", { action: "click", ...(s.ui ? { ui: s.ui } : { ...(s.within ? { ui: s.within } : {}), find: s.label }) })).result as { ok?: boolean; saw?: string }
      return r?.ok === false ? { ok: false, why: r.saw ?? "it didn't work" } : { ok: true }
    } catch (e) { return { ok: false, why: (e as Error).message } }
  }
  /** The step as an ask of its model's where the last ask was: whether it showed that thing (one not there it lets
   *  pass). Stopped (their new ask, Esc): its ask is withdrawn, so it never runs into their answer. */
  async function fallback(tour: Parameters<Screen["fallback"]>[0], step: Parameters<Screen["fallback"]>[1], missing: string[], signal?: AbortSignal) {
    const t0 = Date.now(), last = askOf(name)
    const place = Object.fromEntries((["app", "window", "title", "sx", "sy", "path", "line", "pane", "ui", "url", "displays"] as const).flatMap((k) => (last?.[k] !== undefined ? [[k, last[k]]] : [])))
    const text = `(A step of their tour "${tour.title}", played for them, not their words. Step ${step.n}: ${step.text}\nNot found on their screen now: ${missing.map((x) => JSON.stringify(x)).join(", ")}. If it shows there under other words or moved, say this step yourself, its tag on it as it shows now. If it isn't on their screen, say nothing: let it pass (mcp__vaultite-app__pass "not there"); the tour tells them itself.)`
    if (signal?.aborted) return false
    const m = addMoment({ kind: "ask", for: name, summoned: true, tour: true, text, ...place })
    if (!m) return false
    const k = key(name), showed = () => !((passedAt.get(k) ?? 0) >= t0) && ((showedAt.get(k) ?? 0) >= t0 || (agents.get(k)?.pointed ?? 0) >= t0)
    const answered = () => (passedAt.get(k) ?? 0) >= t0 || [...notes.values(), ...said].some((n) => n.kind === "say" && key(n.agent) === k && n.t >= t0) || showed()
    const busy = () => (lane().takes(m) ? lane().busy() : turning.has(k))
    const withdraw = () => { if (lane().takes(m)) lane().drop(m) }
    signal?.addEventListener("abort", withdraw, { once: true })
    try {
      let began = false
      for (const end = t0 + 90_000; Date.now() < end && !signal?.aborted;) {
        await new Promise((ok) => setTimeout(ok, 300))
        if (busy()) began = true
        else if (began || answered()) break
      }
      return !signal?.aborted && showed()
    } finally { signal?.removeEventListener("abort", withdraw) }
  }
  const inputs = (on: boolean) => { for (const ws of [...windows.keys(), ...screens]) send(ws, { t: "inputs", on }) }
  /** Its marks drawn again where their things are now, unsaid; one off screen left out till it's back. In Vaultite's
   *  window without the helper's drawing, the bubble finds its place again by itself. */
  async function follow(marks: Parameters<Screen["show"]>[1]) {
    if (!overScreen()) return
    const drawn = drawnOf(marks), up = screenDrawing.layer(name), moves = up && glides(up.marks.filter((m) => !m.gone), drawn)
    // (the same marks, their things moved: each glides there, not drawn again)
    if (up && moves) return void screenDrawing.moved(up.id, moves)
    screenDrawing.clear({ agent: name })
    if (drawn.length) await call("companion.draw", { marks: drawn }).catch(() => {})
  }
  if (away) {
    if (!screens.size) return null
    const site = sitesOf(ask!)[0]
    const read = async () => { const r = await takeover.things(); return r.ok ? r.things ?? [] : null }
    return {
      things: async () => { const t = await read(); return t && { where: { app: ask!.app, ...(site ? { site } : {}) }, things: t } },
      holds: async (c, before) => { const t = await read(); return !!t && checkOn(c, listView(t), before).ok },
      snapshot: async () => listView((await read()) ?? []).snapshot(),
      show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
    }
  }
  if (!lastWindow()) return null
  const fromWindow = async <T,>(m: object): Promise<T | null> => {
    const ws = lastWindow(), reply: Record<string, unknown> = {}
    if (!ws) return null
    return (await askWindow(ws, m, 3000, reply).catch(() => false)) ? reply as T : null
  }
  return {
    things: async () => {
      const r = await fromWindow<{ window?: Rect; things?: Shown[] }>({ t: "things" })
      return r?.things ? { where: { app: "vaultite", ...(r.window ? { window: r.window } : {}) }, things: r.things } : null
    },
    holds: async (c, before) => (await fromWindow<{ verdict?: Verdict }>({ t: "check", condition: c, ...(before !== undefined ? { before } : {}) }))?.verdict?.ok === true,
    snapshot: async () => (await fromWindow<{ snapshot?: string }>({ t: "snapshot" }))?.snapshot ?? "",
    show, say: sayIt, act, fallback, inputs, ...(overScreen() ? { follow } : {}),
  }
}
const rectOfNear = (e: Near): ScreenRect => ({ x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height, label: e.label })
/** Where the window used last has `places` now (locate.ts), in screen points; words found nearest `near`. */
async function windowRects(places: string[], near?: { x: number; y: number }): Promise<Record<string, ScreenRect & { q?: number }>> {
  const ws = [...windows.entries()].sort((a, b) => b[1].at - a[1].at)[0]?.[0], reply: { rects?: Record<string, ScreenRect & { q?: number }> } = {}
  if (ws) await askWindow(ws, { t: "locate", places, ...(near ? { near } : {}) }, 3000, reply).catch(() => false)
  return reply.rects ?? {}
}
/** Where words show now on the screen of agent `a`'s last ask (screen points): over another app, its element or the app's
 *  (Accessibility); over Vaultite, its window's and its web pages', the best nearest what they drew or pointed at. */
export async function screenFind(a: string, text: string): Promise<ScreenRect | null> {
  const ask = askOf(a), near = byLabel(nearBy.get(key(a)) ?? [], text)
  if (awayIn([ask].filter((m) => !!m)) || (openedFor.has(key(a)) && openedFor.get(key(a)) === ask)) {
    if (near) return rectOfNear(near)
    const r = await takeover.find(text)
    return r.ok && r.found ? rectOfNear(r.found) : null
  }
  const pointer = ask?.sx !== undefined && ask.sy !== undefined ? { x: ask.sx, y: ask.sy } : undefined
  const by = ask?.ink?.length ? ask.ink.map((k) => ({ x: k.box.x, y: k.box.y, w: k.box.width, h: k.box.height })) : pointer ? [{ ...pointer, w: 0, h: 0 }] : []
  const [here, pages] = await Promise.all([windowRects([`find:${text}`, "pages"], pointer), pageFinds(a, text)])
  const found: Found[] = here[`find:${text}`] ? [{ q: 2, ...here[`find:${text}`] }] : []
  for (const p of pages) {
    const box = here[`page:${p.pane}`]
    for (const r of box ? p.found : []) {
      const at = { x: Math.round(box.x + r.x * p.zoom), y: Math.round(box.y + r.y * p.zoom), w: Math.round(r.w * p.zoom), h: Math.round(r.h * p.zoom), q: r.q }
      if (at.x < box.x + box.w && at.y < box.y + box.h && at.x + at.w > box.x && at.y + at.h > box.y) found.push(at)
    }
  }
  const best = bestFound(found, by)
  if (best) return { x: best.x, y: best.y, w: best.w, h: best.h }
  // (nothing there now: the element the ask came with, as it was)
  return near ? rectOfNear(near) : null
}
/** Where the web pages shown in the user's window say `text` (their viewport's CSS px, a CSS px `zoom` points). */
async function pageFinds(name: string, text: string) {
  const tabs = await plugin.desktop("agent:tabs", { name, session: "", task: "", summary: "", remote: false }).catch(() => []) as (BrowserTab & { shown?: boolean })[]
  const shown = tabs.filter((t) => t.pane && t.shown && t.access !== "none" && !privatePage(t.url, t.container)).slice(0, 8)
  const late = <T,>(ms: number) => new Promise<T>((_ok, no) => setTimeout(() => no(new Error("late")), ms))
  const each = await Promise.all(shown.map((t) => Promise.race([plugin.desktop("agent:find", t.tab, text), late(1500)])
    .then((r) => ({ pane: t.pane!, ...(r as { zoom: number; found: Found[] }) }), () => null)))
  return each.filter((x): x is NonNullable<typeof x> => !!x && Array.isArray(x.found) && Number.isFinite(x.zoom))
}
export const SCREEN_NEWS = new Set(["state", "agent", "note", "drop", "said", "hush", "voice"])
/** The helper the user last spoke to or answered a knock on: where Still broken records. */
export let lastScreen: WebSocket | null = null
export const toScreens = (m: object) => { const text = JSON.stringify(m); for (const ws of screens) if (ws.readyState === ws.OPEN) ws.send(text) }
/** A screen moment's place, from what the helper sent: an app's window, never a path. */
/** Only the helper's own pictures: an agent reads what's named here. */
const OWN_SHOT = /[/\\]screens[/\\](window-\d+-\d+|display-\d+-\d+|close-\d+-\d+)\.png$/
function screenPlace(m: Record<string, unknown>) {
  const shot = str(m.shot), down = str(m.shotDown), window = Number(m.window), sx = Number(m.sx), sy = Number(m.sy)
  const rect = (r: unknown): Rect | null => { const o = (r ?? {}) as Record<string, unknown>, v = [o.x, o.y, o.width, o.height].map(Number); return v.every(Number.isFinite) ? { x: Math.round(v[0]), y: Math.round(v[1]), width: Math.round(v[2]), height: Math.round(v[3]) } : null }
  const near = Array.isArray(m.near) ? m.near.slice(0, 40).flatMap((e: Record<string, unknown>) => { const t = thingFrom(e); return t?.id ? [t as Near] : [] }) : []
  const ink = Array.isArray(m.ink) ? m.ink.slice(0, 12).flatMap((k: Record<string, unknown>) => { const b = rect(k?.box); return b ? [{ shape: str(k.shape).slice(0, 20), box: b,
    points: (Array.isArray(k.points) ? k.points : []).slice(0, 40).map((p: unknown) => (Array.isArray(p) ? [Math.round(Number(p[0])), Math.round(Number(p[1]))] : [0, 0]) as [number, number]) }] : [] }) : []
  const floating = Array.isArray(m.floating) ? m.floating.slice(0, 6).flatMap((w: Record<string, unknown>) => { const f = rect(w?.frame)
    return f && str(w.app) ? [{ app: str(w.app).slice(0, 200), name: str(w.name).slice(0, 120), frame: f }] : [] }) : []
  const clicks = Array.isArray(m.clicks) ? m.clicks.slice(0, 8).flatMap((c: Record<string, unknown>) => { const x = Number(c?.sx), y = Number(c?.sy)
    return Number.isFinite(x) && Number.isFinite(y) ? [{ sx: Math.round(x), sy: Math.round(y), ...(str(c.under) ? { under: str(c.under).slice(0, 300) } : {}) }] : [] }) : []
  const c = (m.closeUp ?? {}) as Record<string, unknown>, cAt = rect(c.at), scale = Number(c.scale), mark = c.mark === "ring" ? "ring" as const : c.mark === "pointer" ? "pointer" as const : null
  const close = OWN_SHOT.test(shot) && OWN_SHOT.test(str(c.shot)) && cAt && Number.isFinite(scale) && scale >= 1 && scale <= 4 ? { shot: str(c.shot), at: cAt, scale, ...(mark ? { mark } : {}) } : null
  const at = rect(m.shotAt), displays = Array.isArray(m.displays) ? m.displays.slice(0, 8).map(rect).filter((d): d is Rect => !!d && d.width > 0 && d.height > 0) : []
  return { ...(str(m.app) ? { app: str(m.app).slice(0, 200), ...(str(m.appName) ? { appName: str(m.appName).slice(0, 120) } : {}) } : {}), ...(Number.isInteger(window) && window > 0 ? { window } : {}), ...(Number.isInteger(Number(m.shotWindow)) && Number(m.shotWindow) > 0 ? { shotWindow: Number(m.shotWindow) } : {}), ...(str(m.title) ? { title: str(m.title).slice(0, 300) } : {}),
    ...(str(m.screen) ? { screen: str(m.screen).slice(0, 20_000) } : {}), ...(str(m.under) ? { under: str(m.under).slice(0, 700) } : {}),
    ...(str(m.chrome) ? { chrome: str(m.chrome).slice(0, 40) } : {}),
    ...(Number.isFinite(sx) && Number.isFinite(sy) && m.sx !== undefined && m.sy !== undefined ? { sx: Math.round(sx), sy: Math.round(sy) } : {}),
    ...(OWN_SHOT.test(shot) ? { shot, ...(at ? { shotAt: at } : {}) } : {}),
    ...(OWN_SHOT.test(down) && OWN_SHOT.test(shot) ? { shotDown: down, ...(rect(m.shotDownAt) ? { shotDownAt: rect(m.shotDownAt)! } : {}) } : {}),
    ...(str(m.notices) ? { notices: str(m.notices).slice(0, 1200) } : {}), ...(close ? { closeUp: close } : {}),
    ...(near.length ? { near } : {}), ...(ink.length ? { ink } : {}), ...(floating.length ? { floating } : {}), ...(displays.length ? { displays } : {}), ...(rect(m.region) ? { region: rect(m.region)! } : {}),
    ...(clicks.length ? { clicks } : {}) }
}
/** What the last ask on screen found near the pointer, by agent: what `--ax` points at. */
export const nearBy = new Map<string, Near[]>()
/** Its cursor off the screen, done there (the helper's: its exchange over, idle a while): back to the user's note while
 *  it's on screen, else home (one in a tab behind would send it to a file's row or a list's edge, far from them). */
export function comeBack(name: string) {
  if (!agents.has(key(name))) return
  const w = [...windows.values()].sort((a, b) => b.at - a.at).find((x) => x.focus), f = w?.focus?.path && w.shown.includes(w.focus.path) ? w.focus : null
  setAgent(name, { ...Object.fromEntries(PLACE_KEYS.map((k) => [k, undefined])), ...(f?.path ? { path: f.path, line: f.line } : {}) }, true)
}
/** What the user did on screen, as the helper says it: an ask, or a point (no words). Over Vaultite's own window, it
 *  says what's there as the page knows it too (a note's line, a pane's row, the app's UI), asked as one asked there. */
export function screenMoment(m: Record<string, unknown>, req?: IncomingMessage) {
  if (m.kind !== "ask" && m.kind !== "point") return null
  const place = screenPlace(m)
  // (a point where nothing can be read, as the menu bar: still there, with its picture)
  if (!place.app && place.sx === undefined) return null
  // (none this time: the last ask's ids are gone too, never pointed at on another screen)
  nearBy.set(key(str(m.agent) || ownName()), place.near ?? [])
  // (the Talk key let go `keyUp`: its words finished and what's there gathered since, as its pause)
  const up = Number(m.keyUp), waited = Number.isFinite(up) ? Date.now() - up : NaN
  const talk = Array.isArray(m.talk) ? m.talk.slice(-8).map((x) => str(x).slice(0, 300)).filter(Boolean) : []
  const asked = { summoned: true as const, ...(m.voice === true ? { voice: true } : {}), ...(waited >= 0 && waited < 60_000 ? { waited: Math.round(waited) } : {}),
    ...(m.front === "realtime" ? { front: "realtime" as const, ...(talk.length ? { talk } : {}) } : {}) }
  if (!place.app && (str(m.pane) || str(m.ui))) {
    const { under: _, title: __, ...seen } = place
    return void paneMoment({ ...m, summoned: true }, req, { ...seen, ...asked })
  }
  if (!place.app && str(m.path)) {
    const selection = str(m.selection).slice(0, 4000) || undefined
    return addMoment({ kind: m.kind, for: str(m.agent) || undefined, path: str(m.path), line: Number(m.line) || undefined, text: str(m.text) || undefined, ...(selection ? { selection } : {}),
      ...(m.kind === "point" && str(m.find) ? { find: str(m.find).slice(0, 200) } : {}), ...place, ...asked }, req)
  }
  return addMoment({ kind: m.kind, for: str(m.agent) || undefined, text: str(m.text) || undefined, ...place, ...asked }, req)
}
/** Each helper's realtime voice, paused (the account can't pay, or its key is refused) and why. */
export const realtimePaused = new Map<WebSocket, { account: string; why: string; until: number } | null>()
export const pausedNow = () => [...realtimePaused.values()].find((p) => p && p.until > Date.now()) ?? null
/** The mic each helper hears with, and why (electron/miclogic.ts): for its status. */
export const mics = new Map<WebSocket, string>()
/** Each Mac's call, as its helper hears it (electron/calllogic.ts): its voice keeps quiet meanwhile. */
export const calls = new Map<WebSocket, string>()
/** What the realtime voice answered alone (small talk): their words and its, kept as an ask and a say. `withdraw`: the
 *  summoned session was asked it too (as the realtime voice listened): its turn stops, and what it said goes. */
function screenAnswered(m: Record<string, unknown>) {
  const name = str(m.agent) || ownName(), heard = str(m.heard).trim().slice(0, 2000), words = str(m.said).trim().slice(0, 2000)
  if (!words || mode() === "off") return
  const t = Date.now()
  const asks = m.withdraw === true && isMain(name) ? lane().withdraw() : []
  // (the talk's log: the summoned answer withdrawn and these words said instead, or small talk the voice answered alone)
  if (asks.length) { did(name, "withdrawn", asks.map((x) => x.seq)); acts.append(t, [{ t, as: name, op: "say", text: words }]) }
  else did(name, "talked", undefined, JSON.stringify({ heard, said: words }))
  if (asks.length) {
    // (their ask stays, as it came; what the summoned session said of it goes)
    const ts = new Set(asks.map((x) => x.t)), theirs = (n: Note) => n.kind === "say" && key(n.agent) === key(name) && !!n.answers && ts.has(n.answers.t)
    for (const n of [...notes.values()].filter(theirs)) dropNote(n.id)
    if (said.some(theirs)) { setSaid(said.filter((n) => !theirs(n))); broadcast({ t: "said", said }) }
  } else if (heard) keepSaid({ id: `ask-rt-${t}`, kind: "ask", by: "user", agent: name, text: heard, t, seen: true })
  keepSaid(putNote({ kind: "say", agent: name, text: words, seen: true, answers: { t, realtime: true } }, sayMs(words)))
}
function screenSocket(ws: WebSocket, req: IncomingMessage) {
  screens.add(ws)
  send(ws, snapshot())
  for (const m of screenDrawing.messages()) send(ws, m)
  send(ws, { t: "jobs", jobs: jobs.cards() })
  knocks.hello()
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    if (takeover.message(ws, m)) return
    // (a wait listening: what they click and type in other apps)
    if (m.t === "input") return void tours.input(m)
    // (a bubble over the screen clicked away)
    if (m.t === "hide" && typeof m.id === "string") return void hide(m.id)
    if (m.t === "home" && typeof m.agent === "string") return void comeBack(m.agent)
    // (its Talk key pressed: its summoned session made ready while they speak)
    if (m.t === "summoning") return void lane().warm()
    // (pressed again, or Esc, mid-answer: its summoned turn stops where it is, so the next ask isn't kept waiting)
    // (its take-over's offer up: the press is their answer to it)
    if (m.t === "interrupt") return void (takeover.offering(ws) || bargeIn())
    // (who rides with their pointer: the windows draw no cursor of its meanwhile)
    if (m.t === "riding") return void ride(ws, str(m.agent).slice(0, 80))
    // (a job opened from the menu bar: no longer news)
    if (m.t === "job-seen" && Array.isArray(m.ids)) return void jobs.seen(m.ids.filter((x): x is string => typeof x === "string").slice(0, 30))
    // (a cursor's conversation opened over the screen: its says seen)
    if (m.t === "saw" && Array.isArray(m.ids)) return void saw(m.ids.filter((x): x is string => typeof x === "string").slice(0, 100))
    if (m.t === "knock" || m.t === "moment") lastScreen = ws
    if (m.t === "knock") return void knocks.heard(m)
    if (m.t === "drawing-act") return void drawingAct(m, req)
    if (m.t === "moment" && !takeover.heard(ws, m)) screenMoment(m, req)
    if (m.t === "answered") screenAnswered(m)
    // (its realtime voice paused, and why, or back: for its status)
    if (m.t === "mic") mics.set(ws, str(m.mic).slice(0, 300))
    // (an answer its voice didn't say, or said after all)
    if (m.t === "unheard" || m.t === "heard") return void screenUnheard(m)
    if (m.t === "call") { if (str(m.call)) calls.set(ws, str(m.call).slice(0, 120)); else calls.delete(ws) }
    if (m.t === "realtime") { const p = m.paused as Record<string, unknown> | null; realtimePaused.set(ws, p && typeof p === "object" ? { account: str(p.account), why: str(p.why).slice(0, 300), until: Number(p.until) || 0 } : null) }
  })
  ws.on("close", () => { screens.delete(ws); realtimePaused.delete(ws); mics.delete(ws); calls.delete(ws); takeover.closed(ws); ride(ws, "") })
}
/** The summoned session's turn stopped (its Talk key pressed again, Esc): only it, never the long session's. */
function bargeIn() {
  if (!lane().busy()) return
  const name = ownName()
  stopStreams(name)
  void lane().interrupt().then((ok) => { if (ok) did(name, "stopped") }, () => {})
}
/** Each helper's agent riding with the pointer over the screen (its Talk key's exchange); `riding()` the one now. */
const ridingBy = new Map<WebSocket, string>()
export const riding = () => [...ridingBy.values()].find(Boolean) ?? ""
function ride(ws: WebSocket, agent: string) {
  const was = riding()
  if (agent) ridingBy.set(ws, agent); else ridingBy.delete(ws)
  if (riding() === was) return
  // (its exchange over: what it answered there was said by the pointer or in its box, so seen, never a bubble after,
  // where its cursor goes next; a late answer still comes as one)
  const there = was ? [...notes.values()].filter((n) => n.kind === "say" && n.answers && key(n.agent) === key(was)).map((n) => n.id) : []
  for (const id of there) dropNote(id)
  saw(there)
  broadcast({ t: "riding", agent: riding() })
}

/** What the user pressed on a layer over the screen (Clear, Keep, a card's ×, a button's next step: an ask by where it
 *  is), or what the helper saw of it: its exchange over (settle), the screen under it changed. */
function drawingAct(m: Record<string, unknown>, req: IncomingMessage) {
  if (m.kind === "changed" && Array.isArray(m.marks)) return void screenDrawing.changed(str(m.id), m.marks.filter((x): x is string => typeof x === "string"))
  if (m.kind === "moved" && Array.isArray(m.moves)) return void screenDrawing.moved(str(m.id), m.moves.flatMap((x) => (x && typeof x === "object" && typeof x.mark === "string" && typeof x.dx === "number" && typeof x.dy === "number" ? [{ mark: x.mark, dx: x.dx, dy: x.dy }] : [])))
  const d = screenDrawing.byId(str(m.id))
  if (!d) return
  if (m.kind === "clear") return void screenDrawing.clear({ id: d.id })
  if (m.kind === "settle") return void screenDrawing.settle(d.agent)
  if (m.kind === "dismiss" && typeof m.mark === "string") return void screenDrawing.dismiss(d.id, m.mark)
  if (m.kind === "media" && typeof m.mark === "string") return void screenDrawing.media(d.id, m.mark, { ...(typeof m.sound === "boolean" ? { sound: m.sound } : {}), ...(typeof m.paused === "boolean" ? { paused: m.paused } : {}) })
  if (m.kind === "keep") return void plugin.runOp("companion.save-drawing", { id: d.id, places: m.places ?? {} }, YOU, req).catch((e) => console.error(`companion: keep: ${(e as Error).message}`))
  const a = agents.get(key(d.agent)), r = spots(d.marks).map((s) => rectOf(s, d.places)).find(Boolean)
  if (m.kind === "ask" && str(m.text)) addMoment({ kind: "ask", for: d.agent, text: str(m.text).slice(0, 2000), ...(a?.app ? { app: a.app } : {}),
    ...(r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : a?.sx !== undefined ? { sx: a.sx, sy: a.sy } : {}) }, req)
}

plugin.socket("companion/live", (ws, req, { query }) => {
  if (query.screen === "1") return screenSocket(ws, req)
  co.add(ws, { who: YOU, name: OWNER, tint: "red", edits: true, see: (rel) => rel })
  // (another machine's server, for its windows: only the rooms, and never sent on again)
  if (query.rooms === "1") {
    ws.on("message", (data: RawData) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(data)) } catch { return }
      if (roomMessage(m)) co.heard(ws, m, notePath(m.path))
    })
    return
  }
  windows.set(ws, { open: [], shown: [], focus: null, at: 0, panes: [] })
  there.add(ws)
  send(ws, snapshot())
  ws.on("message", (data: RawData) => {
    let m: Record<string, unknown>
    try { m = JSON.parse(String(data)) } catch { return }
    if (roomMessage(m)) {
      const path = notePath(m.path)
      if (path && /\.md$/i.test(path) && there.heard(ws, m, path)) return
      if (co.heard(ws, m, path)) return
    }
    const w = windows.get(ws)
    if (!w) return
    if (m.t === "input") return void tours.input(m)
    if (m.t === "where") {
      w.open = Array.isArray(m.open) ? m.open.filter((p): p is string => typeof p === "string") : w.open
      w.shown = Array.isArray(m.shown) ? m.shown.filter((p): p is string => typeof p === "string") : w.shown
      const f = m.focus as Target | null
      // (an editor left for the terminal or a menu: still their note while it's open)
      w.focus = f && typeof f.path === "string" ? { path: f.path, ...(drawing(f.path) ? point(f as Record<string, unknown>) : { line: Number(f.line) || 1 }) } : w.focus && w.open.includes(w.focus.path!) ? w.focus : null
      // (a private note: the agents don't know they're there)
      if (w.focus?.path && hidden(w.focus.path)) w.focus = null
      if (m.active) w.at = Date.now()
      // (another note, not the same one focused again)
      if (w.focus && m.active && w.focus.path !== w.was) { w.was = w.focus.path; addMoment({ kind: "open", ...w.focus }) }
      if (Array.isArray(m.panes)) w.panes = panesFrom(m.panes)
      // (a job's tab on screen: seen)
      const shownJobs = m.active && w.panes.length ? jobs.cards().filter((j) => j.unseen && w.panes.some((x) => x.to === j.link)) : []
      if (shownJobs.length) jobs.seen(shownJobs.map((j) => j.id))
      w.pane = str(m.pane) || undefined
      // (awareness, in pair: the pane they went to that isn't a note, by its title; a private page's never)
      const pn = w.panes.find((x) => x.id === w.pane), kind = pn && paneSource(pn.to).kind
      if (pn && m.active && pn.id !== w.told && kind !== "note" && !privatePane(pn)) { w.told = pn.id; addMoment({ kind: "open", pane: pn.id, title: pn.title, ...(kind === "site" ? { url: paneSource(pn.to).url } : {}) }) }
      else if (kind === "note") w.told = pn!.id
    } else if (m.t === "moment" && (m.kind === "ask" || m.kind === "point" || m.kind === "change") && (str(m.pane) || str(m.ui)) && !str(m.path)) {
      // (an ask or a point on a pane or the app's UI, or a change in UI it follows: the window says what's there)
      w.at = Date.now()
      void paneMoment(m, req)
    } else if (m.t === "moment" && typeof m.kind === "string" && ["ask", "point", "edit"].includes(m.kind)) {
      w.at = Date.now()
      addMoment({ kind: m.kind as Moment["kind"], for: str(m.agent) || undefined, path: str(m.path) || undefined, line: Number(m.line) || undefined, text: str(m.text) || undefined,
        selection: str(m.selection) || undefined, find: m.kind === "point" || str(m.scene) ? str(m.find).slice(0, 200) || undefined : undefined,
        hunks: Array.isArray(m.hunks) ? (m.hunks as Hunk[]).slice(0, 40) : undefined,
        ...(Number(m.waited) >= 0 ? { waited: Math.min(600_000, Math.round(Number(m.waited))) } : {}), ...point(m),
        ...(Array.isArray(m.changes) ? { changes: m.changes.map(String).slice(0, 40) } : {}), ...(str(m.scene) ? { scene: str(m.scene).slice(0, 20_000) } : {}) }, req)
    } else if (m.t === "pin" && typeof m.id === "string") {
      pin(m.id)
    } else if (m.t === "seen" && Array.isArray(m.ids)) {
      saw(m.ids.filter((x): x is string => typeof x === "string"))
    } else if (m.t === "hide" && typeof m.id === "string") {
      hide(m.id)
    } else if (m.t === "reopen" && typeof m.id === "string") {
      reopen(m.id)
    } else if (m.t === "answer" && typeof m.id === "string" && ["accept", "reject", "dismiss", "reply"].includes(String(m.verdict))) {
      answer(m.id, m.verdict as "accept", str(m.text) || undefined, req)
    } else if (m.t === "review" && typeof m.id === "string" && (m.verdict === "accept" || m.verdict === "reject")) {
      void review(m.id, m.verdict, str(m.change) || undefined, req).catch((e) => console.error(`companion: ${(e as Error).message}`))
    } else if (m.t === "comment") {
      const c = personComment({ by: "user", agent: "" }, str(m.path), m), to = c && mentioned(c.text!)
      if (c && to) askIn(c, to, str(m.selection).slice(0, 20_000), req)
    } else if (m.t === "done" && typeof m.rid === "string") {
      asked.get(m.rid)?.done(m.ok === true, str(m.error) || undefined, m)
    }
  })
  ws.on("close", () => {
    windows.delete(ws)
    // (gone mid-edit: what it was asked fails now, not when its wait runs out, and the note's turn is free)
    for (const x of [...asked.values()]) if (x.ws === ws) x.done(false, "the window showing it closed as it was typed: read it again before another change")
  })
})
