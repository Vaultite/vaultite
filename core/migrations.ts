// A vault's settings brought up to date when the app's defaults change under them, once: a step's id goes in
// .vaultite/migrations.json when it has run (a synced vault's other machine skips it); a new vault starts with all done.
import fs from "node:fs"
import type { Item, Vault } from "./vault.ts"

const FILE = "migrations"

const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])
const isObj = (v: unknown): v is Item => !!v && typeof v === "object" && !Array.isArray(v)

/** Daily notes' settings and command, once Today's (daily-notes-2026-10). */
const DAILY_KEYS = ["format", "template"], OLD_CMD = "today:daily-note", NEW_CMD = "daily-notes:today"

/** A record with key `from` renamed `to` in its place (one `to` already there wins), or null when it has no `from`. */
function renamedKey(o: Item, from: string, to: string): Item | null {
  if (!(from in o)) return null
  return Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (k !== from ? [[k, v]] : to in o ? [] : [[to, v]])))
}

/** Today's daily note settings moved to Daily notes', and its command's id renamed, in one set of settings files read and
 *  written through `get` / `set` (the vault's, a saved bundle's, the setup a restore puts back). */
function dailyNotesOut(get: (name: string) => Item | null, set: (name: string, value: Item) => void) {
  const today = get("plugins/today/data")
  const moving = today ? DAILY_KEYS.filter((k) => k in today) : []
  if (today && moving.length) {
    const mine = get("plugins/daily-notes/data") ?? {}
    set("plugins/daily-notes/data", { ...mine, ...Object.fromEntries(moving.filter((k) => !(k in mine)).map((k) => [k, today[k]])) })
    set("plugins/today/data", Object.fromEntries(Object.entries(today).filter(([k]) => !moving.includes(k))))
  }
  const keys = get("hotkeys"), hk = keys && renamedKey(keys, OLD_CMD, NEW_CMD)
  if (hk) set("hotkeys", hk)
  const tab = get("newtab")
  if (tab) {
    const actions = Array.isArray(tab.actions) && tab.actions.includes(OLD_CMD)
      ? [...new Set(tab.actions.map((a: unknown) => (a === OLD_CMD ? NEW_CMD : a)))] : null
    const icons = isObj(tab.icons) ? renamedKey(tab.icons, OLD_CMD, NEW_CMD) : null
    if (actions || icons) set("newtab", { ...tab, ...(actions ? { actions } : {}), ...(icons ? { icons } : {}) })
  }
}

/** Built-ins that were on from the start (`essential`) and became `offByDefault`: on where they weren't switched off. */
export const NOW_OPT_IN = ["activity", "dispatch", "token-count", "workspaces", "codex", "cursor", "opencode", "openclaw", "hermes"]

const STEPS: { id: string; run: (v: Vault) => void }[] = [
  {
    id: "plugins-opt-in-2026-10",
    run: (v) => {
      const conf = v.readConfig("plugins") ?? {}
      const disabled = strs(conf.disabled), enabled = strs(conf.enabled)
      const on = NOW_OPT_IN.filter((id) => !disabled.includes(id) && !enabled.includes(id))
      // (`disabled` no longer counts for them: off is out of `enabled`)
      v.patchConfig("plugins", { disabled: disabled.filter((id) => !NOW_OPT_IN.includes(id)), enabled: [...enabled, ...on] })
    },
  },
  {
    // Daily notes became their own plugin, apart from Today: its settings, hotkeys and buttons follow, in the vault and
    // in the bundles saved in it.
    id: "daily-notes-2026-10",
    run: (v) => {
      const inVault = (base: string) => dailyNotesOut((n) => v.readConfig(base + n), (n, value) => {
        if (n.endsWith("/data") && !Object.keys(value).length) v.removeConfig(base + n)
        else v.setConfig(base + n, value)
      })
      inVault("")
      let saved: string[] = []
      try { saved = fs.readdirSync(v.abs(".vaultite/bundles"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* none */ }
      for (const b of saved) inVault(`bundles/${b}/`)
      // (the setup before the last bundle applied: a restore puts back Daily notes' keys, not Today's)
      const prev = v.readConfig("bundles/previous")
      if (prev && isObj(prev.config)) {
        const config: Record<string, Item> = { ...prev.config }, absent = strs(prev.absent)
        dailyNotesOut((n) => config[n] ?? null, (n, value) => { config[n] = value })
        if (absent.includes("plugins/today/data") && config["plugins/daily-notes/data"] && !absent.includes("plugins/daily-notes/data")) absent.push("plugins/daily-notes/data")
        if (JSON.stringify(config) !== JSON.stringify(prev.config)) v.setConfig("bundles/previous", { ...prev, config, absent })
      }
    },
  },
]

/** The app's plugins that moved to Vaultite's plugin directory: id -> where they're installed from now. Off the app in
 *  the same change (an install can't take an id the app has); bundles name them with `install`. */
export const MOVED: Record<string, string> = {
  "app-windows": "Vaultite/plugins/app-windows",
  books: "Vaultite/plugins/books",
  "dock-icon": "Vaultite/plugins/dock-icon",
  health: "Vaultite/plugins/health",
  learning: "Vaultite/plugins/learning",
  lessons: "Vaultite/plugins/lessons",
  "page-tabs": "Vaultite/plugins/page-tabs",
  podcasts: "Vaultite/plugins/podcasts",
  projects: "Vaultite/plugins/projects",
  today: "Vaultite/plugins/today",
}
const movedStep = (id: string) => `moved:${id}`

/** Every step's id: what a vault made as the app's defaults are now has had (a new one, the sandbox). */
export const DONE = [...STEPS.map((s) => s.id), ...Object.keys(MOVED).map(movedStep)]

/** Run the steps this vault hasn't had; a new vault (`fresh`) has them marked done. One that can't run now (a settings
 *  file iCloud holds) runs at the next start. */
export function migrate(v: Vault, fresh: boolean) {
  let done: string[]
  try { done = strs(v.readConfig(FILE)?.done) } catch { return }
  const todo = STEPS.filter((s) => !done.includes(s.id))
  if (!todo.length) return
  for (const s of todo) {
    if (!fresh) {
      try { s.run(v) } catch (e) { console.error(`bringing the vault's settings up to date (${s.id}):`, e); break }
    }
    done = [...done, s.id]
  }
  v.patchConfig(FILE, { done })
}

/** What installing a moved plugin needs of the app (core/coreops/installs.ts installFrom). */
export type Installer = { vault: Vault; has: (id: string) => boolean; install: (source: string) => Promise<unknown> }

/** A moved plugin the vault had on is installed from where it went, once, keeping its settings and on-state; it waits
 *  for each machine's yes like any install. One that can't be fetched now (offline) is tried at the next start. */
export async function migrateMoved(app: Installer) {
  let done: string[], conf: Record<string, unknown>
  try { done = strs(app.vault.readConfig(FILE)?.done); conf = app.vault.readConfig("plugins") ?? {} } catch { return }
  const enabled = strs(conf.enabled), disabled = strs(conf.disabled)
  const ran: string[] = []
  for (const [id, source] of Object.entries(MOVED)) {
    if (done.includes(movedStep(id)) || app.has(id)) continue
    if (enabled.includes(id) && !disabled.includes(id) && !fs.existsSync(app.vault.abs(`.vaultite/plugins/${id}/manifest.json`))) {
      try { await app.install(source) } catch (e) { console.error(`installing ${id}, which moved out of the app, from ${source}:`, e); continue }
    }
    ran.push(movedStep(id))
  }
  if (!ran.length) return
  try { done = strs(app.vault.readConfig(FILE)?.done) } catch { return }
  app.vault.patchConfig(FILE, { done: [...new Set([...done, ...ran])] })
}
