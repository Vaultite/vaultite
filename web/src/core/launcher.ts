// A new tab (⌘T, the + buttons): a blank tab, or what newtab.json's `opens` says: the quick switcher as a launcher whose
// pick opens in a new tab (Escape: none, so no blank tab is left behind), or a view's tab (`view:web`: a web page).
import { runCommandById } from "@/core/commands"
import { openView } from "@/core/files"
import { active, viewFor } from "@/core/plugins"
import { getPrefs, setPrefs } from "@/core/prefs"
import { focusGroup, newTab } from "@/core/workspace"

/** Whether a new tab opens the quick switcher instead of a tab. */
export const opensSwitcher = () => getPrefs().newTab.opens === "switcher"

/** The views a new tab can be here (`asNewTab`), of the plugins that are on: their targets and names. */
export function newTabViews(disabled = getPrefs().disabled, order = getPrefs().order) {
  return active(disabled, order).flatMap((p) => Object.entries(p.views ?? {}).flatMap(([name, v]) =>
    v.asNewTab && v.asNewTab.here?.() !== false ? [{ target: `view:${name}`, label: v.asNewTab.label }] : []))
}

/** What a new tab can open, as Settings and a blank tab's menu offer it: its page (null), the switcher, the views. */
export const opensChoices = () => [{ value: null, label: "Page" }, { value: "switcher", label: "Quick switcher" },
  ...newTabViews().map((v) => ({ value: v.target, label: v.label }))] as { value: string | null; label: string }[]
/** Choose what a new tab opens (null: its page, the default). */
export const setOpens = (opens: string | null) => setPrefs({ newTab: { ...getPrefs().newTab, opens } })

/** `opens` as a view's tab that shows here, else null (its plugin off, a web page off the desktop app). */
function viewHere(opens: string | null) {
  if (!opens?.startsWith("view:")) return null
  const v = viewFor(opens, getPrefs().disabled)
  return v?.on && v.def.asNewTab?.here?.() !== false ? opens : null
}

/** A new tab in the focused pane (or `gid`'s: its tab bar's +): a blank one, or what newtab.json's `opens` says. */
export function openNewTab(gid?: string) {
  const { opens } = getPrefs().newTab, view = viewHere(opens)
  if (opens !== "switcher" && !view) return newTab(gid)
  if (gid) focusGroup(gid)
  if (view) openView(view, { another: true })
  else if (!runCommandById("switcher:new-tab")) newTab(gid)
}
