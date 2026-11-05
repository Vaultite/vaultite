/** The companion's cursor over the whole screen: a see-through window a display, every Space and full screen app too,
 *  the pointer going through but over the cursor (to drag it); it draws web/screen.html as helper.ts says. */
import { BrowserWindow, ipcMain, screen, shell, type Display, type IpcMainEvent } from "electron"
import path from "node:path"
import { panelAt, type Point, type Scene, sceneFor, splitScene } from "./helperlogic.ts"

/** What the user does to it: drags a cursor and drops it at a point, clicks it or its bubble (its conversation opens),
 *  calls it back (a double click) or right-clicks it, stops dictating. Points are the screen's. */
export type OverlayActs = { drop: (name: string, x: number, y: number) => void; open: (name: string, at: Point) => void; home: (name: string) => void
  menu: (name: string, at: { window: BrowserWindow; x: number; y: number }) => void; stop: () => void }
/** What the user does in a cursor's conversation: asks (typed), the microphone, More (its menu), and it closed. */
export type PanelActs = { send: (name: string, text: string) => void; mic: () => void; more: (name: string, at: { window: BrowserWindow; x: number; y: number }) => void; closed: (name: string) => void }

const PRELOAD = path.join(import.meta.dirname, "screen-preload.cjs")
const wins = new Map<number, BrowserWindow>()
let url = ""
let scene: Scene = { agents: [], idle: null, pill: null }
let acts: OverlayActs | null = null
let watching = false

const empty = (x: ReturnType<typeof sceneFor>) => !x.agents.length && !x.idle && !x.pill
/** What each window was sent last (its scene's shape and places), and its hiding once it's had nothing to draw a while. */
const sent = new Map<BrowserWindow, { shape: string; at: string }>()
const hiding = new Map<BrowserWindow, ReturnType<typeof setTimeout>>()
// (an empty window still costs the window server a full-screen layer, but hiding and showing it at once flickers)
const LINGER = 4000

function make(d: Display) {
  const w = new BrowserWindow({ ...d.bounds, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, show: false, type: "panel", enableLargerThanScreen: true,
    backgroundColor: "#00000000", webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  w.setIgnoreMouseEvents(true, { forward: true })
  // (skipTransformProcessType: else macOS takes the app out of the Dock for it)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // (not a window to the user: Mission Control leaves it out)
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver")
  w.webContents.on("did-finish-load", () => { sent.delete(w); push() })
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
  if (!base) { for (const w of wins.values()) drop(w); wins.clear(); url = ""; return }
  const next = `${base}/screen.html`
  if (next !== url) { url = next; for (const w of wins.values()) void w.loadURL(url).catch(() => {}) }
  if (!watching) {
    watching = true
    for (const e of ["display-added", "display-removed", "display-metrics-changed"] as const) screen.on(e as "display-added", fit)
  }
  if (wins.size !== screen.getAllDisplays().length) fit(); else push()
}

const mine = (e: IpcMainEvent) => [...wins.values()].find((w) => w.webContents === e.sender)
export function overlayActs(a: OverlayActs) {
  acts = a
  // (over the cursor or its bubble the window takes the pointer, so it can be dragged or clicked; elsewhere it goes through)
  ipcMain.on("screen:grab", (e, on: unknown) => { const w = mine(e); if (w) w.setIgnoreMouseEvents(!on, { forward: true }) })
  ipcMain.on("screen:drop", (e, m: { name?: unknown; x?: unknown; y?: unknown }) => {
    const w = mine(e)
    if (!w || typeof m?.name !== "string" || typeof m.x !== "number" || typeof m.y !== "number") return
    const b = w.getBounds()
    acts?.drop(m.name, b.x + m.x, b.y + m.y)
  })
  ipcMain.on("screen:home", (e, name: unknown) => { if (mine(e) && typeof name === "string") acts?.home(name) })
  ipcMain.on("screen:menu", (e, m: { name?: unknown; x?: unknown; y?: unknown }) => {
    const w = mine(e)
    if (w && typeof m?.name === "string" && typeof m.x === "number" && typeof m.y === "number") acts?.menu(m.name, { window: w, x: Math.round(m.x), y: Math.round(m.y) })
  })
  ipcMain.on("screen:open", (e, m: { name?: unknown; x?: unknown; y?: unknown }) => {
    const w = mine(e)
    if (!w || typeof m?.name !== "string" || typeof m.x !== "number" || typeof m.y !== "number") return
    const b = w.getBounds()
    acts?.open(m.name, { x: b.x + m.x, y: b.y + m.y })
  })
  ipcMain.on("screen:stop", (e) => { if (mine(e)) acts?.stop() })
}

// ---------- a cursor's conversation: its own small window, the one that takes the keyboard (the overlay never does)

/** What it shows: the agent, what it runs, its last words and the user's asks, the words being dictated into its box. */
export type PanelData = { name: string; tint: string; how: string; items: { id: string; kind: string; text?: string; t: number; question?: boolean }[]
  /** It's at work on what it was asked (its answer is on its way). */
  busy?: boolean
  /** `done` (with its `id`, to be taken once): said, for the box; `send`: sent as it is (a Talk key's). */
  words?: { text: string; listening: boolean; done?: boolean; id?: number; send?: boolean } }
const WIDTH = 300, PAD = 16
let panel: { w: BrowserWindow; name: string; at: Point; data: PanelData; height: number; menu: boolean } | null = null
let panelActs: PanelActs | null = null

/** Open agent `name`'s conversation by its cursor at `at` (the screen's points); already open: it moves there. */
export function openPanel(base: string, at: Point, data: PanelData) {
  if (panel && !panel.w.isDestroyed()) {
    Object.assign(panel, { at, name: data.name, data })
    place()
    panel.w.webContents.send("vaultite:panel", data)
    panel.w.focus()
    return
  }
  // (a panel: on a Mac one that takes the keyboard without bringing the app forward, so the app in front stays so)
  const w = new BrowserWindow({ width: WIDTH + PAD * 2, height: 160, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false, type: "panel", backgroundColor: "#00000000",
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true } })
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setHiddenInMissionControl(true)
  w.setAlwaysOnTop(true, "screen-saver", 1)
  const mine = { w, name: data.name, at, data, height: 0, menu: false }
  panel = mine
  // (a link in its words opens in the browser, never in this window)
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: "deny" } })
  w.webContents.on("will-navigate", (e, url) => { e.preventDefault(); if (/^https?:/i.test(url)) void shell.openExternal(url) })
  w.webContents.on("did-finish-load", () => { if (panel === mine) w.webContents.send("vaultite:panel", mine.data) })
  w.on("blur", () => { if (panel === mine && !mine.menu) closePanel() })
  w.on("closed", () => { if (panel === mine) { panel = null; panelActs?.closed(mine.name) } })
  void w.loadURL(`${base}/screen.html#panel`).catch(() => {})
}

/** Its words changed (a new say, an ask, dictation): drawn again. */
export function panelData(data: PanelData) {
  if (!panel || panel.w.isDestroyed() || panel.name !== data.name) return
  panel.data = data
  panel.w.webContents.send("vaultite:panel", data)
}
export const panelOpen = () => (panel && !panel.w.isDestroyed() ? panel.name : null)
export const panelFocused = () => !!panel && !panel.w.isDestroyed() && panel.w.isFocused()
export function closePanel() {
  if (panel && !panel.w.isDestroyed()) panel.w.close()
}

/** By its cursor, toward the room, inside the screen; shown once its page knows its height. */
function place() {
  if (!panel || !panel.height) return
  const area = screen.getDisplayNearestPoint(panel.at).workArea
  const at = panelAt(panel.at, { width: WIDTH, height: panel.height }, area)
  panel.w.setBounds({ x: at.x - PAD, y: at.y - PAD, width: WIDTH + PAD * 2, height: panel.height + PAD * 2 })
  if (!panel.w.isVisible()) { panel.w.show(); panel.w.focus() }
}

const ofPanel = (e: IpcMainEvent) => (panel && !panel.w.isDestroyed() && panel.w.webContents === e.sender ? panel : null)
export function onPanel(a: PanelActs) {
  panelActs = a
  ipcMain.on("panel:size", (e, h: unknown) => { const p = ofPanel(e); if (p && typeof h === "number" && h > 0 && Math.round(h) !== p.height) { p.height = Math.round(h); place() } })
  ipcMain.on("panel:send", (e, text: unknown) => { const p = ofPanel(e); if (p && typeof text === "string" && text.trim()) { a.send(p.name, text.trim()) } })
  ipcMain.on("panel:close", (e) => { if (ofPanel(e)) closePanel() })
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
