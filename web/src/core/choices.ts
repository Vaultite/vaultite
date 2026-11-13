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
import { pluginSettings, settingDefault, settingsShown } from "@/core/pluginSettings"
import { getPrefs, setPrefs, type Animation, type Density, type FileBarFade, type FileSort, type Theme } from "@/core/prefs"
import { placeOf } from "@/core/switches"
import type { UpdatePolicy } from "../../../core/updates.ts"

export type { ChoiceDef }

type Options<V extends string> = { value: V; label: string }[]
export const THEMES: Options<Theme> = [{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]
export const DENSITIES: Options<Density> = [{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]
export const ANIMATIONS: Options<Animation> = [{ value: "natural", label: "Natural" }, { value: "snappy", label: "Snappy" }, { value: "off", label: "Off" }]
export const BAR_FADES: Options<FileBarFade> = [{ value: "off", label: "Never" }, { value: "typing", label: "While typing" }, { value: "always", label: "Always" }]
export const barFadeOf = (v: unknown): FileBarFade => (v === "typing" || v === "always" ? v : "off")
export type Indent = "tab" | `${number}`
export const INDENTS: Options<Indent> = [{ value: "tab", label: "Tab" }, { value: "2", label: "2 spaces" }, { value: "4", label: "4 spaces" }]
export const PLUGIN_UPDATE_POLICIES: Options<UpdatePolicy> = [{ value: "vaultite", label: "Vaultite's" }, { value: "all", label: "All" }, { value: "off", label: "None" }]
export const indentOf = (e: { useTab: boolean; tabSize: number }): Indent => (e.useTab ? "tab" : `${e.tabSize}`)

const list = (o: ChoiceOption[]) => () => o
type Typed<V extends string> = Omit<ChoiceDef, "options" | "get" | "set" | "preview"> &
  { options: Options<V>; get: () => V; set: (v: V) => unknown; preview?: (v: V | null) => void }
function typed<V extends string>(c: Typed<V>): ChoiceDef {
  const of = (id: string) => c.options.find((o) => o.value === id)?.value
  const { preview } = c
  return {
    ...c, options: () => c.options, set: (id) => { const v = of(id); return v === undefined ? undefined : c.set(v) },
    preview: preview && ((id) => preview(id === null ? null : of(id) ?? null)),
  }
}
const editorValue = (k: "defaultView" | "editingMode" | "propertiesInDocument") => ({
  section: "editor", get: () => String(editorSettings()[k] ?? ""), set: (v: string) => setEditor({ [k]: v }),
})

// `id` and `name` first, literal: core/appsource.ts lists commands from the source.
const CORE: ChoiceDef[] = [
  typed<Theme>({ id: "setting:theme", name: "Theme", section: "appearance", icon: SunMoon, words: "dark mode light mode", options: THEMES,
    get: () => getPrefs().theme, set: (theme) => setPrefs({ theme }), preview: (theme) => previewLook(theme === null ? null : { theme }) }),
  typed<Density>({ id: "setting:density", name: "Density", section: "appearance", icon: UnfoldVertical, words: "spacing", options: DENSITIES,
    get: () => (getPrefs().density === "comfortable" ? "comfortable" : "compact"), set: (density) => setPrefs({ density }),
    preview: (density) => previewLook(density === null ? null : { density }) }),
  typed<Animation>({ id: "setting:animation", name: "Animations", section: "appearance", icon: Sparkles, words: "motion reduce speed spring", options: ANIMATIONS,
    get: () => getPrefs().animation, set: (animation) => setPrefs({ animation }) }),
  typed<FileBarFade>({ id: "setting:file-bar-fade", name: "Fade the file bar", section: "appearance", icon: PanelTopDashed, words: "hide path breadcrumb focus zen writing reading distraction typing hover auto-hide",
    sub: () => ({ off: "", typing: "While typing, back when the pointer moves", always: "Back while the pointer is over it" })[barFadeOf(getPrefs().fileBarFade)],
    options: BAR_FADES, get: () => barFadeOf(getPrefs().fileBarFade), set: (fileBarFade) => setPrefs({ fileBarFade }) }),
  { id: "setting:new-tabs", name: "New tabs open", section: "appearance", icon: AppWindow, words: "new tab launcher start blank",
    options: () => opensChoices().map((c) => ({ value: c.value ?? "", label: c.label })),
    get: () => { const o = getPrefs().newTab.opens; return opensChoices().some((c) => c.value === o) ? o ?? "" : "" }, set: (v) => setOpens(v || null) },
  { id: "setting:default-view", name: "Default view for new tabs", icon: BookOpen, words: "reading editing mode", options: list(NOTE_VIEWS),
    ...editorValue("defaultView"), get: () => editorSettings().defaultView ?? (isDesktop() ? "editing" : "reading") },
  { id: "setting:editing-mode", name: "Default editing mode", icon: PencilLine, words: "source mode live preview markdown", options: list(EDITING_MODES), ...editorValue("editingMode") },
  { id: "setting:properties-in-document", name: "Properties in document", icon: Tags, words: "frontmatter yaml metadata show hide", options: list(PROPERTIES_SHOWN), ...editorValue("propertiesInDocument") },
  { id: "setting:indent", name: "Indent", section: "editor", icon: IndentIncrease, words: "tabs spaces tab size", options: list(INDENTS),
    get: () => indentOf(editorSettings()), set: (v) => setEditor(v === "tab" ? { useTab: true } : { useTab: false, tabSize: Number(v) }) },
  typed<UpdatePolicy>({ id: "setting:plugin-updates", name: "Plugin updates", section: "plugins", icon: RefreshCw, words: "update automatically plugins", options: PLUGIN_UPDATE_POLICIES,
    sub: () => "Which plugins update on their own", get: () => getPrefs().updates, set: (updates) => setPrefs({ updates }) }),
  typed<FileSort>({ id: "setting:file-sort", name: "Sort order", plugin: { id: "files", key: "fileSort" }, icon: ArrowDownWideNarrow, words: "file explorer tree sort by name modified created",
    sub: () => "Of the file tree; folders stay first, by name", options: SORTS.flat(), when: () => isEnabled("files", getPrefs().disabled),
    get: () => getPrefs().fileSort, set: (fileSort) => setPrefs({ fileSort }) }),
]

export const coreChoice = (id: string) => CORE.find((c) => c.id === id)!

function pluginChoices(disabled: string[]): ChoiceDef[] {
  return PLUGINS.filter((p) => settingsShown(p, disabled)).flatMap((p) => Object.entries(p.settingsDecls ?? {}).flatMap(([key, d]) =>
    d.type !== "enum" || !d.values?.length || d.local ? [] : [declChoice(p, key, d, settingDefault(p.id, key, d), pluginSettings<Record<string, unknown>>(p.id))]))
}

export const allChoices = (disabled = getPrefs().disabled) => [...CORE, ...pluginChoices(disabled)]

const said = (text: string, undo: () => void) => notify(text, { id: "switch", action: { label: "Undo", run: undo } })

export function pickChoice(c: ChoiceDef) {
  const keep = (v: string) => Promise.resolve(c.set(v)).catch((e) => notifyError(e, "Couldn't change it"))
  choose(choicePicker({ ...c, set: keep }, said))
}

export const choiceCommand = (c: ChoiceDef): Command => ({
  id: c.id, name: `${c.name}…`, icon: c.icon, when: c.when, run: () => pickChoice(c),
  words: [c.words, ...c.options().map((o) => o.label)].filter(Boolean).join(" "),
  value: () => choiceLabel(c), place: placeOf(c),
})
