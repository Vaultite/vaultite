/** A tab dragged past its window's edge (web Tabs.tsx' DragGhost): its card's picture follows the pointer over the screen
 *  in a see-through window it goes through. A BrowserWindow: AppWindows count as the app's windows. */
import { BrowserWindow, screen, type WebContents } from "electron"

/** The card as the page draws it: its box (CSS px of the page), where the pointer holds it, its corners. */
export type GhostLook = { x: number; y: number; width: number; height: number; grab: { x: number; y: number }; radius: number }

/** Room around the card for its shadow. */
const PAD = 24
let win: BrowserWindow | null = null
let follow: ReturnType<typeof setInterval> | null = null
/** Each show's own: one hidden (or another shown) meanwhile doesn't show late. */
let shown = 0

function ghost() {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({ width: 100, height: 100, transparent: true, frame: false, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true, show: false, type: "panel",
    backgroundColor: "#00000000", webPreferences: { sandbox: true, contextIsolation: true, javascript: false, backgroundThrottling: false } })
  win.setIgnoreMouseEvents(true)
  // (over a full screen window too; skipTransformProcessType: else macOS takes the app out of the Dock for it)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setAlwaysOnTop(true, "pop-up-menu")
  return win
}

/** Show the card the page `from` draws at `look` (its pixels, as they are now) under the pointer, till hideGhost. */
export async function showGhost(from: WebContents, look: GhostLook) {
  const n = ++shown
  const z = from.getZoomFactor()
  const r = { x: Math.round(look.x * z), y: Math.round(look.y * z), width: Math.max(1, Math.round(look.width * z)), height: Math.max(1, Math.round(look.height * z)) }
  const img = await from.capturePage(r)
  if (n !== shown || img.isEmpty()) return false
  const radius = Math.max(0, look.radius * z), grab = { x: look.grab.x * z, y: look.grab.y * z }
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">`
    + `<img src="${img.toDataURL()}" style="position:absolute;left:${PAD}px;top:${PAD}px;width:${r.width}px;height:${r.height}px;`
    + `border-radius:${radius}px;box-shadow:0 12px 32px rgba(0,0,0,.32),0 0 0 .5px rgba(127,127,127,.35);opacity:.9"></body></html>`
  const w = ghost()
  w.setBounds({ ...place(grab), width: r.width + PAD * 2, height: r.height + PAD * 2 })
  await w.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`).catch(() => {})
  if (n !== shown || w.isDestroyed()) return false
  w.setPosition(place(grab).x, place(grab).y)
  w.showInactive()
  // (by the cursor itself rather than the page's moves: as smooth as the pointer, wherever it goes)
  if (follow) clearInterval(follow)
  follow = setInterval(() => {
    if (w.isDestroyed() || from.isDestroyed()) return hideGhost()
    const p = place(grab)
    w.setPosition(p.x, p.y)
  }, 16)
  return true
}

/** The window's top-left for the card held at `grab` (DIP) under the cursor. */
function place(grab: { x: number; y: number }) {
  const c = screen.getCursorScreenPoint()
  return { x: Math.round(c.x - grab.x - PAD), y: Math.round(c.y - grab.y - PAD) }
}

export function hideGhost() {
  shown++
  if (follow) { clearInterval(follow); follow = null }
  if (win && !win.isDestroyed()) win.hide()
}
