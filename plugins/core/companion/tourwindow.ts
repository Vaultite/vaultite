// A tour's look at Vaultite's own window (tours.ts plays it on the server): its things in screen points, where the
// window is, a ui model check and what shows now, each asked over the companion's socket.
import { interfaceZoom } from "./locate.ts"
import { checkDom, domThings, domView } from "./uidom.ts"
import type { Condition, Rect } from "./uimodel.ts"

/** The window's frame on screen, and a CSS px of it as screen points. */
function toScreen() {
  const z = interfaceZoom(), top = window.screenY + Math.max(0, window.outerHeight - window.innerHeight * z)
  const frame: Rect = { x: window.screenX, y: Math.round(top), width: Math.round(window.innerWidth * z), height: Math.round(window.innerHeight * z) }
  return { frame, at: (r: Rect): Rect => ({ x: Math.round(window.screenX + r.x * z), y: Math.round(top + r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }) }
}

/** Every named thing shown, in screen points; `within`: the nearest data-ui around one that has none of its own (where
 *  the companion's cursor can point at its words). */
export function windowThings() {
  const s = toScreen()
  // (domThings keeps no element: the data-ui around one is found again at its middle)
  const within = (r: Rect) => document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest<HTMLElement>("[data-ui]")?.dataset.ui
  return { window: s.frame, things: domThings().map((t) => { const w = t.ui ? undefined : within(t.frame); return { ...t, frame: s.at(t.frame), ...(w ? { within: w } : {}) } }) }
}

export const windowCheck = (c: Condition, before?: string) => checkDom(c, before)
export const windowSnapshot = () => domView().snapshot()
