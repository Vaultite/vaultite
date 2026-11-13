import { z } from "zod"
import { HTTPError, inDesktop, type Plugin } from "../../../core/plugins.ts"
import { askThere, desktopOf, JSON_ANSWER, machineOf, otherBrowsers } from "./machinecalls.ts"

export type MachineLogins = { machine: string; label: string; sets: Record<string, unknown[]> }
const SETS = z.object({ sets: z.record(z.string(), z.array(z.unknown())).optional() })
const text = z.string().catch("")
const TAKE = z.object({ to: text, sealed: text, machine: text })

export function machineLogins(plugin: Plugin) {
  const what = "Other machines' logins"
  const desktop = desktopOf(plugin)
  const o = { lock: false, sync: false }

  plugin.route("GET", "web-viewer/logins", async (req) => {
    await plugin.ownerOnly(req, what)
    const profiles = String(req.query.profiles ?? "").split(",").filter((p) => /^[a-z0-9-]{0,32}$/.test(p)).slice(0, 50)
    if (req.query.local) return { sets: inDesktop() ? await desktop<Record<string, unknown[]>>("remote:sites", profiles) : {} }
    const { self, others } = await otherBrowsers(plugin)
    const ours = others.filter((m) => !self?.vault || !m.vault || m.vault === self.vault)
    const q = `web-viewer/logins?local=1&profiles=${encodeURIComponent(profiles.join(","))}`
    const got = await Promise.all(ours.map((m) => askThere(m, "GET", q, SETS, undefined, 15_000)
      .then((r): MachineLogins => ({ machine: m.id, label: m.label, sets: r.sets ?? {} }), () => null)))
    return { machines: got.filter((x) => x !== null) }
  }, o)

  plugin.route("GET", "web-viewer/logins/key", async (req) => {
    await plugin.ownerOnly(req, what)
    const m = await machineOf(plugin, String(req.query.machine ?? ""))
    return m ? askThere(m, "GET", "web-viewer/logins/key", JSON_ANSWER) : desktop("remote:key")
  }, o)

  plugin.route("POST", "web-viewer/logins/take", async (req) => {
    await plugin.ownerOnly(req, what)
    const { to, sealed, machine } = TAKE.parse(req.body ?? {})
    if (!/^[a-z0-9-]{0,32}$/.test(to) || !sealed) throw new HTTPError(400, "a login is sealed for a set of logins")
    const m = await machineOf(plugin, machine)
    return m ? askThere(m, "POST", "web-viewer/logins/take", JSON_ANSWER, { to, sealed }, 30_000) : desktop("remote:take", to, sealed)
  }, o)
}
