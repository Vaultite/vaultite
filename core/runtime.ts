// Where the server keeps sockets, run scripts and other short-lived files, and how it starts processes that must outlive it.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let dir: string | null = null
/** A folder only this user can use: a Mac's $TMPDIR is that already; Linux's /tmp is shared (another user could make
 *  the folder first and swap a script a shell runs), so $XDG_RUNTIME_DIR/vaultite, else /tmp/vaultite-<uid>, checked. */
export function runtimeDir(): string {
  if (dir) return dir
  if (process.platform === "darwin" || typeof process.getuid !== "function") return (dir = os.tmpdir())
  const uid = process.getuid()
  const xdg = process.env.XDG_RUNTIME_DIR
  const base = xdg && fs.statSync(xdg, { throwIfNoEntry: false })?.uid === uid ? path.join(xdg, "vaultite") : path.join(os.tmpdir(), `vaultite-${uid}`)
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  const st = fs.lstatSync(base)
  if (!st.isDirectory() || st.uid !== uid) throw new Error(`${base} isn't this user's folder: Vaultite won't keep its sockets there`)
  if ((st.mode & 0o077) !== 0) fs.chmodSync(base, 0o700)
  return (dir = base)
}

let systemdRun: string | null | undefined
/** Under a systemd unit (`vau service` on Linux) restarting it kills its whole cgroup, detached children too (launchd
 *  leaves a new session alone): what a process that must outlive the server runs as, in a scope of its own. */
export function outliving(cmd: string, args: string[], name: string): [string, string[]] {
  if (process.platform !== "linux" || !process.env.INVOCATION_ID || !inService()) return [cmd, args]
  if (systemdRun === undefined) {
    try { systemdRun = execFileSync("sh", ["-c", "command -v systemd-run"], { encoding: "utf8" }).trim() || null } catch { systemdRun = null }
  }
  if (!systemdRun) return [cmd, args]
  const unit = `vaultite-${name.replace(/[^\w-]/g, "_")}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return [systemdRun, ["--user", "--scope", "--collect", "--quiet", `--unit=${unit}`, "--", cmd, ...args]]
}

/** Whether this process is in a systemd user service's cgroup (not a login session's, where nothing kills it). */
function inService() {
  try { return /\/user@\d+\.service\/.*\.service$/m.test(fs.readFileSync("/proc/self/cgroup", "utf8")) } catch { return false }
}
