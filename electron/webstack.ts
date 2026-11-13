import { screen, type View, WebContentsView } from "electron"
import { AppWindow } from "./appwindow.ts"
import { cdp } from "./browser/cdp.ts"
import { QUIET } from "./quiet.ts"
import { NO_POINTER, type Passed, type Pointer, type PointerEvent, pointerStep, type Raise, type Role, stackOrder } from "./stack.ts"
import { MAC, type Page, pages } from "./webbase.ts"

// ---------- the window's page over its pages: stack.ts decides ----------

const pointers = new WeakMap<AppWindow, Pointer>()
const pointerOf = (win: AppWindow) => pointers.get(win) ?? NO_POINTER

const pageViews = new WeakSet<WebContentsView>()

export function addPage(win: AppWindow, view: WebContentsView) {
  pageViews.add(view)
  restack(win, view)
}

export function restack(win: AppWindow, top?: WebContentsView) {
  if (win.isDestroyed()) return
  const full = new Set<WebContentsView>()
  for (const p of pages.values()) if (p.win === win && p.full && !p.player) full.add(p.view)
  const roleOf = (v: View): Role => v === win.view ? "window" : v instanceof WebContentsView && pageViews.has(v) ? (full.has(v) ? "full" : "page") : "chrome"
  const want = stackOrder(win.contentView.children, roleOf, pointerOf(win).raise, top)
  for (const [i, v] of want.entries()) if (win.contentView.children[i] !== v) win.contentView.addChildView(v, i)
}

export const raise = (win: AppWindow, how: Raise) => { if (!win.isDestroyed()) run(win, { type: "raise", how }) }

export const pointer = (p: Page, e: Passed) => run(p.win, { type: "pass", page: p.id, kind: e.kind, button: e.button }, p, e)

export function run(win: AppWindow, e: PointerEvent, p?: Page, m?: Passed) {
  const r = pointerStep(pointerOf(win), e)
  pointers.set(win, r.to)
  for (const x of r.do) {
    if (x.do === "restack") restack(win)
    else if (x.do === "pinch") { if (MAC && !win.isDestroyed()) void import("./gestures.ts").then((g) => g.passPinch(win, x.on)) }
    else if (x.do === "hover") hover(win)
    else if (p && m) send(p, m, x.do === "send" ? x.buttons : null)
  }
}

/** The pointer resting over a page as the window goes over it (fingers leaving the trackpad) is told to the window's
 *  page, which then says what's under it. A quiet copy's pointer isn't the user's (quiet.ts). */
function hover(win: AppWindow) {
  if (!MAC || QUIET) return
  const at = screen.getCursorScreenPoint(), b = win.getContentBounds()
  if (at.x >= b.x && at.y >= b.y && at.x < b.x + b.width && at.y < b.y + b.height) win.webContents.sendInputEvent({ type: "mouseMove", x: at.x - b.x, y: at.y - b.y })
}

const CDP_TYPE = { mouseMove: "mouseMoved", mouseDown: "mousePressed", mouseUp: "mouseReleased", mouseWheel: "mouseWheel" } as const
const KEY_BITS = { alt: 1, control: 2, meta: 4, shift: 8 }

function send(p: Page, m: Passed, buttons: number | null) {
  const wc = p.view.webContents, z = p.win.webContents.getZoomFactor()
  const x = Math.round(m.x * z), y = Math.round(m.y * z)
  // (the click landed on the window's view, which macOS gave the keyboard: a press in the page takes it, as a real one does)
  if (m.kind === "mouseDown" && !wc.isFocused()) wc.focus()
  const direct = () => {
    if (m.kind === "mouseWheel") wc.sendInputEvent({ type: "mouseWheel", x, y, deltaX: -m.dx, deltaY: -m.dy, canScroll: true, modifiers: m.keys })
    else wc.sendInputEvent({ type: m.kind, x, y, button: m.button, clickCount: m.clickCount, modifiers: m.keys })
  }
  if (buttons === null || m.kind === "mouseLeave") return direct()
  // Over the DevTools protocol, which finds the frame under the pointer as the Mac's input does: sendInputEvent never
  // reaches a frame from another site (a captcha, "Sign in with Google").
  const type = CDP_TYPE[m.kind], pz = wc.getZoomFactor() || 1, modifiers = m.keys.reduce((n, k) => n | KEY_BITS[k], 0)
  const at = { x: Math.round(m.x * z / pz), y: Math.round(m.y * z / pz) }
  const params = type === "mouseWheel" ? { type, ...at, modifiers, deltaX: m.dx * z / pz, deltaY: m.dy * z / pz }
    : type === "mouseMoved" ? { type, ...at, modifiers, button: buttons ? (buttons & 1 ? "left" : buttons & 2 ? "right" : "middle") : "none", buttons }
    : { type, ...at, modifiers, button: m.button, buttons, clickCount: m.clickCount }
  void cdp(wc, "Input.dispatchMouseEvent", params).catch(direct)
}
