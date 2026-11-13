import { check, section } from "../lib.ts"
import { type Any, web } from "./lib.ts"

await section("safe to reload", async () => {
  // (a page that's hidden: only what a reload would lose or cut holds it)
  let media: Any[] = []
  const g = globalThis as Any
  g.document = { visibilityState: "hidden", querySelectorAll: () => media }
  const u: Any = await web("core/unsaved.ts")
  check("unsaved: nothing held, a hidden page may reload", u.safeToReload() && u.safeToRestart())
  let dirty = true
  const untrack = u.trackUnsaved(() => dirty)
  check("unsaved: edits not saved yet hold it", !u.safeToReload() && !u.safeToRestart())
  dirty = false
  check("unsaved: saved, they don't", u.safeToReload())
  untrack()
  let on = true
  const done = u.trackUnderway(() => on)
  check("unsaved: something under way (a recording, dictation) holds it", !u.safeToReload() && !u.safeToRestart())
  on = false
  check("unsaved: over, it doesn't", u.safeToReload())
  done()
  media = [{ paused: false, ended: false, muted: false }]
  check("unsaved: sound playing holds it", !u.safeToReload())
  media = [{ paused: false, ended: false, muted: true }, { paused: true, ended: false, muted: false }]
  check("unsaved: muted or paused doesn't", u.safeToReload())
  let due = true, saving = true
  const offSoon = u.trackSoon("a hint's delay", () => due), offSave = u.trackSave("a place's save", () => saving)
  check("busy: what's due soon holds it for QA, not a reload", u.safeToReload() && g.vaultiteBusy().join() === "a hint's delay")
  check("busy: a debounced save only when saves are asked for", g.vaultiteBusy({ saves: true }).join() === "a hint's delay,a place's save")
  due = saving = false
  check("busy: done, neither", g.vaultiteBusy({ saves: true }).length === 0)
  due = saving = true
  offSoon(); offSave()
  check("busy: untracked, neither", g.vaultiteBusy({ saves: true }).length === 0)
  delete g.document
})
