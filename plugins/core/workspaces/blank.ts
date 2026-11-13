type Obj = Record<string, unknown>

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

export function isBlank(d: unknown, defaultSidebars: (sidebars: unknown) => boolean): boolean {
  if (!d || typeof d !== "object" || Array.isArray(d)) return true
  const w = d as Obj
  if (["name", "icon", "tint", "container"].some((k) => typeof w[k] === "string" && (w[k] as string).trim())) return false
  if (Array.isArray(w.pinned)) return false
  return blankLayout(w.layout) && defaultSidebars(w.sidebars)
}
