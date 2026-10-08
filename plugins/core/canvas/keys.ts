// The keyboard's way around a board: the commands Pan and Zoom (index.tsx) act on the board that has the keyboard,
// which each Board registers here (its view stays in its ref: nothing is drawn by React for a pan or a zoom).
export type BoardKeys = {
  box: HTMLElement | null
  /** Move what's shown by dx, dy screen pixels (right and down are positive). */
  pan: (dx: number, dy: number) => void
  zoom: (factor: number) => void
  fit: () => void
  /** Cards or a connection are selected (the arrow keys nudge them instead). */
  selected: () => boolean
}
const boards = new Set<() => BoardKeys>()
export function registerBoard(get: () => BoardKeys) {
  boards.add(get)
  return () => { boards.delete(get) }
}
/** The board with the keyboard (focused, not typing in a card), or null. */
export function focusedBoard(): BoardKeys | null {
  const a = document.activeElement
  if (!a) return null
  for (const get of boards) { const b = get(); if (b.box && b.box.contains(a)) return b }
  return null
}
/** How far one press pans: a fifth of the board's height, at least 60px. */
export const panStep = (b: BoardKeys) => Math.max(60, Math.round((b.box?.clientHeight ?? 400) / 5))
