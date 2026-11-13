import { runCommandById } from "@/core/commands"
import { openView } from "@/core/files"
import { active, viewFor } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { newTab, newTabsAt, type TabsAt } from "@/core/workspace"
import { groupById, newTabInGroup } from "@/core/tabgroups"

export const opensSwitcher = () => getPrefs().newTab.opens === "switcher"

function newTabViews(disabled = getPrefs().disabled) {
  return active(disabled).flatMap((p) => Object.entries(p.views ?? {}).flatMap(([name, v]) =>
    v.asNewTab && v.asNewTab.here?.() !== false ? [{ target: `view:${name}`, label: v.asNewTab.label }] : []))
}

export const opensChoices = (): { value: string | null; label: string }[] => [{ value: null, label: "Page" }, { value: "switcher", label: "Quick switcher" },
  ...newTabViews().map((v) => ({ value: v.target, label: v.label }))]
export const setOpens = (opens: string | null) => setPrefs({ newTab: { ...getPrefs().newTab, opens } })

function viewHere(opens: string | null) {
  if (!opens?.startsWith("view:")) return null
  const v = viewFor(opens, getPrefs().disabled)
  return v?.on && v.def.asNewTab?.here?.() !== false ? opens : null
}

let launchAt: TabsAt
export const launcherAt = () => launchAt
export const launcherClosed = () => { launchAt = undefined }

/** A new tab (or at the end of tab group `group`, a phone's open one): a blank one, or newtab.json's `opens`. Past the
 *  tab on screen and its group, in none (⌘T), or `at` the list's end (a tab bar's +) or among the pane's (its strip's). */
export function openNewTab({ group, at: end }: { group?: string; at?: "end" | "pane" } = {}) {
  const { opens } = getPrefs().newTab, view = viewHere(opens), at: TabsAt = end ?? "new"
  if (group && !groupById(group)) group = undefined
  if (opens !== "switcher" && !view) return group ? newTabInGroup(group) : newTabsAt(at, () => newTab())
  if (view) return newTabsAt(at, () => openView(view, { another: true }))
  launchAt = at
  if (!runCommandById("switcher:new-tab")) { launchAt = undefined; newTabsAt(at, () => newTab()) }
}
