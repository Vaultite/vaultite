import os from "node:os"
import { z } from "zod"
import { agentModel, agentName, KNOWN_AGENTS, parseTerminal } from "../../../core/agents.ts"
import { inDesktop, type Machine, OpError, type Plugin } from "../../../core/plugins.ts"
import { type Handoff, type ProofMode, str } from "./jobs.ts"
import type { workerLinks } from "./links.ts"
import { capOf, CLOUD, type Needs, place, type Traits } from "./placement.ts"
import { Checkout, checkoutCards } from "./checkouts.ts"
import { checkoutNames } from "./where.ts"

export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const Capacity = z.object({ jobs: z.number(), cap: z.number(), repos: z.array(z.string()).optional(), agents: z.array(z.string()).optional(),
  accounts: z.array(z.string()).optional(), checkouts: z.array(Checkout).optional() })

export function jobMachines(plugin: Plugin, links: ReturnType<typeof workerLinks>) {
  const setting = (k: string) => str(plugin.settings()[k]).trim() || str(plugin.manifest.settings?.[k]?.default)
  const atMachine = links.atMachine
  async function machines() { return await plugin.ask<Machine[]>("machines", []) }
  async function away(machine: string, e: unknown) {
    if (!machine || !(e instanceof OpError) || e.status !== 502) return false
    const m = await plugin.ask<Machine | null>("machines:machine", null, machine).catch(() => null)
    return !!m && !m.self && !m.online
  }
  const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
  async function labelOf(machine: string) {
    const id = machine || await plugin.ask<string>("machines:self", "")
    const m = id ? await plugin.ask<Machine | null>("machines:machine", null, id) : null
    return m?.label ?? (machine || os.hostname().replace(/\.local$/, ""))
  }

  async function capacity() {
    const set = Number(plugin.settings().jobs_cap) || 0
    const agents = [...new Set(KNOWN_AGENTS.map((a) => a.terminal ?? a.id))].filter((a) => typeof plugin.service(`agent:${a}`) === "function")
    const accounts = await plugin.ask<string[] | null>("agent-accounts:claude", null).catch(() => null)
    return { jobs: await links.running(), cap: set > 0 ? Math.round(set) : capOf(os.cpus().length, os.totalmem() / 1048576), repos: checkoutNames(), checkouts: checkoutCards(), agents, ...(accounts ? { accounts } : {}) }
  }
  async function traitsOf(): Promise<Traits[]> {
    const vault = await plugin.ask<string>("machines:vault", ""), all = (await machines()).filter((m) => m.self || m.plugins?.includes("companion"))
    const out = await Promise.all(all.map(async (m): Promise<Traits> => {
      const c = m.self ? await capacity() : m.online ? Capacity.safeParse(await atMachine(m.id, "companion.capacity", {}, 4).catch(() => null)).data ?? null : null
      return { id: m.id, label: m.label, self: m.self, online: m.online, standalone: !!m.standalone, platform: m.self ? process.platform : m.platform, vault: m.self || (!!vault && m.vault === vault),
        app: !!m.desktop, ...(m.display !== undefined ? { display: m.display } : {}), ...(m.cores ? { cores: m.cores } : {}), ...(m.load !== undefined ? { load: m.load } : {}),
        ...(m.memory ? { memory: m.memory } : {}), ...(c ? { jobs: c.jobs, cap: c.cap, ...(m.self ? {} : { repos: c.repos }), agents: c.agents, ...(c.accounts ? { accounts: c.accounts } : {}) } : {}),
        ...(!m.self && m.online && !c ? { away: "doesn't say what jobs it takes (an older Vaultite, or its companion is off)" } : {}) }
    }))
    if (!out.some((t) => t.self)) {
      const c = await capacity()
      out.unshift({ id: "here", label: await labelOf(""), self: true, online: true, standalone: !inDesktop(), platform: process.platform, vault: true, app: inDesktop(), ...c, repos: undefined })
    }
    const account = cloudAccount()
    if (account && !out.some((t) => t.id === CLOUD)) {
      const why = await plugin.ask<string>("cloud-ready:claude", "Claude Code's plugin is off", account)
      out.push({ id: CLOUD, label: "Cloud", self: false, online: true, standalone: false, cloud: true, platform: "linux", vault: false, display: false, app: false,
        agents: ["claude"], accounts: [account], ...(why ? { away: `can't start sessions: ${why}` } : {}) })
    }
    return out
  }
  const ranking = async (n: Needs) => place(await traitsOf(), n, plugin.settings().jobs_machine ?? plugin.manifest.settings?.jobs_machine?.default ?? "auto")
  const cloudAccount = () => setting("jobs_cloud").toLowerCase()
  const lands = () => plugin.settings().jobs_land === true
  const proofMode = (): ProofMode => { const v = plugin.settings().jobs_proof; return v === "always" || v === "never" ? v : "auto" }
  const jobsAgent = () => { const own = setting("jobs_agent") || "claude"; return own.split("_")[0] === "claude" ? own : "claude" }
  async function harnessOf(p: Handoff) {
    const asked = str(p.agent) || "claude", account = str(p.account).trim().toLowerCase()
    if (account && asked !== "claude") throw new OpError("account is Claude Code's: leave agent out (or claude) to pick one of its accounts")
    if (account && !/^[a-z0-9][\w.-]{0,40}$/.test(account)) throw new OpError(`'${account}' isn't an account's id: vau limits lists them (personal, agent...)`)
    const agent = account ? (account === "default" ? "claude" : `claude_${account}`) : asked === "claude" ? jobsAgent() : asked
    const claude = agent.split("_")[0] === "claude"
    const { id: model, label } = await agentModel(plugin, agent.split("_")[0], str(p.model) || (claude ? setting("jobs_model") : ""))
    const effort = str(p.effort) || (claude ? setting("jobs_effort") : ""), profile = parseTerminal(`${agent}-x`)?.profile ?? ""
    return { agent, account: profile ? cap(profile) : "", model, effort, harness: [agentName(agent.split("_")[0]) ?? cap(agent), cap(label)].filter(Boolean).join(" ") }
  }
  return { ...everyCheckout(machines, atMachine), setting, machines, away, hostOf, labelOf, capacity, traitsOf, ranking, cloudAccount, lands, proofMode, jobsAgent, harnessOf }
}
export type Machines = ReturnType<typeof jobMachines>

type Labelled = Checkout & { label: string }
function everyCheckout(machines: () => Promise<Machine[]>, atMachine: ReturnType<typeof workerLinks>["atMachine"]) {
  const seen = { at: 0 }
  let known: Labelled[] = []
  async function checkoutsAll(): Promise<Labelled[]> {
    const peers = (await machines()).filter((m) => !m.self && m.online && m.plugins?.includes("companion"))
    const far = await Promise.all(peers.map(async (m) => (Capacity.safeParse(await atMachine(m.id, "companion.capacity", {}, 4).catch(() => null)).data?.checkouts ?? []).map((c) => ({ ...c, label: m.label }))))
    known = [...checkoutCards().map((c) => ({ ...c, label: "" })), ...far.flat()]
    seen.at = Date.now()
    return known
  }
  const checkoutsKnown = () => { if (Date.now() - seen.at > 5 * 60_000) void checkoutsAll().catch(() => {}); return known }
  return { checkoutsAll, checkoutsKnown }
}
