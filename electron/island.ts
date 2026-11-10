// The island: the agents in the background as one quiet mark by the notch and a knock's line as it comes, in a window at
// the top of the user's display (right of the notch and any other island there), click-through but over it. screen.html#island.
import { type BrowserWindow, ipcMain, screen, type Display } from "electron"
import path from "node:path"
import { overlayWindow, takesPointer } from "./overlaywin.ts"
import { quiet } from "./quiet.ts"
import { listen, onFree } from "./helperscope.ts"
import { islandSpot, islandsOn, type OtherWindow, type Rect, roomAt, type Spot, windowAt } from "./islandlogic.ts"
import type { Knock, Presence } from "../plugins/core/companion/knocks.ts"
import type { WalkScene } from "../plugins/core/companion/walks.ts"

/** What the page draws: the presences, the knock showing (`left`: ms of its grace left), a QA walk or lesson on, where it
 *  sits in its window. */
export type IslandData = { presences: Presence[]; knock: (Knock & { tint: string; left: number }) | null; walk: WalkScene | null; spot: Spot; left: number; width: number }
/** What the user does there: opens a session (a presence's id), puts a knock off, closes its card (`dismiss`: it rests in
 *  the island), ignores it (`mute`: its session), a walk's buttons (scratch, done, cancel), All agents (`agents`: the view to open). */
export type IslandActs = { open: (id: string) => void; later: (knock: string) => void; dismiss: (knock: string) => void; ignore: (knock: string, mute: boolean) => void; walk: (what: string) => void
  agents: (to: string) => void; hover?: (on: boolean) => void }

const PRELOAD = path.join(import.meta.dirname, "screen-preload.cjs")
/** Its window's size: room for the knock's line and, below the bar, the list a hover opens (about 9 rows with their
 *  group headings; the page scrolls the rest). Click-through but while hovered, so its height costs nothing. */
const W = 700, H = 600
let win: BrowserWindow | null = null
let url = ""
let last: Omit<IslandData, "spot" | "left" | "width"> | null = null
let spot: Spot | null = null
let acts: IslandActs | null = null
/** What its page was sent last: the same again isn't sent (the helper ticks while sessions show). */
let sent = ""
/** Where each session shows in it (the mark, its row, a knock's line), in the window's points. */
let faces: (Rect & { id: string })[] = []

/** What the user does on it, heard once. */
export function islandActs(a: IslandActs) {
  if (acts) { acts = a; return }
  acts = a
  onFree(() => { acts = null })
  const mine = (e: Electron.IpcMainEvent) => !!win && !win.isDestroyed() && e.sender === win.webContents
  listen(ipcMain, "island:faces", (e, list: unknown) => {
    if (!mine(e) || !Array.isArray(list)) return
    faces = list.flatMap((f: { id?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown }) =>
      typeof f?.id === "string" && [f.x, f.y, f.width, f.height].every((n) => typeof n === "number") ? [f as Rect & { id: string }] : [])
  })
  listen(ipcMain, "island:act", (e, m: { act?: unknown; id?: unknown; mute?: unknown }) => {
    if (!mine(e) || typeof m?.id !== "string") return
    if (m.act === "open") acts?.open(m.id)
    else if (m.act === "later") acts?.later(m.id)
    else if (m.act === "dismiss") acts?.dismiss(m.id)
    else if (m.act === "ignore") acts?.ignore(m.id, m.mute === true)
    else if (m.act === "walk") acts?.walk(m.id)
    else if (m.act === "agents") acts?.agents(m.id)
  })
}

function make() {
  const w = overlayWindow({ width: W, height: H, focusable: false, enableLargerThanScreen: true, acceptFirstMouse: true,
    webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false } }, 2)
  // (over its bar or card it takes the pointer, and a knock's time waits meanwhile)
  takesPointer(w, (on) => acts?.hover?.(on))
  quiet(w)
  w.webContents.on("did-finish-load", () => { sent = ""; send() })
  w.on("closed", () => { if (win === w) win = null })
  if (url) void w.loadURL(url).catch(() => {})
  return w
}

function send() {
  if (!win || win.isDestroyed() || win.webContents.isLoading() || !last || !spot) return
  const b = windowAt(spot, screen.getDisplayMatching({ x: spot.x, y: spot.y, width: 1, height: 1 }), W, H)
  const at = win.getBounds()
  if (at.x !== b.x || at.y !== b.y) win.setBounds(b)
  // (each second while sessions show: the page draws again only when something changed, or a minute on for its "5m")
  const data = { ...last, spot, left: spot.x - b.x, width: W } satisfies IslandData, said = `${Math.floor(Date.now() / 60_000)}${JSON.stringify(data)}`
  if (said !== sent) { sent = said; win.webContents.send("vaultite:island", data) }
}

/** Whether its page is up (made now, unseen, if it isn't): a knock's grace starts only once it can be drawn. */
export function islandReady(base: string | null) {
  if (!base) return false
  const next = `${base}/screen.html#island`
  if (next !== url) { url = next; if (win && !win.isDestroyed()) void win.loadURL(url).catch(() => {}) }
  if (!win || win.isDestroyed()) win = make()
  return !win.webContents.isLoading() && win.webContents.getURL() === url
}

/** Draw `d` at `s` (from `base`, the server's screen.html); null: nothing to show, the window hidden. */
export function showIsland(base: string | null, d: Omit<IslandData, "spot" | "left" | "width"> | null, s: Spot | null) {
  if (!base) { win?.destroy(); win = null; url = ""; return }
  const next = `${base}/screen.html#island`
  if (next !== url) { url = next; if (win && !win.isDestroyed()) void win.loadURL(url).catch(() => {}) }
  const shown = !!d && !!s && !s.hidden && (d.presences.length > 0 || !!d.knock || !!d.walk)
  if (!shown) { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); return }
  last = d; spot = s
  if (!win || win.isDestroyed()) win = make()
  send()
  if (!win.isVisible()) win.showInactive()
}

/** The display the island goes on (the pointer's), with its notch (screen.swift's `notch`) and other apps' islands there
 *  (its window list): where it sits. */
export function spotNow(notches: { frame: Rect; notch?: Rect }[], windows: OtherWindow[]): Spot {
  const d: Display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const same = (a: Rect, b: Rect) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.width - b.width) < 2
  const notch = notches.find((n) => same(n.frame, d.bounds))?.notch ?? null
  const s = islandSpot(d, notch, islandsOn(d, notch, windows)), room = roomAt(s, d, windows)
  return Number.isFinite(room) ? { ...s, room } : s
}

/** The session shown at screen point `p` (a presence's id), if the island's up there. */
export function presenceAt(p: { x: number; y: number }) {
  if (!win || win.isDestroyed() || !win.isVisible()) return null
  const b = win.getBounds(), x = p.x - b.x, y = p.y - b.y
  return faces.find((f) => x >= f.x - 3 && x <= f.x + f.width + 3 && y >= f.y - 3 && y <= f.y + f.height + 3)?.id ?? null
}
