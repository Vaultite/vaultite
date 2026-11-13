export type Obj = Record<string, unknown>
export const isObj = (x: unknown): x is Obj => !!x && typeof x === "object"

export function blankLayout(layout: unknown): boolean {
  if (!isObj(layout)) return true
  if (!Array.isArray(layout.tabs)) {
    const root = layout.root
    if (!isObj(root)) return true
    const tabs: unknown[] = Array.isArray(root.tabs) ? root.tabs : [], first = tabs[0]
    return !Array.isArray(root.kids) && (tabs.length === 0 || (tabs.length === 1 && isObj(first) && first.to === "new"))
  }
  if (Array.isArray(layout.windows) && layout.windows.length) return false
  const tabs: unknown[] = layout.tabs, first = tabs[0], root = isObj(first) ? first.root : undefined
  return tabs.length === 0 || (tabs.length === 1 && isObj(root) && !Array.isArray(root.kids) && root.to === "new")
}

export function isBlank(d: unknown, defaultSidebars: (sidebars: unknown) => boolean): boolean {
  if (!isObj(d) || Array.isArray(d)) return true
  if (["name", "icon", "tint", "container"].some((k) => { const v = d[k]; return typeof v === "string" && !!v.trim() })) return false
  if (Array.isArray(d.pinned)) return false
  return blankLayout(d.layout) && defaultSidebars(d.sidebars)
}
