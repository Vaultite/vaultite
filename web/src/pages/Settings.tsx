// Settings: sections beside the one shown (a sheet each where narrow), headed by Your setup (a way to Setup's page).
// Plugins add pages (`settingsPages`); `alwaysOn` ones' options are under Features, the others' a gear away in Setup.
import { useMemo, useState, useEffect, type ReactNode } from "react"
import { ChevronRight, Keyboard, Palette, PenLine, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { desktop as desktopApp, type UpdateMode } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { APP_PAGES, openSetup } from "@/core/apppages"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, pluginById, tintOfPlugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, revealRow, withSettings, settingsTitle } from "@/core/pluginSettings"
import { setPrefs, usePrefs } from "@/core/prefs"
import { cell } from "@/core/signal"
import { textSizeKinds } from "@/core/textsize"
import { allSwitches, placeOf, useSwitches, type SwitchDef } from "@/core/switches"
import { capitalize, cn } from "@/lib/utils"
import { HotkeysSheet } from "@/pages/Hotkeys"
import { Panel, Segmented, SettingRow, SheetHead, Switch } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
import { PluginSettings } from "@/components/PluginSettings"
import { AppearancePanel } from "@/components/Appearance"
import { EditorPanel } from "@/components/EditorSettings"
import { PermissionsPanel } from "@/components/Permissions"
import { Catch } from "@/components/Guard"
import { notifyError } from "@/core/notify"
import { API_VERSION, APP_VERSION } from "../../../core/version.ts"
import { policyOf, type UpdatePolicy } from "../../../core/updates.ts"

/** Which section is shown: kept while the app runs, so Settings reopens where it was. */
const settingsSection = cell("general")

const byName = new Intl.Collator(undefined, { sensitivity: "base" })

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

const PLUGIN_UPDATES: Record<UpdatePolicy, string> = {
  vaultite: "Vaultite's own update by themselves; others wait for you to update them",
  all: "Every installed plugin updates by itself, on each machine that allowed it",
  off: "None: update each from its page in Plugins",
}

/** Which installed plugins update on their own (plugins.json `updates`): Vaultite's, all of them, or none. */
function PluginUpdatesRow() {
  const policy = policyOf(usePrefs())
  return (
    <SettingRow stack label="Plugin updates" sub={PLUGIN_UPDATES[policy]} data-settings-row="plugin-updates">
      <Segmented<UpdatePolicy> label="Which plugins update on their own" value={policy} onChange={(v) => void setPrefs({ updates: v })} className="w-full shrink-0 sm:w-[260px]"
        options={[{ value: "vaultite", label: "Vaultite's" }, { value: "all", label: "All" }, { value: "off", label: "None" }]} />
    </SettingRow>
  )
}

/** The vault this window shows (Manage vaults: the others, a new one), the app's version and its updates, and its
 *  plugins'. */
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
        <PluginUpdatesRow />
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
  // (macOS's: the desktop app on a Mac only)
  ...(desktopApp?.permission ? [{ id: "permissions", label: "Permissions", icon: ShieldCheck, render: () => <>
    <SheetHead icon={ShieldCheck} tint="var(--primary)" title="Permissions" sub="What macOS lets Vaultite do on this Mac" />
    <PermissionsPanel />
  </> }] : []),
]
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
  return CORE.find((s) => s.id === id) ?? pluginPages(disabled).find((s) => s.id === id) ?? null
}

/** One section on its own: the sheet a narrow pane opens (`settings-section/<id>`). */
export function SettingsSection({ store, id }: { store: Store; id: string }) {
  const { disabled } = usePrefs()
  const s = sectionOf(id, disabled)
  if (!s) return <SheetHead icon={SlidersHorizontal} tint="var(--muted-foreground)" title="Not found" />
  return <Catch fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{s.render(store)}</Catch>
}

/** The menu: the app's sections, plugins' pages, then the options of the app's own plugins (Features). */
function menu(store: Store, disabled: string[]): RailItem[] {
  const pages = pluginPages(disabled)
  const options = withSettings(store, disabled).filter((p) => p.alwaysOn).sort((a, b) => byName.compare(a.name, b.name))
  const item = (s: Sec, more: Partial<RailItem> = {}): RailItem => ({ id: s.id, label: s.label, icon: s.icon, tint: s.tint, attrs: { "data-settings-nav": s.id }, ...more })
  return [
    ...CORE.map((s) => item(s)),
    ...pages.map((s, i) => item(s, { gap: i === 0 })),
    ...options.map((p, i) => item(pluginSec(p.id)!, { heading: i === 0 ? "Features" : undefined })),
  ]
}

/** What the menu lights: for a plugin's settings found by search, its own (under Features), the section its switch is
 *  in (Vim keys: Editor), else none (it's switched on Setup's Plugins). */
function litOf(active: string) {
  const of = active.startsWith("plugin:") ? pluginById(active.slice(7)) : null
  return of && !of.alwaysOn ? of.switchIn?.section ?? null : active
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
    // (Setup's tabs, a page of their own)
    { id: "bundles", label: "Bundles", sub: "Try another setup, save and share yours", where: "Setup", words: "your setup save share import restore", run: () => openSetup("bundles") },
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off, get more", where: "Setup", words: "extensions install", run: () => openSetup("plugins") },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    { ...row("new-tabs", "New tabs open", "Appearance", '[data-settings-row="new-tabs"]', "Their page, the quick switcher or a web page"), words: "new tab launcher start blank address browser" },
    { id: "sidebars", label: "Sidebars", where: "Appearance", words: "panels customize arrange left right hide show", run: () => openDetail("sidebars") },
    // (its rows show only at a phone's width, where pulling works)
    ...(isDesktop() ? [] : [{ ...row("pull-actions", "Pull-down actions", "Appearance", '[data-settings-row="pull-0"]'), words: "pull down gesture phone swipe new note search close tab" }]),
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...textSizeKinds(disabled, order).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    // (every switch: the app's, and plugins switched on and off here, Vim keys; File explorer's are its plugin's, below)
    ...switches.filter((w) => !w.plugin).map((w): Found => {
      const row = w.id.replace(/^setting:/, "")
      return { id: row, label: w.name, sub: w.sub?.(), where: placeOf(w).name, words: w.words ?? "", run: w.section === "sidebars" ? placeOf(w).open : () => show(w.section ?? "appearance", `[data-settings-row="${row}"]`), switch: w }
    }),
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => show("hotkeys") },
    { ...row("vaults", "Manage vaults", "General", "[data-settings-vault]", store.vault.path), words: "vault folder" },
    row("version", "Version", "General", '[data-settings-row="version"]', "Vaultite and its plugin API"),
    ...(desktopApp?.permission ? [{ id: "permissions", label: "Permissions", sub: "What macOS lets Vaultite do", where: "Settings", run: () => show("permissions"),
      words: "privacy security macos microphone camera location accessibility screen recording input monitoring automation files folders desktop documents downloads full disk access icloud vault signed signature" }] : []),
    ...(desktopApp?.updates ? [{ ...row("updates", "Updates", "General", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
    { ...row("plugin-updates", "Plugin updates", "General", '[data-settings-row="plugin-updates"]', "Vaultite's, all or none"), words: "update automatically plugins" },
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

/** What the search found, in the menu's place, each saying where it is: the one picked lit (System Settings' way). */
function Results({ found, query, picked, choose }: { found: Found[]; query: string; picked: string | null; choose: (f: Found) => void }) {
  useSwitches()
  if (!found.length) return <p className="px-1.5 py-2 text-[13px] text-muted-foreground" data-settings-results>No settings match “{query}”</p>
  return (
    <div className="flex flex-col gap-px" role="listbox" aria-label="Settings found" data-settings-results>
      {/* A switch flips where it's found; the rest of its row still goes to it. */}
      {found.map((f) => (
        <div key={f.id} role="option" aria-selected={picked === f.id} data-settings-result={f.id}
          className={cn("flex items-center gap-2 rounded-[6px] pr-1.5", picked === f.id ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]")}>
          <button type="button" onClick={() => choose(f)} className="flex min-w-0 flex-1 cursor-pointer flex-col py-1 pl-1.5 text-left">
            <span className="truncate text-[13px] leading-[18px] font-medium">{f.label}</span>
            <span className="truncate text-[12px] leading-[16px] text-muted-foreground">{f.where}</span>
          </button>
          {f.switch && <Switch on={f.switch.get()} onChange={(on) => void f.switch!.set(on)} label={f.label} />}
        </div>
      ))}
    </div>
  )
}

/** Narrow, the page is the menu: what the search found is the list. */
function FoundList({ found, query }: { found: Found[]; query: string }) {
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

const SETUP = APP_PAGES.find((p) => p.id === "setup")!

/** Your setup, heading the menu: the bundle it came from (when one was applied here). It isn't a section: it goes to
 *  Setup's page, on Bundles. */
function SetupCard({ store }: { store: Store }) {
  const from = store.bundles?.previous?.name
  return (
    <button type="button" onClick={() => openSetup("bundles")} data-settings-setup
      className="mb-3 flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] bg-foreground/[0.03] p-2 text-left transition-colors hover:bg-foreground/[0.06]">
      <span className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-primary text-primary-foreground md:size-8 md:rounded-[8px]">
        <SETUP.icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] leading-[22px] font-semibold md:text-[13px] md:leading-[18px]">Your setup</span>
        <span className="block truncate text-[15px] leading-[20px] text-muted-foreground md:text-[12px] md:leading-[16px]">
          {from ? `Based on ${from}` : "Bundles and plugins"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </button>
  )
}

export function Settings({ store }: { store: Store }) {
  const { disabled, order } = usePrefs()
  const [query, setQuery] = useState("")
  // The find picked: lit in the list, where Enter goes (else the first).
  const [picked, setPicked] = useState<string | null>(null)
  const q = query.trim()
  const rail = useRail(), wide = rail[1]
  const current = settingsSection.use()
  // A plugin turned off takes its section with it: back to the first.
  const sec = sectionOf(current, disabled) ?? CORE[0]
  const show: Show = (id, selector) => {
    if (wide) {
      settingsSection.set(id)
      if (selector) revealRow(selector)
    } else if (id.startsWith("plugin:")) {
      const key = selector?.match(/data-setting="(.*)"\]$/)?.[1]
      openPluginSettings(id.slice(7), key ? key.replace(/\\(.)/g, "$1") : undefined)
    } else {
      openDetail(`settings-section/${encodeURIComponent(id)}`)
      if (selector) revealRow(selector)
    }
  }
  const found = useMemo(() => (q ? search(findable(store, disabled, order, show), q) : []), [store, disabled, order, q, wide])
  const lit = found.find((f) => f.id === picked) ?? null
  // (the search stays, so the next find is a click or an arrow away)
  const choose = (f: Found) => { setPicked(f.id); f.run() }
  // The arrows only light one (some open a sheet, which would take the keys): Enter goes there.
  const move = (by: 1 | -1) => {
    if (!found.length) return
    const i = lit ? found.indexOf(lit) : -1
    const f = found[Math.min(found.length - 1, Math.max(0, i + by))]
    setPicked(f.id)
    requestAnimationFrame(() => document.querySelector(`[data-settings-result="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: "nearest" }))
  }
  const typed = (v: string) => { setQuery(v); setPicked(null) }
  const items = menu(store, disabled)
  const setup = <SetupCard store={store} />
  const menuOf = (active: string | null) => <RailMenu label="Settings" items={items} active={active} pick={(id) => show(id)} data-settings-list="" />
  const list = (active: string | null) => <>{setup}{menuOf(active)}</>
  return (
    <div data-settings>
      <RailLayout rail={rail} page={sec.id} title="Settings"
        side={q ? <Results found={found} query={q} picked={picked} choose={choose} /> : list(litOf(sec.id))}
        search={{ value: query, onChange: typed, placeholder: "Search settings", attrs: { "data-settings-search": "" },
          onSubmit: () => { const f = lit ?? found[0]; if (!f) return; if (wide) choose(f); else f.run() }, onMove: wide ? move : undefined }}>
        {wide ? (
          <div data-settings-section={sec.id}>
            <Catch key={sec.id} fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{sec.render(store)}</Catch>
          </div>
        ) : q ? <FoundList found={found} query={q} />
          // (the page, a phone's or a narrow pane's: its rows a size up, as every page of the sidebar's lists)
          : <>{setup}<div className="size-up-bleed"><div data-size-up>{menuOf(null)}</div></div></>}
      </RailLayout>
    </div>
  )
}
