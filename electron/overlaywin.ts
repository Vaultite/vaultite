// Every window the companion draws over the screen (its cursors and ink, its box, its cards, what comes next) is made
// here: over every Space and full screen app, never in Mission Control, and kept out of screen shares and recordings.
import { BrowserWindow, type BrowserWindowConstructorOptions, ipcMain, screen } from "electron"
import { QUIET, takePointer } from "./quiet.ts"
import { type Box, type Layer, LEVELS, overlayTakes } from "./stack.ts"
import { listen, onFree } from "./helperscope.ts"

/** Whether its windows stay out of screen shares, recordings and screenshots (the companion's `hide_from_shares`). */
let hidden = true
const made = new Set<BrowserWindow>()

/** A see-through, frameless panel over everything, at `layer`; `o` adds to or overrides the defaults. Shown by its maker
 *  (`showInactive`). */
export function overlayWindow(o: BrowserWindowConstructorOptions, layer: Layer) {
  const w = new BrowserWindow({ transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, show: false, type: "panel", backgroundColor: "#00000000", ...o })
  // (skipTransformProcessType: else macOS takes the app out of the Dock for it)
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // (not a window to the user: Mission Control leaves it out)
  w.setHiddenInMissionControl(true)
  const [level, at] = LEVELS[layer]
  w.setAlwaysOnTop(true, level, at)
  // (sharingType none: macOS leaves it out of every capture, ScreenCaptureKit's too; the user still sees it)
  w.setContentProtection(hidden)
  made.add(w)
  w.once("closed", () => made.delete(w))
  return w
}

/** Its windows hidden from shares or not, those up now too. */
export function hideFromShares(on: boolean) {
  if (on === hidden) return
  hidden = on
  for (const w of made) if (!w.isDestroyed()) w.setContentProtection(on)
}
export const hiddenFromShares = () => hidden
/** Every one there now (its cursors, cards, box, the island, take-over's border), by window number: what the
 *  companion's own pictures and recordings leave out, whether or not they're hidden from shares. */
export const overlayNumbers = () => [...made].filter((w) => !w.isDestroyed()).map((w) => Number(/^window:(\d+)/.exec(w.getMediaSourceId())?.[1] ?? 0)).filter((n) => n > 0)

// ---------- the pointer: an overlay takes it only while it's over something on it that can be pressed ----------
// Its page tells where (web/src/screendraw/hold.ts); decided here, so nothing the page missed leaves it taking every click.

type Holds = { boxes: Box[]; pressing: number; on: boolean; stalled: boolean; heard?: (on: boolean) => void }
const holds = new Map<BrowserWindow, Holds>()
/** While a press begun on one goes on (a card dragged past its edge), the page says so again this often at least. */
const PRESS_MS = 2000
const POLL_MS = 50
let polling: ReturnType<typeof setInterval> | null = null

/** Window `w` lets the pointer through but over what its page marks (`heard`: it takes the pointer now, or not). */
export function takesPointer(w: BrowserWindow, heard?: (on: boolean) => void) {
  wire()
  const h: Holds = { boxes: [], pressing: 0, on: false, stalled: false, heard }
  holds.set(w, h)
  takePointer(w, false)
  const forget = () => { h.boxes = []; h.pressing = 0; check() }
  w.webContents.on("did-start-navigation", (d) => { if (d.isMainFrame && !d.isSameDocument) forget() })
  w.webContents.on("render-process-gone", forget)
  w.webContents.on("unresponsive", () => { h.stalled = true; check() })
  w.webContents.on("responsive", () => { h.stalled = false; check() })
  w.on("hide", () => { h.pressing = 0; check() })
  w.on("show", check)
  w.once("closed", () => { holds.delete(w); check() })
}

let wired = false
/** Its pages' word, heard from its first window on (again after the helper stopped: helperscope.ts). */
function wire() {
  if (wired) return
  wired = true
  onFree(() => { wired = false })
  listen(ipcMain, "overlay:holds", (e, m: { boxes?: unknown; pressing?: unknown }) => {
    const w = BrowserWindow.fromWebContents(e.sender), h = w && holds.get(w)
    if (!h) return
    if (Array.isArray(m?.boxes)) h.boxes = m.boxes.flatMap((b: Partial<Box>) => [b.x, b.y, b.width, b.height].every((n) => typeof n === "number" && Number.isFinite(n)) ? [b as Box] : []).slice(0, 200)
    h.pressing = m?.pressing === true ? Date.now() + PRESS_MS : 0
    check()
  })
  // (the pointer came over one: taken now, not at the next look)
  listen(ipcMain, "overlay:near", (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && holds.has(w)) check() })
}

/** Each window takes the pointer as where it is says. Taken as the page hears the pointer over one (`near`) or tells new
 *  boxes; let go as soon as it isn't, looked at every POLL_MS while any window takes it (only then: nothing polls at rest). */
function check() {
  const at = screen.getCursorScreenPoint(), now = Date.now()
  let live = false
  for (const [w, h] of holds) {
    if (w.isDestroyed()) { holds.delete(w); continue }
    const on = overlayTakes({ win: w.getBounds(), shown: w.isVisible(), stalled: h.stalled, boxes: h.boxes, at, pressing: h.pressing > now })
    if (on) live = true
    if (on === h.on) continue
    h.on = on
    takePointer(w, on)
    h.heard?.(on)
  }
  if (live && !polling) polling = setInterval(check, POLL_MS)
  else if (!live && polling) { clearInterval(polling); polling = null }
}
// (what each takes now, for web/qa/overlayholds.mjs)
if (QUIET) Object.assign(globalThis, { vaultiteOverlayHolds: () => { check(); return [...holds].map(([w, h]) => ({ url: w.webContents.getURL(), on: h.on, boxes: h.boxes })) } })
