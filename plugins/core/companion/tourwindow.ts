import { interfaceZoom } from "./locate.ts"
import { checkDom, domThings, domView } from "./uidom.ts"
import type { Condition, Rect } from "../../../core/desktop/uimodel.ts"

function toScreen() {
  const z = interfaceZoom(), top = window.screenY + Math.max(0, window.outerHeight - window.innerHeight * z)
  const frame: Rect = { x: window.screenX, y: Math.round(top), width: Math.round(window.innerWidth * z), height: Math.round(window.innerHeight * z) }
  return { frame, at: (r: Rect): Rect => ({ x: Math.round(window.screenX + r.x * z), y: Math.round(top + r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) }) }
}

export function windowThings() {
  const s = toScreen()
  const within = (r: Rect) => document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest<HTMLElement>("[data-ui]")?.dataset.ui
  return { window: s.frame, things: domThings().map((t) => { const w = t.ui ? undefined : within(t.frame); return { ...t, frame: s.at(t.frame), ...(w ? { within: w } : {}) } }) }
}

export const windowCheck = (c: Condition, before?: string) => checkDom(c, before)
export const windowSnapshot = () => domView().snapshot()
