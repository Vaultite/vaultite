// Settings: sections beside the one shown (a sheet each where narrow), saved in the vault (prefs.ts). Plugins add pages
// (`settingsPages`); `alwaysOn` ones' options are under Features, the others' a gear away on Plugins (its own menu).
import { useMemo, useState, useEffect, type ReactNode } from "react"
import { Keyboard, Palette, PenLine, Puzzle, Search, SlidersHorizontal, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { desktop as desktopApp, type UpdateMode } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { go } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, pluginById, tintOfPlugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, revealRow, withSettings, settingsTitle } from "@/core/pluginSettings"
import { usePrefs } from "@/core/prefs"
import { cell } from "@/core/signal"
import { textSizeKinds } from "@/core/textsize"
import { allSwitches, placeOf, useSwitches, type SwitchDef } from "@/core/switches"
import { capitalize } from "@/lib/utils"
import { HotkeysSheet } from "@/pages/Hotkeys"
import { Panel, Segmented, SettingRow, SheetHead, Switch } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
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
/** Plugins: in place of the menu (Settings draws it so), where it's narrow its own page. */
const PLUGINS_SEC: Sec = { id: "plugins", label: "Plugins", icon: Puzzle, render: (store) => <Plugins store={store} /> }

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

/** The menu: the app's sections and Plugins, plugins' pages, then the options of the app's own plugins (Features). */
function menu(store: Store, disabled: string[]): RailItem[] {
  const pages = pluginPages(disabled)
  const options = withSettings(store, disabled).filter((p) => p.alwaysOn).sort((a, b) => byName.compare(a.name, b.name))
  const item = (s: Sec, more: Partial<RailItem> = {}): RailItem => ({ id: s.id, label: s.label, icon: s.icon, tint: s.tint, attrs: { "data-settings-nav": s.id }, ...more })
  return [
    ...CORE.map((s) => item(s)), item(PLUGINS_SEC),
    ...pages.map((s, i) => item(s, { gap: i === 0 })),
    ...options.map((p, i) => item(pluginSec(p.id)!, { heading: i === 0 ? "Features" : undefined })),
  ]
}

/** What the menu lights: a plugin's settings opened from Plugins (or found) keep Plugins lit; one switched in a section
 *  (Vim keys), that section. */
function litOf(active: string) {
  const of = active.startsWith("plugin:") ? pluginById(active.slice(7)) : null
  return of && !of.alwaysOn ? of.switchIn?.section ?? PLUGINS_SEC.id : active
}

// ---------- search

/** A setting search finds: `where` it is (Appearance, a plugin's name), and what choosing it does; a switch is flipped
 *  right there. */
type Found = { id: string; label: string; sub?: string; where: string; words: string; run: () => void; switch?: SwitchDef }
/** Goes to a section, and to the row `selector` finds in it: beside the list, or in a sheet where the pane is narrow. */
type Show = (section: string, selector?: string) => void

/** Everything in the sections and in plugins' settings that search can find. */
function findable(store: Store, disabled: string[], order: string[], show: Show): Found[] {
  const switches = allSwitches(disabled)
  const switchOf = (plugin: string, key?: string) => switches.find((w) => w.plugin?.id === plugin && w.plugin.key === key)
  const row = (id: string, label: string, where: string, selector: string, sub = ""): Found =>
    ({ id, label, sub, where, words: "", run: () => show(where.toLowerCase(), selector) })
  const app: Found[] = [
    ...pluginPages(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, where: "Settings", words: "", run: () => show(s.id) })),
    { id: "bundles", label: "Bundles", sub: "A whole setup of the app at once", where: "Plugins", words: "setup", run: openBundles },
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off, get more", where: "Plugins", words: "extensions install", run: () => show(PLUGINS_SEC.id) },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...textSizeKinds(disabled, order).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    // (every switch: the app's, and plugins switched on and off here, Vim keys; File explorer's are its plugin's, below)
    ...switches.filter((w) => !w.plugin).map((w): Found => {
      const row = w.id.replace(/^setting:/, "")
      return { id: row, label: w.name, sub: w.sub?.(), where: placeOf(w).name, words: w.words ?? "", run: () => show(w.section ?? "appearance", `[data-settings-row="${row}"]`), switch: w }
    }),
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => show("hotkeys") },
    { ...row("vaults", "Manage vaults", "General", "[data-settings-vault]", store.vault.path), words: "vault folder" },
    row("version", "Version", "General", '[data-settings-row="version"]', "Vaultite and its plugin API"),
    ...(desktopApp?.updates ? [{ ...row("updates", "Updates", "General", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
  ]
  const plugins = PLUGINS.filter((p) => hasSettings(p, store.pluginSettings ?? [])).sort((a, b) => byName.compare(a.name, b.name)).flatMap((p) => {
    const where = isEnabled(p.id, disabled) ? p.name : `${p.name} (off)`
    const own = [
      ...Object.entries(p.settingsDecls ?? {}).map(([key, d]) => ({ key, label: d.label, description: d.description })),
      // (the app's switches in its sheet: File explorer's)
      ...switches.filter((w) => w.plugin?.id === p.id && !p.settingsDecls?.[w.plugin.key]).map((w) => ({ key: w.plugin!.key, label: w.name, description: w.sub?.() })),
      ...(p.settingsSearch ?? []),
      ...(store.filing?.homes ?? []).filter((h) => h.plugin === p.id).map((h) => ({ key: `folder-${h.key}`, label: `${h.label} folder`, description: `where new ${h.label.toLowerCase()} go` })),
    ]
    const sheet = `[data-plugin-settings-sheet="${CSS.escape(p.id)}"]`
    return [
      { id: `plugin:${p.id}`, label: settingsTitle(p.name), where: "Plugin", words: "", run: () => show(`plugin:${p.id}`) },
      ...own.map((e, i): Found => ({ id: `plugin:${p.id}:${e.key ?? i}`, label: e.label, sub: e.description ? capitalize(e.description) : "",
        where, words: e.key ?? "", run: () => show(`plugin:${p.id}`, e.key ? `${sheet} [data-setting="${CSS.escape(e.key)}"]` : undefined),
        switch: isEnabled(p.id, disabled) ? switchOf(p.id, e.key) : undefined })),
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
  useSwitches()
  return (
    <Panel>
      {found.length ? (
        <div className="hairline" data-settings-results>
          {/* A switch flips where it's found; the rest of its row still goes to it. */}
          {found.map((f) => f.switch ? (
            <div key={f.id} className="flex min-h-12 items-center gap-3 py-2" data-settings-result={f.id}>
              <button type="button" onClick={f.run} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] leading-[20px]">{f.label}</span>
                  {f.sub && <span className="block text-[13px] leading-[18px] text-muted-foreground">{f.sub}</span>}
                </span>
                <span className="max-w-[40%] shrink-0 truncate text-right text-[14px] text-muted-foreground">{f.where}</span>
              </button>
              <Switch on={f.switch.get()} onChange={(on) => void f.switch!.set(on)} label={f.label} />
            </div>
          ) : (
            <SettingRow key={f.id} label={f.label} sub={f.sub || undefined} value={f.where} onClick={f.run} data-settings-result={f.id} />
          ))}
        </div>
      ) : <p className="py-2 text-[15px] text-muted-foreground">No settings match “{query}”</p>}
    </Panel>
  )
}

/** Where Plugins' way back goes: the section shown before it. */
let before = CORE[0].id

export function Settings({ store }: { store: Store }) {
  const { disabled, order } = usePrefs()
  const [query, setQuery] = useState("")
  const q = query.trim()
  const rail = useRail(), wide = rail[1]
  const current = shown.use()
  // A plugin turned off takes its section with it: back to the first.
  const sec = sectionOf(current, disabled) ?? CORE[0]
  const show: Show = (id, selector) => {
    setQuery("")
    if (wide) {
      if (id === PLUGINS_SEC.id && sec.id !== id) before = sec.id
      shown.set(id)
      if (selector) revealRow(selector)
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
  const items = menu(store, disabled)
  // Plugins has a menu of its own: it takes this one's place, with a way back.
  if (wide && sec.id === PLUGINS_SEC.id) return <div ref={rail[0]} className="h-full" data-settings data-settings-section={sec.id}><Plugins store={store} back={{ label: "Settings", run: () => shown.set(before) }} /></div>
  return (
    <div className="h-full" data-settings>
      <RailLayout rail={rail} label="Settings" items={items} active={q ? null : litOf(sec.id)} pick={(id) => show(id)} page={q ? "search" : sec.id} narrow="list" title="Settings"
        search={{ value: query, onChange: setQuery, placeholder: "Search settings", onSubmit: () => found[0]?.run(), attrs: { "data-settings-search": "" } }}
        menuAttrs={{ "data-settings-list": "" }}>
        {q ? <>{wide && <SheetHead icon={Search} tint="var(--primary)" title="Search results" />}<Results found={found} query={q} /></>
          : wide ? (
            <div data-settings-section={sec.id}>
              <Catch key={sec.id} fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{sec.render(store)}</Catch>
            </div>
          ) : <RailMenu label="Settings" items={items} active={null} pick={(id) => show(id)} data-settings-list="" />}
      </RailLayout>
    </div>
  )
}
