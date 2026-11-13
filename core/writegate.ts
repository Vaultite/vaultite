import { AsyncLocalStorage } from "node:async_hooks"
import path from "node:path"
import { type Logger, logger } from "./log.ts"

/** The plugin acting on its own now; null or unset: the user (whoever made the request being answered). */
const acting = new AsyncLocalStorage<string | null>()

/** fn as the plugin `id` acting on its own: what it writes outside .vaultite/ needs a grant. Timers made inside keep it. */
export const onItsOwn = <T>(id: string, fn: () => T): T => acting.run(id, fn)
/** fn as the user's own action (a request): never gated. */
export const byUser = <T>(fn: () => T): T => acting.run(null, fn)
const actor = () => acting.getStore() ?? null

/** Set while answering Vaultite Connect with owner tools off (plugins/core/mcp/connect.ts). */
const connect = new AsyncLocalStorage<boolean>()
export const overConnect = <T>(fn: () => T): T => connect.run(true, fn)
/** What turns plugins on or steers this Mac's agents: only this Mac changes it (APFS ignores case). */
const MACHINE_ONLY = /^\.vaultite(\/(plugins|plugins-lock|grants)\.json|\/agents\.md)?$/i

/** A write the gate refused: a 403 for the API. */
export class WriteRefused extends Error {
  status = 403
  plugin: string
  path: string
  constructor(plugin: string, rel: string, why = `${plugin} may not write ${rel} on its own: allow it in its settings (Writes on its own)`) {
    super(why)
    this.plugin = plugin
    this.path = rel
  }
}

/** A file iCloud hasn't brought down yet (errno 11, EDEADLK), or a failure it caused: there at a later try. */
export const notHereYet = (e: unknown): boolean =>
  !!e && (Math.abs((e as NodeJS.ErrnoException).errno ?? 0) === 11 || notHereYet((e as Error).cause))

export function logFailure(log: Logger, what: string, e: unknown) {
  if (e instanceof WriteRefused || notHereYet(e)) log.warn(`${what}: ${(e as Error).message}`)
  else log.error(what, e)
}

/** Run plugin `id`'s hook on its own: what it throws, now or later (a promise), is logged as `<id>: <what>:`. */
export function runHook(id: string, what: string, fn: () => unknown) {
  try {
    const out = onItsOwn(id, fn)
    if (out instanceof Promise) out.catch((e) => logFailure(logger(id), what, e))
  } catch (e) { logFailure(logger(id), what, e) }
}

/** A vault's side of the gate (Vault sets it up): may `plugin` write `rel`, what to do when it may not, and what to
 *  tell once a text file is written (`watch`: null when no one listens). */
export type Gate = { may: (plugin: string, rel: string) => boolean; refused: (plugin: string, rel: string) => void
  watch?: (rel: string) => ((before: string | null, after: string) => void) | null; wrote?: (rel: string) => void }
const gates = new Map<string, Gate>()

export function setGate(root: string, gate: Gate) {
  gates.set(path.resolve(root), gate)
}

function inside(root: string, abs: string) {
  const rel = path.relative(root, abs)
  return !rel || rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/")
}

const ungated = (rel: string) => rel === ".vaultite" || rel.startsWith(".vaultite/")

/** Throws WriteRefused when the plugin acting now may not write `abs` (a file or folder about to be written, moved or
 *  deleted). The core's own work ("core") isn't a plugin's. */
export function guard(abs: string) {
  const full = path.resolve(abs)
  if (connect.getStore()) for (const root of gates.keys()) {
    const rel = inside(root, full)
    if (rel !== null && MACHINE_ONLY.test(rel)) throw new WriteRefused("connect", rel, `${rel} is changed only on this Mac (or with owner tools on over Connect, in Connections)`)
  }
  const id = actor()
  if (!id || id === "core") return
  for (const [root, gate] of gates) {
    const rel = inside(root, full)
    if (rel === null || ungated(rel)) continue
    if (gate.may(id, rel)) return
    gate.refused(id, rel)
    throw new WriteRefused(id, rel)
  }
}

export function written(abs: string) {
  const full = path.resolve(abs)
  for (const [root, gate] of gates) {
    const rel = inside(root, full)
    if (rel !== null) gate.wrote?.(rel)
  }
}

export function watching(abs: string) {
  const full = path.resolve(abs)
  for (const [root, gate] of gates) {
    const rel = inside(root, full)
    if (rel !== null && gate.watch) return gate.watch(rel)
  }
  return null
}
