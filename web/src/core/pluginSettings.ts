import { getStore, type Store } from "@/core/data"
import type { Plugin } from "@/core/define"
import { openDetail } from "@/core/nav"
import { isEnabled, pluginById, PLUGINS } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import type { Command } from "@/core/commands"
import { get as fetchJson, patch } from "@/core/http"
import { onVaultChange, touches } from "@/core/live"
import { cell } from "@/core/signal"
import { capitalize } from "@/lib/utils"
import type { SettingDecl } from "../../../core/blocks.ts"
import { isObj } from "../../../core/values.ts"
import { glide } from "@/core/animation"

/** Where a plugin's settings are kept. */
export const settingsFile = (id: string) => `.vaultite/plugins/${id}/data.json`
type Data = Record<string, unknown>
const EMPTY = {}
// eslint-disable-next-line no-var -- plugins call pluginSettings as their modules load, maybe before this module has run
var kept: Map<string, ReturnType<typeof keep>> | undefined
// eslint-disable-next-line no-var -- read before this module has run, as `kept`
var asking: Map<string, { ok: (d: unknown) => void; fail: (e: unknown) => void }> | null = null
function readSoon(id: string) {
  return new Promise<unknown>((ok, fail) => {
    if (!asking) {
      const all = asking = new Map()
      setTimeout(() => {
        asking = null
        fetchJson<Data>(`config/plugin?ids=${[...all.keys()].join(",")}`)
          .then((d) => { for (const [k, r] of all) r.ok(d?.[k]) }, (e) => { for (const r of all.values()) r.fail(e) })
      })
    }
    asking.set(id, { ok, fail })
  })
}

function keep(id: string) {
  const saved = cell<Data | null>(null), value = cell<Data | null>(null)
  let over: Data | null = null
  const show = () => { const s = saved.get(); value.set(over ? { ...(s ?? {}), ...over } : s) }
  saved.subscribe(show)
  let reading: Promise<void> | null = null
  let writes = 0, gen = 0, stale = false, queue: Promise<unknown> = Promise.resolve()
  const got = (g: number) => (d: unknown) => {
    if (writes || g !== gen) { stale = true; if (!writes) void read(); return }
    saved.set(isObj<Data>(d) ? d : {})
  }
  const failed = () => { if (!saved.get()) saved.set({}) }
  const read = (): Promise<void> => { stale = false; return readSoon(id).then(got(gen), failed) }
  const start = () => {
    if (reading) return
    reading = read()
    onVaultChange((paths) => { if (touches(paths, settingsFile(id))) void read() })
  }
  const set = async (changes: Data) => {
    start()
    const was = saved.get() ?? {}, next = { ...was }
    for (const [k, v] of Object.entries(changes)) if (v === null || v === undefined) delete next[k]; else next[k] = v
    saved.set(next)
    gen++; writes++
    const body = Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v ?? null]))
    const sent = queue.then(() => patch(`config/plugin/${id}`, body))
    queue = sent.catch(() => {})
    try { await sent } catch (e) { saved.set(was); throw e } finally { if (!--writes && stale) void read() }
  }
  const preview = (keys: Data | null) => { start(); over = keys; show() }
  return { value, start, set, preview, ready: () => { start(); return reading! } }
}

/** A plugin's settings (its data.json) as module state, one per plugin: read on first use and whenever the file changes.
 *  `get`/`use` ({} until read; `use(true)`: null), `set`, `onChange`; `preview` shows keys, saved nowhere, until null. */
export function pluginSettings<T extends object = Data>(id: string) {
  kept ??= new Map()
  let k = kept.get(id)
  if (!k) { k = keep(id); kept.set(id, k) }
  const { value, start, set, preview, ready } = k
  function use(): T
  function use(loading: true): T | null
  function use(loading?: boolean) { start(); const v = value.use(); return (v ?? (loading ? null : EMPTY)) as T | null }
  return {
    get: (): T => { start(); return (value.get() ?? EMPTY) as T },
    use,
    set: (changes: { [K in keyof T]?: T[K] | null }) => set(changes),
    onChange: value.subscribe,
    preview: (keys: { [K in keyof T]?: T[K] } | null) => preview(keys),
    /** Settled once the file was first read. */
    ready,
  }
}

export function settingDefault(id: string, key: string, d: SettingDecl): unknown {
  const seeds = getStore()?.settingDefaults?.[`plugins/${id}/data`]
  return seeds && Object.hasOwn(seeds, key) ? seeds[key] : d.default
}

export const valueLabel = (d: SettingDecl, v: unknown) => d.labels?.[String(v)] ?? capitalize(String(v))

export const settingsTitle = (name: string) => (/\bsettings$/i.test(name) ? name : `${name} settings`)

/** Whether a plugin has anything to set (whether it's on or not). `files`: the ids with a settings file. */
export function hasSettings(p: Plugin, files: string[] = getStore()?.pluginSettings ?? []) {
  return !!p.settingsPanel || Object.keys(p.settingsDecls ?? {}).length > 0 || files.includes(p.id) ||
    !!getStore()?.filing?.homes.some((h) => h.plugin === p.id) || !!getStore()?.writeGrants?.some((g) => g.plugin === p.id)
}

export const withSettings = (store: Store | null = getStore(), disabled = getPrefs().disabled) =>
  PLUGINS.filter((p) => settingsShown(p, disabled) && hasSettings(p, store?.pluginSettings ?? []))

export const settingsShown = (p: Plugin, disabled = getPrefs().disabled) => isEnabled(p.id, disabled) && (getPrefs().ai || settingsHome(p) !== "ai")

let goingTo: { id: string; key: string } | null = null

/** Open a plugin's settings sheet (over the sheet that's open, if any); `key`: the setting to go to (its row's
 *  `data-setting`), scrolled to and flashed once the sheet has drawn it. */
export function openPluginSettings(id: string, key?: string) {
  goingTo = key ? { id, key } : null
  openDetail(`plugin-settings/${encodeURIComponent(id)}`)
}

export function takeGoingTo(id: string) {
  const g = goingTo?.id === id ? goingTo.key : null
  goingTo = null
  return g
}

export function revealRow(selector: string, within: ParentNode = document) {
  let tries = 0
  const go = () => {
    const el = within.querySelector<HTMLElement>(selector)
    if (!el) { if (++tries < 20) setTimeout(go, 50); return }
    el.scrollIntoView({ block: "center", behavior: glide() })
    el.classList.remove("reveal-flash"); void el.offsetWidth; el.classList.add("reveal-flash")
  }
  requestAnimationFrame(go)
}

export const settingsCommands = (): Command[] =>
  PLUGINS.map((p) => ({
    id: `plugin-settings:${p.id}`, name: `Open ${settingsTitle(p.name)}`,
    when: () => settingsShown(p) && hasSettings(p),
    run: () => openPluginSettings(p.id),
    icon: p.icon,
  }))

const HOMES: Record<string, string> = { writing: "editor", navigation: "files", formats: "files", life: "files", agents: "ai", "ai-apps": "ai", system: "about" }
const OWN: Record<string, string> = { terminal: "terminal", history: "files" }
export const settingsHome = (p: Plugin): string | null => (p.alwaysOn ? OWN[p.id] ?? HOMES[p.category ?? ""] ?? "about" : null)
export function settingsLit(section: string) {
  const of = section.startsWith("plugin:") ? pluginById(section.slice(7)) : null
  if (!of) return section
  return of.switchIn?.section ?? settingsHome(of) ?? "plugins"
}
export const settingsApart = (p: Plugin) => Object.keys(p.settingsDecls ?? {}).length > 10
