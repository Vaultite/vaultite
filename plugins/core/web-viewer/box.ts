/** What covers a page: something that takes every click over it ("app": a menu, a dialog, a drag), only what lets the
 *  rest through ("through": a toast, the mini player, a sidebar peeking over it), or nothing (null). */
export type Cover = "app" | "through" | null
/** What a change may change of what covers a page: "hits", only its floats (in a toast or tooltip), or nothing (in the
 *  box, the status bar, or another pane, whose scroller clips it, but for a fixed element added there). */
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
