// The vault as the web app sees it (GET /api/state), plus date helpers. Every item has a string id (its vault path
// without .md) and `modified` (UTC "YYYY-MM-DD HH:MM:SS").
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { editCount, edited, onVaultChange, settled, startLive, type Paths } from "@/core/live"
import { get, send } from "@/core/http"
import { getPrefs, hydratePrefs } from "@/core/prefs"
import { notifyError } from "@/core/notify"
import { setVaultAppearance, type VaultAppearance } from "@/core/appearance"
import { hydrateHotkeys } from "@/core/commands"
import type { FileTree } from "@/core/files"
import { applyPatch, type Patch } from "../../../core/statepatch.ts"
import type { BlockDecls, SettingDecls } from "../../../core/blocks.ts"
import type { PropTypes } from "../../../core/proptypes.ts"
import type { Disclosures } from "../../../core/pluginmeta.ts"
import type { PluginState } from "@/api"

/** GET /api/state: what each plugin's plugin.ts puts in it (`PluginState`, which plugins extend: see api.ts), plus the
 *  core's own keys. */
export type State = PluginState & {
  vault: { path: string; problems: { file: string; problem: string }[]
    /** Files the server is still reading (iCloud downloading them): not in the store until they arrive. */
    downloading?: string[]
    /** A sandbox (core/sandbox.ts): made up, made afresh each time it opens. */
    sandbox?: boolean }
  /** Every file in the vault (the file tree, links and backlinks). */
  files: FileTree
  config: { appearance: Record<string, unknown>; plugins: Record<string, unknown>; hotkeys?: Record<string, unknown> }
  /** The vault's own plugins (.vaultite/plugins/<id>/), on or off: core/vaultPlugins.ts loads them. */
  vaultPlugins: VaultPluginInfo[]
  /** Obsidian themes and CSS snippets in the vault's .vaultite/ (core/appearance.ts). */
  appearance?: VaultAppearance
  /** The plugins (ids) with a settings file, .vaultite/plugins/<id>/data.json: Settings lists them. */
  pluginSettings?: string[]
  /** Bundles (core/bundles.ts): the setup the last one applied replaced (to restore), and whether a new vault is still
   *  being offered them. */
  bundles?: { previous: { bundle: string; name: string; at: string } | null; onboarding: boolean }
  /** Property types (core/proptypes.ts): every declared one (Obsidian's too), and the keys .vaultite/types.json has. */
  propertyTypes?: { types: PropTypes; own: string[] }
}
/** A vault plugin as the server lists it (core/vaultplugins.ts on the server). */
export type VaultPluginInfo = {
  id: string; name: string; description: string; requires: string[]; enhances: string[]; runsOnServer: boolean; tint?: string; category?: string
  /** Its manifest's icon: a name, or its SVG file as a data address (core/pluginmeta.ts iconOf). */
  icon?: string
  /** Other apps' plugins it stands in for (its manifest's `replaces`). */
  replaces?: Record<string, string[]>
  folder: string; on: boolean; loaded: boolean; problems: string[]
  /** What it should fix but runs anyway (a block without its declaration or its text side). */
  warnings: string[]
  /** Its blocks as its manifest declares them (core/blocks.ts). */
  blocks: BlockDecls
  /** Its settings as its manifest declares them (core/blocks.ts SettingDecl). */
  settings?: SettingDecls
  /** Its bundle's version, when it's on and built (else null). */
  bundle: string | null
  pages: { name: string; text: string }[]
} & VaultMeta
/** What a vault plugin says about itself and where it came from, and whether this machine lets it run (core/trust.ts). */
export type VaultMeta = {
  version: string | null; author: string | null; repo: string | null; fundingUrl: string | null; disclosures: Disclosures
  /** Where it was installed from (.vaultite/plugins-lock.json), null for one made here. */
  source: { source: string; repo: string | null; tag: string | null; commit: string | null; version: string; installed: string } | null
  /** On, but waiting for this machine's owner to allow it: new here, or changed since (`changed`: its files that did). */
  approval: { state: "new" | "changed"; since: string | null; changed: string[] } | null
  /** Why the plugin directory blocks this version, or null. */
  blocked: string | null
  /** Its files' hash: allowing it is refused if they changed since it was shown. */
  hash: string
  /** Its later edits run without asking on this machine (a plugin its owner is writing here). */
  edits: boolean
}
/** The store every block, detail and panel gets: the state without the settings, which the app applies itself. */
export type Store = Omit<State, "config" | "vaultPlugins" | "appearance">

/** A number that goes up every `ms` while the page is shown (and `on`): redraws relative times, or asks again. */
export function useTick(ms = 30_000, on = true) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => { if (!document.hidden) setN((x) => x + 1) }, ms)
    return () => clearInterval(id)
  }, [ms, on])
  return n
}

/** Made-up live data for plugin previews: inside <PreviewLive>, useLive returns these instead of fetching. */
export const PreviewLive = createContext<Record<string, unknown> | null>(null)

// Cards asking for the same live data at once share one request. Always no-cache at the same address, so over the
// network an unchanged answer is a 304 with no body.
const inflight = new Map<string, { at: number; p: Promise<unknown> }>()
function fetchLive<T>(path: string, key = path): Promise<T> {
  const hit = inflight.get(key)
  if (hit && Date.now() - hit.at < 10_000) return hit.p as Promise<T>
  const p = send<T>("GET", path, undefined, "no-cache")
  inflight.set(key, { at: Date.now(), p })
  p.catch(() => inflight.delete(key))
  return p
}

/** Does this change touch what a plugin's route answers from: its cache (.vaultite/cache/<id>.json) or its settings
 *  (.vaultite/plugins/<id>/)? A route's plugin is its first part, by convention (`calendar?from=…`: calendar). */
function liveData(paths: Paths, route: string) {
  if (paths === null) return true
  const id = route.split(/[/?]/)[0]
  return paths.some((p) => p === ".vaultite" || p === ".vaultite/cache" || p === ".vaultite/plugins" || p === `.vaultite/cache/${id}.json`
    || p === `.vaultite/plugins/${id}` || p.startsWith(`.vaultite/plugins/${id}/`))
}
// Before any card refetches, forget what's in flight, so they share one new request.
onVaultChange((paths) => { for (const k of [...inflight.keys()]) if (liveData(paths, k)) inflight.delete(k) })

// The last answer per address, so a card drawn again shows it at once while it asks again instead of jumping. Kept for
// this visit (200) and in localStorage per vault (20, up to 16 KB each).
const answers = new Map<string, { data: unknown; json: string }>()
const KEPT = "vaultite.live"
let keptFor: string | null = null // the vault whose answers are loaded
function recall(path: string) {
  const vault = loaded.store?.vault.path ?? ""
  if (keptFor !== vault) {
    keptFor = vault
    answers.clear()
    try {
      const all = JSON.parse(localStorage.getItem(KEPT) ?? "null") as { vault: string; answers: [string, string][] } | null
      if (all?.vault === vault) for (const [k, json] of all.answers) answers.set(k, { data: JSON.parse(json), json })
    } catch { /* private mode, or not JSON */ }
  }
  return answers.get(path)
}
let keeping: ReturnType<typeof setTimeout> | null = null
function remember(path: string, data: unknown, json: string) {
  const same = answers.get(path)?.json === json
  answers.delete(path)
  answers.set(path, { data, json })
  if (answers.size > 200) answers.delete(answers.keys().next().value!)
  if (same) return
  keeping ??= setTimeout(() => {
    keeping = null
    const recent = [...answers].filter(([, a]) => a.json.length <= 16_384).slice(-20).map(([k, a]) => [k, a.json])
    try { localStorage.setItem(KEPT, JSON.stringify({ vault: keptFor, answers: recent })) } catch { /* private mode, full */ }
  }, 1000)
}

/** Live data from a plugin's own route: loaded once per mount (the last answer shown meanwhile), and again when its
 *  plugin's cache or settings change, after a disconnect, when `version` changes, and with `files` when the vault's
 *  files change (true: any note; or which, by path: a query over the vault follows them). */
export function useLive<T>(path: string | null, version?: string | number, files?: boolean | ((path: string) => boolean)) {
  const follow = useRef(files)
  follow.current = files
  const mock = useContext(PreviewLive)
  const [data, setData] = useState<T | null>(() => (path ? (recall(path)?.data as T | undefined) ?? null : null))
  const [error, setError] = useState<string | null>(null)
  // An answer the same as the one shown keeps its object, so what's drawn from it isn't drawn again.
  const last = useRef<string | null>(null)
  last.current ??= path ? recall(path)?.json ?? "" : ""
  const ask = path && version !== undefined ? `${path}\0${version}` : path
  useEffect(() => {
    if (!path || !ask || mock) return
    let on = true
    const load = () => fetchLive<T>(path, ask).then((d) => {
      if (!on) return
      const json = JSON.stringify(d)
      remember(path, d, json)
      if (json !== last.current) { last.current = json; setData(d) }
      setError(null)
    }).catch((e) => on && setError(String(e)))
    load()
    const off = onVaultChange((paths) => {
      const f = follow.current
      if (liveData(paths, path)) return load()
      if (f && (paths === null || paths.some((p) => !p.split("/").some((s) => s.startsWith(".")) && (f === true || f(p))))) { inflight.delete(ask); load() }
    })
    return () => { on = false; off() }
  }, [path, ask, mock])
  if (mock) {
    const key = path && Object.keys(mock).find((k) => path === k || path.startsWith(`${k}?`))
    return { data: (key ? mock[key] : null) as T | null, error: null, loading: false }
  }
  return { data, error, loading: !!path && data === null && error === null }
}

// The one store: /api/state, loaded as soon as the app's code runs and again on every change in the vault. Plugins
// change it optimistically with mutate() after a write, or reload().
type Loaded = { store: Store | null; error: string | null }
let loaded: Loaded = { store: null, error: null }
const listeners = new Set<() => void>()
const publish = (next: Partial<Loaded>) => { loaded = { ...loaded, ...next }; listeners.forEach((f) => f()) }
/** The store as it is now (for code outside React). */
export const getStore = () => loaded.store
/** Call `fn` whenever the store changes (for code outside React); returns how to stop. */
export const onStore = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
/** Change the store optimistically, after a write: f returns a new store, with new objects where it changed (never
 *  one changed in place: the store's objects are also the server's last state, which the next refresh patches). */
export const mutate = (f: (s: Store) => Store) => { edited(); if (loaded.store) publish({ store: f(loaded.store) }) }
/** A tap answered at once: change the store now, then write; a failed write brings the server's back and says so. The
 *  write's promise (handled: callers may ignore it). */
export function optimistic<T>(change: (s: Store) => Store, write: () => Promise<T>, failed: string): Promise<T> {
  mutate(change)
  const p = write()
  p.catch((e) => { void reload(); notifyError(e, failed) })
  return p
}
// Runs with each new state before it's drawn (the vault plugins' bundles load there: App.tsx sets it).
let beforeState: ((s: State) => Promise<void>) | null = null
export const onState = (fn: (s: State) => Promise<void>) => { beforeState = fn }

/** The state as the server last gave it (`v`) and its store: what a refresh asks the server to patch, so only what
 *  changed comes. Optimistic changes (mutate) are dropped at each refresh, which starts from the server's. */
let server: { v: string; state: State; store: Store } | null = null
type Answer = { v: string; state: State } | { v: string; since: string; patch: Patch | null }

/** The state after the server's answer: the whole state, or the one it has patched; null when the patch isn't of the
 *  state this app has (it then asks for the whole state). */
function stateOf(a: Answer): State | null {
  if ("state" in a) return a.state
  if (!server || a.since !== server.v) return null
  try { return a.patch ? applyPatch(server.state, a.patch) as State : server.state } catch (e) { console.error(e); return null }
}

// One refresh at a time; asked again meanwhile, it runs once more after. It waits for this app's writes on their way,
// and one that a write overtook is thrown away and run again, so an optimistic change never flickers back.
let busy: Promise<void> | null = null
let again = false
function load(): Promise<void> {
  if (busy) { again = true; return busy }
  const run = async () => {
    do {
      again = false
      await settled()
      const gen = editCount()
      try {
        const answer = await get<Answer>(`state?since=${encodeURIComponent(server?.v ?? "0")}`)
        if (editCount() !== gen) { again = true; continue }
        const all = stateOf(answer)
        if (!all) { server = null; again = true; continue }
        if (all === server?.state) {
          // Nothing changed there: the server's store again, if an optimistic change is on top of it.
          if (loaded.store !== server.store || loaded.error) publish({ store: server.store, error: null })
          continue
        }
        hydratePrefs(all.config)
        setVaultAppearance(all.appearance)
        hydrateHotkeys(all.config.hotkeys)
        await beforeState?.(all)
        const { config: _config, vaultPlugins: _plugins, appearance: _appearance, ...store } = all
        server = { v: answer.v, state: all, store }
        publish({ store, error: null })
      } catch (e) {
        publish({ error: String(e) })
      }
    } while (again)
  }
  busy = run().finally(() => { busy = null })
  return busy
}
export const reload = () => load()

/** A change only to plugins' caches: never part of the state (live data is drawn by blocks, which ask their routes),
 *  so the store only reloads for one while hidden files are shown (then they're in the file tree). */
const onlyCaches = (paths: Paths) => !!paths?.length && paths.every((p) => p === ".vaultite/cache" || p.startsWith(".vaultite/cache/"))

// Changes in quick succession (an agent writing file after file) reload it at most once a second: the first at once,
// the ones after it together, a moment later.
const GAP = 1000
let lastLoad = 0
let soon: ReturnType<typeof setTimeout> | null = null
function loadSoon() {
  if (soon) return
  const wait = lastLoad + GAP - Date.now()
  const go = () => { soon = null; lastLoad = Date.now(); load() }
  if (wait <= 0) go()
  else soon = setTimeout(go, wait)
}

/** Load the store, and follow the vault: any change (Claude, another device, this app's own writes) refreshes it,
 *  except to caches (and artifacts' storage, which the server doesn't report). Once, from main.tsx. */
let started = false
export function startStore() {
  if (started) return
  started = true
  load()
  startLive()
  onVaultChange((paths) => { if (!onlyCaches(paths) || getPrefs().showHidden) loadSoon() })
}

/** The store and the last error loading it, redrawn when either changes. */
export function useStore() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f) } }, () => loaded)
}

// ---------- dates (local) ----------
export const pad = (n: number) => String(n).padStart(2, "0")
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d) }
export const today = () => iso(new Date())
export const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
export const dow = (s: string) => (parse(s).getDay() + 6) % 7 // 0 = Monday
export const weekStart = (s: string) => addDays(s, -dow(s))
export const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))

// Dates and numbers as text in the user's locale. toLocaleDateString(undefined, options) makes a new formatter on every
// call (about a tenth of a millisecond, which a page's dates add up to); these keep one per set of options.
const dateFormats = new Map<string, Intl.DateTimeFormat>()
const byOptions = new WeakMap<Intl.DateTimeFormatOptions, Intl.DateTimeFormat>() // (options kept in a constant: no key to make)
/** A date (or a time in ms) as text: `dateText(d, { day: "numeric", month: "short" })` is d.toLocaleString(undefined,
 *  { day: "numeric", month: "short" }), with the formatter kept. */
export function dateText(d: Date | number, options: Intl.DateTimeFormatOptions) {
  let f = byOptions.get(options)
  if (!f) {
    const key = JSON.stringify(options)
    f = dateFormats.get(key)
    if (!f) dateFormats.set(key, (f = new Intl.DateTimeFormat(undefined, options)))
    byOptions.set(options, f)
  }
  return f.format(d)
}
const WEEKDAY = { weekday: "long" } as const, DAY = { day: "numeric", month: "short" } as const
const DAY_YEAR = { ...DAY, year: "numeric" } as const, TIME = { hour: "numeric", minute: "2-digit" } as const
const numbers = new Intl.NumberFormat()
/** A number as text (1,234.5): n.toLocaleString(), with the formatter kept. */
export const numberText = (n: number) => numbers.format(n)

export function fmtDay(s: string) {
  const diff = Math.round((parse(today()).getTime() - parse(s).getTime()) / 864e5)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff > 0 && diff < 7) return dateText(parse(s), WEEKDAY)
  return dateText(parse(s), diff > 300 ? DAY_YEAR : DAY)
}
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${Math.round(m || 0)}m`)
export function fmtAgo(isoStr: string) {
  const d = (Date.now() - new Date(isoStr.replace(" ", "T") + (isoStr.includes("T") ? "" : "Z")).getTime()) / 1000
  if (d < 90) return "just now"
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 86400) return `${Math.round(d / 3600)} h ago`
  const days = Math.round(d / 86400)
  return days < 45 ? `${days} d ago` : dateText(new Date(isoStr), { month: "short", year: "numeric" })
}
export const fmtTime = (isoStr: string) => dateText(new Date(isoStr), TIME)
export const fmtLongDay = (d: string) => dateText(parse(d), { weekday: "long", day: "numeric", month: "long" })

/** Imported titles (Hevy etc.) carry emojis; the app shows plain text. */
export const plain = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim()
