// Players (webplayer.ts's): the scripts filling a page's video in its window, and that window: no title bar, its controls
// shown with the pointer at its top, which drags it (topstrip.ts).
import { app, BaseWindow, type MenuItemConstructorOptions, type Rectangle, screen, WebContentsView } from "electron"
import fs from "node:fs"
import path from "node:path"
import { QUIET, quiet } from "./quiet.ts"
import { lightsShown, topStrip } from "./topstrip.ts"
import { isOnTop, setOnTop, watchFocus } from "./ontop.ts"
import { writeAtomic } from "./setup.ts"
import { MAIN_VIDEO } from "./playerpage.ts"

// Picture in picture for the page's main video, or out of it. A quiet copy (quiet.ts) marks the video instead
// (data-vaultite-pip): the system's window would show over the user's work.
const pip = (on: string, out: string, enter: string) => `(() => {
  const on = ${on}
  if (on) return void ${out}
  ${MAIN_VIDEO}
  const v = videos.filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]?.el
  if (!v) return "none"
  return ${enter}
})()`
export const PIP = QUIET
  ? pip(`document.querySelector("video[data-vaultite-pip]")`, `on.removeAttribute("data-vaultite-pip")`, `(v.setAttribute("data-vaultite-pip", ""), true)`)
  : pip("document.pictureInPictureElement", "document.exitPictureInPicture().catch(() => {})", "v.requestPictureInPicture().then(() => true, () => false)")

/** Resolves with the page's main video's aspect (width / height) once it has one other than `last`: a page written into
 *  (a pop-out) gets its video late, and a call's video changes size as the camera on the other end does. */
export const nextAspect = (last: number | null) => `new Promise((done) => {
  const look = () => {
    ${MAIN_VIDEO}
    const v = best?.video, a = v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 0
    if (a && Math.abs(a - ${last ?? 0}) > 0.005) { clearInterval(timer); done(a) }
  }
  const timer = setInterval(look, 500)
  look()
})`

const PLAYER_TITLE = "Vaultite player"
const MAC = process.platform === "darwin"
const LIGHTS = { x: 14, y: 13 }
/** How often a player looks whether it still has its page (ms). */
const WATCH_MS = 120

/** The window's last place on this machine (userData), as its area and centre: the next player has it at its aspect. */
const keptFile = () => path.join(app.getPath("userData"), "player-window.json")
function kept(): Rectangle | null {
  try {
    const k = JSON.parse(fs.readFileSync(keptFile(), "utf8")) as Rectangle
    return [k.x, k.y, k.width, k.height].every(Number.isFinite) && k.width >= 160 && k.height >= 90 ? k : null
  } catch { return null }
}

/** Where a player at `aspect` (width / height) opens: where the last one was, else centred on `near`'s screen. */
export function placeFor(aspect: number, near: Rectangle): Rectangle {
  const last = kept()
  const area = screen.getDisplayMatching(last ?? near).workArea
  let width = last ? Math.sqrt(last.width * last.height * aspect) : Math.min(1280, area.width * 0.6)
  let height = width / aspect
  const shrink = Math.min(1, (area.width * 0.95) / width, (area.height * 0.95) / height)
  width = Math.round(width * shrink); height = Math.round(height * shrink)
  const cx = last ? last.x + last.width / 2 : area.x + area.width / 2, cy = last ? last.y + last.height / 2 : area.y + area.height / 2
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)))
  return { x: clamp(cx - width / 2, area.x, area.x + area.width - width), y: clamp(cy - height / 2, area.y, area.y + area.height - height), width, height }
}

/** A player window at `bounds` (its content), hidden till shown; `menu`: its page's items for its top's right-click. */
export function playerWindow(bounds: Rectangle, menu: () => MenuItemConstructorOptions[] = () => []): BaseWindow {
  const w = new BaseWindow({ title: PLAYER_TITLE, ...bounds, useContentSize: true, minWidth: 320, minHeight: 180, backgroundColor: "#000000", show: false,
    ...(MAC ? { titleBarStyle: "hidden", trafficLightPosition: LIGHTS } : { frame: false, autoHideMenuBar: true }) })
  quiet(w)
  const { bar } = topStrip(w, () => { if (MAC && !w.isDestroyed()) { w.setWindowButtonPosition(LIGHTS); w.setWindowButtonVisibility(lightsShown(w)) } },
    { pin: () => setOnTop(w, !isOnTop(w)), menu: () => [...menu(), { label: "Keep window on top", type: "checkbox", checked: isOnTop(w), click: () => setOnTop(w, !isOnTop(w)) }] })
  watchFocus(w)
  // A player is its page's: one left with no live page (its page gone without taking it along) closes, not a black
  // window with nothing to close it by. (A moment's grace: a page leaving its player closes it the turn after.)
  const paged = () => w.contentView.children.some((c) => c !== bar && c instanceof WebContentsView && !c.webContents.isDestroyed())
  let empty = 0
  const timer = setInterval(() => {
    if (w.isDestroyed()) return clearInterval(timer)
    if (!w.isVisible()) return
    empty = paged() ? 0 : empty + 1
    if (empty * WATCH_MS >= 1000) w.close()
  }, WATCH_MS)

  // Its last normal place, kept as it closes.
  let place: Rectangle | null = null
  const note = () => { if (!w.isDestroyed() && w.isVisible() && !w.isFullScreen() && !w.isMaximized() && !w.isMinimized()) place = w.getContentBounds() }
  w.on("resize", note)
  w.on("move", note)
  w.on("close", () => {
    clearInterval(timer)
    if (place) { try { writeAtomic(keptFile(), JSON.stringify(place)) } catch { /* this run's only */ } }
  })
  return w
}

/** Lock window `w` to `aspect` (null: none), its content resized to it, keeping its width (and within its screen);
 *  `top`: points over the video that aren't its (a title bar). */
export function setAspect(w: BaseWindow, aspect: number | null, top = 0) {
  if (w.isDestroyed()) return
  w.setAspectRatio(aspect ?? 0, { width: 0, height: aspect ? top : 0 })
  if (!aspect || w.isFullScreen() || w.isMaximized()) return
  const b = w.getContentBounds(), area = screen.getDisplayMatching(b).workArea
  let width = b.width, height = Math.round(width / aspect) + top
  if (height > area.height) { height = area.height; width = Math.round((height - top) * aspect) }
  if (Math.abs(height - b.height) > 1 || width !== b.width) w.setContentBounds({ x: b.x, y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)), width, height })
}
