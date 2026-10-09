// Coding agents in terminal tabs (the Terminal plugin runs them; a plugin brings one with `agents` in its definition
// and the service "agent:<name>" in its backend): open a new session, or resume one in the folder it ran in.
import { SquareTerminal } from "lucide-react"
import { choose } from "@/components/Chooser"
import { get } from "@/core/http"
import { isViewOpen, openView } from "@/core/files"
import { fetchMachines, machinePath, onMachine, otherMachines, type Machine } from "@/core/machines"
import { notify } from "@/core/notify"
import { agentsOn, isEnabled, type Agent } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { currentWorkspace, scopedState, useScopedState } from "@/core/scope"
import { agentIn, newTerminalId, resumeTerminalId } from "../../../core/terminalids.ts"

/** The ids made on this page: their tabs start their session (an agent); any other tab only attaches (mintedHere). */
const minted = new Set<string>()
/** A new terminal session id: 8 letters and digits. */
export function terminalId() {
  const id = newTerminalId()
  minted.add(id)
  return id
}
/** Whether this page made terminal `id` ("claude-k3j2h1g0@studio" too) just now, so its tab may start it:
 *  a tab put back (a reload, the app reopened, another device) only attaches, and never starts an agent by itself. */
export const mintedHere = (id: string) => minted.has(id.replace(/@.*$/, "").split("-").pop() ?? "")

/** Whether agents can run here: the Terminal plugin is on. */
export const canRunAgents = () => isEnabled("terminal", getPrefs().disabled)

// ---------- where new ones open, per workspace ----------
/** Where new terminals and agents open in the current workspace when none is asked for (and where Dispatch runs): a
 *  machine (none: this one) and an account per agent (none: its own default). */
export type DefaultPlace = { machine?: string; accounts?: Record<string, string> }
const NOWHERE: DefaultPlace = {}
const placeState = scopedState<DefaultPlace>("core:place", NOWHERE)
export const getDefaultPlace = () => placeState.get()
export const useDefaultPlace = () => useScopedState("core:place", NOWHERE)[0]

/** The current workspace's default for agent `agent` (null: a shell), as ids: "" is this machine (also when the default
 *  names this one), and the agent's own account. */
export function defaultPlaceOf(agent: string | null, machines: Machine[] | null, h = getDefaultPlace()) {
  const machine = h.machine && !machines?.find((m) => m.id === h.machine)?.self ? h.machine : ""
  return { machine, profile: (agent && h.accounts?.[agent]) || "" }
}

/** Make machine `machine` ("": this one) the current workspace's default, and `profile` agent `agent`'s account there. */
export function setDefaultPlace(agent: string | null, machine: string, profile = "") {
  const h = getDefaultPlace(), accounts = { ...h.accounts }
  if (agent) { if (profile) accounts[agent] = profile; else delete accounts[agent] }
  const next: DefaultPlace = { ...(machine ? { machine } : {}), ...(Object.keys(accounts).length ? { accounts } : {}) }
  placeState.set(Object.keys(next).length ? next : undefined)
}

/** Where a new one opens: what's asked (machine "" is this one), else the workspace's default. A default machine that's
 *  offline, or doesn't run terminals (or the agent's plugin), gives way to this one: `instead` says why. */
export async function resolvePlace(agent: string | null, asked: { machine?: string | null; profile?: string | null } = {}) {
  const h = getDefaultPlace()
  let machine = asked.machine ?? undefined, instead = ""
  if (machine === undefined && h.machine) {
    const ms = await fetchMachines(), m = ms.find((x) => x.id === h.machine)
    const plugin = agent ? agentsOn().find((a) => a.name === agent)?.plugin : undefined
    if (m?.self || !ms.length) machine = ""
    else if (m?.online && m.plugins?.includes("terminal") && (!plugin || m.plugins.includes(plugin))) machine = m.id
    else { machine = ""; instead = `${m?.label ?? h.machine} ${m?.online ? "doesn't run it" : "is offline"}` }
  }
  return { machine: machine ?? "", profile: asked.profile ?? (agent ? h.accounts?.[agent] ?? "" : ""), instead }
}

/** Open agent `name` in a terminal tab, new or `resume` (a session id, in the tab that has it). `machine`: on another
 *  machine ("": this one); `profile`: in one of its accounts; either left out: the workspace's default (resolvePlace). */
export async function openAgent(name: string, opts: { resume?: string; split?: boolean; newTab?: boolean; machine?: string | null; profile?: string | null } = {}) {
  if (opts.resume) {
    const to = `terminal/${onMachine(resumeTerminalId(name, opts.resume), opts.machine)}`
    return openView(to, { newTab: opts.newTab ?? !isViewOpen(to), split: opts.split })
  }
  const { machine, profile, instead } = await resolvePlace(name, opts)
  if (instead) notify(`${instead}: opened on this machine`)
  const id = `${agentIn(name, profile)}-${terminalId()}`
  return openView(`terminal/${onMachine(id, machine)}`, { newTab: !opts.split, split: opts.split })
}

/** Open a plain terminal: on `machine` ("": this one), else the workspace's default. */
export async function openTerminal(opts: { machine?: string | null; split?: boolean } = {}) {
  const { machine, instead } = await resolvePlace(null, opts)
  if (instead) notify(`${instead}: opened on this machine`)
  return openView(`terminal/${onMachine(terminalId(), machine)}`, { newTab: !opts.split, split: opts.split })
}

/** A place to open a terminal or an agent: which machine ("": this one) and, for an agent with accounts, which one. */
export type Place = { agent: Agent | null; machine: string; machineLabel: string; profile: string; profileLabel: string }

/** Every place: a terminal, then each agent that's on (in each of its accounts), on this machine and on each other one
 *  that's online with the Terminal plugin on (and the agent's plugin, for an agent). */
export async function places(): Promise<Place[]> {
  const ms = await fetchMachines()
  const where = [{ machine: "", label: ms.find((m) => m.self)?.label ?? "This machine", plugins: null as string[] | null },
    ...otherMachines(ms, "terminal").map((m) => ({ machine: m.id, label: m.label, plugins: m.plugins ?? [] }))]
  const agents = agentsOn()
  const out: Place[] = []
  await Promise.all(where.map(async (w) => {
    const here: Place[] = [{ agent: null, machine: w.machine, machineLabel: w.label, profile: "", profileLabel: "" }]
    for (const a of agents) {
      if (w.plugins && !w.plugins.includes(a.plugin)) continue
      let accts: { id: string; label: string }[] = []
      if (a.accounts) try { accts = await get<{ id: string; label: string }[]>(machinePath(w.machine, a.accounts)) } catch { /* none */ }
      if (accts.length > 1) for (const x of accts) here.push({ agent: a, machine: w.machine, machineLabel: w.label, profile: x.id, profileLabel: x.label })
      else here.push({ agent: a, machine: w.machine, machineLabel: w.label, profile: "", profileLabel: "" })
    }
    out.push(...here)
  }))
  const order = where.map((w) => w.machine)
  return out.sort((a, b) => order.indexOf(a.machine) - order.indexOf(b.machine))
}

/** Open what a place says. */
export function openPlace(p: Place, opts: { split?: boolean } = {}) {
  return p.agent ? openAgent(p.agent.name, { machine: p.machine, profile: p.profile, split: opts.split }) : openTerminal({ machine: p.machine, split: opts.split })
}

/** Choose where to open a terminal or an agent (`agent`: only that one's places), then open it. */
export async function choosePlace(opts: { agent?: string; split?: boolean } = {}) {
  const all = (await places()).filter((p) => !opts.agent || p.agent?.name === opts.agent)
  choose({
    title: opts.agent ? "Open an agent" : "Open a terminal or an agent", placeholder: "Where to open it…",
    items: all.map((p, i) => ({ id: String(i), label: [p.agent?.label ?? "Terminal", p.profileLabel].filter(Boolean).join(" · "), detail: p.machineLabel, icon: p.agent?.icon ?? SquareTerminal })),
    onPick: (it) => { const p = all[Number(it.id)]; if (p) openPlace(p, opts) },
  })
}

/** Choose where new terminals and agents open in the current workspace: a machine, and the agent's account there. */
export async function chooseDefaultPlace() {
  const all = await places(), ms = await fetchMachines()
  const h = getDefaultPlace(), desk = currentWorkspace()
  const isDefault = (p: Place) => {
    const at = defaultPlaceOf(p.agent?.name ?? null, ms, h)
    // (an agent's bare name runs its account "default")
    return p.machine === at.machine && (!p.agent || !p.profile || p.profile === (at.profile || "default"))
  }
  choose({
    title: desk ? `Default in ${desk.label}` : "Default", placeholder: "Where new terminals and agents open…",
    items: all.map((p, i) => ({ id: String(i), label: [p.agent?.label ?? "Terminal", p.profileLabel].filter(Boolean).join(" · "),
      detail: `${p.machineLabel}${isDefault(p) ? " · default" : ""}`, icon: p.agent?.icon ?? SquareTerminal })),
    onPick: (it) => { const p = all[Number(it.id)]; if (p) setDefaultPlace(p.agent?.name ?? null, p.machine, p.profile) },
  })
}
