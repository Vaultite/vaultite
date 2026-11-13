export type BoardKeys = {
  box: HTMLElement | null
  pan: (dx: number, dy: number) => void
  zoom: (factor: number) => void
  fit: () => void
  fitSelection: () => void
  zoom100: () => void
  selected: () => boolean
}
const boards = new Set<() => BoardKeys>()
export function registerBoard(get: () => BoardKeys) {
  boards.add(get)
  return () => { boards.delete(get) }
}
export function focusedBoard(): BoardKeys | null {
  const a = document.activeElement
  if (!a) return null
  for (const get of boards) { const b = get(); if (b.box && b.box.contains(a)) return b }
  return null
}
export const panStep = (b: BoardKeys) => Math.max(60, Math.round((b.box?.clientHeight ?? 400) / 5))
export const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest("textarea, input, [contenteditable=''], [contenteditable='true'], .cm-editor")
