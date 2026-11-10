// app.version: what this server runs (its version, the commit it runs and its branch) and what its updates are doing: a
// service install following a branch's (core/update/), or the desktop app's that runs it (electron/updates.ts).
import type { Op } from "../ops.ts"
import { desktopCall, inDesktop } from "../desktopapp.ts"
import { running } from "../running.ts"
import { updateStatus } from "../update/updater.ts"
import { API_VERSION, APP_VERSION } from "../version.ts"
import type { Any } from "./common.ts"

const short = (sha: unknown) => String(sha).slice(0, 7)
type AppUpdates = { mode: "automatic" | "notify" | "off"; available: boolean; from: string; ready: string | null; doing: string | null }

export function versionOps(): Op[] {
  return [{
    id: "app.version",
    cli: "version",
    summary: "What this server runs: Vaultite's version, the plugin API's, its commit and branch, and its updates' state.",
    help: `commit: the commit it runs (a web-only update's too: it runs without a restart), its subject and date.
updates: a service install following a branch (vau service install --updates main) updates itself: its state
(current, waiting and why, updating, failed), when it last looked, the last update and a failed one (in vau errors too).
app: the desktop app this server runs in or is attached to updates itself (and its server) in its mode: automatic,
notify (the default: offers Restart to update) or off (only from its menu); ready is a build waiting for a restart.

  vau version`,
    kind: "read",
    run: async () => {
      const { startedOn: _, ...now } = await running()
      return { version: APP_VERSION, api: API_VERSION, ...now, pid: process.pid, started: Date.now() - Math.round(process.uptime() * 1000),
        updates: updateStatus(), app: await appUpdates() }
    },
    text: (r: Any) => [`Vaultite ${r.version} (plugin API ${r.api})${r.commit ? `, ${short(r.commit)}${r.branch ? ` on ${r.branch}` : ""}` : ""}`,
      ...(r.subject ? [`Commit: ${r.subject}${r.at ? ` (${new Date(r.at).toISOString()})` : ""}`] : []),
      // (out of step: a checkout pulled and built but not restarted, or restarted but not built)
      ...(r.web?.commit && r.commit && r.web.commit !== r.commit ? [`Web app: built from ${short(r.web.commit)}, not ${short(r.commit)}`] : []),
      `Updates: ${updatesLine(r.updates, r.app)}`,
      ...(r.updates.last ? [`Last update: ${short(r.updates.last.from)} to ${short(r.updates.last.to)}, ${new Date(r.updates.last.at).toISOString()}`] : []),
      ...(r.updates.error ? [`Failed: ${r.updates.error.message}`] : [])].join("\n"),
  }]
}

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
