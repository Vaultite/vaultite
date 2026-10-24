// Tabs: what each device has open, a file per device (device-<id>.json, so devices never write the same file); which
// are open now isn't kept: each server knows its own windows (core/live.ts) and asks the other machines for theirs.
import dns from "node:dns/promises"
import fs from "node:fs"
import path from "node:path"
import { COLORS, HTTPError, MACHINE_CLIENT, type OpCtx, OpError, Plugin, type Present, type Request } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** A device and its tabs (types.ts has them for the app). */
type DeviceTab = { to: string; label?: string; pinned?: boolean }
type Device = { id: string; name: string; label?: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[]
  live?: boolean; windows?: number }
/** A machine as the Machines plugin lists it (the fields used here). */
type Machine = { id: string; label: string; url: string; online: boolean; self: boolean; via?: string; host?: string; vault?: string }

const ID = /^[a-z0-9]{8,32}$/
const TERM = "view:terminal/"
/** A device not heard from in this long is left out (its file stays until it's forgotten). */
const STALE = 30 * 86400_000
const LOOPBACK_URL = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/
const loopbackIp = (ip: string) => ip === "::1" || ip.startsWith("127.") || ip === "::ffff:127.0.0.1"

const file = (id: string) => `device-${id}`
const idOf = (s: string) => { const id = s.toLowerCase(); if (!ID.test(id)) throw new HTTPError(400, "a device id is 8 to 32 letters and digits"); return id }

/** This machine's id in Machines' list ("" for none). */
const self = async () => String(await plugin.ask("machines:self", ""))
const machinesNow = async () => (await plugin.ask<Machine[]>("machines", [])) ?? []

/** The computer a machine entry runs on, by its name: one at a loopback address is a second server on a computer listed
 *  by its network address, so that one names it. */
function computerOf(m: Machine, all: Machine[]) {
  if (!LOOPBACK_URL.test(m.url)) return m.label
  return all.find((x) => x !== m && !x.via && x.host && x.host === m.host && !LOOPBACK_URL.test(x.url))?.label ?? m.label
}

const resolved = new Map<string, [number, Promise<string[]>]>()
/** A machine's addresses (its URL's host looked up: on a tailnet, its 100.x one), kept 10 minutes. */
function addressesOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname } catch { return Promise.resolve([]) }
  const hit = resolved.get(host)
  if (hit && Date.now() - hit[0] < 600_000) return hit[1]
  const p = dns.lookup(host, { all: true }).then((a) => a.map((x) => x.address), () => [])
  resolved.set(host, [Date.now(), p])
  return p
}

/** Which computer a request came from, by name ("" when unknown): this one for a loopback caller, else the listed
 *  machine at its address (behind Tailscale Serve, the address it forwards), else its name on the tailnet. */
async function computerAsking(req: Request): Promise<string> {
  const remote = String(req.http?.socket?.remoteAddress ?? "")
  const fwd = String(req.http?.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
  const ip = (loopbackIp(remote) && fwd ? fwd : remote).replace(/^::ffff:/, "")
  const all = await machinesNow()
  if (!ip || loopbackIp(ip)) { const me = all.find((m) => m.self); return me ? computerOf(me, all) : "" }
  for (const m of all) if (!m.via && m.url && !LOOPBACK_URL.test(m.url) && (await addressesOf(m.url)).includes(ip)) return computerOf(m, all)
  if (!/^100\./.test(ip)) return ""
  const name = await Promise.race([dns.reverse(ip).then((n) => n[0] ?? "", () => ""), new Promise<string>((r) => setTimeout(() => r(""), 1000))])
  return name.split(".")[0]
}

/** What a browser calls itself, in words: "Brave on Mac". `brands`: its Sec-CH-UA header, which tells Chromium's
 *  browsers apart (each says "Chrome" in its user agent); one that names no other is Chromium itself. */
export function browserName(ua: string, brands = "") {
  if (!/Chrome\//.test(ua)) brands = "" // (what the user agent says it is wins: hints come only from Chromium itself)
  const brand = /"Brave"/.test(brands) ? "Brave" : /"Microsoft Edge"/.test(brands) ? "Edge" : /"Opera"/.test(brands) ? "Opera"
    : /"Vivaldi"/.test(brands) ? "Vivaldi" : /"Google Chrome"/.test(brands) ? "Chrome" : /"Chromium"/.test(brands) ? "Chromium" : ""
  const app = brand || (/Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser")
  return { app, os: /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "" }
}

/** Which device is asking: the iPhone app (its cookie), the desktop app (X-Vaultite-Client: app/desktop) or a browser,
 *  named by the computer it's on when that's known ("Brave on Studio"), else by its system ("Safari on iPhone"). */
async function whoAsks(req: Request): Promise<Pick<Device, "name" | "kind">> {
  const h = req.http?.headers ?? {}
  if (/(?:^|;\s*)vaultite_client=iphone(?:;|$)/.test(String(h.cookie ?? ""))) return { name: "iPhone app", kind: "phone" }
  const ua = String(h["user-agent"] ?? "")
  if (h["x-vaultite-client"] === "app/desktop") {
    const app = /Macintosh|Mac OS X/.test(ua) ? "Mac app" : /Linux/.test(ua) ? "Linux app" : /Windows/.test(ua) ? "Windows app" : "Desktop app"
    const at = await computerAsking(req)
    return { name: at ? `${app} on ${at}` : app, kind: "desktop" }
  }
  const { app, os } = browserName(ua, String(h["sec-ch-ua"] ?? ""))
  const handheld = os === "iPhone" || os === "iPad" || os === "Android"
  const at = handheld ? "" : await computerAsking(req)
  return { name: at || os ? `${app} on ${at || os}` : app, kind: /iPhone|Android/.test(ua) ? "phone" : "web" }
}

/** The tabs a device sent, checked: places another device can open (no blank tabs, no files outside the vault), its
 *  terminals saved with this machine (none without one: another machine couldn't find them). */
function tabsOf(raw: unknown, machine: string): DeviceTab[] {
  const out: DeviceTab[] = []
  for (const t of Array.isArray(raw) ? raw as Item[] : []) {
    let to = typeof t?.to === "string" ? t.to : ""
    if (!/^(file|view):./.test(to) || to.startsWith("file:/") || out.some((o) => o.to === to)) continue
    if (to.startsWith(TERM) && !to.includes("@")) { if (!machine) continue; to = `${to}@${machine}` }
    out.push({ to, ...(typeof t.label === "string" && t.label ? { label: t.label } : {}), ...(t.pinned === true ? { pinned: true } : {}) })
  }
  return out
}

/** The other machines serving this vault that may have windows open: each one's address. */
async function otherServers() {
  const all = await machinesNow(), me = all.find((m) => m.self)
  return all.filter((m) => !m.self && !m.via && m.online && m.url && (!me?.vault || !m.vault || m.vault === me.vault))
}

/** Which devices are open now, on this server and the other machines (each asked, briefly): by device, where. */
async function presence(): Promise<Map<string, Present & { on: string }>> {
  return plugin.memo(5, async function presence() {
    const all = await machinesNow(), me = all.find((m) => m.self)
    const out = new Map<string, Present & { on: string }>()
    const add = (list: Present[], on: string) => {
      for (const p of list) {
        const had = out.get(p.id)
        out.set(p.id, { ...p, windows: p.windows + (had?.windows ?? 0), at: Math.max(p.at, had?.at ?? 0), on: had && had.at > p.at ? had.on : on })
      }
    }
    add(plugin.host.devices(), me?.id ?? "")
    await Promise.all((await otherServers()).map(async (m) => {
      try {
        const r = await fetch(`${m.url}/api/tabs/devices/here`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(2000) })
        if (r.ok) add(((await r.json()) as { devices?: Present[] }).devices ?? [], m.id)
      } catch { /* offline or older: its devices just don't show as open */ }
    }))
    return out
  })
}

/** Every device's tabs, open ones first, then the latest; this machine's terminals without "@<this machine>". `live`:
 *  say which are open now (asking the other machines); the state leaves that to the app's ask, repeated while shown. */
async function devices(live = true): Promise<Device[]> {
  let names: string[]
  try { names = fs.readdirSync(path.join(plugin.vault.path, ".vaultite", "plugins", plugin.id)) } catch { return [] }
  const machine = await self()
  const open = live ? await presence() : new Map<string, Present>()
  const out: Device[] = []
  for (const n of names) {
    const m = /^device-([a-z0-9]{8,32})\.json$/.exec(n)
    if (!m) continue
    const d = plugin.settings({}, file(m[1]))
    const at = typeof d.at === "string" ? d.at : "", now = open.get(m[1])
    if (!at || (!now && !(Date.now() - Date.parse(at) < STALE))) continue
    const tabs = (Array.isArray(d.tabs) ? d.tabs as DeviceTab[] : []).filter((t) => typeof t?.to === "string")
      .map((t) => (machine && t.to.endsWith(`@${machine}`) && t.to.startsWith(TERM) ? { ...t, to: t.to.slice(0, -machine.length - 1) } : t))
    out.push({ id: m[1], name: String(d.name || "A device"), ...(typeof d.label === "string" && d.label ? { label: d.label } : {}),
      kind: d.kind === "desktop" || d.kind === "phone" ? d.kind : "web", at, tabs,
      ...(now ? { live: true, windows: now.windows } : {}) })
  }
  return out.sort((a, b) => Number(!!b.live) - Number(!!a.live) || b.at.localeCompare(a.at))
}

plugin.state(async () => ({ tabDevices: await devices(false) }))
plugin.route("GET", "tabs/devices", async () => ({ devices: await devices() }), { lock: false })
/** GET tabs/devices/here: the devices with windows open on this server (what other machines ask). */
plugin.route("GET", "tabs/devices/here", () => ({ devices: plugin.host.devices() }), { sync: false })

/** PUT tabs/devices/<id> {tabs: [{to, label?, pinned?}]}: this device's tabs now. */
plugin.route("PUT", "tabs/devices/*", async (req) => {
  const id = idOf(req.arg(0)), machine = await self()
  const tabs = tabsOf(req.body.tabs, machine)
  const was = plugin.settings({}, file(id))
  const next = { ...await whoAsks(req), ...(typeof was.label === "string" && was.label ? { label: was.label } : {}), at: new Date().toISOString(), tabs }
  // Nothing new (a reload): the file stays as it is, unless it's old enough that "updated" would mislead.
  if (JSON.stringify({ ...was, at: "" }) === JSON.stringify({ ...next, at: "" }) && Date.now() - Date.parse(String(was.at)) < 3600_000) return { ok: true }
  plugin.saveSettings(next, file(id))
  return { ok: true }
})

/** POST tabs/devices/<id>/label {label}: the user's name for a device (empty: its own again). */
plugin.route("POST", "tabs/devices/*/label", (req) => {
  const id = idOf(req.arg(0)), was = plugin.settings({}, file(id))
  if (!was.at) throw new HTTPError(404, "no such device")
  const label = typeof req.body.label === "string" ? req.body.label.trim().slice(0, 60) : ""
  const { label: _old, ...rest } = was
  plugin.saveSettings(label ? { ...rest, label } : rest, file(id))
  return { ok: true }
})

/** Close tabs on a device that's open now (`tabs`: what they show, as its list has them; left out, all of them), on
 *  whichever machine its windows are: how many windows were told. */
async function closeOn(id: string, tabs: string[] | undefined, here = false): Promise<{ windows: number }> {
  const msg = { action: "tabs", do: "close", ...(tabs ? { tabs } : {}) }
  const n = plugin.host.tell(id, msg)
  if (n || here) return { windows: n }
  const where = (await presence()).get(id)?.on
  const m = where ? (await otherServers()).find((x) => x.id === where) : undefined
  if (!m) throw new HTTPError(409, "that device isn't open now: its tabs close when it's in use")
  let r: Response
  try {
    r = await fetch(`${m.url}/api/tabs/devices/${id}/close`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify({ ...(tabs ? { tabs } : {}), here: true }), signal: AbortSignal.timeout(5000) })
  } catch { throw new HTTPError(502, `${m.label} doesn't answer`) }
  const answer = await r.json().catch(() => ({})) as Item
  if (!r.ok) throw new HTTPError(r.status, String(answer.error || `${m.label} couldn't reach it`))
  return { windows: Number(answer.windows) || 0 }
}

/** POST tabs/devices/<id>/close {tabs?}: close tabs on that device (`here`: only if it's open on this server). */
plugin.route("POST", "tabs/devices/*/close", async (req) => {
  const tabs = Array.isArray(req.body.tabs) ? (req.body.tabs as unknown[]).map(String) : undefined
  const done = await closeOn(idOf(req.arg(0)), tabs, req.body.here === true)
  plugin.forget() // (its new list comes from the device itself in a moment)
  return done
}, { lock: false })

/** DELETE tabs/devices/<id>: forget a device (it comes back the next time it's used). */
plugin.route("DELETE", "tabs/devices/*", (req) => {
  plugin.saveSettings(null, file(idOf(req.arg(0))))
  return { ok: true }
})

/** A device named by an agent: its id, or its name (the user's, or its own), without regard to case. */
async function deviceNamed(q: string) {
  const all = await devices(), low = q.trim().toLowerCase()
  const hit = all.filter((d) => d.id === low || (d.label ?? "").toLowerCase() === low || d.name.toLowerCase() === low)
  if (hit.length === 1) return hit[0]
  if (hit.length > 1) throw new OpError(`${hit.length} devices are named ${q}: name one by its id (vau tabs devices lists them)`, 400)
  throw new OpError(`no device ${q} (vau tabs devices lists them)`, 404)
}

const deviceLine = (d: Device) => `${d.label || d.name}${d.label ? ` (${d.name})` : ""} [${d.id}]: ${d.live ? `open now${d.windows && d.windows > 1 ? ` in ${d.windows} windows` : ""}` : `last used ${d.at}`}`

plugin.op({
  id: "tabs.devices",
  cli: "tabs devices",
  summary: "The user's devices (each app and browser): which are open now, and the tabs each has open.",
  help: `Each device that used this vault in the last 30 days: the iPhone app, the desktop app on each machine, each
browser (by the computer it's on, when known), open now or when it was last used, with its tabs. A browser driven by
automation isn't one. vau tabs device-close closes tabs on one that's open.

  vau tabs devices`,
  kind: "read",
  run: async () => ({ devices: await devices() }),
  text: (r: { devices: Device[] }) => r.devices.length
    ? r.devices.map((d) => [deviceLine(d), ...d.tabs.map((t) => `  ${t.to}${t.label ? ` (${t.label})` : ""}`)].join("\n")).join("\n")
    : "No devices yet.",
})

plugin.op({
  id: "tabs.device-close",
  cli: "tabs device-close",
  summary: "Close tabs on another of the user's devices that's open now (or all its tabs).",
  help: `Closes tabs in that device's windows (it must be open now: vau tabs devices says which are). Name it by id or
by name; the tabs as vau tabs devices lists them (file:<path>, view:<view>); none: all of them. What would lose work (a
running terminal) asks on that device first.

  vau tabs device-close "Brave on Studio" file:Notes/Idea.md
  vau tabs device-close k2x9a0b1c3d4`,
  kind: "write",
  params: {
    device: { type: "string", required: true, description: "the device: its id or name" },
    tabs: { type: "array", items: { type: "string" }, description: "what the tabs show (none: all its tabs)" },
  },
  args: ["device", "tabs"],
  run: async (p) => {
    const d = await deviceNamed(p.device)
    if (!d.live) throw new OpError(`${d.label || d.name} isn't open now: its tabs close when it's in use`, 409)
    return { device: d.label || d.name, ...await closeOn(d.id, p.tabs?.length ? p.tabs : undefined) }
  },
  text: (r) => `Closing ${r.device}'s tabs (${r.windows} window${r.windows === 1 ? "" : "s"}).`,
  did: (p) => ({ action: "ui", text: `Closed tabs on ${p.device}` }),
})

// ---------- the user's window's tabs and tab groups (vau tabs): asked of the window, which has them ----------

type ReportTab = { id: string; to: string; active?: boolean; pinned?: boolean; group?: string }
type ReportGroup = { id: string; name: string; color: string; collapsed?: boolean; tabs: number }
type Report = { panes: { pane: number; id: string; focused: boolean; tabs: ReportTab[]; groups: ReportGroup[] }[] }

/** Ask the window the user was in last (core/live.ts' asks; web/src/core/tabsets.ts answers). */
async function ask(ctx: OpCtx, msg: Record<string, unknown>) {
  try { return await ctx.ui({ action: "tabs", ...msg }) } catch (e) {
    if (e instanceof OpError && e.status === 409) throw new OpError("no app window is open on this server: open the app (browser or desktop) first", 409)
    throw e
  }
}
const groupLine = (g: ReportGroup) => `${g.name ? `"${g.name}"` : "(no name)"} ${g.color}${g.collapsed ? ", collapsed" : ""} (${g.id})`

const HELP = `The user's window's tabs (the one they used last), pane by pane, with their tab groups: like a browser's,
a group is a named, coloured run of a pane's tabs, side by side, that folds to its name (collapsed). With Workspaces on
they're the current workspace's (vau workspace tabs lists every workspace's, from their files).

tabs: each tab's id and what it shows (file:<path>, view:<view>, new for a blank tab); * marks the one on screen in
each pane, a group's tabs are indented under it.

group: makes the tabs a new group where the first of them is (tabs from other panes move there), or with --group
<id> adds them to that one; --name, --color (${COLORS.join(", ")}; default the first no group has) and --collapsed
true/false name, colour or fold it (with --group alone: an existing one). Name tabs by id, by what they show
(file:Notes/a.md, view:terminal/x) or by a file's path or name. A new group's name, left out, is the folder or site
its tabs share, else none.

ungroup: --group <id> ungroups it (its tabs stay where they are); tabs without --group leave their groups, each going
right after its group, as dragging it out would.

  vau tabs
  vau tabs group "Notes/Idea.md" "Notes/Plan.md" --name Lighthouse --color teal
  vau tabs group t1k2x9a0 --group s1k2x9a1
  vau tabs group --group s1k2x9a1 --collapsed true
  vau tabs ungroup --group s1k2x9a1
  vau tabs ungroup "Notes/Plan.md"`

plugin.op({
  id: "tabs.list",
  cli: "tabs",
  summary: "The user's window's tabs, pane by pane, with their tab groups (name, colour, folded).",
  help: HELP,
  kind: "read",
  run: (_p, ctx) => ask(ctx, { do: "list" }),
  text: (r: Report) => r.panes.flatMap((p) => {
    const out = [...(r.panes.length > 1 ? [`pane ${p.pane}${p.focused ? " (focused)" : ""}`] : [])]
    const pad = r.panes.length > 1 ? "  " : ""
    let open: string | undefined
    for (const t of p.tabs) {
      if (t.group !== open) {
        open = t.group
        const g = p.groups.find((x) => x.id === t.group)
        if (g) out.push(`${pad}group ${groupLine(g)}`)
      }
      out.push(`${pad}${t.group ? "  " : ""}${t.active ? "* " : "  "}${t.id}  ${t.to}${t.pinned ? " (pinned)" : ""}`)
    }
    return out
  }).join("\n"),
})

type ArchivedReport = { archived: { id: string; to: string; title: string; archived: string }[] }
plugin.op({
  id: "tabs.archived",
  cli: "tabs archived",
  summary: "The user's archived tabs: unpinned ones that closed themselves unseen a while (Archive tabs), the latest first.",
  help: `The tabs archived in the user's window (with Workspaces, the current workspace's), the latest first: each one's id,
when it was archived, what it showed (file:<path>, view:<view>) and its title. Tabs archive themselves with the Tabs
setting archive_after (never, 12h, 24h, 7d, 30d); the user reopens them from the Archived tabs view or the quick switcher.

  vau tabs archived`,
  kind: "read",
  run: (_p, ctx) => ask(ctx, { action: "archived-tabs" }),
  text: (r: ArchivedReport) => r.archived.length ? r.archived.map((e) => `${e.id}  ${e.archived}  ${e.to}${e.title ? ` (${e.title})` : ""}`).join("\n") : "No archived tabs.",
})

plugin.op({
  id: "tabs.group",
  cli: "tabs group",
  summary: "Group tabs in the user's window (a new tab group, or into one), or name, colour or fold a group.",
  help: HELP,
  kind: "write",
  params: {
    tabs: { type: "array", items: { type: "string" }, description: "the tabs: ids (vau tabs), what they show, or files' paths or names" },
    group: { type: "string", description: "an existing group's id: add the tabs to it (or change it)" },
    name: { type: "string", description: "its name (empty: none, the chip is its colour)" },
    color: { type: "string", enum: COLORS, description: "its colour" },
    collapsed: { type: "boolean", description: "fold it to its name, or open it" },
  },
  args: ["tabs"],
  run: (p, ctx) => {
    if (!p.group && !p.tabs?.length) throw new OpError("say which tabs to group (or --group to change one)", 400)
    return ask(ctx, { do: "group", ...p })
  },
  text: (r) => `Group ${groupLine({ ...r.group, tabs: r.group.tabs.length })}: ${r.group.tabs.map((t: ReportTab) => t.to).join(", ")}.`,
  did: (p) => ({ action: "ui", text: p.group ? `Changed tab group ${p.group}` : `Grouped ${p.tabs?.length ?? 0} tab(s)${p.name ? ` as "${p.name}"` : ""}` }),
})

plugin.op({
  id: "tabs.ungroup",
  cli: "tabs ungroup",
  summary: "Ungroup a tab group in the user's window (its tabs stay), or take tabs out of theirs.",
  help: HELP,
  kind: "write",
  params: {
    tabs: { type: "array", items: { type: "string" }, description: "tabs to take out of their groups" },
    group: { type: "string", description: "the group to ungroup" },
  },
  args: ["tabs"],
  run: (p, ctx) => {
    if (!p.group && !p.tabs?.length) throw new OpError("say which group (--group) or which tabs", 400)
    return ask(ctx, { do: "ungroup", ...p })
  },
  text: (r) => (r.ungrouped ? `Ungrouped ${r.ungrouped}.` : `Took ${r.removed.length} tab(s) out of their groups.`),
})
