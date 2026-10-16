// Settings: sections beside the one shown (a sheet each where narrow), saved in the vault (prefs.ts). Plugins add pages
// (`settingsPages`); `alwaysOn` ones' options are under Features, the others' a gear away on Plugins.
import { useMemo, useRef, useState, useEffect, type ReactNode } from "react"
import { Keyboard, Palette, PenLine, Puzzle, SlidersHorizontal, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { desktop as desktopApp, type UpdateMode } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { go } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, pluginById, tintOfPlugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, revealRow, withSettings, settingsTitle } from "@/core/pluginSettings"
import { usePrefs } from "@/core/prefs"
import { cell } from "@/core/signal"
import { quickTextSizeSub, textSizeKinds } from "@/core/textsize"
import { capitalize } from "@/lib/utils"
import { HotkeysSheet } from "@/pages/Hotkeys"
import { FilterField, PageHeader, Panel, Segmented, SettingRow, SheetHead } from "@/components/kit"
import { SidebarRow } from "@/components/Sidebar"
import { PluginSettings } from "@/components/PluginSettings"
import { AppearancePanel } from "@/components/Appearance"
import { EditorPanel } from "@/components/EditorSettings"
import { Catch } from "@/components/Guard"
import { openBundles } from "@/core/bundles"
import { Plugins } from "@/pages/Plugins"
import { notifyError } from "@/core/notify"
import { API_VERSION, APP_VERSION } from "../../../core/version.ts"

const byName = new Intl.Collator(undefined, { sensitivity: "base" })

/** The Plugins page, the way Bundles opens its own (core/bundles.ts openBundles). */
const openPlugins = () => { if (isDesktop()) go("plugins"); else location.hash = "#plugins" }

const UPDATES: Record<UpdateMode, string> = {
  automatic: "Downloaded, then the app restarts into it while you're away, with nothing unsaved",
  notify: "Downloaded, then Restart to update when you're ready",
  off: "Only when you choose Check for updates in the menu",
}

/** How this Mac's desktop app takes updates (kept by the app, not the vault); only in a build that updates. */
function UpdatesRow() {
  const [mode, setMode] = useState<UpdateMode | null>(null)
  useEffect(() => { void desktopApp?.updates?.get().then((u) => { if (u.available) setMode(u.mode) }, () => {}) }, [])
  if (!mode) return null
  const choose = (m: UpdateMode) => { setMode(m); desktopApp!.updates!.set(m).catch((e) => notifyError(e, "Couldn't change it")) }
  return (
    <SettingRow stack label="Updates" sub={UPDATES[mode]} data-settings-row="updates">
      <Segmented<UpdateMode> label="Updates" value={mode} onChange={choose} className="w-full shrink-0 sm:w-[260px]"
        options={[{ value: "automatic", label: "Automatic" }, { value: "notify", label: "Notify" }, { value: "off", label: "Off" }]} />
    </SettingRow>
  )
}

/** The vault this window shows (Manage vaults: the others, a new one), the app's version and its updates. */
function General({ store }: { store: Store }) {
  const path = store.vault.path
  const name = path.split("/").filter(Boolean).pop() ?? "Vault"
  return (
    <Panel>
      <div className="hairline">
        <SettingRow label={name} sub={<span className="break-all">{path}</span>} value="Manage vaults" data-settings-vault
          onClick={() => { if (desktopApp) void desktopApp.manageVaults(); else openDetail("vaults") }} />
        <SettingRow label="Vaultite" data-settings-row="version" sub={`Plugin API ${API_VERSION}`} value={APP_VERSION} />
        <UpdatesRow />
      </div>
    </Panel>
  )
}

// ---------- sections

/** A section: the app's own (general, appearance…), a plugin's page (`<plugin>:<page>`) or its options (`plugin:<id>`). */
type Sec = { id: string; label: string; icon: LucideIcon; tint?: string; render: (store: Store) => ReactNode }
const headed = (label: string, Icon: LucideIcon, body: ReactNode) => <><SheetHead icon={Icon} tint="var(--primary)" title={label} />{body}</>
const CORE: Sec[] = [
  { id: "general", label: "General", icon: SlidersHorizontal, render: (store) => headed("General", SlidersHorizontal, <General store={store} />) },
  { id: "appearance", label: "Appearance", icon: Palette, render: () => headed("Appearance", Palette, <AppearancePanel />) },
  { id: "editor", label: "Editor", icon: PenLine, render: (store) => headed("Editor", PenLine, <EditorPanel store={store} />) },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard, render: () => <HotkeysSheet /> },
]
/** Plugins, beside the list (where it's narrow, its own page): a plugin's gear shows its settings here. */
const PLUGINS_SEC: Sec = { id: "plugins", label: "Plugins", icon: Puzzle, render: (store) => <Plugins store={store} openSettings={(id) => shown.set(`plugin:${id}`)} /> }

/** The pages plugins that are on add (Connections' AI apps), in plugin order. */
function pluginPages(disabled: string[]): Sec[] {
  return PLUGINS.filter((p) => p.settingsPages && isEnabled(p.id, disabled)).flatMap((p) =>
    Object.entries(p.settingsPages!).map(([k, d]) => ({ id: `${p.id}:${k}`, label: d.label, icon: d.icon, tint: tintOfPlugin(p.id),
      render: (store: Store) => <>
        <SheetHead icon={d.icon} tint={tintOfPlugin(p.id)} title={d.label} sub={d.sub} />
        {d.render({ store })}
      </> })))
}

const pluginSec = (id: string): Sec | null => {
  const p = pluginById(id)
  return p ? { id: `plugin:${p.id}`, label: p.name, icon: p.icon, tint: tintOfPlugin(p.id), render: (store) => <PluginSettings store={store} plugin={p} /> } : null
}

function sectionOf(id: string, disabled: string[]): Sec | null {
  if (id.startsWith("plugin:")) return pluginSec(id.slice(7))
  if (id === PLUGINS_SEC.id) return PLUGINS_SEC
  return CORE.find((s) => s.id === id) ?? pluginPages(disabled).find((s) => s.id === id) ?? null
}

/** The section shown beside the list (kept while the app runs, so Settings reopens where it was). */
const shown = cell("general")

/** One section on its own: the sheet a narrow pane opens (`settings-section/<id>`). */
export function SettingsSection({ store, id }: { store: Store; id: string }) {
  const { disabled } = usePrefs()
  const s = sectionOf(id, disabled)
  if (!s) return <SheetHead icon={SlidersHorizontal} tint="var(--muted-foreground)" title="Not found" />
  return <Catch fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{s.render(store)}</Catch>
}

/** The list: the app's sections and Plugins, plugins' pages, then the options of the app's own plugins (Features). A
 *  plugin's settings opened from Plugins keep Plugins lit. */
function Nav({ store, active, pick }: { store: Store; active: string | null; pick: (id: string) => void }) {
  const { disabled } = usePrefs()
  const pages = pluginPages(disabled)
  const options = withSettings(store, disabled).filter((p) => p.alwaysOn).sort((a, b) => byName.compare(a.name, b.name))
  const lit = active?.startsWith("plugin:") && !pluginById(active.slice(7))?.alwaysOn ? PLUGINS_SEC.id : active
  const row = (s: Sec) => (
    <SidebarRow key={s.id} icon={s.icon} tint={s.tint} label={s.label} open active={lit === s.id} onClick={() => pick(s.id)} data-settings-nav={s.id} />
  )
  const heading = (t: string) => <div className="px-1.5 pt-4 pb-1 text-[12px] font-semibold text-muted-foreground">{t}</div>
  return (
    <nav aria-label="Settings" className="flex flex-col gap-px" data-settings-list>
      {CORE.map(row)}
      {row(PLUGINS_SEC)}
      {pages.length > 0 && <div className="pt-3" />}
      {pages.map(row)}
      {options.length > 0 && heading("Features")}
      {options.map((p) => row(pluginSec(p.id)!))}
    </nav>
  )
}

// ---------- search

/** A setting search finds: `where` it is (Appearance, a plugin's name), and what choosing it does. */
type Found = { id: string; label: string; sub?: string; where: string; words: string; run: () => void }
/** Goes to a section, and to the row `selector` finds in it: beside the list, or in a sheet where the pane is narrow. */
type Show = (section: string, selector?: string) => void

/** Everything in the sections and in plugins' settings that search can find. */
function findable(store: Store, disabled: string[], order: string[], show: Show): Found[] {
  const row = (id: string, label: string, where: string, selector: string, sub = ""): Found =>
    ({ id, label, sub, where, words: "", run: () => show(where.toLowerCase(), selector) })
  const app: Found[] = [
    ...pluginPages(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, where: "Settings", words: "", run: () => show(s.id) })),
    { id: "bundles", label: "Bundles", sub: "A whole setup of the app at once", where: "Plugins", words: "setup", run: openBundles },
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off, get more", where: "Plugins", words: "extensions install", run: () => show(PLUGINS_SEC.id) },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    row("file-icons", "File icons", "Appearance", '[data-settings-row="file-icons"]'),
    row("line-numbers", "Line numbers", "Appearance", '[data-settings-row="line-numbers"]'),
    { ...row("sidebar-scroll", "Scroll sidebar panels separately", "Appearance", '[data-settings-row="sidebar-scroll"]'), words: "sidebars" },
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...textSizeKinds(disabled, order).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("quick-text-size", "Quick text size", "Appearance", '[data-settings-row="quick-text-size"]', quickTextSizeSub()), words: "font size zoom scroll wheel pinch" },
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("readable-line-length", "Readable line length", "Editor", '[data-settings-row="readable-line-length"]'), words: "width wide column" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("spellcheck", "Spellcheck", "Editor", '[data-settings-row="spellcheck"]'), words: "spelling spell check" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    { ...row("auto-pair-brackets", "Auto-pair brackets", "Editor", '[data-settings-row="auto-pair-brackets"]'), words: "close brackets quotes autopair" },
    { ...row("auto-pair-markdown", "Auto-pair Markdown", "Editor", '[data-settings-row="auto-pair-markdown"]'), words: "wrap selection bold italic autopair" },
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => show("hotkeys") },
    { ...row("vaults", "Manage vaults", "General", "[data-settings-vault]", store.vault.path), words: "vault folder" },
    row("version", "Version", "General", '[data-settings-row="version"]', "Vaultite and its plugin API"),
    ...(desktopApp?.updates ? [{ ...row("updates", "Updates", "General", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
  ]
  const plugins = PLUGINS.filter((p) => hasSettings(p, store.pluginSettings ?? [])).sort((a, b) => byName.compare(a.name, b.name)).flatMap((p) => {
    const where = isEnabled(p.id, disabled) ? p.name : `${p.name} (off)`
    const own = [
      ...Object.entries(p.settingsDecls ?? {}).map(([key, d]) => ({ key, label: d.label, description: d.description })),
      ...(p.settingsSearch ?? []),
      ...(store.filing?.homes ?? []).filter((h) => h.plugin === p.id).map((h) => ({ key: `folder-${h.key}`, label: `${h.label} folder`, description: `where new ${h.label.toLowerCase()} go` })),
    ]
    const sheet = `[data-plugin-settings-sheet="${CSS.escape(p.id)}"]`
    return [
      { id: `plugin:${p.id}`, label: settingsTitle(p.name), where: "Plugin", words: "", run: () => show(`plugin:${p.id}`) },
      ...own.map((e, i): Found => ({ id: `plugin:${p.id}:${e.key ?? i}`, label: e.label, sub: e.description ? capitalize(e.description) : "",
        where, words: e.key ?? "", run: () => show(`plugin:${p.id}`, e.key ? `${sheet} [data-setting="${CSS.escape(e.key)}"]` : undefined) })),
    ]
  })
  return [...app, ...plugins]
}

/** The ones every word of the query is in (label, description, where, more words), those with the words in their
 *  label first. */
function search(all: Found[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const inLabel = (f: Found) => words.filter((w) => f.label.toLowerCase().includes(w)).length
  return all.filter((f) => { const t = `${f.label} ${f.sub ?? ""} ${f.where} ${f.words}`.toLowerCase(); return words.every((w) => t.includes(w)) })
    .map((f, i) => [f, inLabel(f), i] as const).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([f]) => f)
}

function Results({ found, query }: { found: Found[]; query: string }) {
  return (
    <Panel>
      {found.length ? (
        <div className="hairline" data-settings-results>
          {found.map((f) => (
            <SettingRow key={f.id} label={f.label} sub={f.sub || undefined} value={f.where} onClick={f.run} data-settings-result={f.id} />
          ))}
        </div>
      ) : <p className="py-2 text-[15px] text-muted-foreground">No settings match “{query}”</p>}
    </Panel>
  )
}

/** Wide enough for the list beside a section: Tailwind's @3xl (48rem), which the layout below switches at. */
const sideBySide = (el: HTMLElement | null) => !!el && el.clientWidth >= 48 * parseFloat(getComputedStyle(document.documentElement).fontSize)

export function Settings({ store }: { store: Store }) {
  const { disabled, order } = usePrefs()
  const [query, setQuery] = useState("")
  const q = query.trim()
  const wrap = useRef<HTMLDivElement>(null)
  const current = shown.use()
  // Whether the list is beside a section (else it's the page, and a section opens as a sheet), followed as it resizes.
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWide(sideBySide(el)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // A plugin turned off takes its section with it: back to the first.
  const sec = sectionOf(current, disabled) ?? CORE[0]
  const show: Show = (id, selector) => {
    setQuery("")
    if (wide) {
      shown.set(id)
      if (selector) revealRow(selector)
      else wrap.current?.closest<HTMLElement>("[data-pane]")?.scrollTo({ top: 0 })
    } else if (id === PLUGINS_SEC.id) {
      openPlugins()
    } else if (id.startsWith("plugin:")) {
      const key = selector?.match(/data-setting="(.*)"\]$/)?.[1]
      openPluginSettings(id.slice(7), key ? key.replace(/\\(.)/g, "$1") : undefined)
    } else {
      openDetail(`settings-section/${encodeURIComponent(id)}`)
      if (selector) revealRow(selector)
    }
  }
  const found = useMemo(() => (q ? search(findable(store, disabled, order, show), q) : []), [store, disabled, order, q, wide])
  return (
    <div ref={wrap} className="@container" data-settings>
      <PageHeader title="Settings" />
      {/* Enter goes to the first one found. */}
      <form role="search" className="mb-4 flex" onSubmit={(e) => { e.preventDefault(); found[0]?.run() }} data-settings-search>
        <FilterField value={query} onChange={setQuery} placeholder="Search settings" />
      </form>
      {q ? <Results found={found} query={q} /> : (
        <div className="flex items-start gap-8">
          <div className="w-full shrink-0 @3xl:sticky @3xl:top-14 @3xl:max-h-[calc(100dvh-9rem)] @3xl:w-48 @3xl:overflow-y-auto" data-settings-side>
            <Nav store={store} active={wide ? sec.id : null} pick={(id) => show(id)} />
          </div>
          <div className="hidden min-w-0 flex-1 @3xl:block" data-settings-section={sec.id}>
            <Catch key={sec.id} fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{sec.render(store)}</Catch>
          </div>
        </div>
      )}
    </div>
  )
}
