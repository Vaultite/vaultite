// Whether an overlay window takes the pointer (overlaywin.ts `takesPointer`): pure, so it's tested without Electron.

/** A box in a window's points, from its corner. */
export type Box = { x: number; y: number; width: number; height: number }

/** Window `win` (screen points) takes the pointer at `at` (screen points): it's over one of `boxes`, or a press begun on
 *  one goes on (`pressing`) while it's over the window. */
export function holding(win: Box, boxes: Box[], at: { x: number; y: number }, pressing = false) {
  const x = at.x - win.x, y = at.y - win.y
  if (x < 0 || y < 0 || x >= win.width || y >= win.height) return false
  return pressing || boxes.some((b) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height)
}
