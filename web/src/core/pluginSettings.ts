// A plugin's settings sheet: a plugin has one when it draws a panel, declares settings in its manifest, or has a
// data.json. Only while it's on.
import { getStore, type Store } from "@/core/data"
import type { Plugin } from "@/core/define"
import { openDetail } from "@/core/nav"
import { isEnabled, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import type { Command } from "@/core/commands"
import { get as fetchJson, patch } from "@/core/http"
import { onVaultChange, touches } from "@/core/live"
import { cell } from "@/core/signal"
import { capitalize } from "@/lib/utils"
import type { SettingDecl } from "../../../core/blocks.ts"

/** Where a plugin's settings are kept. */
export const settingsFile = (id: string) => `.vaultite/plugins/${id}/data.json`
type Data = Record<string, unknown>
const EMPTY = {}
const isMap = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v)
// (a var: plugins call pluginSettings as their modules load, maybe before this module has run)
// eslint-disable-next-line no-var
var kept: Map<string, ReturnType<typeof keep>> | undefined
function keep(id: string) {
  const value = cell<Data | null>(null)
  let reading: Promise<void> | null = null
  const read = () => fetchJson<Data>(`config/plugin/${id}`).then((d) => value.set(isMap(d) ? d : {}), () => { if (!value.get()) value.set({}) })
  const start = () => {
    if (reading) return
    reading = read()
    onVaultChange((paths) => { if (touches(paths, settingsFile(id))) void read() })
  }
  /** Write those keys (null removes one): shown at once, put back if the write fails. */
  const set = async (changes: Data) => {
    start()
    const was = value.get() ?? {}, next = { ...was }
    for (const [k, v] of Object.entries(changes)) if (v === null || v === undefined) delete next[k]; else next[k] = v
    value.set(next)
    try { await patch(`config/plugin/${id}`, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v ?? null]))) } catch (e) { value.set(was); throw e }
  }
  return { value, start, set, ready: () => { start(); return reading! } }
}

/** A plugin's settings (its data.json) as module state, one per plugin: read on first use and again whenever the file
 *  changes. `get`/`use` answer {} until read (`use(true)`: null); `set` writes keys; `onChange` hears every change. */
export function pluginSettings<T extends object = Data>(id: string) {
  kept ??= new Map()
  let k = kept.get(id)
  if (!k) { k = keep(id); kept.set(id, k) }
  const { value, start, set, ready } = k
  function use(): T
  function use(loading: true): T | null
  function use(loading?: boolean) { start(); const v = value.use(); return (v ?? (loading ? null : EMPTY)) as T | null }
  return {
    get: (): T => { start(); return (value.get() ?? EMPTY) as T },
    use,
    set: set as (changes: { [K in keyof T]?: T[K] | null }) => Promise<void>,
    onChange: value.subscribe,
    /** Settled once the file was first read. */
    ready,
  }
}

/** What a declared setting is when its key is left out: its manifest's default, or one another app's settings make
 *  (.obsidian/templates.json's folder). */
export function settingDefault(id: string, key: string, d: SettingDecl): unknown {
  const seeds = getStore()?.settingDefaults?.[`plugins/${id}/data`]
  return seeds && Object.hasOwn(seeds, key) ? seeds[key] : d.default
}

/** An enum's value as the form and the palette name it: its `labels`' name, else the value capitalized. */
export const valueLabel = (d: SettingDecl, v: unknown) => d.labels?.[String(v)] ?? capitalize(String(v))

/** A plugin's settings sheet's name: "Vim settings", but "Style settings" as it is. */
export const settingsTitle = (name: string) => (/\bsettings$/i.test(name) ? name : `${name} settings`)

/** Whether a plugin has anything to set (whether it's on or not). `files`: the ids with a settings file. */
export function hasSettings(p: Plugin, files: string[] = getStore()?.pluginSettings ?? []) {
  return !!p.settingsPanel || Object.keys(p.settingsDecls ?? {}).length > 0 || files.includes(p.id) ||
    !!getStore()?.filing?.homes.some((h) => h.plugin === p.id) || !!getStore()?.writeGrants?.some((g) => g.plugin === p.id)
}

/** The plugins whose settings can be opened now: on, with something to set. */
export const withSettings = (store: Store | null = getStore(), disabled = getPrefs().disabled) =>
  PLUGINS.filter((p) => isEnabled(p.id, disabled) && hasSettings(p, store?.pluginSettings ?? []))

let goingTo: { id: string; key: string } | null = null

/** Open a plugin's settings sheet (over the sheet that's open, if any); `key`: the setting to go to (its row's
 *  `data-setting`), scrolled to and flashed once the sheet has drawn it. */
export function openPluginSettings(id: string, key?: string) {
  goingTo = key ? { id, key } : null
  openDetail(`plugin-settings/${encodeURIComponent(id)}`)
}

/** The setting the sheet just opened for `id` should go to (once: taken). */
export function takeGoingTo(id: string) {
  const g = goingTo?.id === id ? goingTo.key : null
  goingTo = null
  return g
}

/** Scroll to the first element `selector` finds and flash it, waiting a moment for one drawn late (a form that loads). */
export function revealRow(selector: string, within: ParentNode = document) {
  let tries = 0
  const go = () => {
    const el = within.querySelector<HTMLElement>(selector)
    if (!el) { if (++tries < 20) setTimeout(go, 50); return }
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.classList.remove("reveal-flash"); void el.offsetWidth; el.classList.add("reveal-flash")
  }
  requestAnimationFrame(go)
}

/** "Open <Name> settings" in the command palette, for each plugin that has some, while it's on. Verb first, like every
 *  command: a name starting with the plugin's (Claude Code settings) would beat its "Open …" for the same word. */
export const settingsCommands = (): Command[] =>
  PLUGINS.map((p) => ({
    id: `plugin-settings:${p.id}`, name: `Open ${settingsTitle(p.name)}`,
    when: () => isEnabled(p.id, getPrefs().disabled) && hasSettings(p),
    run: () => openPluginSettings(p.id),
    icon: p.icon,
  }))
