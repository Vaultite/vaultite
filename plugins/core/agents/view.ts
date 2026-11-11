// How the Agents panel and tab list their agents, as the user set it (the settings `group`, `sort`, `hide`); the menu
// that sets them is menu.ts, loaded when it opens.
import type { MouseEvent } from "react"
import { pluginSettings, type AgentRun } from "@vaultite"

export type Group = "none" | "state" | "project" | "machine" | "account"
export type Sort = "status" | "recent"
type Settings = { group?: Group; sort?: Sort; hide?: AgentRun["kind"][]; fold?: string }
export const settings = pluginSettings<Settings>("agents")
export const inbox = pluginSettings<{ muted?: string[] }>("inbox")

export const GROUPS: { id: Group; label: string }[] = [
  { id: "none", label: "None" }, { id: "state", label: "State" }, { id: "project", label: "Repository" }, { id: "machine", label: "Machine" }, { id: "account", label: "Account" },
]
export const SORTS: { id: Sort; label: string }[] = [{ id: "status", label: "Status" }, { id: "recent", label: "Recent" }]

/** The grouping, order and kinds left out, as set. */
export function useView() {
  const s = settings.use()
  return { group: GROUPS.some((g) => g.id === s.group) ? s.group! : "none" as Group, sort: s.sort === "recent" ? "recent" as Sort : "status" as Sort, hide: s.hide ?? [] }
}

/** The panel's view menu (menu.ts). */
export const viewMenu = (e: MouseEvent, kinds: { kind: AgentRun["kind"]; label: string }[]) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  void import("./menu").then((m) => m.viewMenu(r, kinds))
}
