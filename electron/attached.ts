// The servers the windows attached to, as the updates see them (updates.ts loads it at its first look, not at launch:
// tools/perf/startup.ts): the commit they pin the app to (storepolicy.ts pinOf), and one of its own told as an error.
import { CODE } from "./identity.ts"
import { pinOf } from "./storepolicy.ts"
import type { UpdatesHost } from "./updates.ts"
import { messageOf } from "./browser/errors.ts"

type Host = Pick<UpdatesHost, "windows" | "ownsServer" | "nameOf">

/** The commit every window's server runs when each is a real service; "": the branch; null: a service didn't say (a
 *  service just restarted, still making its module graph), so the store's look waits rather than take the newest. */
export async function attachedTo(host: Host, told: ReadonlyMap<number, string>, log: (line: string) => void): Promise<string | null> {
  const links = host.windows().map((w) => (w.link ? { own: host.ownsServer(w), port: w.port, name: host.nameOf(w.vault.path) } : null))
  const own = links.find((l) => l?.own)
  if (own && !toldOwn) {
    toldOwn = true
    updateError(host, log, `${own.name}'s window is attached to this app's own server (port ${own.port}) as if to a service: its updates follow the branch, and it moves with them`)
  }
  // (a commit asked only when every window is on a real service: else it follows the branch anyway)
  const services = links.every((l) => l && !l.own)
  return pinOf(await Promise.all(links.map(async (l) => l && { own: l.own, commit: services ? told.get(l.port) ?? await serverCommit(l.port, log) : "" })))
}
let toldOwn = false

/** An update's fault in update.log and the open vaults' Errors (vau errors): one that would otherwise sit silent. */
function updateError(host: Host, log: (line: string) => void, message: string) {
  log(`updates: error: ${message}`)
  const body = JSON.stringify({ device: "desktop", errors: [{ kind: "update", t: Date.now(), message: `Updates: ${message}`, stack: "", build: CODE?.commit ?? "" }] })
  for (const w of host.windows()) void fetch(`http://127.0.0.1:${w.port}/api/errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {})
}

export const serverCommit = (port: number, log: (line: string) => void) => fetch(`http://127.0.0.1:${port}/api/ops/app.version`, { method: "POST",
  headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000) }).then(async (r) => {
  const { VersionHere } = await import("../core/contracts/version.ts")
  const v = VersionHere.pick({ commit: true }).safeParse(await r.json())
  return v.success ? v.data.commit ?? "" : ""
}, (e) => {
  log(`its server on port ${port} didn't say its commit: ${messageOf(e)}`)
  return ""
})
