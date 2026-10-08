// Tabs: what each device has open, a file per device (device-<id>.json, so devices never write the same file), for the
// Tabs panel; terminal tabs saved with their machine (`@<machine>`), like Workspaces'.
import fs from "node:fs"
import path from "node:path"
import { HTTPError, Plugin, type Request } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** A device and its tabs (types.ts has them for the app). */
type DeviceTab = { to: string; label?: string; pinned?: boolean }
type Device = { id: string; name: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[] }

const ID = /^[a-z0-9]{8,32}$/
const TERM = "view:terminal/"
const MAX_TABS = 100
/** A device not heard from in this long is left out (its file stays until it's forgotten). */
const STALE = 30 * 86400_000

const file = (id: string) => `device-${id}`
const idOf = (s: string) => { const id = s.toLowerCase(); if (!ID.test(id)) throw new HTTPError(400, "a device id is 8 to 32 letters and digits"); return id }

/** This machine's id in Machines' list ("" for none). */
const self = async () => String(await plugin.ask("machines:self", ""))
const labelOf = (id: string) => {
  const list = plugin.peer("machines")?.settings({}).machines
  const m = Array.isArray(list) ? (list as Item[]).find((x) => x?.id === id) : undefined
  return String(m?.label || id)
}

/** What a browser calls itself, in words: "Safari on iPhone". */
export function browserName(ua: string) {
  const app = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser"
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : ""
  return os ? `${app} on ${os}` : app
}

/** Which device is asking, from its request: the iPhone app (its cookie), the desktop app (X-Vaultite-Client:
 *  app/desktop, always on this machine; "Mac app" or "Linux app" by its user agent) or a browser. */
function whoAsks(req: Request, machine: string): Pick<Device, "name" | "kind"> {
  const h = req.http?.headers ?? {}
  if (/(?:^|;\s*)vaultite_client=iphone(?:;|$)/.test(String(h.cookie ?? ""))) return { name: "iPhone app", kind: "phone" }
  const ua = String(h["user-agent"] ?? "")
  if (h["x-vaultite-client"] === "app/desktop") {
    const app = /Macintosh|Mac OS X/.test(ua) ? "Mac app" : /Linux/.test(ua) ? "Linux app" : /Windows/.test(ua) ? "Windows app" : "Desktop app"
    return { name: machine ? `${app} on ${labelOf(machine)}` : app, kind: "desktop" }
  }
  return { name: browserName(ua), kind: /iPhone|Android/.test(ua) ? "phone" : "web" }
}

/** The tabs a device sent, checked: places another device can open (no blank tabs, no files outside the vault), its
 *  terminals saved with this machine (none without one: another machine couldn't find them). */
function tabsOf(raw: unknown, machine: string): DeviceTab[] {
  const out: DeviceTab[] = []
  for (const t of Array.isArray(raw) ? raw as Item[] : []) {
    let to = typeof t?.to === "string" ? t.to : ""
    if (!/^(file|view):./.test(to) || to.startsWith("file:/") || out.some((o) => o.to === to)) continue
    if (to.startsWith(TERM) && !to.includes("@")) { if (!machine) continue; to = `${to}@${machine}` }
    out.push({ to, ...(typeof t.label === "string" && t.label ? { label: t.label.slice(0, 200) } : {}), ...(t.pinned === true ? { pinned: true } : {}) })
    if (out.length >= MAX_TABS) break
  }
  return out
}

/** Every device's tabs, the latest first; this machine's terminals as its app has them (without "@<this machine>"). */
async function devices(): Promise<Device[]> {
  let names: string[]
  try { names = fs.readdirSync(path.join(plugin.vault.path, ".vaultite", "plugins", plugin.id)) } catch { return [] }
  const machine = await self()
  const out: Device[] = []
  for (const n of names) {
    const m = /^device-([a-z0-9]{8,32})\.json$/.exec(n)
    if (!m) continue
    const d = plugin.settings({}, file(m[1]))
    const at = typeof d.at === "string" ? d.at : ""
    if (!at || !(Date.now() - Date.parse(at) < STALE)) continue
    const tabs = (Array.isArray(d.tabs) ? d.tabs as DeviceTab[] : []).filter((t) => typeof t?.to === "string")
      .map((t) => (machine && t.to.endsWith(`@${machine}`) && t.to.startsWith(TERM) ? { ...t, to: t.to.slice(0, -machine.length - 1) } : t))
    out.push({ id: m[1], name: String(d.name || "A device"), kind: d.kind === "desktop" || d.kind === "phone" ? d.kind : "web", at, tabs })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

plugin.state(async () => ({ tabDevices: await devices() }))
plugin.route("GET", "tabs/devices", async () => ({ devices: await devices() }))

/** PUT tabs/devices/<id> {tabs: [{to, label?, pinned?}]}: this device's tabs now. */
plugin.route("PUT", "tabs/devices/*", async (req) => {
  const id = idOf(req.arg(0)), machine = await self()
  const tabs = tabsOf(req.body.tabs, machine)
  const was = plugin.settings({}, file(id))
  const next = { ...whoAsks(req, machine), at: new Date().toISOString(), tabs }
  // Nothing new (a reload): the file stays as it is, unless it's old enough that "updated" would mislead.
  if (JSON.stringify({ ...was, at: "" }) === JSON.stringify({ ...next, at: "" }) && Date.now() - Date.parse(String(was.at)) < 3600_000) return { ok: true }
  plugin.saveSettings(next, file(id))
  return { ok: true }
})

/** DELETE tabs/devices/<id>: forget a device (it comes back the next time it's used). */
plugin.route("DELETE", "tabs/devices/*", (req) => {
  plugin.saveSettings(null, file(idOf(req.arg(0))))
  return { ok: true }
})
