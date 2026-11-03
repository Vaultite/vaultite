// What "unused" means for a workspace, for server and app alike: no name, look, pins or panels of its own and one blank
// tab (its `state` doesn't count). Unused is an empty slot: never kept in a file. No Node, no app imports.

type Obj = Record<string, unknown>

/** Tabs that are nothing yet: none, or one tab of one blank pane ("new"), and no pop-out. A layout from before tabs
 *  held panes (`root`: groups of tabs) reads as it did: one group with at most a blank tab. */
export function blankLayout(layout: unknown): boolean {
  const l = layout as Obj | null | undefined
  if (!l || typeof l !== "object") return true
  if (!Array.isArray(l.tabs)) {
    const root = l.root as Obj | undefined
    if (!root || typeof root !== "object") return true
    const tabs = Array.isArray(root.tabs) ? root.tabs as Obj[] : []
    return !Array.isArray(root.kids) && (tabs.length === 0 || (tabs.length === 1 && tabs[0]?.to === "new"))
  }
  if (Array.isArray(l.windows) && l.windows.length) return false
  const tabs = l.tabs as Obj[], root = tabs[0]?.root as Obj | undefined
  return tabs.length === 0 || (tabs.length === 1 && !!root && !Array.isArray(root.kids) && root.to === "new")
}

/** A workspace that's as good as an empty slot (null counts): no name, icon, tint or container, the tabs blank, and its
 *  sidebars the default (`defaultSidebars`: none of its own, or sidebars.json's; each side compares them its way). */
export function isBlank(d: unknown, defaultSidebars: (sidebars: unknown) => boolean): boolean {
  if (!d || typeof d !== "object" || Array.isArray(d)) return true
  const w = d as Obj
  if (["name", "icon", "tint", "container"].some((k) => typeof w[k] === "string" && (w[k] as string).trim())) return false
  if (Array.isArray(w.pinned)) return false
  return blankLayout(w.layout) && defaultSidebars(w.sidebars)
}
