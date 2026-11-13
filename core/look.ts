export const LOOK = {
  theme: "system" as "system" | "light" | "dark", scheme: "gruvbox", density: "compact" as "compact" | "comfortable", animation: "natural" as "snappy" | "natural" | "off",
  sidebarScroll: "panels" as "panels" | "sidebar", panelDividers: false, panelHeadings: "shown" as "shown" | "quiet", quickTextSize: false, interfaceFont: "", textFont: "", monoFont: "",
  snippets: [] as string[], fileIcons: true, tabBar: true, paneTabBars: true, dimPanes: true, paneCards: false, rails: true, peekShade: false, sidebarButtons: false, lineNumbers: false,
  fileBarFade: "off" as "off" | "typing" | "always", translucent: false, translucentPages: false, translucency: 50, pageTranslucency: 50,
  statusBar: null as string[] | null, statusBarMore: [] as string[], statusBarLeft: null as string[] | null, fileBar: null as string[] | null, fileBarHidden: [] as string[], sidebarHeader: null as string[] | null, pullActions: null as string[] | null,
}
export const LOOK_KEYS = Object.keys(LOOK) as (keyof typeof LOOK)[]
/** Only a bundle about looks sets these; a layout leaves them as they are. */
export const PERSONAL_LOOK: readonly (keyof typeof LOOK)[] = ["theme", "scheme", "interfaceFont", "textFont", "monoFont", "animation", "quickTextSize",
  "translucent", "translucentPages", "translucency", "pageTranslucency"]
