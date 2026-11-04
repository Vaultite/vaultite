// Settings: sections beside the one shown (a sheet each where narrow). The app's own plugins' settings are parts of the
// section their kind belongs to (Search field's in Files); optional plugins' are a gear away on Plugins, the menu's last.
import { useMemo, useState, useEffect, type ReactNode } from "react"
import { Cog, FolderOpen, Keyboard, Palette, PenLine, ShieldCheck, SlidersHorizontal, Sparkles, type LucideIcon } from "lucide-react"
import type { Store } from "@/core/data"
import { desktop as desktopApp, type UpdateMode } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { APP_PAGES, openSetup, settingsSection } from "@/core/apppages"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, pluginById, tileTint, type Plugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, revealRow, settingsApart, settingsHome, settingsTitle, withSettings } from "@/core/pluginSettings"
import { setPrefs, usePrefs } from "@/core/prefs"
import { textSizeKinds } from "@/core/textsize"
import { allSwitches, placeOf, useSwitches, type SwitchDef } from "@/core/switches"
import { PLUGIN_UPDATE_POLICIES } from "@/core/choices"
import { capitalize, cn } from "@/lib/utils"
import { HotkeysSheet } from "@/pages/Hotkeys"
import { DenseRows, Group, IconTile, Logo, Panel, Section, Segmented, SettingRow, SheetHead, Switch } from "@/components/kit"
import { RailLayout, RailMenu, useRail, type RailItem } from "@/components/RailLayout"
import { PluginSettings } from "@/components/PluginSettings"
import { AppearancePanel } from "@/components/Appearance"
import { EditorPanel } from "@/components/EditorSettings"
import { PermissionsPanel } from "@/components/Permissions"
import { aiParts, AiPanel } from "@/components/AiSettings"
import { aiOn } from "@/core/ai"
import { Catch } from "@/components/Guard"
import { notifyError } from "@/core/notify"
import { APP_VERSION } from "../../../core/version.ts"
import { policyOf, type UpdatePolicy } from "../../../core/updates.ts"

const SETUP = APP_PAGES.find((p) => p.id === "setup")!

const byName = new Intl.Collator(undefined, { sensitivity: "base" })
/** The section a built-in plugin's settings are in, by name: what search says is where they are. */
const homeName = (p: Plugin) => { const h = settingsHome(p); return h ? CORE.find((s) => s.id === h)?.label ?? null : null }

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
        options={PLUGIN_UPDATE_POLICIES} />
    </SettingRow>
  )
}

/** The app's version, how it updates (the desktop app's) and how its plugins do. The vault is the sidebar's: its menu
 *  manages vaults. */
function Updates() {
  return (
    <Group>
      <div className="flex min-h-14 items-center gap-3 py-2" data-settings-row="version">
        <Logo className="size-9 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] leading-[20px] font-semibold md:text-[13px] md:leading-[18px]">Vaultite</div>
          <div className="text-[13px] leading-[18px] text-muted-foreground tabular-nums md:text-[12px] md:leading-[16px]">Version {APP_VERSION}</div>
        </div>
      </div>
      <UpdatesRow />
      <PluginUpdatesRow />
    </Group>
  )
}

// ---------- sections

/** A section: the app's own (appearance, editor…), with its plugins' settings under it; a plugin's page
 *  (`<plugin>:<page>`); or an optional plugin's settings (`plugin:<id>`, found by search: its sheet's). */
type Sec = { id: string; label: string; icon: LucideIcon; tint?: string; render: (store: Store) => ReactNode }
const headed = (id: string, label: string, icon: LucideIcon, tint: string, body: (store: Store) => ReactNode, sub?: string): Sec =>
  ({ id, label, icon, tint, render: (store) => <><SheetHead icon={icon} tint={tint} title={label} sub={sub} />{body(store)}<Members store={store} section={id} /></> })
const CORE: Sec[] = [
  headed("appearance", "Appearance", Palette, "var(--blue)", () => <AppearancePanel />),
  headed("editor", "Editor", PenLine, "var(--orange)", (store) => <EditorPanel store={store} />),
  headed("files", "Files", FolderOpen, "var(--teal)", () => null, "Finding, opening and keeping track of them"),
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard, tint: "var(--gray)", render: () => <HotkeysSheet /> },
  // (first of the setup's own: the app's plugins' pages follow it)
  headed("ai", "AI", Sparkles, "var(--purple)", (store) => <AiPanel store={store} />),
  headed("general", "General", Cog, "var(--gray)", () => <Updates />),
  // (macOS's: the desktop app on a Mac only)
  ...(desktopApp?.permission ? [headed("permissions", "Permissions", ShieldCheck, "var(--blue)", () => <PermissionsPanel />, "What macOS lets Vaultite do on this Mac")] : []),
]
/** The app's sections with something of a plugin's between them: AI heads the app's plugins' pages, General and
 *  Permissions go after them. */
const AFTER = ["ai"], LAST = ["general", "permissions"]

/** The app's own plugins whose settings a section draws under its own (pluginSettings.ts' settingsHome), by name. */
function membersOf(store: Store, disabled: string[], section: string) {
  return withSettings(store, disabled).filter((p) => settingsHome(p) === section).sort((a, b) => byName.compare(a.name, b.name))
}

/** Those plugins' settings, each under its name; a long form is a row to its sheet. */
function Members({ store, section }: { store: Store; section: string }) {
  const { disabled } = usePrefs()
  const list = membersOf(store, disabled, section)
  if (!list.length) return null
  const drawn = list.filter((p) => !settingsApart(p)), apart = list.filter(settingsApart)
  return (
    <div className="mt-6 flex flex-col gap-6" data-settings-members={section}>
      {drawn.map((p) => (
        <section key={p.id} aria-label={p.name} data-settings-member={p.id}>
          <Section title={p.name}>
            <Catch fallback={() => <p className="text-[13px] text-muted-foreground">Its settings couldn't be drawn.</p>}>
              <PluginSettings store={store} plugin={p} embedded />
            </Catch>
          </Section>
        </section>
      ))}
      {!!apart.length && (
        <Section title="More">
          <Group>
            {apart.map((p) => (
              <SettingRow key={p.id} data-settings-member={p.id} onClick={() => openPluginSettings(p.id)} sub={`${Object.keys(p.settingsDecls ?? {}).length} settings`}
                label={<span className="flex items-center gap-2"><IconTile icon={p.icon} tint={tileTint(p.id)} className="size-5 rounded-[5px]" iconClassName="size-3" />{p.name}</span>} />
            ))}
          </Group>
        </Section>
      )}
    </div>
  )
}

/** The pages plugins that are on add (MCP's Remote access; Apple Health), in plugin order; not those drawn in the AI
 *  section (AiSettings.tsx). */
function pluginPages(disabled: string[]): (Sec & { plugin: Plugin })[] {
  return PLUGINS.filter((p) => p.settingsPages && isEnabled(p.id, disabled)).flatMap((p) =>
    Object.entries(p.settingsPages!).filter(([, d]) => !d.in).map(([k, d]) => ({ ...headed(`${p.id}:${k}`, d.label, d.icon, tileTint(p.id), (store) => d.render({ store }), d.sub), plugin: p })))
}

const pluginSec = (id: string): Sec | null => {
  const p = pluginById(id)
  return p ? { id: `plugin:${p.id}`, label: p.name, icon: p.icon, tint: tileTint(p.id), render: (store) => <PluginSettings store={store} plugin={p} /> } : null
}

function sectionOf(id: string, disabled: string[]): Sec | null {
  if (id.startsWith("plugin:")) return pluginSec(id.slice(7))
  return CORE.find((s) => s.id === id) ?? pluginPages(disabled).find((s) => s.id === id) ?? null
}

/** Where a plugin's settings are: the app's own in their section (one apart: its sheet), the others' their sheet. */
function placeOfPlugin(id: string): { section: string } | { sheet: string } {
  const p = pluginById(id), home = p && settingsHome(p)
  return home && !settingsApart(p) ? { section: home } : { sheet: id }
}

/** One section on its own: the sheet a narrow pane opens (`settings-section/<id>`). */
export function SettingsSection({ store, id }: { store: Store; id: string }) {
  const { disabled } = usePrefs()
  const s = sectionOf(id, disabled)
  if (!s) return <SheetHead icon={SlidersHorizontal} tint="var(--muted-foreground)" title="Not found" />
  return <Catch fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{s.render(store)}</Catch>
}

/** The menu: the app's sections, the app's plugins' pages (AI's), General and Permissions, then Plugins (their page)
 *  with the pages optional plugins add. */
function menu(disabled: string[]): RailItem[] {
  const pages = pluginPages(disabled)
  const item = (s: Sec, more: Partial<RailItem> = {}): RailItem => ({ id: s.id, label: s.label, icon: s.icon, tint: s.tint, attrs: { "data-settings-nav": s.id }, ...more })
  const last = CORE.filter((s) => LAST.includes(s.id))
  const on = PLUGINS.filter((p) => !p.alwaysOn && isEnabled(p.id, disabled)).length
  return [
    ...CORE.filter((s) => !LAST.includes(s.id) && !AFTER.includes(s.id)).map((s) => item(s)),
    ...[...CORE.filter((s) => AFTER.includes(s.id)), ...pages.filter((s) => s.plugin.alwaysOn)].map((s, i) => item(s, { gap: i === 0 })),
    ...last.map((s, i) => item(s, { gap: i === 0 })),
    { id: PLUGINS_ITEM, label: "Plugins", icon: SETUP.icon, tint: "var(--primary)", count: on, gap: true, attrs: { "data-settings-nav": PLUGINS_ITEM, "data-settings-setup": "" } },
    ...pages.filter((s) => !s.plugin.alwaysOn).sort((a, b) => byName.compare(a.label, b.label)).map((s) => item(s)),
  ]
}
/** The menu's Plugins: not a section, it opens the Plugins page. */
const PLUGINS_ITEM = "plugins"

/** What the menu lights: for an optional plugin's settings found by search, the section its switch is in (Vim keys:
 *  Editor), else none (it's switched on Plugins). */
function litOf(active: string) {
  const of = active.startsWith("plugin:") ? pluginById(active.slice(7)) : null
  return of ? of.switchIn?.section ?? null : active
}

// ---------- search

/** A setting search finds: `where` it is (Appearance, a plugin's name), and what choosing it does; a switch is flipped
 *  right there. */
type Found = { id: string; label: string; sub?: string; where: string; words: string; run: () => void; switch?: SwitchDef }
/** Goes to a section, and to the row `selector` finds in it: beside the list, or in a sheet where the pane is narrow. */
type Show = (section: string, selector?: string) => void

/** Everything in the sections and in plugins' settings that search can find. */
function findable(store: Store, disabled: string[], show: Show): Found[] {
  const switches = allSwitches(disabled)
  const switchOf = (plugin: string, key?: string) => switches.find((w) => w.plugin?.id === plugin && w.plugin.key === key)
  const row = (id: string, label: string, where: string, selector: string, sub = ""): Found =>
    ({ id, label, sub, where, words: "", run: () => show(where.toLowerCase(), selector) })
  const app: Found[] = [
    ...pluginPages(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, where: "Settings", words: "", run: () => show(s.id) })),
    // (the AI section's parts, while it's on)
    ...(aiOn() ? [
      { ...row("coding-agents", "Coding agents", "AI", "[data-ai-agents]", "Which run in Vaultite's terminals, and your companion"), words: "claude code codex cursor opencode openclaw hermes companion terminal" },
      ...aiParts(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, sub: s.sub, where: "AI", words: "", run: () => show("ai", `[data-ai-part="${s.id}"]`) })),
    ] : []),
    // (Setup's tabs, a page of their own)
    { ...row("layout", "Layout", "Appearance", "[data-layout-picker]", "Standard, Zen, Browser or yours"), words: "bundle setup zen browser standard save share restore" },
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off", where: "Plugins", words: "extensions install setup features", run: () => openSetup("plugins") },
    { id: "get", label: "Get plugins and layouts", sub: "From Vaultite's directory, or import a bundle", where: "Plugins", words: "store install bundles packs import", run: () => openSetup("get") },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    { ...row("animation", "Animations", "Appearance", '[data-settings-row="animation"]', "Natural, snappy or off"), words: "motion reduce speed spring" },
    { ...row("new-tabs", "New tabs open", "Appearance", '[data-settings-row="new-tabs"]', "Their page, the quick switcher or a web page"), words: "new tab launcher start blank address browser" },
    { id: "sidebars", label: "Sidebars", where: "Appearance", words: "panels customize arrange left right hide show", run: () => openDetail("sidebars") },
    // (its rows show only at a phone's width, where pulling works)
    ...(isDesktop() ? [] : [{ ...row("pull-actions", "Pull-down actions", "Appearance", '[data-settings-row="pull-0"]'), words: "pull down gesture phone swipe new note search close tab" }]),
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...textSizeKinds(disabled).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("default-view", "Default view for new tabs", "Editor", '[data-settings-row="default-view"]', "Editing or reading"), words: "reading view preview open new note tab mode" },
    { ...row("editing-mode", "Default editing mode", "Editor", '[data-settings-row="editing-mode"]', "Live preview or source mode"), words: "source mode live preview markdown raw view" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    // (every switch: the app's, and plugins switched on and off here, Vim keys; File explorer's are its plugin's, below)
    ...switches.filter((w) => !w.plugin).map((w): Found => {
      const row = w.id.replace(/^setting:/, "")
      return { id: row, label: w.name, sub: w.sub?.(), where: placeOf(w).name, words: w.words ?? "", run: w.section === "sidebars" ? placeOf(w).open : () => show(w.section ?? "appearance", `[data-settings-row="${row}"]`), switch: w }
    }),
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => show("hotkeys") },
    { id: "vaults", label: "Manage vaults", sub: store.vault.path, where: "Vaults", words: "vault folder",
      run: () => { if (desktopApp) void desktopApp.manageVaults(); else openDetail("vaults") } },
    { ...row("version", "Version", "General", '[data-settings-row="version"]', `Vaultite ${APP_VERSION}`), words: "about" },
    ...(desktopApp?.permission ? [{ id: "permissions", label: "Permissions", sub: "What macOS lets Vaultite do", where: "Settings", run: () => show("permissions"),
      words: "privacy security macos microphone camera location accessibility screen recording input monitoring automation files folders desktop documents downloads full disk access icloud vault signed signature" }] : []),
    ...(desktopApp?.updates ? [{ ...row("updates", "App updates", "General", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
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
      { id: `plugin:${p.id}`, label: settingsTitle(p.name), where: homeName(p) ?? "Plugin", words: "", run: () => show(`plugin:${p.id}`) },
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

export function Settings({ store }: { store: Store }) {
  const { disabled } = usePrefs()
  const [query, setQuery] = useState("")
  // The find picked: lit in the list, where Enter goes (else the first).
  const [picked, setPicked] = useState<string | null>(null)
  const q = query.trim()
  const rail = useRail(), wide = rail[1]
  const current = settingsSection.use()
  // A plugin turned off takes its section with it: back to the first.
  const sec = sectionOf(current, disabled) ?? CORE[0]
  const show: Show = (to, selector) => {
    if (to === PLUGINS_ITEM) return openSetup("plugins")
    let id = to
    // (the app's own plugins' settings are in a section: there, at its part)
    const at = id.startsWith("plugin:") ? placeOfPlugin(id.slice(7)) : null
    if (at && "section" in at) { selector ??= `[data-settings-member="${CSS.escape(id.slice(7))}"]`; id = at.section }
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
  const found = useMemo(() => (q ? search(findable(store, disabled, show), q) : []), [store, disabled, q, wide])
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
  const items = menu(disabled)
  const menuOf = (active: string | null) => <RailMenu label="Settings" tiles items={items} active={active} pick={(id) => show(id)} data-settings-list="" />
  return (
    <div data-settings>
      <RailLayout rail={rail} page={sec.id} title="Settings"
        side={q ? <Results found={found} query={q} picked={picked} choose={choose} /> : menuOf(litOf(sec.id))}
        search={{ value: query, onChange: typed, placeholder: "Search settings", attrs: { "data-settings-search": "" },
          onSubmit: () => { const f = lit ?? found[0]; if (!f) return; if (wide) choose(f); else f.run() }, onMove: wide ? move : undefined }}>
        {wide ? (
          <DenseRows.Provider value>
            <div data-settings-section={sec.id}>
              <Catch key={sec.id} fallback={() => <p className="text-[15px] text-muted-foreground">This section couldn't be drawn.</p>}>{sec.render(store)}</Catch>
            </div>
          </DenseRows.Provider>
        ) : q ? <FoundList found={found} query={q} />
          // (the page, a phone's or a narrow pane's: its rows a size up, as every page of the sidebar's lists)
          : <div className="size-up-bleed"><div data-size-up>{menuOf(null)}</div></div>}
      </RailLayout>
    </div>
  )
}
