// The menu-bar helper moved onto a new code root in place (the store's plan: `helper: reload`), as a module graph of its
// own started once the old one stopped. ESM never unloads: the old graph stays in memory, with nothing live.
import path from "node:path"
import { pathToFileURL } from "node:url"
import { leaseIn, storeRootOf } from "../core/update/lease.ts"
import type { HelperHost } from "./helper.ts"
import { CODE } from "./identity.ts"
import { messageOf } from "./browser/messageof.ts"

type Helper = typeof import("./helper.ts")
const ROOT = path.dirname(import.meta.dirname)
/** How often a reload waiting on a busy helper looks again. */
const AGAIN_MS = 5_000

export type HelperSlot = {
  /** The commit the running helper's code is from (null: none runs). */
  commit(): string | null
  /** Onto `root` (commit `commit`) once the helper isn't busy; a newer ask while it waits replaces it. */
  reload(root: string, commit: string): void
}

/** The helper main.ts loaded (`now`, swapped by `set`), started with `host`. */
export function helperSlot(o: { now: () => Helper | null; set: (h: Helper) => void; host: HelperHost; log: (line: string) => void }): HelperSlot {
  let at = { root: ROOT, commit: CODE?.commit ?? null }, release: (() => void) | null = null
  let target: { root: string; commit: string } | null = null, waiting: Promise<void> | null = null
  const short = (c: string | null) => c?.slice(0, 7) ?? "its own code"

  async function swap(old: Helper, t: { root: string; commit: string }) {
    let next: Helper
    try { next = await import(pathToFileURL(path.join(t.root, "electron", "helper.ts")).href) as Helper } catch (e) {
      return o.log(`helper: ${short(t.commit)} didn't load (${messageOf(e)}): it stays on ${short(at.commit)}`)
    }
    old.stopHelper()
    let started = false
    try { started = await next.startHelper(o.host) } catch (e) { o.log(`helper: ${short(t.commit)} didn't start: ${messageOf(e)}`) }
    if (!started) {
      try { next.stopHelper() } catch { /* half started */ }
      await old.startHelper(o.host).catch((e) => o.log(`helper: ${short(at.commit)} didn't start again: ${messageOf(e)}`))
      return o.log(`helper: stays on ${short(at.commit)} (${short(t.commit)} didn't take its lock or start)`)
    }
    o.set(next)
    release?.()
    release = null
    // (a root of the store is held while the helper runs from it; the main process's own root is held already)
    const s = storeRootOf(t.root)
    if (s && path.resolve(t.root) !== ROOT) release = await leaseIn(s.store, s.sha, { pid: process.pid, what: "helper" }).catch(() => null)
    o.log(`helper: reloaded from ${short(at.commit)} onto ${short(t.commit)}`)
    at = { root: t.root, commit: t.commit }
  }
  async function run() {
    let said = ""
    for (let old = o.now(); old && target; old = o.now()) {
      const busy = old.helperBusy()
      if (busy) {
        if (busy !== said) { said = busy; o.log(`helper: reloads once idle (${busy})`) }
        await new Promise((r) => setTimeout(r, AGAIN_MS))
        continue
      }
      const t = target
      target = null
      if (t.commit !== at.commit) await swap(old, t)
    }
  }
  const slot: HelperSlot = {
    commit: () => (o.now()?.helperOn() ? at.commit : null),
    reload(root, commit) {
      target = { root, commit }
      waiting ??= run().catch((e) => o.log(`helper: the reload failed: ${messageOf(e)}`)).finally(() => { waiting = null })
    },
  }
  // (web/qa/helperreload.mjs: a reload onto a copy of the code, and what the process holds after it)
  if (process.env.VAULTITE_QUIET) Object.assign(globalThis, { vaultiteHelperSlot: { ...slot, done: () => waiting ?? Promise.resolve(),
    stop: () => o.now()?.stopHelper(), start: () => o.now()?.startHelper(o.host), busy: () => o.now()?.helperBusy() ?? null } })
  return slot
}
