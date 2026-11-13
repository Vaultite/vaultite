// Vaultite Main's updates through the root store (core/update/store.ts): each commit made once into a code root, then
// only what it changed (core/update/plan.ts) restarted. Where the marker says (electron/storepolicy.ts), else update.sh.
import { app } from "electron"
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { leaseIn } from "../core/update/lease.ts"
import type { UpdateStatus } from "../core/contracts/version.ts"
import { codeAt, SHELL } from "./identity.ts"
import { markerFile, storeDir, storeWanted } from "./storepolicy.ts"
import { relaunchOptions } from "./argv.ts"
import { shellBad, storeCurrent, storeFingerprint } from "./filewire.ts"

const ROOT = path.dirname(import.meta.dirname)
export const SHA = /^[0-9a-f]{40}$/

/** What the store's updates need of the app (updates.ts, main.ts). */
export type StoreHost = {
  /** The commit every window's server runs, when every window is attached to a service ("" otherwise; null: one
   *  didn't say, so the look waits). */
  attached(): Promise<string | null>
  /** The commit its own servers' code is from, and their web build's; null: it runs none (attached, no window). */
  servers(): { code: string | null; web: string | null } | null
  /** Its own servers started again, from the current root. */
  restartServers(): void
  /** Its own servers serve `dist` (`commit`'s web build) from now on, their pages told. */
  adoptWeb(dist: string, commit: string): void
  /** The main process runs older code than `commit` (`why`: what changed that it runs): a relaunch offered (made when
   *  safe, automatic). */
  offerRelaunch(commit: string, why?: string): void
  /** The commit the menu-bar helper's code is from (it may be newer than the main process's: reloaded); null: none runs. */
  helper(): string | null
  /** The helper moved onto `root` (`commit`) once it's idle, the main process left running. */
  reloadHelper(root: string, commit: string): void
  /** A new shell's app for `commit` is built (update.noindex): installed as before, when restarted. */
  offerInstall(commit: string): void
  /** Why nothing should restart now (an agent at work in the browser), or null. */
  busy(): Promise<string | null>
  /** The user's PATH (npm, git), as their login shell has it. */
  path(): string
  log(line: string): void
}

export const userData = () => app.getPath("userData")
/** Whether this app takes updates through the store now (the marker read each time). */
export const storeOn = () => storeWanted({ packaged: app.isPackaged, channel: SHELL.channel, release: SHELL.release, platform: process.platform,
  marker: fs.existsSync(markerFile(userData())) })

/** The root its servers start from: the store's current one when this shell can run it (its fingerprint) and it didn't
 *  fail to start (the store's bad marks, and the shell's from this launch, before they're the store's), else its own. */
export function codeRoot(): string {
  if (!storeOn()) return ROOT
  const dir = storeDir(userData()), sha = storeCurrent(dir)
  if (!sha || !SHA.test(sha) || fs.existsSync(path.join(dir, "bad", `${sha}.json`))) return ROOT
  const root = path.join(dir, "roots", sha)
  if (shellBad(userData())[root]) return ROOT
  return storeFingerprint(dir, sha) === SHELL.fingerprint && fs.existsSync(path.join(root, "server.ts")) ? root : ROOT
}
/** The commit at `root` (its stamp). */
export const commitAt = (root: string) => codeAt(root)?.commit ?? null

/** A process run from a root of the store (a server, the main process) holds it from gc while it lives. */
export function hold(root: string, pid: number, what: string) {
  const dir = storeDir(userData()), sha = path.basename(root)
  if (path.dirname(root) !== path.join(dir, "roots") || !SHA.test(sha)) return
  void leaseIn(dir, sha, { pid, what }).catch(() => {})
}

let said: UpdateStatus | null = null
/** One look through the store (storeupdate.ts, loaded at the first). */
export async function storeLook(h: StoreHost) { return (said = await (await import("./storeupdate.ts")).look(h)) }
/** The store's updates' state at the last look, for app.version (vau version). */
export const storeStatus = () => said
/** Once this launch is ready: what the store keeps of it (storeupdate.ts' ready). */
export async function storeReady(h: StoreHost) { if (storeOn()) await (await import("./storeupdate.ts")).ready(h) }

/** Relaunched in place, nothing swapped (its code is a root of the store): as a LaunchAgent's app, by launchd once this
 *  process has ended (so a crash still brings it back); else Electron's relaunch. */
export function relaunchSoon() {
  const label = process.env.XPC_SERVICE_NAME
  if (process.platform === "darwin" && label && label !== "0" && !label.startsWith("application.")) {
    spawn("/bin/sh", ["-c", 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; launchctl kickstart "gui/$(id -u)/$2"', "sh", String(process.pid), label],
      { detached: true, stdio: "ignore" }).unref()
  } else app.relaunch(relaunchOptions())
}
