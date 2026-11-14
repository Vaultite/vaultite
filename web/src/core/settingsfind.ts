import type { Store } from "@/core/data"
import { desktop as desktopApp } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { openSettings, openSetup } from "@/core/apppages"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS, pluginById, type Plugin } from "@/core/plugins"
import { hasSettings, openPluginSettings, settingsApart, settingsHome, settingsTitle } from "@/core/pluginSettings"
import { getPrefs } from "@/core/prefs"
import { textSizeKinds } from "@/core/textsize"
import { allSwitches, placeOf, SECTIONS, type SwitchDef } from "@/core/switches"
import { aiOn } from "@/core/ai"
import { capitalize } from "@/lib/utils"
import { APP_VERSION } from "../../../core/version.ts"

export function aiParts(disabled: string[]) {
  return PLUGINS.filter((p) => p.settingsPages && isEnabled(p.id, disabled)).flatMap((p) =>
    Object.entries(p.settingsPages!).filter(([, d]) => d.in === "ai").map(([k, d]) => ({ ...d, id: `${p.id}:${k}` })))
}

export const COMPANION_HERE = ["summoned_model", "summoned_effort"]
const byName = new Intl.Collator(undefined, { sensitivity: "base" })
const homeName = (p: Plugin) => { const h = settingsHome(p); return h ? SECTIONS[h] ?? capitalize(h) : "Plugin" }
const pageLabels = (disabled: string[]) => PLUGINS.filter((p) => p.settingsPages && isEnabled(p.id, disabled))
  .flatMap((p) => Object.entries(p.settingsPages!).filter(([, d]) => !d.in).map(([k, d]) => ({ id: `${p.id}:${k}`, label: d.label })))

export function placeOfPlugin(id: string): { section: string } | { sheet: string } {
  const p = pluginById(id), home = p && settingsHome(p)
  return home && !settingsApart(p) ? { section: home } : { sheet: id }
}

export type Found = { id: string; label: string; sub?: string; where: string; words: string; run: () => void; switch?: SwitchDef }
export type Show = (section: string, selector?: string) => void

export function findable(store: Store, disabled: string[], show: Show): Found[] {
  const switches = allSwitches(disabled)
  const switchOf = (plugin: string, key?: string) => switches.find((w) => w.plugin?.id === plugin && w.plugin.key === key)
  const row = (id: string, label: string, where: string, selector: string, sub = ""): Found =>
    ({ id, label, sub, where, words: "", run: () => show(where.toLowerCase(), selector) })
  const app: Found[] = [
    ...pageLabels(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, where: "Settings", words: "", run: () => show(s.id) })),
    ...(aiOn() ? [
      { ...row("coding-agents", "Coding agents", "AI", "[data-ai-agents]", "Which run in Vaultite's terminals, and your companion"), words: "claude code codex cursor opencode openclaw hermes companion terminal" },
      ...aiParts(disabled).map((s) => ({ id: `page-${s.id}`, label: s.label, sub: s.sub, where: "AI", words: "", run: () => show("ai", `[data-ai-part="${s.id}"]`) })),
    ] : []),
    { ...row("layout", "Layout", "Appearance", "[data-layout-picker]", "Standard, Zen, Browser or yours"), words: "bundle setup zen browser standard save share restore" },
    { id: "plugins", label: "Plugins", sub: "Turn plugins on and off", where: "Plugins", words: "extensions install setup features", run: () => show("plugins") },
    { id: "get", label: "Get plugins and layouts", sub: "From Vaultite's directory, or import a bundle", where: "Plugins", words: "store install bundles packs import", run: () => show("get") },
    { ...row("theme", "Theme", "Appearance", '[data-settings-row="theme"]', "System, light or dark"), words: "dark mode light mode" },
    { ...row("scheme", "Colour scheme", "Appearance", '[data-settings-row="scheme"]'), words: "color colors colours obsidian themes" },
    { ...row("density", "Density", "Appearance", '[data-settings-row="density"]', "Compact or comfortable"), words: "spacing" },
    { ...row("animation", "Animations", "Appearance", '[data-settings-row="animation"]', "Natural, snappy or off"), words: "motion reduce speed spring" },
    { ...row("new-tabs", "New tabs open", "Appearance", '[data-settings-row="new-tabs"]', "Their page, the quick switcher or a web page"), words: "new tab launcher start blank address browser" },
    { id: "sidebars", label: "Sidebars", where: "Appearance", words: "panels customize arrange left right hide show", run: () => openDetail("sidebars") },
    ...(isDesktop() ? [] : [{ ...row("pull-actions", "Pull-down actions", "Appearance", '[data-settings-row="pull-0"]'), words: "pull down gesture phone swipe new note search close tab" }]),
    { id: "fonts", label: "Fonts", sub: "Interface, text and code", where: "Appearance", words: "font typeface monospace", run: () => openDetail("fonts") },
    ...(desktopApp?.interfaceSize ? [{ ...row("interface-size", "Interface size", "Appearance", '[data-settings-row="interface-size"]', "Every window, on this computer"), words: "zoom scale bigger smaller ui app window" }] : []),
    ...textSizeKinds(disabled).map(([kind, k]) =>
      ({ ...row(`text-size-${kind}`, `${k.label} text size`, "Appearance", `[data-settings-row="text-size-${kind}"]`, "This device only"), words: "font size zoom bigger smaller" })),
    { ...row("snippets", "CSS snippets", "Appearance", 'section[aria-label="CSS snippets"]'), words: "styles custom" },
    { ...row("default-view", "Default view for new tabs", "Editor", '[data-settings-row="default-view"]', "Editing or reading"), words: "reading view preview open new note tab mode" },
    { ...row("editing-mode", "Default editing mode", "Editor", '[data-settings-row="editing-mode"]', "Live preview or source mode"), words: "source mode live preview markdown raw view" },
    { ...row("properties-in-document", "Properties in document", "Editor", '[data-settings-row="properties-in-document"]', "Visible, hidden or source"), words: "frontmatter yaml metadata" },
    { ...row("indent", "Indent", "Editor", '[data-settings-row="indent"]', "Tab or spaces"), words: "tabs spaces tab size" },
    ...switches.filter((w) => !w.plugin).map((w): Found => {
      const row = w.id.replace(/^setting:/, "")
      return { id: row, label: w.name, sub: w.sub?.(), where: placeOf(w).name, words: w.words ?? "", run: w.section === "sidebars" ? placeOf(w).open : () => show(w.section ?? "appearance", `[data-settings-row="${row}"]`), switch: w }
    }),
    { id: "hotkeys", label: "Keyboard shortcuts", sub: "Every command's keys", where: "Hotkeys", words: "hotkeys keys bindings", run: () => show("hotkeys") },
    { id: "vaults", label: "Manage vaults", sub: store.vault.path, where: "Vaults", words: "vault folder",
      run: () => { if (desktopApp) void desktopApp.manageVaults(); else openDetail("vaults") } },
    { ...row("version", "Version", "About", '[data-settings-row="version"]', `Vaultite ${APP_VERSION}`), words: "about" },
    { ...row("running", "Running", "About", '[data-settings-row="running"]', "The server's commit and its updates"), words: "commit build deployed live hash server" },
    ...(desktopApp?.permission ? [{ id: "permissions", label: "Permissions", sub: "What macOS lets Vaultite do", where: "Settings", run: () => show("permissions"),
      words: "privacy security macos microphone camera location accessibility screen recording input monitoring automation files folders desktop documents downloads full disk access icloud vault signed signature" }] : []),
    ...(desktopApp?.updates ? [{ ...row("updates", "App updates", "About", '[data-settings-row="updates"]', "Automatic, notify or off"), words: "update upgrade restart" }] : []),
    ...(desktopApp?.login ? [{ ...row("login", "Open at login", "About", '[data-settings-row="login"]', "On this computer"), words: "startup start launch login boot menu bar" }] : []),
    { ...row("plugin-updates", "Plugin updates", "Plugins", '[data-settings-row="plugin-updates"]', "Vaultite's, all or none"), words: "update automatically plugins" },
  ]
  const plugins = PLUGINS.filter((p) => hasSettings(p, store.pluginSettings ?? [])).sort((a, b) => byName.compare(a.name, b.name)).flatMap((p) => {
    const where = isEnabled(p.id, disabled) ? p.name : `${p.name} (off)`
    const own = [
      ...Object.entries(p.settingsDecls ?? {}).map(([key, d]) => ({ key, label: d.label, description: d.description })),
      ...switches.filter((w) => w.plugin?.id === p.id && !p.settingsDecls?.[w.plugin.key]).map((w) => ({ key: w.plugin!.key, label: w.name, description: w.sub?.() })),
      ...(p.settingsSearch ?? []),
      ...(store.filing?.homes ?? []).filter((h) => h.plugin === p.id).map((h) => ({ key: `folder-${h.key}`, label: `${h.label} folder`, description: `where new ${h.label.toLowerCase()} go` })),
    ]
    const sheet = `[data-plugin-settings-sheet="${CSS.escape(p.id)}"]`
    return [
      { id: `plugin:${p.id}`, label: settingsTitle(p.name), where: homeName(p), words: "", run: () => show(`plugin:${p.id}`) },
      ...own.map((e, i): Found => ({ id: `plugin:${p.id}:${e.key ?? i}`, label: e.label, sub: e.description ? capitalize(e.description) : "",
        ...(inAi(p.id, e.key) ? { where: "AI", words: e.key!, run: () => show("ai", `[data-ai-agents] [data-setting="${CSS.escape(e.key!)}"]`) }
          : { where, words: e.key ?? "", run: () => show(`plugin:${p.id}`, e.key ? `${sheet} [data-setting="${CSS.escape(e.key)}"]` : undefined) }),
        switch: isEnabled(p.id, disabled) ? switchOf(p.id, e.key) : undefined })),
    ]
  })
  return [...app, ...plugins]
}

const showAnywhere: Show = (to, selector) => {
  if (to === "plugins" || to === "get") return void openSetup(to)
  let id = to
  const at = id.startsWith("plugin:") ? placeOfPlugin(id.slice(7)) : null
  if (at && "section" in at) { selector ??= `[data-settings-member="${CSS.escape(id.slice(7))}"]`; id = at.section }
  if (!isDesktop() && id.startsWith("plugin:")) {
    const key = selector?.match(/data-setting="(.*)"\]$/)?.[1]
    return openPluginSettings(id.slice(7), key ? key.replace(/\\(.)/g, "$1") : undefined)
  }
  openSettings(id, selector)
}

function findSetting(all: Found[], said: string): Found | null {
  const q = said.trim(), low = q.toLowerCase()
  if (!q) return null
  const scoped = /^([a-z0-9][a-z0-9-]*)[.:/ ]([A-Za-z0-9_-]+)$/.exec(q)
  return (scoped && all.find((f) => f.id === `plugin:${scoped[1]}:${scoped[2]}`))
    ?? all.find((f) => f.words === q || f.id === q) ?? all.find((f) => f.label.toLowerCase() === low)
    ?? search(all, q.replace(/[_.:/]+/g, " "))[0] ?? null
}

export function showSetting(store: Store, said: string) {
  const all = findable(store, getPrefs().disabled, showAnywhere), f = findSetting(all, said)
  if (!f) return { found: false, near: search(all, said.split(/[\s_.:/]+/)[0] ?? "").slice(0, 6).map((x) => `${x.label} (${x.where})`) }
  f.run()
  return { found: true, label: f.label, where: f.where, sub: f.sub || undefined }
}

const inAi = (plugin: string, key?: string) => plugin === "companion" && !!key && COMPANION_HERE.includes(key) && aiOn() && isEnabled(plugin, getPrefs().disabled)

export function search(all: Found[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const inLabel = (f: Found) => words.filter((w) => f.label.toLowerCase().includes(w)).length
  return all.filter((f) => { const t = `${f.label} ${f.sub ?? ""} ${f.where} ${f.words}`.toLowerCase(); return words.every((w) => t.includes(w)) })
    .map((f, i) => [f, inLabel(f), i] as const).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([f]) => f)
}
