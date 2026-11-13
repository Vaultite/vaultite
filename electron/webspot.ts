import { AppWindow } from "./appwindow.ts"
import { pageHeld } from "./browser/engine.ts"
import { shown, type Spot, type SpotEffect, type SpotEvent, spotStep } from "./pagespot.ts"
import type { WebRect } from "./webwire.ts"
import type { Page } from "./webbase.ts"
import { addPage } from "./webstack.ts"

/** Off the window but shown: a hidden view stops drawing at its next cross-site load. */
const PARKED = { x: -40000, y: 0, width: 1280, height: 800 }
/** Its spot now (read again after a `move`, which narrowing doesn't see). */
const spotOf = (p: Page): Spot => p.spot
export function move(p: Page, e: SpotEvent) {
  if (e.type !== "hide" && p.view.webContents.isDestroyed()) return
  const r = spotStep(p.spot, e)
  p.spot = r.to
  for (const d of r.do) SPOT_DOES[d](p)
}
const SPOT_DOES: Record<SpotEffect, (p: Page) => void> = {
  "show": (p) => p.view.setVisible(true),
  "hide": (p) => p.view.setVisible(false),
  "throttle": (p) => p.view.webContents.setBackgroundThrottling(true),
  "unthrottle": (p) => p.view.webContents.setBackgroundThrottling(false),
  "to-parked": (p) => p.view.setBounds(PARKED),
  "to-fill": (p) => {
    const [width, height] = (p.player ?? p.win).getContentSize()
    round(p, 0)
    p.view.setBounds({ x: 0, y: 0, width, height })
  },
  "to-tab": (p) => {
    if (!p.want) return
    if (keyboardFrom.get(p.win) === p.id) keyboardFrom.delete(p.win)
    // (the window's page may be zoomed, ⌘+: its CSS pixels are that many of the window's)
    const z = p.win.webContents.getZoomFactor(), rect = p.want
    round(p, Math.round((rect.radius ?? 0) * z))
    p.view.setBounds({ x: Math.round(rect.x * z), y: Math.round(rect.y * z), width: Math.round(rect.width * z), height: Math.round(rect.height * z) })
  },
  "raise": (p) => addPage(p.win, p.view),
  "unfocus": (p) => { if (p.view.webContents.isFocused() && !p.win.isDestroyed()) p.win.webContents.focus() },
  "keys-out": (p) => {
    p.hadFocus = p.view.webContents.isFocused()
    if (p.hadFocus) { p.win.webContents.focus(); keyboardFrom.set(p.win, p.id) }
  },
  "see": (p) => void seeDraws(p),
}
export async function wake(p: Page) {
  if (p.spot.at === "resting") move(p, { type: "park", now: Date.now() })
  const left = (p.spot.at === "parked" ? p.spot.woke : 0) + 100 - Date.now()
  if (left > 0) await new Promise<void>((done) => setTimeout(done, left))
  if (p.spot.at === "parked" && Date.now() - (p.drew ?? 0) > SEEN_MS) await seeDraws(p)
}
const askPage = (p: Page, code: string, ms: number) => Promise.race([new Promise<null>((done) => setTimeout(done, ms, null)),
  p.view.webContents.executeJavaScriptInIsolatedWorld(1018, [{ code }]).catch(() => null)])
const frameIn = async (p: Page, ms: number) => (await askPage(p, "new Promise((done) => requestAnimationFrame(() => done(true)))", ms)) === true
const SEEN_MS = 5000
export const seeDraws = (p: Page) => (p.seeing ??= drawing(p).finally(() => { p.seeing = undefined }))
/** An unthrottled page that stopped drawing for good (Electron on a Mac keeps its widget shown, not its compositor) takes
 *  no press: it's hidden and throttled, then, once its page is hidden, shown unthrottled again, which shows both. */
async function drawing(p: Page) {
  const wc = p.view.webContents
  if (wc.isDestroyed()) return
  if (await frameIn(p, 300)) { p.drew = Date.now(); return }
  if (!p.drawn || p.player || p.spot.at === "resting" || p.spot.at === "hidden" || !p.view.getVisible() || wc.isDestroyed()) return
  const parked = p.spot.at === "parked"
  if (parked) move(p, { type: "rest" })
  else { p.view.setVisible(false); wc.setBackgroundThrottling(true) }
  for (const until = Date.now() + 1000; Date.now() < until;) {
    if (await askPage(p, "document.visibilityState", 200) === "hidden") break
    await new Promise((done) => setTimeout(done, 30))
  }
  if (wc.isDestroyed()) return
  if (parked && spotOf(p).at === "resting") move(p, { type: "park", now: Date.now() })
  else if (!parked && shown(p.spot) && !p.view.getVisible() && !p.player) { wc.setBackgroundThrottling(false); p.view.setVisible(true) }
  await frameIn(p, 1000)
  p.drew = Date.now()
}
export const stow = (p: Page) => move(p, { type: "stow", drawn: !!p.drawn, now: Date.now() })

export const keyboardFrom = new WeakMap<AppWindow, number>()

export function place(p: Page, rect: WebRect | null) {
  p.want = rect && rect.width >= 2 && rect.height >= 2 ? rect : null
  fit(p)
}

export function fit(p: Page) {
  const fill = p.player ?? (p.full ? p.win : null)
  if (fill?.isDestroyed()) return
  const held = pageHeld(p.id)
  if (held) p.drawn = true
  move(p, { type: "fit", fill: !!fill, rect: !p.agent && !held && !!p.want, drawn: !!p.drawn, now: Date.now() })
}
const round = (p: Page, r: number) => { if ((p.radius ?? 0) !== r) { p.radius = r; p.view.setBorderRadius(r) } }
