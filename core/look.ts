// The look: appearance.json's keys and their defaults, one list for the app (web/src/core/prefs.ts) and the server
// (core/bundles.ts: a bundle states every key, so applying one leaves nothing of the look before). No Node: both use it.
export const LOOK = {
  theme: "system" as "system" | "light" | "dark", scheme: "gruvbox", density: "compact" as "compact" | "comfortable",
  sidebarScroll: "panels" as "panels" | "sidebar", panelDividers: false, quickTextSize: false, interfaceFont: "", textFont: "", monoFont: "",
  snippets: [] as string[], fileIcons: true, tabBar: true, paneTitles: true, tabTint: false, rails: true, lineNumbers: false,
  statusBar: null as string[] | null, statusBarMore: [] as string[], fileBar: null as string[] | null, pullActions: null as string[] | null,
}
export const LOOK_KEYS = Object.keys(LOOK) as (keyof typeof LOOK)[]
