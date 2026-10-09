// Whether the page may go away now (a reload into a new build, a restart to update): nothing unsaved, and the user
// isn't at work in it. No imports: errors.ts asks before the app loads.

const editors = new Set<() => boolean>()
/** An editor's unsaved state while it's drawn (autosave: typed and not yet saved, a save failed or in conflict). */
export function trackUnsaved(dirty: () => boolean) {
  editors.add(dirty)
  return () => { editors.delete(dirty) }
}
export const hasUnsavedEdits = () => [...editors].some((f) => { try { return f() } catch { return true } })

// (0: none yet, so a page that failed as it started may reload at once)
let lastKey = 0, lastInput = 0
if (typeof addEventListener === "function") {
  const key = () => { lastKey = lastInput = Date.now() }
  for (const e of ["keydown", "input", "compositionupdate"]) addEventListener(e, key, { capture: true, passive: true })
  for (const e of ["pointerdown", "wheel"]) addEventListener(e, () => { lastInput = Date.now() }, { capture: true, passive: true })
}
const hidden = () => document.visibilityState === "hidden"

/** A reload loses nothing: nothing unsaved, and no typing in the last 30 s (or the page hidden). */
export const safeToReload = () => !hasUnsavedEdits() && (hidden() || Date.now() - lastKey >= 30_000)
/** The app may restart by itself: nothing unsaved, and the page hidden or untouched for 10 minutes. */
export const safeToRestart = () => !hasUnsavedEdits() && (hidden() || Date.now() - lastInput >= 10 * 60_000)
