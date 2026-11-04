// Players (web.ts's): the scripts filling a page's video in its window, and that window: no title bar, its controls
// shown with the pointer at its top, which drags it (the Mac's traffic lights; ours elsewhere: player-bar.cjs).
import { app, BaseWindow, type Rectangle, screen, WebContentsView } from "electron"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { quiet } from "./quiet.ts"
import { writeAtomic } from "./setup.ts"

/** The page's main video: the biggest playing (else any), or the biggest frame that may go full screen (an embedded
 *  player), or none (the page itself fills the player). */
const MAIN_VIDEO = `const size = (el) => { const r = el.getBoundingClientRect(); return r.width >= 160 && r.height >= 90 ? r.width * r.height : 0 }
  const videos = [...document.querySelectorAll("video")].map((el) => ({ el, video: el, n: size(el) * (el.paused ? 1 : 2) }))
  const frames = [...document.querySelectorAll("iframe")].filter((f) => f.allowFullscreen || /\\bfullscreen\\b/.test(f.allow)).map((el) => ({ el, video: null, n: size(el) }))
  const best = [...videos, ...frames].filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]`
// The video's player (its site's box around it, no bigger: its controls, captions) fills the window as a popover, in
// the top layer over the page, leaving the page's own full screen to the site; answers its aspect (width / height).
export const FILL = `(() => {
  const fill = () => {
    window.__vaultitePlayer?.off()
    ${MAIN_VIDEO}
    if (!best) return null
    const v = best.video, box = (v ?? best.el).getBoundingClientRect()
    const aspect = () => v?.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : null
    // (the box around the video no bigger than it, the nearest that says it's a player, wrappers with no size skipped)
    const holder = () => {
      const n = size(v), boxes = []
      for (let at = v.parentElement; at && at !== document.body; at = at.parentElement) { const s = size(at); if (s > n * 1.25) break; if (s) boxes.push(at) }
      return boxes.find((b) => /player/i.test(b.id + " " + b.className + " " + b.localName)) ?? boxes.at(-1) ?? v
    }
    // (a popover closed is display: none, so it's one only while open)
    let el = null, chosen = null
    const release = () => {
      if (!el) return
      try { if (el.matches(":popover-open")) el.hidePopover() } catch {}
      el.removeAttribute("popover"); el.removeAttribute("data-vaultite-player"); el = null
    }
    const hold = () => {
      release()
      if (v && !size(v)) return // (mid-change, the site laying it out: held as it has a size again)
      // (the box first chosen, while it still holds the video: mid-change, the site's own sizes are a moment behind)
      el = !v ? best.el : chosen?.isConnected && chosen.contains(v) ? chosen : (chosen = holder())
      el.setAttribute("data-vaultite-player", ""); el.setAttribute("popover", "manual")
      try { el.showPopover() } catch { release() }
    }
    // (the site's own full screen draws it: out of the top layer meanwhile, and held again after)
    const full = () => { if (document.fullscreenElement) release(); else if (!el) hold() }
    // (a site moving its player in the page, as YouTube does by width, takes it out of the top layer: held again at once)
    const moved = new ResizeObserver(() => {
      if (document.fullscreenElement || !v.isConnected) return
      const r = v.getBoundingClientRect()
      if (r.width < innerWidth - 1 || r.height < innerHeight - 1) hold()
    })
    // (and whatever else undoes it, the site's video replaced: a second later)
    const check = setInterval(() => {
      if (document.fullscreenElement) return
      if (v && !v.isConnected) { const w = wake; wake = null; again(w) }
      else if (!el?.isConnected || !el.matches(":popover-open")) hold()
    }, 1000)
    // (its aspect told to the one waiting for the old video's)
    const again = (w, tries = 10) => {
      const a = fill()
      if (a !== null || !tries) w?.(a ?? undefined)
      else setTimeout(() => { if (!window.__vaultitePlayer) again(w, tries - 1) }, 500)
    }
    let wake = null
    const resized = () => { const w = wake; wake = null; w?.(aspect()) }
    v?.setAttribute("data-vaultite-player-video", "")
    v?.addEventListener("resize", resized)
    document.addEventListener("fullscreenchange", full)
    window.__vaultitePlayer = {
      next: () => new Promise((r) => { wake = r }),
      off: () => {
        clearInterval(check); moved.disconnect(); v?.removeEventListener("resize", resized); document.removeEventListener("fullscreenchange", full)
        release(); v?.removeAttribute("data-vaultite-player-video")
        delete window.__vaultitePlayer; const w = wake; wake = null; w?.(undefined)
      },
    }
    hold()
    if (v) moved.observe(v)
    return aspect() ?? (box.width / box.height)
  }
  return fill()
})()`
export const FILL_CSS = `[data-vaultite-player]:popover-open { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
  border: 0 !important; border-radius: 0 !important; overflow: hidden !important; transform: none !important; background: #000 !important }
[data-vaultite-player]:popover-open { color: inherit }
[data-vaultite-player]::backdrop { background: #000 }
html:has([data-vaultite-player]:popover-open) { scrollbar-width: none !important }
[data-vaultite-player]:popover-open [data-vaultite-player-video], video[data-vaultite-player]:popover-open { position: fixed !important; inset: 0 !important;
  width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important;
  object-fit: contain !important }`
// (the page's world: a popover can't go full screen, so the site's own full screen of the video's player takes it out of
// the popover first (held again as it leaves); a refused one puts it back at once)
export const FULL_GUARD = `(() => {
  for (const name of ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"]) {
    const own = Element.prototype[name]
    if (!own || own.vaultite) continue
    const guarded = function (...a) {
      const ours = this.hasAttribute?.("data-vaultite-player") && this.matches(":popover-open")
      if (ours) { this.hidePopover(); this.removeAttribute("popover") }
      const r = own.apply(this, a)
      if (ours) r?.catch?.(() => { if (!document.fullscreenElement && this.hasAttribute("data-vaultite-player")) { this.setAttribute("popover", "manual"); this.showPopover() } })
      return r
    }
    guarded.vaultite = true
    Element.prototype[name] = guarded
  }
})()`
export const UNFILL = `(() => { window.__vaultitePlayer?.off(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}) })()`
export const PIP = `(() => {
  if (document.pictureInPictureElement) return void document.exitPictureInPicture().catch(() => {})
  ${MAIN_VIDEO}
  const v = videos.filter((c) => c.n > 0).sort((a, b) => b.n - a.n)[0]?.el
  if (!v) return "none"
  return v.requestPictureInPicture().then(() => true, () => false)
})()`

const PLAYER_TITLE = "Vaultite player"
const MAC = process.platform === "darwin"
/** The top strip (points) where the controls show and the window drags. */
const STRIP = 40
const LIGHTS = { x: 14, y: 13 }
const PRELOAD = fileURLToPath(new URL("./player-bar.cjs", import.meta.url))
// (a shade for the controls to read on; Windows' and Linux's buttons on its right, as their title bars have them)
const BUTTONS = MAC ? "" : `<div class="b" data-do="minimize"><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></div>
<div class="b" data-do="maximize"><svg viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9"/></svg></div>
<div class="b x" data-do="close"><svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg></div>`
const BAR = `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; user-select: none; cursor: default }
body { display: flex; justify-content: flex-end; -webkit-app-region: drag; background: linear-gradient(rgb(0 0 0 / .55), rgb(0 0 0 / 0)) }
.b { -webkit-app-region: no-drag; width: 46px; display: grid; place-items: center; color: #fff }
.b:hover { background: rgb(255 255 255 / .14) } .x:hover { background: #c42b1c }
svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1 }
</style><body>${BUTTONS}</body>`

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

const players = new WeakMap<BaseWindow, { reveal: (on: boolean) => void; bar: WebContentsView }>()

/** A player window at `bounds` (its content), hidden till shown. */
export function playerWindow(bounds: Rectangle): BaseWindow {
  const w = new BaseWindow({ title: PLAYER_TITLE, ...bounds, useContentSize: true, minWidth: 320, minHeight: 180, backgroundColor: "#000000", show: false,
    ...(MAC ? { titleBarStyle: "hidden", trafficLightPosition: LIGHTS } : { frame: false, autoHideMenuBar: true }) })
  quiet(w)
  const bar = new WebContentsView({ webPreferences: { partition: "vaultite-player-bar", sandbox: true, contextIsolation: true, spellcheck: false, ...(MAC ? {} : { preload: PRELOAD }) } })
  bar.setBackgroundColor("#00000000")
  bar.setVisible(false)
  void bar.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BAR)}`)
  bar.webContents.ipc.on("player:bar", (_e, what) => {
    if (what === "minimize") w.minimize()
    else if (what === "maximize") { if (w.isMaximized()) w.unmaximize(); else w.maximize() }
    else if (what === "close") w.close()
  })
  w.contentView.addChildView(bar)

  // Shown while the pointer is in the strip (the page tells it's there: `pointerAt`), hidden once it's left it.
  let shown = false, timer: ReturnType<typeof setInterval> | null = null
  const lights = () => { if (MAC && !w.isDestroyed()) { w.setWindowButtonPosition(LIGHTS); w.setWindowButtonVisibility(shown || w.isFullScreen()) } }
  const reveal = (on: boolean) => {
    if (w.isDestroyed() || (on && w.isFullScreen()) || on === shown) return
    shown = on
    bar.setVisible(on)
    lights()
    if (timer) { clearInterval(timer); timer = null }
    if (on) timer = setInterval(() => { if (!inStrip()) reveal(false) }, 120)
  }
  const inStrip = () => {
    if (w.isDestroyed() || !w.isVisible()) return false
    const c = screen.getCursorScreenPoint(), b = w.getContentBounds()
    return c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + STRIP
  }
  lights()
  const lay = () => { const [width] = w.getContentSize(); bar.setBounds({ x: 0, y: 0, width, height: STRIP }) }
  lay()
  w.contentView.on("bounds-changed", lay)
  // (full screen has the system's own top: the Mac's lights come with its menu bar)
  w.on("enter-full-screen", () => { reveal(false); lights() })
  w.on("leave-full-screen", lights)
  // (the Mac lays its title bar out again on these, its lights put back)
  if (MAC) for (const e of ["focus", "blur", "show", "restore", "resized"] as const) w.on(e as "focus", lights)

  // Its last normal place, kept as it closes.
  let place: Rectangle | null = null
  const note = () => { if (!w.isDestroyed() && w.isVisible() && !w.isFullScreen() && !w.isMaximized() && !w.isMinimized()) place = w.getContentBounds() }
  w.on("resize", note)
  w.on("move", note)
  w.on("close", () => {
    if (timer) clearInterval(timer)
    if (place) { try { writeAtomic(keptFile(), JSON.stringify(place)) } catch { /* this run's only */ } }
    if (!bar.webContents.isDestroyed()) bar.webContents.close()
  })
  players.set(w, { reveal, bar })
  return w
}

/** The pointer moved over player `w`'s page, `y` points from its top: in its top strip, its controls show till it leaves. */
export const pointerAt = (w: BaseWindow, y: number) => { if (y <= STRIP) players.get(w)?.reveal(true) }
/** Player `w`'s controls over the page just added to it. */
export function overPage(w: BaseWindow) {
  const bar = players.get(w)?.bar
  if (bar && !w.isDestroyed()) w.contentView.addChildView(bar)
}

/** Lock player `w` to `aspect` (null: none), its content resized to it, keeping its width (and within its screen). */
export function setAspect(w: BaseWindow, aspect: number | null) {
  if (w.isDestroyed()) return
  w.setAspectRatio(aspect ?? 0)
  if (!aspect || w.isFullScreen() || w.isMaximized()) return
  const b = w.getContentBounds(), area = screen.getDisplayMatching(b).workArea
  let width = b.width, height = Math.round(width / aspect)
  if (height > area.height) { height = area.height; width = Math.round(height * aspect) }
  if (Math.abs(height - b.height) > 1 || width !== b.width) w.setContentBounds({ x: b.x, y: Math.max(area.y, Math.min(b.y, area.y + area.height - height)), width, height })
}
