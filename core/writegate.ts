// The one gate every write to a vault passes (writeAtomic, writeNew, moves and deletes: core/vault.ts, core/files.ts).
// The user's own actions (a request: the app, the CLI, an agent, an op) always pass; a plugin acting on its own (its
// jobs, timers, hooks: `onItsOwn`) writes outside .vaultite/ only where the user granted it (core/grants.ts).
import { AsyncLocalStorage } from "node:async_hooks"
import path from "node:path"

/** The plugin acting on its own now; null or unset: the user (whoever made the request being answered). */
const acting = new AsyncLocalStorage<string | null>()

/** fn as the plugin `id` acting on its own: what it writes outside .vaultite/ needs a grant. Timers made inside keep it. */
export const onItsOwn = <T>(id: string, fn: () => T): T => acting.run(id, fn)
/** fn as the user's own action (a request): never gated. */
export const byUser = <T>(fn: () => T): T => acting.run(null, fn)
/** The plugin acting on its own now, or null. */
export const actor = () => acting.getStore() ?? null

/** A write the gate refused: a 403 for the API. */
export class WriteRefused extends Error {
  status = 403
  plugin: string
  path: string
  constructor(plugin: string, rel: string) {
    super(`${plugin} may not write ${rel} on its own: allow it in its settings (Writes on its own)`)
    this.plugin = plugin
    this.path = rel
  }
}

/** Log a failure: a refused write is a warning (the app asks the user; it isn't the server's error), else an error. */
export function logFailure(where: string, e: unknown) {
  if (e instanceof WriteRefused) console.warn(`${where} ${e.message}`)
  else console.error(where, e)
}

/** A vault's side of the gate (Vault sets it up): may `plugin` write `rel`, and what to do when it may not. */
export type Gate = { may: (plugin: string, rel: string) => boolean; refused: (plugin: string, rel: string) => void }
const gates = new Map<string, Gate>()

/** The gate for the vault at `root` (the last one set for a folder wins). */
export function setGate(root: string, gate: Gate) {
  gates.set(path.resolve(root), gate)
}

/** A path relative to the root it's in, or null. */
function inside(root: string, abs: string) {
  const rel = path.relative(root, abs)
  return !rel || rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/")
}

/** The vault path `abs` is in .vaultite/ (the app's own), or outside every vault: never gated. */
const ungated = (rel: string) => rel === ".vaultite" || rel.startsWith(".vaultite/")

/** Throws WriteRefused when the plugin acting now may not write `abs` (a file or folder about to be written, moved or
 *  deleted). The core's own work ("core") isn't a plugin's. */
export function guard(abs: string) {
  const id = actor()
  if (!id || id === "core") return
  const full = path.resolve(abs)
  for (const [root, gate] of gates) {
    const rel = inside(root, full)
    if (rel === null || ungated(rel)) continue
    if (gate.may(id, rel)) return
    gate.refused(id, rel)
    throw new WriteRefused(id, rel)
  }
}
