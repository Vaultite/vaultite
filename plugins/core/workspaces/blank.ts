// What "unused" means for a workspace, for server and app alike: no name, pins or panels of its own and one blank tab
// (its `state` doesn't count). Unused is an empty slot: never kept in a file. No Node, no app imports.

type Obj = Record<string, unknown>

/** Tabs that are nothing yet: none, or a single pane with a single blank tab ("new"). */
export function blankLayout(layout: unknown): boolean {
  const root = (layout as Obj | null | undefined)?.root as Obj | undefined
  if (!root || typeof root !== "object") return true
  if (Array.isArray(root.kids)) return false
  const tabs = Array.isArray(root.tabs) ? root.tabs as Obj[] : []
  return tabs.length === 0 || (tabs.length === 1 && tabs[0]?.to === "new")
}

/** A workspace that's as good as an empty slot (null counts): no name, the tabs blank, and its sidebars the default
 *  (`defaultSidebars`: none of its own, or the same as .vaultite/sidebars.json's; each side compares them its way). */
export function isBlank(d: unknown, defaultSidebars: (sidebars: unknown) => boolean): boolean {
  if (!d || typeof d !== "object" || Array.isArray(d)) return true
  const w = d as Obj
  if (typeof w.name === "string" && w.name.trim()) return false
  if (Array.isArray(w.pinned)) return false
  return blankLayout(w.layout) && defaultSidebars(w.sidebars)
}
