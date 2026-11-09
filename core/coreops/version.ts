// app.version: what this server runs (its version, its checkout's commit and branch) and what its updates are doing: a
// service install following a branch's (core/selfupdate.ts), or the desktop app's that runs it (electron/main.ts).
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { Op } from "../ops.ts"
import { ROOT } from "../plugins.ts"
import { desktopCall, inDesktop } from "../desktopapp.ts"
import { updateStatus } from "../update/updater.ts"
import { API_VERSION, APP_VERSION } from "../version.ts"
import type { Any } from "./common.ts"
import { gitEnv } from "../gitenv.ts"

const exec = promisify(execFile)
const git = (...args: string[]) => exec("git", ["-C", ROOT, ...args], { timeout: 3000, env: gitEnv() }).then((r) => r.stdout.trim(), () => "")

/** The commit and branch it started on (the checkout's then, or the packaged app's build: electron/build.json). */
const RUNNING = build()
async function build() {
  const commit = await git("rev-parse", "HEAD")
  if (commit) return { commit, branch: await git("symbolic-ref", "--short", "-q", "HEAD") || null }
  try { return { commit: String(JSON.parse(fs.readFileSync(path.join(ROOT, "electron", "build.json"), "utf8")).commit ?? "") || null, branch: null } }
  catch { return { commit: null, branch: null } }
}

export function versionOps(): Op[] {
  return [{
    id: "app.version",
    cli: "version",
    summary: "What this server runs: Vaultite's version, the plugin API's, its commit and branch, and its updates' state.",
    help: `updates: a service install following a branch (vau service install --updates main) updates itself: its state
(current, waiting and why, updating, failed), when it last looked, the last update and a failed one (in vau errors too).
app: the desktop app this server runs in or is attached to updates itself (and its server) in its mode: automatic,
notify (the default: offers Restart to update) or off (only from its menu); ready is a build waiting for a restart.

  vau version`,
    kind: "read",
    run: async () => ({ version: APP_VERSION, api: API_VERSION, ...(await RUNNING), pid: process.pid, started: Date.now() - Math.round(process.uptime() * 1000),
      updates: updateStatus(), app: await appUpdates() }),
    text: (r: Any) => [`Vaultite ${r.version} (plugin API ${r.api})${r.commit ? `, ${String(r.commit).slice(0, 7)}${r.branch ? ` on ${r.branch}` : ""}` : ""}`,
      `Updates: ${updatesLine(r.updates, r.app)}`,
      ...(r.updates.last ? [`Last update: ${String(r.updates.last.from).slice(0, 7)} to ${String(r.updates.last.to).slice(0, 7)}, ${new Date(r.updates.last.at).toISOString()}`] : []),
      ...(r.updates.error ? [`Failed: ${r.updates.error.message}`] : [])].join("\n"),
  }]
}

type AppUpdates = { mode: "automatic" | "notify" | "off"; available: boolean; from: string; ready: string | null; doing: string | null }

/** The desktop app's updates, when it runs this server or is attached to it (null: none; unknown: it didn't say). */
const appUpdates = (): Promise<AppUpdates | "unknown" | null> => !inDesktop() ? Promise.resolve(null)
  : (desktopCall("app:updates", [], 5000) as Promise<AppUpdates | null>).then((a) => a ?? "unknown", () => "unknown" as const)

function updatesLine(u: Any, app: AppUpdates | "unknown" | null) {
  if (u.branch) return `following ${u.branch}, ${u.state}: ${u.why}`
  if (!app) return "off (not a service install following a branch, nor in the desktop app)"
  if (app === "unknown") return "the desktop app's, which didn't say how they are (an older app)"
  if (!app.available) return "off (this desktop app's build doesn't update itself)"
  if (app.mode === "off") return "off in the desktop app (it looks only when asked, from its menu)"
  return `by the desktop app, ${app.mode}, from ${app.from}${app.doing ? `: ${app.doing}` : app.ready ? `: ${app.ready.slice(0, 7)} ready, restart to update` : ""}`
}
