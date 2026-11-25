export type Size = { w: number; h: number }
export type Pt = { x: number; y: number }
export type View = { k: number; x: number; y: number }

const MOST = 8, STEP = 1.25

export function fitScale(content: Size, box: Size, pad = 0, grows = false) {
  const room = (across: number) => Math.max(1, across - 2 * pad)
  const k = Math.min(room(box.w) / content.w, room(box.h) / content.h)
  return grows ? k : Math.min(1, k)
}
export const mostScale = (fit: number) => Math.max(MOST, fit * MOST)

export function held(v: View, content: Size, box: Size, pad = 0): View {
  const along = (at: number, size: number, room: number) => (size <= room - 2 * pad ? (room - size) / 2 : Math.min(pad, Math.max(room - size - pad, at)))
  return { k: v.k, x: along(v.x, content.w * v.k, box.w), y: along(v.y, content.h * v.k, box.h) }
}

export const zoomedAbout = (v: View, k: number, at: Pt): View => ({ k, x: at.x - ((at.x - v.x) / v.k) * k, y: at.y - ((at.y - v.y) / v.k) * k })

export const closerScale = (fit: number, sharp = 1) => (fit < 0.7 * sharp ? sharp : fit * 2)

export function steppedScale(k: number, dir: 1 | -1) {
  const next = dir > 0 ? k * STEP : k / STEP
  return (k < 0.999 && next > 1) || (k > 1.001 && next < 1) ? 1 : next
}

export const wheelScale = (px: number) => Math.exp(-px * (Math.abs(px) >= 50 ? 0.002 : 0.01))

export function wheelPx(e: WheelEvent, page: number): Pt {
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1
  const turned = e.shiftKey && !e.deltaX
  return { x: (turned ? e.deltaY : e.deltaX) * unit, y: (turned ? 0 : e.deltaY) * unit }
}
