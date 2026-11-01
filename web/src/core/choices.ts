// Settings of a few values, declared once (a plugin's: its manifest's enums): Settings draws these values, and the palette
// has "<Name>…", their picker (core/choicePicker.ts). On/off ones are core/switches.ts.
import { AppWindow, ArrowDownWideNarrow, BookOpen, IndentIncrease, PanelTopDashed, PencilLine, RefreshCw, Sparkles, SunMoon, Tags, UnfoldVertical } from "lucide-react"
import type { Command } from "@/core/commands"
import { choose } from "@/components/Chooser"
import { SORTS } from "@/components/FileTree"
import { previewLook } from "@/core/appearance"
import { choiceLabel, choicePicker, declChoice, type ChoiceDef, type ChoiceOption } from "@/core/choicePicker"
import { EDITING_MODES, editorSettings, NOTE_VIEWS, PROPERTIES_SHOWN, setEditor } from "@/core/editorPrefs"
import { opensChoices, setOpens } from "@/core/launcher"
import { notify, notifyError } from "@/core/notify"
import { isDesktop } from "@/core/platform"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { pluginSettings, settingDefault } from "@/core/pluginSettings"
import { getPrefs, setPrefs, type Animation, type Density, type FileBarFade, type FileSort, type Theme } from "@/core/prefs"
import { placeOf } from "@/core/switches"
import type { UpdatePolicy } from "../../../core/updates.ts"

export type { ChoiceDef }

type Options<V extends string> = { value: V; label: string }[]
export const THEMES: Options<Theme> = [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]
export const DENSITIES: Options<Density> = [{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]
export const ANIMATIONS: Options<Animation> = [{ value: "natural", label: "Natural" }, { value: "snappy", label: "Snappy" }, { value: "off", label: "Off" }]
export const BAR_FADES: Options<FileBarFade> = [{ value: "off", label: "Never" }, { value: "typing", label: "While typing" }, { value: "always", label: "Always" }]
/** What the file bar's fade is now: one of its three (a hand-edited value reads as off). */
export const barFadeOf = (v: unknown): FileBarFade => (v === "typing" || v === "always" ? v : "off")
export type Indent = "tab" | "2" | "4"
export const INDENTS: Options<Indent> = [{ value: "tab", label: "Tab" }, { value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }]
export const PLUGIN_UPDATE_POLICIES: Options<UpdatePolicy> = [{ value: "vaultite", label: "Vaultite's" }, { value: "all", label: "All" }, { value: "off", label: "None" }]
export const indentOf = (e: { useTab: boolean; tabSize: number }): Indent => (e.useTab ? "tab" : (String(e.tabSize) as Indent))

const list = (o: ChoiceOption[]) => () => o
const editorValue = (k: "defaultView" | "editingMode" | "propertiesInDocument") => ({
  section: "editor", get: () => String(editorSettings()[k] ?? ""), set: (v: string) => setEditor({ [k]: v }),
})

// (`id` and `name` first, literal: the server lists commands from the source, core/appsource.ts.)
const CORE: ChoiceDef[] = [
  { id: "setting:theme", name: "Theme", section: "appearance", icon: SunMoon, words: "dark mode light mode", options: list(THEMES),
    get: () => getPrefs().theme, set: (v) => setPrefs({ theme: v as Theme }), preview: (v) => previewLook(v === null ? null : { theme: v as Theme }) },
  { id: "setting:density", name: "Density", section: "appearance", icon: UnfoldVertical, words: "spacing", options: list(DENSITIES),
    get: () => (getPrefs().density === "comfortable" ? "comfortable" : "compact"), set: (v) => setPrefs({ density: v as Density }),
    preview: (v) => previewLook(v === null ? null : { density: v as Density }) },
  { id: "setting:animation", name: "Animations", section: "appearance", icon: Sparkles, words: "motion reduce speed spring", options: list(ANIMATIONS),
    get: () => getPrefs().animation, set: (v) => setPrefs({ animation: v as Animation }) },
  { id: "setting:file-bar-fade", name: "Fade the file bar", section: "appearance", icon: PanelTopDashed, words: "hide path breadcrumb focus zen writing reading distraction typing hover auto-hide",
    sub: () => ({ off: "", typing: "While typing, back when the pointer moves", always: "Back while the pointer is over it" })[barFadeOf(getPrefs().fileBarFade)],
    options: list(BAR_FADES), get: () => barFadeOf(getPrefs().fileBarFade), set: (v) => setPrefs({ fileBarFade: v as FileBarFade }) },
  { id: "setting:new-tabs", name: "New tabs open", section: "appearance", icon: AppWindow, words: "new tab launcher start blank",
    options: () => opensChoices().map((c) => ({ value: c.value ?? "", label: c.label })),
    get: () => { const o = getPrefs().newTab.opens; return opensChoices().some((c) => c.value === o) ? o ?? "" : "" }, set: (v) => setOpens(v || null) },
  { id: "setting:default-view", name: "Default view for new tabs", icon: BookOpen, words: "reading editing mode", options: list(NOTE_VIEWS),
    ...editorValue("defaultView"), get: () => editorSettings().defaultView ?? (isDesktop() ? "editing" : "reading") },
  { id: "setting:editing-mode", name: "Default editing mode", icon: PencilLine, words: "source mode live preview markdown", options: list(EDITING_MODES), ...editorValue("editingMode") },
  { id: "setting:properties-in-document", name: "Properties in document", icon: Tags, words: "frontmatter yaml metadata show hide", options: list(PROPERTIES_SHOWN), ...editorValue("propertiesInDocument") },
  { id: "setting:indent", name: "Indent", section: "editor", icon: IndentIncrease, words: "tabs spaces tab size", options: list(INDENTS),
    get: () => indentOf(editorSettings()), set: (v) => setEditor(v === "tab" ? { useTab: true } : { useTab: false, tabSize: Number(v) }) },
  { id: "setting:plugin-updates", name: "Plugin updates", section: "updates", icon: RefreshCw, words: "update automatically plugins", options: list(PLUGIN_UPDATE_POLICIES),
    sub: () => "Which plugins update on their own", get: () => getPrefs().updates, set: (v) => setPrefs({ updates: v as UpdatePolicy }) },
  // File explorer's, kept in files.json (its sheet: components/FilesSettings.tsx).
  { id: "setting:file-sort", name: "Sort order", plugin: { id: "files", key: "fileSort" }, icon: ArrowDownWideNarrow, words: "file explorer tree sort by name modified created",
    sub: () => "Of the file tree; folders stay first, by name", options: () => SORTS.flat(), when: () => isEnabled("files", getPrefs().disabled),
    get: () => getPrefs().fileSort, set: (v) => setPrefs({ fileSort: v as FileSort }) },
]

/** One of the app's choices, by its id ("setting:animation"). */
export const coreChoice = (id: string) => CORE.find((c) => c.id === id)!

/** A plugin's enum settings, while it's on. Not a `local` one (who may reach this machine: chosen in its settings,
 *  where what it does is read first). */
function pluginChoices(disabled: string[]): ChoiceDef[] {
  return PLUGINS.filter((p) => isEnabled(p.id, disabled)).flatMap((p) => Object.entries(p.settingsDecls ?? {}).flatMap(([key, d]) =>
    d.type !== "enum" || !d.values?.length || d.local ? [] : [declChoice(p, key, d, settingDefault(p.id, key, d), pluginSettings<Record<string, unknown>>(p.id))]))
}

/** Every choice there is now: the app's, then the plugins' that are on. */
export const allChoices = (disabled = getPrefs().disabled) => [...CORE, ...pluginChoices(disabled)]

const said = (text: string, undo: () => void) => notify(text, { id: "switch", action: { label: "Undo", run: undo } })

/** Its picker in the palette's place. */
export function pickChoice(c: ChoiceDef) {
  const keep = (v: string) => Promise.resolve(c.set(v)).catch((e) => notifyError(e, "Couldn't change it"))
  choose(choicePicker({ ...c, set: keep }, said))
}

/** A choice as a command: "Animations…", its value at its row's end and its place in Settings. */
export const choiceCommand = (c: ChoiceDef): Command => ({
  id: c.id, name: `${c.name}…`, icon: c.icon, when: c.when, run: () => pickChoice(c),
  words: [c.words, ...c.options().map((o) => o.label)].filter(Boolean).join(" "),
  value: () => choiceLabel(c), place: placeOf(c),
})
