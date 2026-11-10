// How Vaultite Main takes updates through the root store (electron/storehost.ts), stated in one place: where it does,
// and its two policies. No Electron: tools/test_update.ts reads it.
import path from "node:path"
import type { CiResult } from "../core/update/ci.ts"
import type { Recipe } from "../core/update/store.ts"
import { MARKER, STORE } from "./shell/store.mjs"

// (MARKER turns the store on for this machine: electron/shell/store.mjs; absent, update.sh builds the whole app as before)
export { MARKER, STORE }
/** A new shell (its fingerprint changed: the app itself is built and signed again) at most this often. */
export const SHELL_EVERY = 60 * 60_000

/** Whether this app takes its updates through the store: Vaultite Main from source (not a release, not Windows, which
 *  run their bundle only: electron/shell/roots.mjs) where the marker is. */
export const storeWanted = (o: { packaged: boolean; channel?: string; release?: boolean; platform: string; marker: boolean }) =>
  o.packaged && o.channel === "main" && !o.release && o.platform !== "win32" && o.marker

export type Policy = {
  /** What it follows: the commit its server runs (every window attached to a service), or the branch's newest. */
  follows: "server" | "branch"
  recipe: Recipe
  /** Whether a commit may be taken (the updater's CI gate). */
  ci: (repo: string, sha: string) => Promise<CiResult>
}

/** A window's server: null, its own; else the one it attached to, `own` when this app started it all the same (this
 *  launch or its last, taken over), and the commit it says it runs ("": it didn't say, or wasn't asked). */
export type Attachment = { own: boolean; commit: string } | null
/** The commit every window's server runs when each is a real service (one this app didn't start); "": the branch, as
 *  with any on its own server, which moves only with the app (waiting for it waits forever); null: one didn't say. */
export function pinOf(windows: Attachment[]): string | null {
  if (!windows.length || windows.some((w) => !w || w.own)) return ""
  const ran = windows.map((w) => w!.commit)
  if (ran.some((c) => !/^[0-9a-f]{40}$/.test(c))) return null
  return ran.every((c) => c === ran[0]) ? ran[0] : ""
}

/** Attached to a service (`server`: the commit it runs, which CI for this OS passed): that commit only, checked by its
 *  server booting (about 10 s). Standalone: the branch's newest, CI not waited for (as before), with smoke too. */
export async function policyFor(server: string): Promise<Policy> {
  const { appRecipe, serverBoots } = await import("../core/update/store.ts")
  if (server) return {
    follows: "server", recipe: { ...appRecipe(), preflight: [serverBoots] },
    ci: async (_repo, sha) => sha === server ? { ok: true, why: "the commit its server runs" } : { ok: null, why: `not the commit its server runs (${server.slice(0, 7)})` },
  }
  return { follows: "branch", recipe: appRecipe(), ci: async () => ({ ok: true, why: "not waited for: a standalone app" }) }
}

/** The store's folder and the marker, in `userData`. */
export const storeDir = (userData: string) => path.join(userData, STORE)
export const markerFile = (userData: string) => path.join(userData, MARKER)
