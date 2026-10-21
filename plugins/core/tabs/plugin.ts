// Tabs: what each device has open, a file per device (device-<id>.json, so devices never write the same file), for the
// Tabs panel; terminal tabs saved with their machine (`@<machine>`), like Workspaces'.
import fs from "node:fs"
import path from "node:path"
import { COLORS, HTTPError, type OpCtx, OpError, Plugin, type Request } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

/** A device and its tabs (types.ts has them for the app). */
type DeviceTab = { to: string; label?: string; pinned?: boolean }
type Device = { id: string; name: string; kind: "desktop" | "phone" | "web"; at: string; tabs: DeviceTab[] }

const ID = /^[a-z0-9]{8,32}$/
const TERM = "view:terminal/"
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
    out.push({ to, ...(typeof t.label === "string" && t.label ? { label: t.label } : {}), ...(t.pinned === true ? { pinned: true } : {}) })
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
