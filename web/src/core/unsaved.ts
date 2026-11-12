const editors = new Map<() => boolean, () => string>()
export function trackUnsaved(dirty: () => boolean, path: () => string = () => "") {
  editors.set(dirty, path)
  return () => { editors.delete(dirty) }
}
const isDirty = (f: () => boolean) => { try { return f() } catch { return true } }
const hasUnsavedEdits = () => [...editors.keys()].some(isDirty)

const going = new Set<() => boolean>()
/** Something under way in the page that it going away would cut (a recording, dictation): `on` says while it is. */
export function trackUnderway(on: () => boolean) {
  going.add(on)
  return () => { going.delete(on) }
}
const playing = () => [...document.querySelectorAll<HTMLMediaElement>("audio, video")].some((m) => !m.paused && !m.ended && !m.muted)
const underway = () => [...going].some(isDirty) || playing()
export const unsavedIn = (path: string) => [...editors].some(([f, p]) => p() === path && isDirty(f))

let lastKey = 0, lastInput = 0
if (typeof addEventListener === "function") {
  const key = () => { lastKey = lastInput = Date.now() }
  for (const e of ["keydown", "input", "compositionupdate"]) addEventListener(e, key, { capture: true, passive: true })
  for (const e of ["pointerdown", "wheel"]) addEventListener(e, () => { lastInput = Date.now() }, { capture: true, passive: true })
}
const hidden = () => document.visibilityState === "hidden"

export const safeToReload = () => !hasUnsavedEdits() && !underway() && (hidden() || Date.now() - lastKey >= 30_000)
export const safeToRestart = () => !hasUnsavedEdits() && !underway() && (hidden() || Date.now() - lastInput >= 10 * 60_000)

const soon = new Map<() => boolean, [string, boolean]>()
/** What the page will do by itself in a moment (a hint's delay; `save`: a debounced save): QA waits while `on()`. */
export function trackSoon(what: string, on: () => boolean, save = false) {
  soon.set(on, [what, save])
  return () => { soon.delete(on) }
}

declare global { var vaultiteBusy: (o?: { saves?: boolean }) => string[] }
globalThis.vaultiteBusy = ({ saves = false } = {}) => [hasUnsavedEdits() && "unsaved edits", [...going].some(isDirty) && "under way",
  ...[...soon].flatMap(([on, [what, save]]) => ((saves || !save) && isDirty(on) ? [what] : []))].filter((x): x is string => !!x)
