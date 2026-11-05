// What a bundle's plan changes, named as Settings names it: for its preview (pages/Bundles.tsx) and a layout's tile
// (components/LayoutPicker.tsx), which says what changed.
import { EDITOR } from "../../../core/editor.ts"
import { pluginById } from "@/core/plugins"
import { EDITING_MODES, NOTE_VIEWS, PROPERTIES_SHOWN } from "@/core/editorPrefs"

export const stem = (p: string) => p.split("/").pop()!.replace(/\.(md|base|canvas|html|csv)$/, "")

/** Plugins by id, named ("Tasks and Kanban"): those not installed yet by their id. */
export const AND = new Intl.ListFormat("en", { type: "conjunction" })
export const pluginName = (id: string) => pluginById(id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1)
export const listOf = (ids: string[]) => AND.format(ids.map(pluginName))

/** A change by its id (core/bundles.ts PlanChange), named for a tooltip's list: "Colour scheme", "Books". */
export function changeName(id: string) {
  const [part, ...rest] = id.split(":"), what = rest.join(":")
  if (part === "install") return `Install ${pluginName(what)}`
  if (part === "plugin") return pluginName(what)
  if (part === "setting") { const [pid, ...k] = what.split("."), key = k.join("."); return `${pluginName(pid)}: ${pluginById(pid)?.settingsDecls?.[key]?.label ?? key}` }
  if (part === "panels") return "Sidebar panels"
  if (part === "file") return stem(what)
  if (part === "pin") return `Pin ${stem(what)}`
  if (part === "pins") return "Order of pinned pages"
  if (part === "appearance") return APPEARANCE[what] ?? what
  if (part === "editor") return EDITOR_NAMES[what] ?? what
  if (part === "newtab") return NEWTAB[what] ?? `New tab: ${what}`
  return part === "hotkey" ? `Hotkey ${what}` : id
}
export const fewOf = (names: string[]) => (names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : AND.format(names))

/** The editor's settings as Settings names them. */
export const EDITOR_NAMES: Record<string, string> = {
  propertiesInDocument: "Properties in document", showInlineTitle: "Show inline title", readableLineLength: "Readable line length", spellcheck: "Spellcheck",
  autoPairBrackets: "Auto-pair brackets", autoPairMarkdown: "Auto-pair Markdown", useTab: "Indent with tabs", tabSize: "Tab size",
  defaultView: "Default view for new tabs", editingMode: "Default editing mode",
}
export const EDITOR_VALUES: Record<string, unknown> = EDITOR
/** What a new tab opens, as Settings names it (opensChoices). */
export const OPENS: Record<string, string> = { switcher: "Quick switcher", "view:web": "Web page" }
const labelsOf = (xs: { value: string; label: string }[]) => Object.fromEntries(xs.map((x) => [x.value, x.label]))
export const EDITOR_LABELS: Record<string, Record<string, string>> = { propertiesInDocument: labelsOf(PROPERTIES_SHOWN), defaultView: labelsOf(NOTE_VIEWS), editingMode: labelsOf(EDITING_MODES) }
export const NEWTAB: Record<string, string> = { page: "New tab's page", sections: "New tab's sections", actions: "New tab's buttons", icons: "New tab's button icons", opens: "New tabs open" }
export const APPEARANCE: Record<string, string> = {
  theme: "Theme", scheme: "Colour scheme", density: "Density", animation: "Animations", fileIcons: "File icons", tabBar: "Tab bar", paneTabBars: "Pane tab bars", dimPanes: "Dim inactive panes", paneCards: "Panes as cards", rails: "Sidebar rails", peekShade: "Dim the page behind a sidebar", sidebarButtons: "Sidebar buttons on phones", fileBarFade: "Fade the file bar", translucent: "Translucent window", translucentPages: "Translucent pages", translucency: "Window transparency", pageTranslucency: "Page transparency", lineNumbers: "Line numbers", statusBar: "Status bar", statusBarMore: "Status bar tray", statusBarLeft: "Status bar left corner", fileBar: "File top bar", sidebarHeader: "Sidebar header", pullActions: "Pull-down actions", sidebarScroll: "Sidebar scrolling", panelDividers: "Lines between sidebar panels", quickTextSize: "Quick text size",
  interfaceFont: "Interface font", textFont: "Text font", monoFont: "Monospace font", snippets: "CSS snippets",
}
