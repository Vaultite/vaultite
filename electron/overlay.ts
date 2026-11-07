/** The companion over the whole screen: a see-through window a display, every Space and full screen app too, the pointer
 *  going through but over a bubble or the pill (to click them); it draws web/screen.html as helper.ts says. */
import { BrowserWindow, clipboard, ipcMain, screen, shell, type Display, type IpcMainEvent } from "electron"
import path from "node:path"
import { besidePointer, grownAt, panelAt, pointerBox, type Point, reaching, type Rect, type Scene, sceneFor, splitScene } from "./helperlogic.ts"
import { drawingFor, type Drawing, type DrawAct, offered } from "./drawing.ts"
import { rectOf, spots } from "../plugins/core/companion/screenmarks.ts"

/** What the user does to it: clicks a bubble (its conversation opens by its cursor, `at`: the screen's), stops dictating. */
export type OverlayActs = { open: (name: string, at: Point) => void; stop: () => void
  /** Their box moved or resized (screen points), or one of its buttons pressed (record, stop, replay, close). */
  region?: (r: Rect) => void; regionAct?: (what: string) => void }
/** What the user does in a cursor's conversation: asks (typed), the microphone, More (its menu), and it closed (`esc`:
 *  by Esc in it; else clicked away, its close, or closed by the helper). */
export type PanelActs = { send: (name: string, text: string) => void; mic: () => void; more: (name: string, at: { window: BrowserWindow; x: number; y: number }) => void; closed: (name: string, why?: "esc") => void }

const PRELOAD = path.join(import.meta.dirname, "screen-preload.cjs")
const wins = new Map<number, BrowserWindow>()
let url = ""
let scene: Scene = { agents: [], summon: null, pill: null }
let acts: OverlayActs | null = null
let watching = false

const empty = (x: ReturnType<typeof sceneFor>) => !x.agents.length && !x.summon && !x.pill && !x.region && !layers.size
/** What each window was sent last (its scene's shape and places), and its hiding once it's had nothing to draw a while. */
const sent = new Map<BrowserWindow, { shape: string; at: string }>()
const hiding = new Map<BrowserWindow, ReturnType<typeof setTimeout>>()
// (an empty window still costs the window server a full-screen layer, but hiding and showing it at once flickers)
const LINGER = 4000

function make(d: Display) {
  const w = new BrowserWindow({ ...d.bounds, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, show: false, type: "panel", enableLargerThanScreen: true,
    // (its soft cues play with no click on it: nothing ever clicks the overlay to allow them)
    backgroundColor: "#00000000", webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" } })
  w.setIgnoreMouseEvents(true, { forward: true })
  // (skipTransformProcessType: else macOS takes the app out of the Dock for it)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // (not a window to the user: Mission Control leaves it out)
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver")
  w.webContents.on("did-finish-load", () => { sent.delete(w); push(); if (layers.size) sendDrawing(); if (feed) feedPointer(true) })
  if (url) void w.loadURL(url).catch(() => {})
  wins.set(d.id, w)
  return w
}

function drop(w: BrowserWindow) { clearTimeout(hiding.get(w)); hiding.delete(w); sent.delete(w); w.destroy() }

/** Each display has its window, where it is. */
function fit() {
  const ds = screen.getAllDisplays()
  for (const [id, w] of [...wins]) if (!ds.some((d) => d.id === id)) { drop(w); wins.delete(id) }
  for (const d of ds) {
    const w = wins.get(d.id) ?? make(d)
    const b = w.getBounds()
    if (b.x !== d.bounds.x || b.y !== d.bounds.y || b.width !== d.bounds.width || b.height !== d.bounds.height) w.setBounds(d.bounds)
  }
  push()
}

function push() {
  const ds = screen.getAllDisplays(), p = screen.getCursorScreenPoint()
  for (const d of ds) {
    const w = wins.get(d.id)
    if (!w || w.isDestroyed() || w.webContents.isLoading()) continue
    const s = sceneFor(d, scene, p, ds), { shape, at } = splitScene(s), had = sent.get(w), places = JSON.stringify(at)
    if (had?.shape !== shape) w.webContents.send("vaultite:screen", s)
    else if (had.at !== places) w.webContents.send("vaultite:screen-at", at)
    sent.set(w, { shape, at: places })
    if (!empty(s)) {
      clearTimeout(hiding.get(w)); hiding.delete(w)
      if (!w.isVisible()) w.showInactive()
    } else if (w.isVisible() && !hiding.has(w)) hiding.set(w, setTimeout(() => { hiding.delete(w); if (!w.isDestroyed() && empty(sceneFor(d, scene, screen.getCursorScreenPoint(), screen.getAllDisplays()))) w.hide() }, LINGER))
  }
}

/** Draw `s` from the server at `base` (its screen.html); null: none, every window goes. */
export function showOverlay(base: string | null, s?: Scene) {
  if (s) scene = s
  if (!base) { followPointer(false); for (const w of wins.values()) drop(w); wins.clear(); url = ""; return }
  const next = `${base}/screen.html`
  if (next !== url) { url = next; for (const w of wins.values()) void w.loadURL(url).catch(() => {}) }
  if (!watching) {
    watching = true
    for (const e of ["display-added", "display-removed", "display-metrics-changed"] as const) screen.on(e as "display-added", fit)
  }
  if (wins.size !== screen.getAllDisplays().length) fit(); else push()
}

// ---------- the pointer, fed to the windows while the companion rides beside it (an exchange): a light poll, only then

let feed: ReturnType<typeof setInterval> | null = null, fed = "", lastP: Point | null = null, lastT = 0
/** The pointer's speed (points a second), smoothed: whether it heads for the box. */
const speed = { x: 0, y: 0 }
/** Where the companion is headed or rests while it points (the overlay's pilot says; null: beside the pointer). */
let pilotTo: Point | null = null
/** Where the pointer went, each move while it's fed (the helper keeps the trail the Talk key's hold draws). */
let tap: ((p: Point, t: number) => void) | null = null
/** Feed the pointer to the overlay (on: an exchange), and its box along with it; `moved` hears each move. */
export function followPointer(on: boolean, moved?: (p: Point, t: number) => void) {
  tap = on ? moved ?? null : null
  if (on === !!feed) return
  if (!on) { clearInterval(feed!); feed = null; fed = ""; pilotTo = null; return }
  feed = setInterval(() => feedPointer(), 16)
  feedPointer(true)
}
function feedPointer(again = false) {
  const p = screen.getCursorScreenPoint(), now = Date.now(), key = `${p.x},${p.y}`
  if (lastP && now > lastT) {
    const dt = (now - lastT) / 1000, k = Math.min(1, dt / 0.08)
    speed.x += ((p.x - lastP.x) / dt - speed.x) * k
    speed.y += ((p.y - lastP.y) / dt - speed.y) * k
  }
  lastP = p; lastT = now
  if (key !== fed || again) {
    fed = key
    tap?.(p, now)
    const home = besidePointer(p, screen.getDisplayNearestPoint(p).bounds), ds = screen.getAllDisplays()
    for (const [id, w] of wins) {
      if (w.isDestroyed() || w.webContents.isLoading()) continue
      const b = ds.find((d) => d.id === id)?.bounds
      if (b) w.webContents.send("vaultite:pointer", [p.x - b.x, p.y - b.y, home.x - b.x, home.y - b.y])
    }
  }
  travel(p, now)
}

/** A soft cue (web/src/core/cues.ts), played by the window of the display the pointer is on. */
export function cue(name: string) {
  const id = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id, w = wins.get(id)
  if (w && !w.isDestroyed() && !w.webContents.isLoading()) w.webContents.send("vaultite:cue", name)
}

// ---------- the companions' layers (drawing.ts): each session's, side by side; each display its part, in its own points

const layers = new Map<string, Drawing>()
let onDrawAct: ((a: DrawAct) => void) | null = null
/** Draw `agent`'s layer `d` over the screens (null: take it down); `found` the places the helper knows (its asks'
 *  elements, "el:<id>"). */
export function showDrawing(agent: string, d: Drawing | null, found?: Drawing["places"]) {
  if (d) layers.set(agent, { ...d, places: { ...found, ...d.places } })
  else layers.delete(agent)
  sendDrawing()
  push()
}
/** Every layer down (the server gone). */
export function dropDrawings() { layers.clear(); sendDrawing(); push() }
function sendDrawing() {
  const ds = screen.getAllDisplays(), p = screen.getCursorScreenPoint()
  for (const d of ds) { const w = wins.get(d.id); if (w && !w.isDestroyed() && !w.webContents.isLoading()) w.webContents.send("vaultite:draw", [...layers.values()].map((l) => drawingFor(l, d, ds, p))) }
}
/** Whether the layer `id` is up (not cleared, not ended). */
export const drawingUp = (id: string) => [...layers.values()].some((l) => l.id === id)
/** `agent`'s exchange is over: what lives until the next ask goes from its layer (the server does it and says so); `all`
 *  (Esc), the whole layer, at once. */
export function endDrawing(agent: string, all = false) {
  const l = layers.get(agent)
  if (!l) return
  if (all) showDrawing(agent, null)
  onDrawAct?.({ id: l.id, kind: all ? "clear" : "settle" })
}
/** What the user presses on a layer: Clear, Keep, a card's ×, its next step go to `fn`; copy and open are done here. */
export function drawingActs(fn: (a: DrawAct) => void) { onDrawAct = fn }

const mine = (e: IpcMainEvent) => [...wins.values()].find((w) => w.webContents === e.sender)
export function overlayActs(a: OverlayActs) {
  acts = a
  // (over a bubble or the pill the window takes the pointer, so it can be clicked; elsewhere it goes through)
  ipcMain.on("screen:grab", (e, on: unknown) => { const w = mine(e); if (w) w.setIgnoreMouseEvents(!on, { forward: true }) })
  ipcMain.on("screen:open", (e, m: { name?: unknown; x?: unknown; y?: unknown }) => {
    const w = mine(e)
    if (!w || typeof m?.name !== "string" || typeof m.x !== "number" || typeof m.y !== "number") return
    const b = w.getBounds()
    acts?.open(m.name, { x: b.x + m.x, y: b.y + m.y })
  })
  ipcMain.on("screen:stop", (e) => { if (mine(e)) acts?.stop() })
  ipcMain.on("screen:region", (e, r: unknown) => {
    const w = mine(e), o = (r ?? {}) as Record<string, unknown>, v = [o.x, o.y, o.width, o.height]
    if (!w || !v.every((n) => typeof n === "number" && Number.isFinite(n))) return
    const b = w.getBounds()
    acts?.region?.({ x: Math.round(b.x + Number(o.x)), y: Math.round(b.y + Number(o.y)), width: Math.round(Number(o.width)), height: Math.round(Number(o.height)) })
  })
  ipcMain.on("screen:region-act", (e, what: unknown) => { if (mine(e) && typeof what === "string") acts?.regionAct?.(what) })
  // (where the companion's pilot is headed: its box goes with it)
  ipcMain.on("screen:pilot", (e, to: unknown) => {
    const w = mine(e)
    if (!w) return
    const b = w.getBounds()
    pilotTo = Array.isArray(to) && to.length === 2 && to.every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: b.x + to[0], y: b.y + to[1] } : null
  })
  ipcMain.on("screen:draw-act", (e, a: DrawAct) => {
    const d = a && typeof a === "object" ? [...layers.values()].find((l) => l.id === a.id) : undefined
    if (!mine(e) || !d) return
    const act = { ...a, id: d.id }
    if ((a.kind === "copy" || a.kind === "open" || a.kind === "ask") && !offered(d, act)) return
    if (a.kind === "copy") return clipboard.writeText(a.text!)
    if (a.kind === "open") return void shell.openExternal(a.url!)
    // (gone at once; the server hears it after)
    if (a.kind === "clear") showDrawing(d.agent, null)
    if (a.kind === "clear" || a.kind === "keep" || a.kind === "ask" || (a.kind === "dismiss" && typeof a.mark === "string")) onDrawAct?.(act)
  })
}

// ---------- a cursor's conversation: its own small window, the one that takes the keyboard (the overlay never does)

/** What it shows: the agent, its last words and the user's asks, the words being dictated into its box. */
export type PanelData = { name: string; tint: string; items: { id: string; kind: string; text?: string; t: number; question?: boolean }[]
  /** It's at work on what it was asked (its answer is on its way). */
  busy?: boolean
  /** `done` (with its `id`, to be taken once): said, for the box; `send`: sent as it is (a Talk key's). */
  words?: { text: string; listening: boolean; done?: boolean; id?: number; send?: boolean }
  /** What its empty field says (an answer's box: how to reply without the mouse). */
  hint?: string }
const WIDTH = 300, PAD = 16
/** `travels`: an exchange's box, going with the companion as it rides beside the pointer (`goal`: where it's going,
 *  `held`: till when it holds for the pointer reaching for it). */
let panel: { w: BrowserWindow; name: string; at: Point; data: PanelData; height: number; menu: boolean; focus: boolean; travels: boolean; goal?: Point; pos?: Point; held: number
  /** Closed by Esc in it: its exchange ends, its voice with it. */
  esc?: boolean } | null = null
let panelActs: PanelActs | null = null
/** What the box keeps clear of besides its cursor (what it points at, its marks). */
let avoid: Rect[] = []
export function panelAvoid(rects: Rect[]) { avoid = rects }

/** Open agent `name`'s conversation by its cursor at `at` (the screen's points); already open: it moves there. Unfocused
 *  (an answer's box), it takes the keyboard only once clicked; `travels`: it goes with the companion (an exchange). */
export function openPanel(base: string, at: Point, data: PanelData, focus = true, travels = false) {
  if (panel && !panel.w.isDestroyed()) {
    Object.assign(panel, { at, name: data.name, data, focus, travels })
    place()
    panel.w.webContents.send("vaultite:panel", data)
    if (focus) panel.w.focus()
    return
  }
  // (a panel: on a Mac one that takes the keyboard without bringing the app forward, so the app in front stays so)
  const w = new BrowserWindow({ width: WIDTH + PAD * 2, height: 160, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, type: "panel", backgroundColor: "#00000000",
    // (a click in it goes straight to its field: no first click spent bringing it forward)
    acceptFirstMouse: true, webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true } })
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver", 1)
  const mine: NonNullable<typeof panel> = { w, name: data.name, at, data, height: 0, menu: false, focus, travels, held: 0 }
  panel = mine
  // (a link in its words opens in the browser, never in this window)
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: "deny" } })
  w.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url) })
  w.webContents.on("did-finish-load", () => { if (panel === mine) w.webContents.send("vaultite:panel", mine.data) })
  w.on("blur", () => { if (panel === mine && !mine.menu) closePanel() })
  w.on("closed", () => { if (panel === mine) { panel = null; panelActs?.closed(mine.name, mine.esc ? "esc" : undefined) } })
  void w.loadURL(`${base}/screen.html#panel`).catch(() => {})
}

/** Its words changed (a new say, an ask, dictation): drawn again. */
export function panelData(data: PanelData) {
  if (!panel || panel.w.isDestroyed() || panel.name !== data.name) return
  panel.data = data
  panel.w.webContents.send("vaultite:panel", data)
}
export const panelOpen = () => (panel && !panel.w.isDestroyed() ? panel.name : null)
/** Where it is on screen (its words' box, not the room around it), or null. */
export const panelBounds = () => { if (!panel || panel.w.isDestroyed() || !panel.w.isVisible()) return null; const b = panel.w.getBounds(); return { x: b.x + PAD, y: b.y + PAD, width: b.width - PAD * 2, height: b.height - PAD * 2 } }
/** The windows that are ours on screen (the overlay's, the conversation): a display's picture leaves them out. */
export const ownWindows = () => [...wins.values(), ...(panel && !panel.w.isDestroyed() ? [panel.w] : [])]
  .map((w) => Number(/^window:(\d+)/.exec(w.getMediaSourceId())?.[1] ?? 0)).filter((n) => n > 0)
export const panelFocused = () => !!panel && !panel.w.isDestroyed() && panel.w.isFocused()
export function closePanel(esc = false) {
  if (!panel || panel.w.isDestroyed()) return
  if (esc) panel.esc = true
  panel.w.close()
}

/** Where the box goes for its cursor at `at`: clear of its arrow and name, what it points at, the user's pointer. */
function spotFor(at: Point, pointer?: Point) {
  const area = screen.getDisplayNearestPoint(at).workArea
  // (its flag in the overlay: its name and what it does, about this wide)
  return panelAt(at, { width: WIDTH, height: panel!.height }, area, panel!.name.length * 7 + 70, null, [...avoid, ...marked(), ...(pointer ? [pointerBox(pointer)] : [])])
}
/** What the layers up mark on screen (their spots' rects, a little wider): the box keeps off it. */
const marked = (): Rect[] => [...layers.values()].filter((l) => !l.hidden).flatMap((l) => spots(l.marks).flatMap((s) => { const r = rectOf(s, l.places); return r ? [{ x: r.x - 10, y: r.y - 10, width: r.w + 20, height: r.h + 20 }] : [] }))
/** By its cursor, clear of its arrow and name, inside the screen; shown once its page knows its height. */
function place() {
  if (!panel || !panel.height) return
  const p = panel.travels ? screen.getCursorScreenPoint() : undefined, at = spotFor(panel.at, p)
  if (panel.travels && panel.w.isVisible() && panel.pos) {
    // (grown as its words stream in: it keeps the edge by its cursor (its foot, when it's above it) and grows away from
    // it, in one move; resized by its top it pushed down over the pointer, then slid back, each new line)
    const was = panel.w.getBounds().height - PAD * 2, area = screen.getDisplayNearestPoint({ x: Math.round(panel.at.x), y: Math.round(panel.at.y) }).workArea
    panel.pos = grownAt(panel.pos, was, { width: WIDTH, height: panel.height }, panel.at, area)
    panel.goal = at
    panel.w.setBounds({ x: Math.round(panel.pos.x - PAD), y: Math.round(panel.pos.y - PAD), width: WIDTH + PAD * 2, height: panel.height + PAD * 2 })
    return
  }
  panel.pos = at; panel.goal = at
  panel.w.setBounds({ x: at.x - PAD, y: at.y - PAD, width: WIDTH + PAD * 2, height: panel.height + PAD * 2 })
  if (panel.w.isVisible()) return
  if (panel.focus) { panel.w.show(); panel.w.focus() } else panel.w.showInactive()
}
/** An exchange's box, each pointer tick: with the companion (beside the pointer, or where it points), gliding there;
 *  held still while the pointer is in it or heading for it, and while it has the keyboard. */
function travel(p: Point, now: number) {
  const x = panel
  if (!x || x.w.isDestroyed() || !x.travels || !x.height || !x.pos || !x.w.isVisible()) return
  const box = { x: x.pos.x, y: x.pos.y, width: WIDTH, height: x.height }
  if (x.w.isFocused() || x.menu || reaching(p, speed, box)) x.held = now + 400
  if (now < x.held) return
  x.at = pilotTo ?? besidePointer(p, screen.getDisplayNearestPoint(p).bounds)
  x.goal = spotFor(x.at, p)
  const dx = x.goal.x - x.pos.x, dy = x.goal.y - x.pos.y
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
  // (an easing step each tick: about 90 ms to get most of the way)
  const k = 1 - Math.exp(-16 / 90)
  x.pos = Math.hypot(dx, dy) < 1.5 ? x.goal : { x: x.pos.x + dx * k, y: x.pos.y + dy * k }
  x.w.setPosition(Math.round(x.pos.x - PAD), Math.round(x.pos.y - PAD))
}

const ofPanel = (e: IpcMainEvent) => (panel && !panel.w.isDestroyed() && panel.w.webContents === e.sender ? panel : null)
export function onPanel(a: PanelActs) {
  panelActs = a
  ipcMain.on("panel:size", (e, h: unknown) => { const p = ofPanel(e); if (p && typeof h === "number" && h > 0 && Math.round(h) !== p.height) { p.height = Math.round(h); place() } })
  ipcMain.on("panel:send", (e, text: unknown) => { const p = ofPanel(e); if (p && typeof text === "string" && text.trim()) { a.send(p.name, text.trim()) } })
  ipcMain.on("panel:close", (e, esc: unknown) => { if (ofPanel(e)) closePanel(esc === true) })
  ipcMain.on("panel:mic", (e) => { if (ofPanel(e)) a.mic() })
  ipcMain.on("panel:more", (e, m: { x?: unknown; y?: unknown }) => {
    const p = ofPanel(e)
    if (!p || typeof m?.x !== "number" || typeof m.y !== "number") return
    // (its menu takes the keyboard a moment: no reason to close)
    p.menu = true
    a.more(p.name, { window: p.w, x: Math.round(m.x), y: Math.round(m.y) })
  })
}
/** Its menu closed (helper.ts' More): back to closing when the user clicks elsewhere. */
export function panelMenuClosed() {
  if (!panel || panel.w.isDestroyed()) return
  panel.menu = false
  if (!panel.w.isFocused()) closePanel()
}
