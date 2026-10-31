// On/off settings, declared once (a plugin's: a boolean in its manifest): Settings, its search, the palette, menus and
// the menu bar all follow. Named as Settings names them, never "Toggle"; "Turn on" is only for plugins.
import { ArrowDownUp, Archive, Blend, BookOpenText, Brackets, Eye, Heading, Heading1, Layers2, ListOrdered, ListTree, MousePointer2, PanelLeftDashed, PanelTop, PenLine, SeparatorHorizontal, Shapes, SpellCheck, SunDim, WrapText } from "lucide-react"
import { canTranslucent, getTranslucency, onTranslucency } from "@/core/appearance"
import type { Command } from "@/core/commands"
import { reload } from "@/core/data"
import { editorSet, editorSettings, setEditor, type EditorSettings } from "@/core/editorPrefs"
import { openDetail } from "@/core/nav"
import { notify, notifyError } from "@/core/notify"
import { isEnabled, pluginById, PLUGINS, setSwitch, switchedOn } from "@/core/plugins"
import { openPluginSettings, pluginSettings, revealRow, settingDefault } from "@/core/pluginSettings"
import { getPrefs, onPrefs, setPrefs, type Prefs } from "@/core/prefs"
import { signal } from "@/core/signal"
import { quickTextSizeSub } from "@/core/textsize"
import { isMac } from "@/core/platform"
import { capitalize } from "@/lib/utils"

export type SwitchDef = {
  /** Its command; the app's are `setting:<row>`, `<row>` its Settings row (`data-settings-row`). */
  id: string
  /** What Settings calls it, the same everywhere: "Line numbers". */
  name: string
  sub?: () => string
  /** Other words it's found by, in the palette and Settings' search. */
  words?: string
  icon?: Command["icon"]
  /** Where Settings has it: an app section ("appearance"), or a plugin's settings sheet and its key there. */
  section?: string
  plugin?: { id: string; key: string }
  get: () => boolean
  set: (on: boolean) => unknown
  /** Set apart from what applies without it (Editor's, over Obsidian's): Settings shows a reset. */
  reset?: { shown: () => boolean; run: () => void }
}

/** The app's Settings sections that have switches, by id, as their list names them. */
const SECTIONS: Record<string, string> = { appearance: "Appearance", editor: "Editor", sidebars: "Sidebars" }

type Flag = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs]
const pref = (k: Flag) => ({ get: () => getPrefs()[k], set: (on: boolean) => setPrefs({ [k]: on }) })
type EditorFlag = { [K in keyof EditorSettings]: EditorSettings[K] extends boolean ? K : never }[keyof EditorSettings]
const editor = (k: EditorFlag) => ({
  section: "editor", get: () => editorSettings()[k], set: (on: boolean) => setEditor({ [k]: on }),
  reset: { shown: () => editorSet(k), run: () => void setEditor({ [k]: null }) },
})
/** One of File explorer's, kept in files.json (its sheet: components/FilesSettings.tsx). */
const files = (k: "showHidden" | "showArchived" | "autoReveal", sub: string) => ({ plugin: { id: "files", key: k }, sub: () => sub, ...pref(k) })

/** What Translucent window does here, or why it can't. */
function translucentSub() {
  const { why } = getTranslucency()
  if (!canTranslucent || why === "system") return "In the desktop app on a Mac or Windows 11: the desktop shows through the sidebars and bars"
  if (why === "reduced") return isMac ? "Solid while Reduce transparency is on in System Settings" : "Solid while transparency effects are off in Windows' settings"
  if (why === "apps") return "Solid while a tab shows another app's window"
  if (why === "reopen") return "Shows once this window is opened again"
  return "The desktop shows through the sidebars and bars, blurred; pages stay solid"
}

// (`id` and `name` first, literal: the server lists commands from the source, core/appsource.ts.)
const CORE: SwitchDef[] = [
  { id: "setting:file-icons", name: "File icons", section: "appearance", icon: Shapes, ...pref("fileIcons") },
  { id: "setting:tab-bar", name: "Tab bar", section: "appearance", icon: PanelTop, words: "tabs", ...pref("tabBar") },
  { id: "setting:pane-titles", name: "Pane titles", section: "appearance", icon: Heading1, sub: () => "With the tab bar off, what's open shows above each pane", words: "tab bar title zen", ...pref("paneTitles") },
  { id: "setting:dim-panes", name: "Dim inactive panes", section: "appearance", icon: SunDim, sub: () => "With the window split, the panes you're not in fade a little", words: "fade focus splits active", ...pref("dimPanes") },
  { id: "setting:rails", name: "Sidebar rails", section: "sidebars", icon: PanelLeftDashed, sub: () => "Off, a hidden sidebar slides in when the pointer reaches the window's edge", words: "rail icons compact zen hover edge sidebars", ...pref("rails") },
  { id: "setting:peek-shade", name: "Dim the page behind a sidebar", section: "sidebars", icon: SunDim, sub: () => "With rails off, while a hidden sidebar is slid in", words: "darken shade focus zen backdrop", ...pref("peekShade") },
  { id: "setting:translucent", name: "Translucent window", section: "appearance", icon: Blend, sub: translucentSub, words: "transparent transparency vibrancy blur glass frosted mica see-through desktop", ...pref("translucent") },
  { id: "setting:translucent-pages", name: "Translucent pages", section: "appearance", icon: Layers2, sub: () => "Notes and terminals too, more lightly; web pages and media stay solid", words: "transparent transparency glass full notes terminal editor see-through",
    // (on, the window too: pages show the desktop only through a translucent window)
    get: () => getPrefs().translucentPages, set: (on: boolean) => setPrefs(on ? { translucentPages: true, translucent: true } : { translucentPages: false }) },
  { id: "setting:typing-fade", name: "Fade the file bar while typing", section: "appearance", icon: PenLine, sub: () => "Back when the pointer moves", words: "hide path breadcrumb focus zen writing distraction", ...pref("typingFade") },
  { id: "setting:line-numbers", name: "Line numbers", section: "appearance", icon: ListOrdered, words: "gutter", ...pref("lineNumbers") },
  { id: "setting:sidebar-scroll", name: "Scroll sidebar panels separately", section: "sidebars", icon: ArrowDownUp, words: "sidebars",
    get: () => getPrefs().sidebarScroll !== "sidebar", set: (on) => setPrefs({ sidebarScroll: on ? "panels" : "sidebar" }) },
  { id: "setting:panel-dividers", name: "Lines between sidebar panels", section: "sidebars", icon: SeparatorHorizontal, words: "dividers sidebars", ...pref("panelDividers") },
  { id: "setting:quick-text-size", name: "Pinch to resize text", section: "appearance", icon: MousePointer2, sub: quickTextSizeSub,
    words: "font size text size zoom scroll wheel bigger smaller", ...pref("quickTextSize") },
  { id: "setting:readable-line-length", name: "Readable line length", icon: WrapText, words: "width wide column", ...editor("readableLineLength") },
  { id: "setting:show-inline-title", name: "Show inline title", icon: Heading, words: "title", ...editor("showInlineTitle") },
  { id: "setting:spellcheck", name: "Spellcheck", icon: SpellCheck, words: "spelling spell check", ...editor("spellcheck") },
  { id: "setting:auto-pair-brackets", name: "Auto-pair brackets", icon: Brackets, words: "close brackets quotes autopair", ...editor("autoPairBrackets") },
  { id: "setting:auto-pair-markdown", name: "Auto-pair Markdown", icon: BookOpenText, sub: () => "Typing * _ ~ = or ` over a selection wraps it", words: "wrap selection bold italic autopair", ...editor("autoPairMarkdown") },
  // Hidden folders are out of the server's reach while it's off: the vault again once it's on.
  { id: "setting:show-hidden", name: "Show hidden files", icon: Eye, words: "dotfiles trash",
    ...files("showHidden", "Adds .vaultite (the app's settings, as files) and .trash (deleted files, which you can restore) to the file list"),
    set: (on) => setPrefs({ showHidden: on }).then(reload) },
  { id: "setting:show-archived", name: "Show archived files", icon: Archive,
    ...files("showArchived", "Adds the .archive folders archived files move into, dimmed (hidden files or not); without it, an archived file shows only while it's open") },
  { id: "setting:auto-reveal", name: "Reveal the open file", icon: ListTree, words: "auto-reveal current file tree",
    ...files("autoReveal", "Opens its folders in the tree and scrolls to it") },
]

/** One of the app's switches, by its id ("setting:line-numbers"). */
export const coreSwitch = (id: string) => CORE.find((s) => s.id === id)!

/** A plugin's boolean settings, while it's on. Not a `local` one: those say who may reach this machine, chosen in its
 *  settings where what they do is read first. */
function pluginSwitches(disabled: string[]): SwitchDef[] {
  return PLUGINS.filter((p) => isEnabled(p.id, disabled)).flatMap((p) => Object.entries(p.settingsDecls ?? {}).flatMap(([key, d]) => {
    if (d.type !== "boolean" || d.local) return []
    const s = pluginSettings<Record<string, unknown>>(p.id)
    const dflt = () => settingDefault(p.id, key, d) === true
    return [{
      id: `setting:${p.id}:${key}`, name: d.label, sub: () => capitalize(d.description ?? ""), words: `${p.name} ${d.description ?? ""}`, icon: p.icon,
      plugin: { id: p.id, key },
      get: () => { const v = s.get()[key]; return typeof v === "boolean" ? v : dflt() },
      // The default again: the key goes, so the vault keeps only what was chosen.
      set: (on: boolean) => s.set({ [key]: on === dflt() ? null : on }),
    }]
  }))
}

/** A plugin switched on and off in a Settings section (its manifest's `switchIn`: Vim keys, in Editor): its row there. */
export const switchRow = (id: string) => `plugin-${id}`

/** Those plugins' switches, named as their section names them: "Turn on" never offers them (CommandPalette.tsx). */
const switchedIn = (): SwitchDef[] => PLUGINS.filter((p) => p.switchIn).map((p) => ({
  id: `setting:${switchRow(p.id)}`, name: p.switchIn!.label, section: p.switchIn!.section, icon: p.icon,
  sub: () => p.description?.split(/[.:;] /)[0] ?? "", words: `${p.name} plugin`,
  get: () => switchedOn(p, getPrefs()), set: (on: boolean) => setSwitch(p, on),
}))

/** Every switch there is now: the app's, those plugins', then the plugins' settings, of the ones that are on. */
export const allSwitches = (disabled = getPrefs().disabled) => [...CORE, ...switchedIn(), ...pluginSwitches(disabled)]

/** Where Settings has it, and how to go there: its row flashes once it's drawn. */
export function placeOf(s: SwitchDef) {
  if (s.plugin) {
    const { id, key } = s.plugin
    return { name: pluginById(id)?.name ?? id, open: () => openPluginSettings(id, key) }
  }
  const section = s.section ?? "appearance"
  return { name: SECTIONS[section] ?? capitalize(section), open: () => {
    // (the sidebars' own are in their sheet, beside the panels)
    openDetail(section === "sidebars" ? "sidebars" : `settings-section/${encodeURIComponent(section)}`)
    revealRow(`[data-settings-row="${s.id.replace(/^setting:/, "")}"]`)
  } }
}

/** Flip it, saying so with Undo: what the palette, a menu and a hotkey do. */
function flip(s: SwitchDef) {
  const on = !s.get()
  const set = (v: boolean) => Promise.resolve(s.set(v)).catch((e) => notifyError(e, "Couldn't change it"))
  void set(on)
  notify(`${s.name}: ${on ? "on" : "off"}`, { id: "switch", action: { label: "Undo", run: () => set(!on) } })
}

/** A switch as a command: named as the setting, with its state (`on`) and its place in Settings. */
export const switchCommand = (s: SwitchDef): Command => ({
  id: s.id, name: s.name, icon: s.icon, words: [s.words, s.sub?.()].filter(Boolean).join(" "),
  on: s.get, place: placeOf(s), run: () => flip(s),
})

// ---------- following them

const changed = signal()
const heard = new Set<string>()
let started = false
// Prefs, and each plugin's settings file once (a vault plugin that arrives later joins on the next call).
function follow() {
  if (!started) { started = true; onPrefs(changed.notify); onTranslucency(changed.notify) }
  for (const p of PLUGINS) {
    if (heard.has(p.id) || !Object.values(p.settingsDecls ?? {}).some((d) => d.type === "boolean" || d.type === "enum")) continue
    heard.add(p.id)
    pluginSettings(p.id).onChange(changed.notify)
  }
}
/** Call `fn` when any switch (or a plugin's choice, core/choices.ts) may have changed; returns how to stop. */
export function onSwitches(fn: () => void) { follow(); return changed.subscribe(fn) }
/** Redraw when a switch changes. */
export function useSwitches() { follow(); return changed.use() }
