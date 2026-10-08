// The sandbox in the desktop app: a made-up vault (core/sandbox.ts, from examples/vault) in userData/Sandbox,
// made fresh with today's dates each time it opens, unless its window is open.
import { app } from "electron"
import path from "node:path"
import { isStale, makeSandbox } from "../core/sandbox.ts"

/** Where the sandbox lives: this Mac's, never in a vault the user chose. */
export const sandboxPath = () => path.join(app.getPath("userData"), "Sandbox")

/** Make the sandbox afresh (unless `isOpen`), then `open` it. `fresh` hears of a new one first, so it gets a new
 *  origin: last time's tabs point at files dated then. */
export async function openSandbox<T>(open: (p: string) => Promise<T>, isOpen: (p: string) => boolean, fresh: (p: string) => void) {
  const p = sandboxPath()
  if (!isOpen(p)) {
    makeSandbox(p)
    fresh(p)
  }
  return open(p)
}

/** At launch, before the vaults open last time reopen: a sandbox among them from another day or an older sample (the
 *  app was updated) is made again, so it never comes back as it was. True when it was. */
export function refreshSandbox(p: string) {
  if (p !== sandboxPath() || !isStale(p)) return false
  makeSandbox(p)
  return true
}
