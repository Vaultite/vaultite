// app.version: what this server runs (its version, its checkout's commit and branch) and, a service install following a
// branch, what its updates are doing (core/selfupdate.ts).
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import type { Op } from "../ops.ts"
import { ROOT } from "../plugins.ts"
import { updateStatus } from "../selfupdate.ts"
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
    help: `updates is off unless the server is a service install following a branch (vau service install --updates
main): then its state (current, waiting and why, updating, failed), when it last looked, the last update and a failed one.
A failure is in vau errors too.

  vau version`,
    kind: "read",
    run: async () => ({ version: APP_VERSION, api: API_VERSION, ...(await RUNNING), pid: process.pid, started: Date.now() - Math.round(process.uptime() * 1000),
      updates: updateStatus() }),
    text: (r: Any) => [`Vaultite ${r.version} (plugin API ${r.api})${r.commit ? `, ${String(r.commit).slice(0, 7)}${r.branch ? ` on ${r.branch}` : ""}` : ""}`,
      `Updates: ${r.updates.branch ? `following ${r.updates.branch}, ${r.updates.state}: ${r.updates.why}` : "off"}`,
      ...(r.updates.last ? [`Last update: ${String(r.updates.last.from).slice(0, 7)} to ${String(r.updates.last.to).slice(0, 7)}, ${new Date(r.updates.last.at).toISOString()}`] : []),
      ...(r.updates.error ? [`Failed: ${r.updates.error.message}`] : [])].join("\n"),
  }]
}
