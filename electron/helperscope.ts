import { logger } from "../core/log.ts"

const log = logger("helper")

// What the menu-bar helper's code holds of the process beyond its own windows (listeners on Electron's emitters, set
// once by a module), freed as one by stopHelper: a reload onto another code root leaves the old copy nothing live.
type Fn = (...a: any[]) => void
type Emitter = { on(ev: string, fn: Fn): unknown; removeListener(ev: string, fn: Fn): unknown }

const undo = new Set<() => void>()

/** `fn` on `em`'s `ev` until the helper stops (or the answer is called). */
export function listen(em: Emitter, ev: string, fn: Fn) {
  em.on(ev, fn)
  const off = () => { undo.delete(off); em.removeListener(ev, fn) }
  undo.add(off)
  return off
}
/** `fn` once when the helper stops: a module's own "set up already" flag reset, a hook given back. */
export function onFree(fn: () => void) { undo.add(fn) }
/** Everything listened to and kept since the last free, given back. */
export function freeAll() {
  const all = [...undo]
  undo.clear()
  for (const f of all) try { f() } catch (e) { log.error("the helper didn't free one of its hooks", e) }
}
