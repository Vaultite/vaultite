import { announceAgent, cell, closePane, notifyError, openInGroup, selectPane, viewsChanged } from "@vaultite"
import { argOf, containerOfProfile } from "./containers"
import { engine } from "./engine"

export type AgentPage = { id: number; tab: string; url: string; title: string; profile: string; by: string; task: string; summary: string
  group: string
  what: string; at: number | null
  own: boolean
  paused: boolean; asking: string | null
  held: boolean; taken: boolean }

export const agentPages = cell<AgentPage[]>([])
export function setAgentPages(list: AgentPage[]) {
  const was = new Map(agentPages.get().map((p) => [p.id, p]))
  for (const p of list) { const b = was.get(p.id); if (b) announceAgent(p.by || "An agent", b.asking ? "waiting" : "working", p.asking ? "waiting" : "working") }
  agentPages.set(list)
  viewsChanged()
}
export const agentPage = (id: number) => agentPages.get().find((p) => p.id === id)
export const agentPageOfTab = (tab: string) => (tab ? agentPages.get().find((p) => p.tab === tab) : undefined)
export const whoOf = (p: Pick<AgentPage, "by" | "task">) => [p.by, p.task].filter(Boolean).join("/")
export const WORKING_MS = 8000
export const working = (p: AgentPage, now = Date.now()) => !!p.at && now - p.at < WORKING_MS && !p.paused


export async function openAsTab(p: Pick<AgentPage, "id" | "tab" | "url" | "profile" | "group">, here = true) {
  if (p.tab) { selectPane(p.tab); return }
  const tab = openInGroup(`view:web/${argOf(p.url, containerOfProfile(p.profile))}`, p.group, !here)
  try { await engine("agents:own", p.id, tab) } catch (e) { closePane(tab, true); notifyError(e, "Couldn't open the page as a tab"); return }
  selectPane(tab)
}
export async function toBackground(p: AgentPage) {
  const tab = p.tab
  try { await engine("agents:own", p.id, "") } catch (e) { notifyError(e, "Couldn't move the page to the background"); return }
  if (tab) closePane(tab, true)
}
export const pauseAgents = (id: number, on: boolean) => engine("agents:pause", id, on).catch((e) => notifyError(e, on ? "Couldn't pause it" : "Couldn't resume it"))
export const takeOver = (id: number, on: boolean) => engine("agents:take", id, on).catch((e) => notifyError(e, on ? "Couldn't take it over" : "Couldn't give it back"))
export const doneAsk = (id: number) => engine("agents:helped", id).catch((e) => notifyError(e, "Couldn't tell the agent"))
export const closeAgentPage = (id: number) => engine("agents:end", id).catch((e) => notifyError(e, "Couldn't close the page"))
