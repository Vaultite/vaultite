/** The companion's cursor over the whole screen: a see-through window a display, every Space and full screen app too,
 *  the pointer going through but over the cursor (to drag it); it draws web/screen.html as helper.ts says. */
import { BrowserWindow, ipcMain, screen, type Display, type IpcMainEvent } from "electron"
import path from "node:path"
import { type Scene, sceneFor } from "./helperlogic.ts"

/** What the user does to it: drags a cursor and drops it at a point, dismisses a bubble, stops dictating. */
export type OverlayActs = { drop: (name: string, x: number, y: number) => void; dismiss: (id: string) => void; stop: () => void }

const PRELOAD = path.join(import.meta.dirname, "screen-preload.cjs")
const wins = new Map<number, BrowserWindow>()
let url = ""
let scene: Scene = { agents: [], idle: null, pill: null }
let acts: OverlayActs | null = null
let watching = false

const empty = (x: ReturnType<typeof sceneFor>) => !x.agents.length && !x.idle && !x.pill

function make(d: Display) {
  const w = new BrowserWindow({ ...d.bounds, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false,
    maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, show: false, type: "panel", enableLargerThanScreen: true,
    backgroundColor: "#00000000", webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  w.setIgnoreMouseEvents(true, { forward: true })
  // (skipTransformProcessType: else macOS takes the app out of the Dock for it)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  w.setAlwaysOnTop(true, "screen-saver")
  w.webContents.on("did-finish-load", () => push())
  if (url) void w.loadURL(url).catch(() => {})
  wins.set(d.id, w)
  return w
}

/** Each display has its window, where it is. */
function fit() {
  const ds = screen.getAllDisplays()
  for (const [id, w] of [...wins]) if (!ds.some((d) => d.id === id)) { w.destroy(); wins.delete(id) }
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
    const s = sceneFor(d, scene, p, ds)
    w.webContents.send("vaultite:screen", s)
    // (shown only with something to draw: an empty one still costs the window server a full-screen layer)
    if (empty(s)) { if (w.isVisible()) w.hide() } else if (!w.isVisible()) w.showInactive()
  }
}

/** Draw `s` from the server at `base` (its screen.html); null: none, every window goes. */
export function showOverlay(base: string | null, s?: Scene) {
  if (s) scene = s
  if (!base) { for (const w of wins.values()) w.destroy(); wins.clear(); url = ""; return }
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
  ipcMain.on("screen:dismiss", (e, id: unknown) => { if (mine(e) && typeof id === "string") acts?.dismiss(id) })
  ipcMain.on("screen:stop", (e) => { if (mine(e)) acts?.stop() })
}
