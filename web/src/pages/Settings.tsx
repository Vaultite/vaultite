// Settings: the app's own, short (plugins' options are their settings sheets), saved in the vault (prefs.ts). Search
// finds the app's rows and every plugin's settings (`settingsSearch`), opening its sheet there.
import { useEffect, useMemo, useState } from "react"
import { ChevronRight, SlidersHorizontal } from "lucide-react"
import type { Store } from "@/core/data"
import { desktop as desktopApp, type UpdateMode } from "@/core/desktop"
import { go, isDesktop } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, tintOfPlugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, revealRow, withSettings, settingsTitle } from "@/core/pluginSettings"
import { usePrefs } from "@/core/prefs"
import { textSizeKinds } from "@/core/textsize"
import { capitalize } from "@/lib/utils"
import { Hotkeys } from "@/pages/Hotkeys"
import { FilterField, PageHeader, Panel, Segmented, SettingRow, SheetHead } from "@/components/kit"
import { AppearancePanel } from "@/components/Appearance"
import { EditorPanel } from "@/components/EditorSettings"
import { openBundles, restoreSetup } from "@/core/bundles"
import { notifyError } from "@/core/notify"
import { API_VERSION, APP_VERSION } from "../../../core/version.ts"

const byName = new Intl.Collator(undefined, { sensitivity: "base" })

/** The Plugins page, the way Bundles opens its own (core/bundles.ts openBundles). */
const openPlugins = () => { if (isDesktop()) go("plugins"); else location.hash = "#plugins" }

/** The plugins that are on and have settings: one row saying how many, which opens their list in a sheet. */
function PluginSettingsRow({ store }: { store: Store }) {
  const { disabled } = usePrefs()
  const n = withSettings(store, disabled).length
  if (!n) return null
  return <SettingRow label="Plugin settings" value={`${n} plugins`} onClick={() => openDetail("plugin-settings")} data-plugin-settings-open />
}

/** The sheet: one row per plugin that has settings, each opening its own sheet over this one. */
export function PluginSettingsSheet({ store }: { store: Store }) {
  const { disabled } = usePrefs()
  const list = withSettings(store, disabled).sort((a, b) => byName.compare(a.name, b.name))
  return (
    <>
      <SheetHead icon={SlidersHorizontal} tint="var(--primary)" kicker="Settings" title="Plugin settings" sub="Each plugin's options" />
      <div className="hairline flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => openPluginSettings(p.id)} data-plugin-settings={p.id}
            className="flex h-11 w-full cursor-pointer items-center gap-2.5 text-left md:h-10">
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-muted md:size-6 md:rounded-[6px]" style={{ color: tintOfPlugin(p.id) }}>
              <p.icon className="size-4 md:size-[15px]" strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px] md:text-[14px]">{p.name}</span>
            <ChevronRight className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
          </button>
        ))}
      </div>
    </>
  )
}

/** The plugins' rows in Setup (`setup`), of those that are on. */
const setupRows = (disabled: string[]) => PLUGINS.flatMap((p) => (p.setup && isEnabled(p.id, disabled) ? [{ id: p.id, ...p.setup }] : []))

/** Bundles (core/bundles.ts): a whole setup of the app at once, and the one from before the last applied; then the
 *  Plugins page and each plugin's settings. */
function SetupPanel({ store }: { store: Store }) {
  const prev = store.bundles?.previous ?? null
  const { disabled } = usePrefs()
  return (
    <Panel title="Setup">
      <div className="hairline flex flex-col [&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
        {setupRows(disabled).map((r) => <SettingRow key={r.id} label={r.label} sub={r.sub} onClick={r.run} data-settings-setup={r.id} />)}
        <SettingRow label="Bundles" onClick={openBundles} data-settings-bundles />
        {prev && <SettingRow label="Restore previous setup"
          onClick={() => restoreSetup().catch((e) => notifyError(e, "Couldn't restore it"))} data-settings-restore />}
        <SettingRow label="Plugins" onClick={openPlugins} data-settings-plugins />
        <PluginSettingsRow store={store} />
      </div>
    </Panel>
  )
}

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

/** The vault this window shows (Manage vaults: the others, a new one) and the app's version. */
function VaultPanel({ store }: { store: Store }) {
  const path = store.vault.path
  const name = path.split("/").filter(Boolean).pop() ?? "Vault"
  return (
    <Panel title="Vault">
      <div className="hairline">
        <SettingRow label={name} sub={<span className="break-all">{path}</span>} value="Manage vaults" data-settings-vault
          onClick={() => { if (desktopApp) void desktopApp.manageVaults(); else openDetail("vaults") }} />
        <SettingRow label="Vaultite" data-settings-row="version" sub={`Plugin API ${API_VERSION}`} value={APP_VERSION} />
        <UpdatesRow />
      </div>
    </Panel>
  )
}

// ---------- search

/** A setting search finds: `where` it is (Appearance, a plugin's name), and what choosing it does. */
type Found = { id: string; label: string; sub?: string; where: string; words: string; run: () => void }

/** Everything on this page and in plugins' sheets that search can find. `back`: choosing a row of this page clears the
 *  search first, so the row is drawn to go to. */
function findable(store: Store, disabled: string[], order: string[], back: () => void): Found[] {
  const row = (id: string, label: string, where: string, selector: string, sub = ""): Found =>
    ({ id, label, sub, where, words: "", run: () => { back(); revealRow(selector) } })
  const app: Found[] = [
    ...setupRows(disabled).map((r) => ({ id: `setup-${r.id}`, label: r.label, sub: r.sub, where: "Setup", words: "", run: r.run })),
    { id: "bundles", label: "Bundles", sub: "A whole setup of the app at once", where: "Setup", words: "setup", run: openBundles },
    ...(store.bundles?.previous ? [row("restore", "Restore previous setup", "Setup", "[data-settings-restore]")] : []),
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off, add your own", where: "Setup", words: "extensions", run: openPlugins },
    { id: "plugin-settings", label: "Plugin settings", sub: "Each plugin's options", where: "Setup", words: "", run: () => openDetail("plugin-settings") },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    row("file-icons", "File icons", "Appearance", '[data-settings-row="file-icons"]'),
    row("line-numbers", "Line numbers", "Appearance", '[data-settings-row="line-numbers"]'),
    { ...row("sidebar-scroll", "Scroll sidebar panels separately", "Appearance", '[data-settings-row="sidebar-scroll"]'), words: "sidebars" },
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...textSizeKinds(disabled, order).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("readable-line-length", "Readable line length", "Editor", '[data-settings-row="readable-line-length"]'), words: "width wide column" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("spellcheck", "Spellcheck", "Editor", '[data-settings-row="spellcheck"]'), words: "spelling spell check" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    { ...row("auto-pair-brackets", "Auto-pair brackets", "Editor", '[data-settings-row="auto-pair-brackets"]'), words: "close brackets quotes autopair" },
    { ...row("auto-pair-markdown", "Auto-pair Markdown", "Editor", '[data-settings-row="auto-pair-markdown"]'), words: "wrap selection bold italic autopair" },
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => openDetail("hotkeys") },
    { id: "vaults", label: "Manage vaults", sub: store.vault.path, where: "Vault", words: "vault folder",
      run: () => { if (desktopApp) void desktopApp.manageVaults(); else openDetail("vaults") } },
    row("version", "Version", "Vault", '[data-settings-row="version"]', "Vaultite and its plugin API"),
    ...(desktopApp?.updates ? [{ ...row("updates", "Updates", "Vault", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
  ]
  const plugins = PLUGINS.filter((p) => hasSettings(p, store.pluginSettings ?? [])).sort((a, b) => byName.compare(a.name, b.name)).flatMap((p) => {
    const where = isEnabled(p.id, disabled) ? p.name : `${p.name} (off)`
    const own = [
      ...Object.entries(p.settingsDecls ?? {}).map(([key, d]) => ({ key, label: d.label, description: d.description })),
      ...(p.settingsSearch ?? []),
      ...(store.filing?.homes ?? []).filter((h) => h.plugin === p.id).map((h) => ({ key: `folder-${h.key}`, label: `${h.label} folder`, description: `where new ${h.label.toLowerCase()} go` })),
    ]
    return [
      { id: `plugin:${p.id}`, label: settingsTitle(p.name), where: "Plugin", words: "", run: () => openPluginSettings(p.id) },
      ...own.map((e, i): Found => ({ id: `plugin:${p.id}:${e.key ?? i}`, label: e.label, sub: e.description ? capitalize(e.description) : "",
        where, words: e.key ?? "", run: () => openPluginSettings(p.id, e.key) })),
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

export function Settings({ store }: { store: Store }) {
  const { disabled, order } = usePrefs()
  const [query, setQuery] = useState("")
  const q = query.trim()
  const found = useMemo(() => (q ? search(findable(store, disabled, order, () => setQuery("")), q) : []), [store, disabled, order, q])
  return (
    <>
      <PageHeader title="Settings" />
      {/* Enter goes to the first one found. */}
      <form role="search" className="mb-4 flex" onSubmit={(e) => { e.preventDefault(); found[0]?.run() }} data-settings-search>
        <FilterField value={query} onChange={setQuery} placeholder="Search settings" />
      </form>
      {q ? <Results found={found} query={q} /> : (
        <div className="grid grid-cols-1 gap-4">
          <SetupPanel store={store} />
          <AppearancePanel />
          <EditorPanel store={store} />
          <Hotkeys />
          <VaultPanel store={store} />
        </div>
      )}
    </>
  )
}
