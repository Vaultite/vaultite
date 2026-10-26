// Other machines' logins (Machines): who's signed in where, and a login copied there sealed for that app's key
// (electron/web.ts), so servers never read a cookie. Owner only, and routes, never ops: no agent copies a login.
import { HTTPError, inDesktop, type Plugin } from "../../../core/plugins.ts"
import { askThere, machineOf, otherBrowsers } from "./machinecalls.ts"

/** A machine's sets of logins with sites, by profile (each a list of the desktop app's WebSite). */
export type MachineLogins = { machine: string; label: string; sets: Record<string, unknown[]> }

export function machineLogins(plugin: Plugin) {
  const what = "Other machines' logins"
  const desktop = async <T>(name: string, ...args: unknown[]) => {
    try { return (await plugin.desktop(name, ...args)) as T } catch (e) { throw new HTTPError(409, (e as Error).message) }
  }
  const o = { lock: false, sync: false }

  // The other machines' sets of logins among `profiles` (the vault's, so the same on each); `local`: this server's
  // browser's own, what another machine asks.
  plugin.route("GET", "web-viewer/logins", async (req) => {
    await plugin.ownerOnly(req, what)
    const profiles = String(req.query.profiles ?? "").split(",").filter((p) => /^[a-z0-9-]{0,32}$/.test(p)).slice(0, 50)
    if (req.query.local) return { sets: inDesktop() ? await desktop<Record<string, unknown[]>>("remote:sites", profiles) : {} }
    const { self, others } = await otherBrowsers(plugin)
    const ours = others.filter((m) => !self?.vault || !m.vault || m.vault === self.vault)
    const q = `web-viewer/logins?local=1&profiles=${encodeURIComponent(profiles.join(","))}`
    const got = await Promise.all(ours.map((m) => askThere<{ sets?: Record<string, unknown[]> }>(m, "GET", q, undefined, 15_000)
      .then((r): MachineLogins => ({ machine: m.id, label: m.label, sets: r.sets ?? {} }), () => null)))
    return { machines: got.filter((x) => x !== null) }
  }, o)

  // The key a login copied to `machine`'s browser is sealed for.
  plugin.route("GET", "web-viewer/logins/key", async (req) => {
    await plugin.ownerOnly(req, what)
    const m = await machineOf(plugin, String(req.query.machine ?? ""))
    return m ? askThere(m, "GET", "web-viewer/logins/key") : desktop("remote:key")
  }, o)

  // A sealed login into `machine`'s browser, its profile `to`: whether it stayed signed in there, and as whom.
  plugin.route("POST", "web-viewer/logins/take", async (req) => {
    await plugin.ownerOnly(req, what)
    const b = (req.body ?? {}) as Record<string, unknown>
    const to = String(b.to ?? ""), sealed = String(b.sealed ?? "")
    if (!/^[a-z0-9-]{0,32}$/.test(to) || !sealed) throw new HTTPError(400, "a login is sealed for a set of logins")
    const m = await machineOf(plugin, String(b.machine ?? ""))
    return m ? askThere(m, "POST", "web-viewer/logins/take", { to, sealed }, 30_000) : desktop("remote:take", to, sealed)
  }, o)
}
