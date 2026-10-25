// The pages agents are at work in, as the desktop app tells them (electron/browser/agent.ts): an agent's own (in the
// background, no tab, or opened as one) and the user's tabs an agent acted in lately.
import { cell, closeTab, notifyError, openInSet, selectTab, viewsChanged, webPages } from "@vaultite"
import { argOf, containerOfProfile } from "./containers"

export type AgentPage = { id: number; tab: string; url: string; title: string; profile: string; by: string; task: string; summary: string
  /** Its tab group's name when it's opened as a tab: "<agent>/<task>". */
  group: string
  /** What the agent is doing there now, and since when. */
  what: string; at: number | null
  /** The agent opened it (else it's the user's tab). */
  own: boolean
  paused: boolean; asking: string | null }

export const agentPages = cell<AgentPage[]>([])
export function setAgentPages(list: AgentPage[]) {
  agentPages.set(list)
  viewsChanged() // (tabs' marks)
}
export const agentPage = (id: number) => agentPages.get().find((p) => p.id === id)
export const agentPageOfTab = (tab: string) => (tab ? agentPages.get().find((p) => p.tab === tab) : undefined)
/** Its agent and task, as its tab group is named. */
export const whoOf = (p: Pick<AgentPage, "by" | "task">) => [p.by, p.task].filter(Boolean).join("/")
/** An agent did something there this recently: it's at work now. */
export const WORKING_MS = 8000
export const working = (p: AgentPage, now = Date.now()) => !!p.at && now - p.at < WORKING_MS && !p.paused

const engine = (name: string, ...args: unknown[]) => Promise.resolve(webPages?.engine?.(name, ...args))

/** Open as tab: the same page joins the user's tabs, in its agent's tab group (the user's pick: in their pane, as a new
 *  tab; an ask's: beside it, their work staying in sight); shown. */
export async function openAsTab(p: Pick<AgentPage, "id" | "tab" | "url" | "profile" | "group">, here = true) {
  if (p.tab) { selectTab(p.tab); return }
  const tab = openInSet(`view:web/${argOf(p.url, containerOfProfile(p.profile))}`, p.group, here)
  try { await engine("agents:own", p.id, tab) } catch (e) { closeTab(tab, true); notifyError(e, "Couldn't open the page as a tab"); return }
  selectTab(tab)
}
/** Back to the background: its tab closes, the page goes on there. */
export async function toBackground(p: AgentPage) {
  const tab = p.tab
  try { await engine("agents:own", p.id, "") } catch (e) { notifyError(e, "Couldn't move the page to the background"); return }
  if (tab) closeTab(tab, true)
}
export const pauseAgents = (id: number, on: boolean) => engine("agents:pause", id, on).catch((e) => notifyError(e, on ? "Couldn't pause it" : "Couldn't resume it"))
export const doneAsk = (id: number) => engine("agents:helped", id).catch((e) => notifyError(e, "Couldn't tell the agent"))
export const closeAgentPage = (id: number) => engine("agents:end", id).catch((e) => notifyError(e, "Couldn't close the page"))
