import { ArrowDownUp, Archive, Blend, Sparkles, BookOpenText, Brackets, Eye, Heading, Layers2, LayoutPanelLeft, Link2, LayoutPanelTop, ListOrdered, ListTree, MousePointer2, PanelLeft, PanelLeftDashed, PanelTop, SeparatorHorizontal, Shapes, SpellCheck, SunDim, WrapText } from "lucide-react"
import { setAi } from "@/core/ai"
import { canTranslucent, getTranslucency, onTranslucency } from "@/core/appearance"
import type { Command } from "@/core/commands"
import { getStore, reload } from "@/core/data"
import { linkStyle } from "@/core/links"
import { setWikilinks } from "@/core/linkstyle"
import { editorSet, editorSettings, setEditor, type EditorSettings } from "@/core/editorPrefs"
import { openDetail } from "@/core/nav"
import { notify, notifyError } from "@/core/notify"
import { pluginById, PLUGINS, setSwitch, switchedOn } from "@/core/plugins"
import { openPluginSettings, pluginSettings, revealRow, settingDefault, settingsApart, settingsHome, settingsShown } from "@/core/pluginSettings"
import { getPrefs, onPrefs, setPrefs, type Prefs } from "@/core/prefs"
import { signal } from "@/core/signal"
import { quickTextSizeSub } from "@/core/textsize"
import { isDesktop, isMac, keysText } from "@/core/platform"
import { openSettings } from "@/core/apppages"
import { capitalize } from "@/lib/utils"

export type SwitchDef = {
  id: string
  name: string
  sub?: () => string
  words?: string
  icon?: Command["icon"]
  section?: string
  plugin?: { id: string; key: string }
  get: () => boolean
  set: (on: boolean) => unknown
  reset?: { shown: () => boolean; run: () => void }
}

export const SECTIONS: Record<string, string> = { appearance: "Appearance", editor: "Editor", files: "Files", sidebars: "Sidebars", ai: "AI", terminal: "Terminal", plugins: "Plugins", about: "About" }

type Flag = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs]
const pref = (k: Flag) => ({ get: () => getPrefs()[k], set: (on: boolean) => setPrefs({ [k]: on }) })
type EditorFlag = { [K in keyof EditorSettings]: EditorSettings[K] extends boolean ? K : never }[keyof EditorSettings]
const editor = (k: EditorFlag) => ({
  section: "editor", get: () => editorSettings()[k], set: (on: boolean) => setEditor({ [k]: on }),
  reset: { shown: () => editorSet(k), run: () => void setEditor({ [k]: null }) },
})
const files = (k: "showHidden" | "showArchived" | "autoReveal", sub: string) => ({ plugin: { id: "files", key: k }, sub: () => sub, ...pref(k) })

const quietHeadingsSub = () => keysText("Panels' names show when you point at the space above one, or hold ⌥")

function translucentSub() {
  const { why } = getTranslucency()
  if (!canTranslucent || why === "system") return "In the desktop app on a Mac or Windows 11: the desktop shows through the sidebars and bars"
  if (why === "reduced") return isMac ? "Solid while Reduce transparency is on in System Settings" : "Solid while transparency effects are off in Windows' settings"
  if (why === "apps") return "Solid while a tab shows another app's window"
  if (why === "reopen") return "Shows once this window is opened again"
  return "The desktop shows through the sidebars and bars, blurred; pages stay solid"
}

// `id` and `name` first, literal: core/appsource.ts lists commands from the source.
const CORE: SwitchDef[] = [
  { id: "setting:ai", name: "Use AI", section: "ai", icon: Sparkles, sub: () => "Agents, the companion and AI apps",
    words: "artificial intelligence agents claude codex companion chatgpt llm no ai", get: () => getPrefs().ai, set: setAi },
  { id: "setting:file-icons", name: "File icons", section: "appearance", icon: Shapes, ...pref("fileIcons") },
  { id: "setting:tab-bar", name: "Tab bar", section: "appearance", icon: PanelTop, words: "tabs", ...pref("tabBar") },
  { id: "setting:pane-tab-bars", name: "Pane tab bars", section: "appearance", icon: LayoutPanelTop, sub: () => "Each pane of a split shows its own tabs above it", words: "tab bar title strip split zen", ...pref("paneTabBars") },
  { id: "setting:dim-panes", name: "Dim inactive panes", section: "appearance", icon: SunDim, sub: () => "With the window split, the panes you're not in fade a little", words: "fade focus splits active", ...pref("dimPanes") },
  { id: "setting:pane-cards", name: "Panes as cards", section: "appearance", icon: LayoutPanelLeft, sub: () => "Each pane an inset, rounded card, with room between them", words: "rounded corners gaps inset tiles splits floating", ...pref("paneCards") },
  { id: "setting:rails", name: "Sidebar rails", section: "sidebars", icon: PanelLeftDashed, sub: () => "Off, a hidden sidebar slides in when the pointer reaches the window's edge", words: "rail icons compact zen hover edge sidebars", ...pref("rails") },
  { id: "setting:peek-shade", name: "Dim the page behind a sidebar", section: "sidebars", icon: SunDim, sub: () => "With rails off, while a hidden sidebar is slid in", words: "darken shade focus zen backdrop", ...pref("peekShade") },
  { id: "setting:translucent", name: "Translucent window", section: "appearance", icon: Blend, sub: translucentSub, words: "transparent transparency vibrancy blur glass frosted mica see-through desktop", ...pref("translucent") },
  { id: "setting:translucent-pages", name: "Translucent pages", section: "appearance", icon: Layers2, sub: () => "Notes and terminals too, more lightly; web pages and media stay solid", words: "transparent transparency glass full notes terminal editor see-through",
    get: () => getPrefs().translucentPages, set: (on: boolean) => setPrefs(on ? { translucentPages: true, translucent: true } : { translucentPages: false }) },
  { id: "setting:line-numbers", name: "Line numbers", section: "appearance", icon: ListOrdered, words: "gutter", ...pref("lineNumbers") },
  { id: "setting:sidebar-buttons", name: "Sidebar buttons on phones", section: "sidebars", icon: PanelLeft, sub: () => "In the top bar; off, swipe in from the screen's edge. A phone's browser always shows them", words: "drawer swipe edge top bar header mobile iphone", ...pref("sidebarButtons") },
  { id: "setting:sidebar-scroll", name: "Scroll sidebar panels separately", section: "sidebars", icon: ArrowDownUp, words: "sidebars",
    get: () => getPrefs().sidebarScroll !== "sidebar", set: (on) => setPrefs({ sidebarScroll: on ? "panels" : "sidebar" }) },
  { id: "setting:panel-dividers", name: "Lines between sidebar panels", section: "sidebars", icon: SeparatorHorizontal, words: "dividers sidebars", ...pref("panelDividers") },
  { id: "setting:quiet-panel-headings", name: "Quiet panel headings", section: "sidebars", icon: Heading, sub: quietHeadingsSub,
    words: "panel names titles labels hide headings minimal clean sidebars hover",
    get: () => getPrefs().panelHeadings === "quiet", set: (on) => setPrefs({ panelHeadings: on ? "quiet" : "shown" }) },
  { id: "setting:quick-text-size", name: "Pinch to resize text", section: "appearance", icon: MousePointer2, sub: quickTextSizeSub,
    words: "font size text size zoom scroll wheel bigger smaller", ...pref("quickTextSize") },
  { id: "setting:readable-line-length", name: "Readable line length", icon: WrapText, words: "width wide column", ...editor("readableLineLength") },
  { id: "setting:show-inline-title", name: "Show inline title", icon: Heading, words: "title", ...editor("showInlineTitle") },
  { id: "setting:spellcheck", name: "Spellcheck", icon: SpellCheck, words: "spelling spell check", ...editor("spellcheck") },
  { id: "setting:auto-pair-brackets", name: "Auto-pair brackets", icon: Brackets, words: "close brackets quotes autopair", ...editor("autoPairBrackets") },
  { id: "setting:auto-pair-markdown", name: "Auto-pair Markdown", icon: BookOpenText, sub: () => "Typing * _ ~ = or ` over a selection wraps it", words: "wrap selection bold italic autopair", ...editor("autoPairMarkdown") },
  { id: "setting:show-hidden", name: "Show hidden files", icon: Eye, words: "dotfiles trash",
    ...files("showHidden", "Adds .vaultite (the app's settings, as files) and .trash (deleted files, which you can restore) to the file list"),
    set: (on) => setPrefs({ showHidden: on }).then(reload) },
  { id: "setting:show-archived", name: "Show archived files", icon: Archive,
    ...files("showArchived", "Adds the .archive folders archived files move into, dimmed (hidden files or not); without it, an archived file shows only while it's open") },
  { id: "setting:auto-reveal", name: "Reveal the open file", icon: ListTree, words: "auto-reveal current file tree",
    ...files("autoReveal", "Opens its folders in the tree and scrolls to it") },
  { id: "setting:wikilinks", name: "Use wikilinks", icon: Link2, words: "links markdown [[ ]] link format", plugin: { id: "files", key: "wikilinks" },
    sub: () => "New links are written [[Note]]; off, as Markdown links: [Note](Note.md)",
    get: () => linkStyle(getStore()).wikilinks, set: (on) => setWikilinks(on) },
]

export const coreSwitch = (id: string) => CORE.find((s) => s.id === id)!

function pluginSwitches(disabled: string[]): SwitchDef[] {
  return PLUGINS.filter((p) => settingsShown(p, disabled)).flatMap((p) => Object.entries(p.settingsDecls ?? {}).flatMap(([key, d]) => {
    if (d.type !== "boolean" || d.local) return []
    const s = pluginSettings<Record<string, unknown>>(p.id)
    const dflt = () => settingDefault(p.id, key, d) === true
    return [{
      id: `setting:${p.id}:${key}`, name: d.label, sub: () => capitalize(d.description ?? ""), words: `${p.name} ${d.description ?? ""}`, icon: p.icon,
      plugin: { id: p.id, key },
      get: () => { const v = s.get()[key]; return typeof v === "boolean" ? v : dflt() },
      set: (on: boolean) => s.set({ [key]: on === dflt() ? null : on }),
    }]
  }))
}

export const switchRow = (id: string) => `plugin-${id}`

const switchedIn = (): SwitchDef[] => PLUGINS.filter((p) => p.switchIn).map((p) => ({
  id: `setting:${switchRow(p.id)}`, name: p.switchIn!.label, section: p.switchIn!.section, icon: p.icon,
  sub: () => p.description?.split(/[.:;] /)[0] ?? "", words: `${p.name} plugin`,
  get: () => switchedOn(p, getPrefs()), set: (on: boolean) => setSwitch(p, on),
}))

export const allSwitches = (disabled = getPrefs().disabled) => [...CORE, ...switchedIn(), ...pluginSwitches(disabled)]

export function placeOf(s: Pick<SwitchDef, "id" | "section" | "plugin">) {
  if (s.plugin) {
    const { id, key } = s.plugin, p = pluginById(id), home = p && settingsHome(p)
    const row = `[data-plugin-settings-sheet="${CSS.escape(id)}"] [data-setting="${CSS.escape(key)}"]`
    if (home && !settingsApart(p)) return { name: p.name, open: () => openSettings(home, row) }
    return { name: p?.name ?? id, open: () => (isDesktop() ? openSettings(`plugin:${id}`, row) : openPluginSettings(id, key)) }
  }
  const section = s.section ?? "appearance", row = `[data-settings-row="${s.id.replace(/^setting:/, "")}"]`
  return { name: SECTIONS[section] ?? capitalize(section), open: () => {
    if (section !== "sidebars") return openSettings(section, row)
    openDetail("sidebars")
    revealRow(row)
  } }
}

function flip(s: SwitchDef) {
  const on = !s.get()
  const set = (v: boolean) => Promise.resolve(s.set(v)).catch((e) => notifyError(e, "Couldn't change it"))
  void set(on)
  notify(`${s.name}: ${on ? "on" : "off"}`, { id: "switch", action: { label: "Undo", run: () => set(!on) } })
}

export const switchCommand = (s: SwitchDef): Command => ({
  id: s.id, name: s.name, icon: s.icon, words: [s.words, s.sub?.()].filter(Boolean).join(" "),
  on: s.get, place: placeOf(s), run: () => flip(s),
})

const changed = signal()
const heard = new Set<string>()
let started = false
function follow() {
  if (!started) { started = true; onPrefs(changed.notify); onTranslucency(changed.notify) }
  for (const p of PLUGINS) {
    if (heard.has(p.id) || !Object.values(p.settingsDecls ?? {}).some((d) => d.type === "boolean" || d.type === "enum")) continue
    heard.add(p.id)
    pluginSettings(p.id).onChange(changed.notify)
  }
}
export function onSwitches(fn: () => void) { follow(); return changed.subscribe(fn) }
export function useSwitches() { follow(); return changed.use() }
