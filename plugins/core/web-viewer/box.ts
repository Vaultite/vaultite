export type Cover = "app" | "through" | null
export type Change = "hits" | "floats" | null

export type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number }
export const boxAt = (left: number, top: number, width: number, height: number): Box =>
  ({ left, top, width, height, right: left + width, bottom: top + height })
export const sameBox = (a: Box | null, b: Box | null) =>
  (a && b ? a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height : a === b)
export function overlap(a: Box, b: Box) {
  const l = Math.max(a.left, b.left), r = Math.min(a.right, b.right), t = Math.max(a.top, b.top), btm = Math.min(a.bottom, b.bottom)
  return l < r && t < btm ? boxAt(l, t, r - l, btm - t) : null
}
