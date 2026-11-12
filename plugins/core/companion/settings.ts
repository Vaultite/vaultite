import fs from "node:fs"
import { type AgentModels, agentName, findBin, KNOWN_AGENTS } from "../../../core/agents.ts"
import { joinPath, Kind, safeName } from "../../../core/vault.ts"
import { parseProfiles, type Profile, profileOf } from "./profiles.ts"
import { isPrivate, privateOf } from "./text.ts"
import { hostOf, siteIn } from "../../../core/desktop/places.ts"
import { voiceOps } from "./voice.ts"
import { type Guide, parseGuide } from "./guides.ts"
import { plugin } from "./self.ts"
import type { Mode, Moment } from "./types.ts"
import { broadcast, isMain } from "./state.ts"
import { session, runsOf } from "./alwayson.ts"

voiceOps(plugin, () => broadcast({ t: "voice" }))

// The user's guides to their apps and sites (guides.ts): one loads with a summoned ask there.
plugin.kind(new Kind({
  type: "guide", collection: "guides", folder: "Guides", label: "Guides",
  parse: parseGuide,
  render: (g) => [{ app: (g.app as string[] | undefined)?.length ? g.app : null, site: (g.site as string[] | undefined)?.length ? g.site : null }, String(g.body ?? "")],
  filename: (g, at) => joinPath(at.folder, safeName(String(g.title || "Guide"))),
}))
export const guides = () => plugin.vault.shared("guides") as unknown as readonly Guide[]
export const TINTS = ["orange", "blue", "purple", "green", "red", "yellow"]
export const EMOJI: Record<string, string> = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" }
export const KEEP = 300, SAY_MS = 12_000, HIGHLIGHT_MS = 10_000, EDIT_WAIT = 10_000, SAVED_MS = 3000
/** How long a bubble shows: longer the more it says, as reading takes. */
export const sayMs = (text: string) => Math.min(45_000, SAY_MS + Math.max(0, text.split(/\s+/).length - 20) * 300)
/** Whether a moment wakes its agent: an open, a bubble dismissed or its words moved by the user ride along with the next. */
export const wakes = (m: Pick<Moment, "kind" | "bubble">) => m.kind !== "open" && m.kind !== "move" && !(m.kind === "dismiss" && m.bubble)

export const str = (v: unknown) => (typeof v === "string" ? v : "")
/** A setting, else its manifest's default. */
export const setting = (key: string) => str(plugin.settings()[key]).trim() || str(plugin.manifest.settings?.[key]?.default)
export const mode = (): Mode => {
  const m = plugin.settings().mode
  return m === "off" || m === "pair" ? m : "quiet"
}
export const agentSetting = () => setting("agent") || "claude"
/** A note no agent sees: in a private folder (the setting), or marked so in its properties (`companion: private`). */
export function hidden(p: string) {
  if (isPrivate(p, "", privates().folders)) return true
  if (!/\.md$/i.test(p)) return false
  let head = ""
  try { const fd = fs.openSync(plugin.vault.abs(p), "r"), b = Buffer.alloc(4096); head = b.subarray(0, fs.readSync(fd, b, 0, 4096, 0)).toString("utf8"); fs.closeSync(fd) } catch { return false }
  return isPrivate(p, head, [])
}
/** What it never sees: folders, sites, the Browser's containers and apps (the helper keeps those), the setting's lines
 *  (else its starting list). */
export const privates = () => { const v = plugin.settings().private; return privateOf(Array.isArray(v) ? v : plugin.manifest.settings?.private?.default) }
/** A web page it never sees: on a private site, or in a private container. */
export const privatePage = (url: string, container?: string | null) => { const p = privates(); return siteIn(hostOf(url), p.sites) || (!!container && p.containers.includes(container)) }
/** What a session of `agent` runs: the model and effort given, else the settings; their defaults (Sonnet, medium) only
 *  for Claude Code, whose models they name. */
export function howOf(agent: string, model = "", effort = "") {
  const claude = agent.split("_")[0] === "claude", own = (k: string) => (claude ? setting(k) : str(plugin.settings()[k]).trim())
  return { model: model || own("model"), effort: effort || own("effort") }
}
/** The configured agent's name: the setting, else its own (claude: Claude). */
export const ownName = () => str(plugin.settings().name).trim() || nameOf(agentSetting())
export const nameOf = (agent: string) => {
  const base = agent.split("_")[0]
  return base === "claude" ? "Claude" : agentName(base) ?? base.charAt(0).toUpperCase() + base.slice(1)
}
/** The names that pick an agent: the manifest's, then the user's lines. */
export const profiles = () => parseProfiles([plugin.manifest.settings?.profiles?.default, plugin.settings().profiles].flatMap((v) => (Array.isArray(v) ? v : [])))
/** A profile's agent in the companion's account (claude_work) when it's the same agent. */
export const inAccount = (agent: string) => (agent && agent === agentSetting().split("_")[0] ? agentSetting() : agent)
/** What agent `name` runs, filled in where it isn't told: as its last session did (started again), else its profile
 *  (its name's first part), else the settings. */
export function howFor(name: string, agent = "", model = "", effort = "") {
  const kept = isMain(name) ? null : session(name), ran = kept ? runsOf(kept) : ""
  let base: Partial<Profile> = ran ? { agent: ran, model: kept!.model, effort: kept!.effort } : isMain(name) ? {} : profileOf(name, profiles()) ?? {}
  if (agent && agent !== base.agent) base = {}
  const runs = agent || inAccount(base.agent ?? "") || agentSetting()
  return { agent: runs, ...howOf(runs, model || base.model, effort || base.effort) }
}
/** Programs whose name isn't their agent's. */
const BIN: Record<string, string> = { cursor: "cursor-agent" }
let found: { t: number; off: string; list: { id: string; name: string; installed: boolean; models: AgentModels["models"]; efforts: string[] }[] } | null = null
/** The coding agents a plugin that's on runs, whether they're installed here, and their models. */
export function harnesses() {
  const off = [...plugin.vault.switchedOff()].join()
  if (found && found.off === off && Date.now() - found.t < 60_000) return found.list
  const list = KNOWN_AGENTS.flatMap((a) => {
    const id = a.terminal ?? a.id
    if (typeof plugin.service(`agent:${id}`) !== "function") return []
    let m: AgentModels | null = null
    try { m = plugin.service(`agent-models:${id}`)?.() ?? null } catch { /* none */ }
    return [{ id, name: a.name, installed: !!findBin(BIN[id] ?? id), models: m?.models ?? [], efforts: m?.efforts ?? [] }]
  })
  found = { t: Date.now(), off, list }
  return list
}
