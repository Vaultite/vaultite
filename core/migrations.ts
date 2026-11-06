// A vault brought up to date when the app's defaults change under it (settings, the app's keys in files), once: a
// step's id goes in .vaultite/migrations.json when it has run (a synced vault's other machine skips it); a new vault starts with all done.
import fs from "node:fs"
import path from "node:path"
import { infoWithLayout, type LayoutKey, settingsOf } from "./blocks.ts"
import { FM, loadFm, setPropertyText } from "./frontmatter.ts"
import { FENCE, scan } from "./sections.ts"
import { type Item, readSoon, stamp, type Vault, writeAtomic } from "./vault.ts"
import { trustOf } from "./trust.ts"
import { keptOf } from "./kept.ts"
import { isObj, strings as strs } from "./values.ts"

const FILE = "migrations"


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

/** Who may reach a plugin's owner-only parts (`allowRemote`, `allowUsers`) is this machine's now (core/trust.ts), not the
 *  vault settings': copied once to each machine as they were, so no one let in is shut out (access-local-2026-10). */
export function accessToMachine(vault: Vault, plugins: { id: string; manifest: Item }[]) {
  const trust = trustOf(vault.path), STEP = "access-local-2026-10"
  if (trust.ran(STEP)) return
  for (const p of plugins) {
    let set: Item | null
    try { set = vault.readConfig(`plugins/${p.id}/data`) } catch { return } // (mid-sync: next start)
    // (one its manifest marked local was this machine's already: what the vault has for it never applied)
    const moving = ["allowRemote", "allowUsers"].filter((k) => set && k in set && !settingsOf(p.manifest)[k]?.local)
    if (moving.length) trust.patchLocal(p.id, Object.fromEntries(moving.map((k) => [k, set![k]])))
  }
  trust.ran(STEP, true)
}

/** Plugins' caches were .vaultite/cache/<id>.json: kept by the server now (core/kept.ts). Taken in at each start (an old
 *  app elsewhere writes one until it updates), the newer winning, then removed. */
export function cachesToKept(vault: Vault) {
  const dir = vault.abs(".vaultite/cache")
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { return }
  const kept = keptOf(vault.path)
  for (const f of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.json$/.exec(f)
    if (!m) continue
    const file = path.join(dir, f), name = m[1] === "plugin-index" ? "core/plugin-index" : `${m[1]}/cache`
    let data: unknown, at: number
    try { at = Math.round(fs.statSync(file).mtimeMs); data = JSON.parse(fs.readFileSync(file, "utf8")) } catch (e) {
      if (e instanceof SyntaxError) fs.rmSync(file, { force: true }) // (half written: a cache, made again)
      continue // (in iCloud only for now: the next start)
    }
    // (provenance's is each machine's own: what its copies of the files say)
    if (kept.at(name) < at) kept.set(name, data, { shared: m[1] !== "provenance", at })
    fs.rmSync(file, { force: true })
  }
  try { fs.rmdirSync(dir) } catch { /* something else is in it */ }
}

/** Built-ins that were on from the start (`essential`) and became `offByDefault`: on where they weren't switched off. */
export const NOW_OPT_IN = ["activity", "dispatch", "token-count", "workspaces", "codex", "cursor", "opencode", "openclaw", "hermes"]

/** Every Markdown file of the vault's own, archived ones too (not .vaultite/, .trash or .git), relative paths. */
function markdownFiles(root: string, rel = ""): string[] {
  let names: fs.Dirent[]
  try { names = fs.readdirSync(path.join(root, rel), { withFileTypes: true }) } catch { return [] }
  return names.filter((e) => ![".vaultite", ".trash", ".git", "node_modules"].includes(e.name)).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name
    return e.isDirectory() ? markdownFiles(root, r) : e.name.endsWith(".md") ? [r] : []
  })
}

/** Change the vault's Markdown files (`only` those, else all) by `change`, each read off the main thread as a sync reads
 *  it: a file iCloud is slow to give never holds the start. Returns those not read yet (iCloud bringing them): later. */
async function eachMarkdown(v: Vault, only: string[] | undefined, change: (rel: string, text: string) => string) {
  const queue = only ?? markdownFiles(v.abs("")), later: string[] = []
  let at = 0 // (not shift(): on a big array each one moves the rest)
  const next = async () => {
    for (let rel = queue[at++]; rel !== undefined; rel = queue[at++]) {
      const abs = v.abs(rel)
      let data: Buffer | null
      try { data = await readSoon(abs) } catch { continue } // (gone meanwhile, or not a file)
      if (data === null) { later.push(rel); continue }
      const text = data.toString("utf8"), out = change(rel, text)
      if (out !== text) writeAtomic(abs, out)
    }
  }
  await Promise.all(Array.from({ length: Math.min(64, queue.length) }, next))
  return later.sort()
}

/** The kinds' stamps (a note's created) were UTC; they're the vault's local time now, as the user reads them. */
function stampsToLocal(v: Vault, only?: string[]) {
  const UTC = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/
  return eachMarkdown(v, only, (rel, text) => {
    let fm: Item
    try { fm = loadFm(FM.exec(text)?.[1] ?? "") } catch { return text }
    const keys = v.kindFor(rel, fm)?.spec.stamps ?? []
    let out: string | null = text
    for (const k of keys) {
      if (out && typeof fm[k] === "string" && UTC.test(fm[k])) out = setPropertyText(out, k, stamp(new Date(`${fm[k].replace(" ", "T")}Z`)))
    }
    return out ?? text
  })
}

/** A text's ```base fences with their `wide: true` / `stack: true` (keys of its YAML, where the grid read them) moved to
 *  its info line, ```base wide, where a fence a plugin draws keeps its layout now (core/blocks.ts fenceLayout). */
export function baseLayoutOut(text: string): string {
  if (!/(`{3,}|~{3,})\s*base/i.test(text)) return text
  const s = scan(text), lines = [...s.lines], drop = new Set<number>()
  for (const f of s.fences) {
    if (f.close === null || f.info.split(/\s/)[0].toLowerCase() !== "base") continue
    let info = f.info
    for (let i = f.open + 1; i < f.close; i++) {
      const m = /^(wide|stack):\s*(true|false)\s*$/.exec(lines[i])
      if (!m) continue
      drop.add(i)
      if (m[2] === "true") info = infoWithLayout(info, m[1] as LayoutKey, true)
    }
    if (info !== f.info) lines[f.open] = FENCE.exec(lines[f.open])![0] + info
  }
  return drop.size ? lines.filter((_, i) => !drop.has(i)).join("\n") : text
}

/** The Browser's blocked elements list, which was a note of the user's (type: blocked-elements) and is the app's now,
 *  in .vaultite (the web-viewer plugin's elements.ts BLOCKED). */
const BLOCKED_LIST = ".vaultite/plugins/web-viewer/blocked-elements.md"

/** The blocked elements note (at the top, or moved into a folder) into the Browser's list, the note to the trash. */
async function blockedElementsIn(v: Vault): Promise<string[]> {
  const top = "Blocked elements.md"
  const found = fs.existsSync(v.abs(top)) ? [top] : markdownFiles(v.abs("")).filter((rel) => path.basename(rel) === top)
  for (const rel of found) {
    const text = (await readSoon(v.abs(rel)))?.toString("utf8")
    const fm = text && FM.exec(text)
    let type: unknown
    try { type = fm ? loadFm(fm[1] ?? "").type : undefined } catch { continue }
    if (!text || type !== "blocked-elements") continue
    const body = text.slice(fm![0].length).replace(/^\n+/, "")
    const had = fs.existsSync(v.abs(BLOCKED_LIST)) ? fs.readFileSync(v.abs(BLOCKED_LIST), "utf8") : ""
    writeAtomic(v.abs(BLOCKED_LIST), had ? `${had.replace(/\n*$/, "\n\n")}${body}` : body)
    v.toTrash(rel)
    break
  }
  return []
}

/** The status bar's items for the file (Vim's mode, chips, the view, the counts) were always there; they're in its list
 *  now (appearance `statusBar`), which a saved one gets, where they were (status-bar-items-2026-10). */
const FILE_ITEMS = ["vim:mode", "properties:chips", "provenance:origin", "core:view", "core:words", "core:characters", "token-count:tokens"]
const withFileItems = (look: Item | null) =>
  Array.isArray(look?.statusBar) ? { ...look, statusBar: [...look.statusBar.filter((k: unknown) => !FILE_ITEMS.includes(k as string)), ...FILE_ITEMS] } : null

/** In the vault's settings, its saved bundles' and the setup a restore puts back (`bundles/previous`). */
function eachSettings(v: Vault, change: (get: (name: string) => Item | null, set: (name: string, value: Item) => void) => void) {
  const inVault = (base: string) => change((n) => v.readConfig(base + n), (n, value) => v.setConfig(base + n, value))
  inVault("")
  let saved: string[] = []
  try { saved = fs.readdirSync(v.abs(".vaultite/bundles"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* none */ }
  for (const b of saved) inVault(`bundles/${b}/`)
  const prev = v.readConfig("bundles/previous")
  if (prev && isObj<Item>(prev.config)) {
    const config: Record<string, Item> = { ...prev.config }
    change((n) => config[n] ?? null, (n, value) => { config[n] = value })
    if (JSON.stringify(config) !== JSON.stringify(prev.config)) v.setConfig("bundles/previous", { ...prev, config })
  }
}

function bundlePicturesOut(v: Vault) {
  let saved: string[] = []
  try { saved = fs.readdirSync(v.abs(".vaultite/bundles"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { /* none */ }
  for (const b of saved) for (const f of ["preview.png", "preview-dark.png"]) fs.rmSync(v.abs(`.vaultite/bundles/${b}/${f}`), { force: true })
}

/** A step: what it changes in the vault. One that changes files (`only` those, when some were left) returns the files it
 *  couldn't read yet, to change at a later start. */
const STEPS: { id: string; run: (v: Vault, only?: string[]) => void | Promise<string[]> }[] = [
  { id: "stamps-local-2026-10", run: stampsToLocal },
  { id: "base-layout-2026-10", run: (v, only) => eachMarkdown(v, only, (_, text) => baseLayoutOut(text)) },
  {
    id: "plugins-opt-in-2026-10",
    run: (v) => {
      const conf = v.readConfig("plugins") ?? {}
      const disabled = strs(conf.disabled), enabled = strs(conf.enabled)
      // (not one that moved out of the app since: on by default was never asking to install it)
      const on = NOW_OPT_IN.filter((id) => !disabled.includes(id) && !enabled.includes(id) && !Object.hasOwn(MOVED, id))
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
      if (prev && isObj<Item>(prev.config)) {
        const config: Record<string, Item> = { ...prev.config }, absent = strs(prev.absent)
        dailyNotesOut((n) => config[n] ?? null, (n, value) => { config[n] = value })
        if (absent.includes("plugins/today/data") && config["plugins/daily-notes/data"] && !absent.includes("plugins/daily-notes/data")) absent.push("plugins/daily-notes/data")
        if (JSON.stringify(config) !== JSON.stringify(prev.config)) v.setConfig("bundles/previous", { ...prev, config, absent })
      }
    },
  },
  { id: "blocked-elements-2026-10", run: blockedElementsIn },
  {
    id: "status-bar-items-2026-10",
    run: (v) => eachSettings(v, (get, set) => { const look = withFileItems(get("appearance")); if (look) set("appearance", look) }),
  },
  {
    // plugins.json's `order`, from when the Plugins page could be dragged: nothing reads it.
    id: "plugins-order-out-2026-10",
    run: (v) => eachSettings(v, (get, set) => {
      const conf = get("plugins")
      if (conf && "order" in conf) set("plugins", Object.fromEntries(Object.entries(conf).filter(([k]) => k !== "order")))
    }),
  },
  {
    // The Inbox's show_read, from when reading an event took it out of the lists: what's listed is what isn't done now.
    id: "inbox-show-read-out-2026-10",
    run: (v) => eachSettings(v, (get, set) => {
      const conf = get("plugins/inbox/data")
      if (conf && "show_read" in conf) set("plugins/inbox/data", Object.fromEntries(Object.entries(conf).filter(([k]) => k !== "show_read")))
    }),
  },
  {
    // appearance.json's `typingFade` (on or off), now one of fileBarFade's three: off, typing or always.
    id: "file-bar-fade-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const look = get("appearance")
      if (!look || !("typingFade" in look)) return
      const renamed = renamedKey(look, "typingFade", "fileBarFade")!
      set("appearance", "fileBarFade" in look ? renamed : { ...renamed, fileBarFade: look.typingFade === true ? "typing" : "off" })
    }),
  },
  {
    // Watches' own folder setting, the same as its kind's folder (folders.json's watches): moved there.
    id: "watches-folder-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const conf = get("plugins/watches/data")
      if (!conf || !("folder" in conf)) return
      const { folder, ...rest } = conf, folders = get("folders") ?? {}
      if (typeof folder === "string" && folder.trim() && !("watches" in folders)) set("folders", { ...folders, watches: folder.trim().replace(/^\/+|\/+$/g, "") })
      set("plugins/watches/data", rest)
    }),
  },
  {
    // The companion's notice mode, merged into pair: its setting and its palette command's keys.
    id: "companion-notice-pair-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const conf = get("plugins/companion/data")
      if (conf?.mode === "notice") set("plugins/companion/data", { ...conf, mode: "pair" })
      const keys = get("hotkeys"), hk = keys && renamedKey(keys, "companion:notice", "companion:pair")
      if (hk) set("hotkeys", hk)
    }),
  },
  // Saved bundles' screenshots (preview.png, preview-dark.png): their pictures are drawn now.
  { id: "bundle-pictures-out-2026-11", run: bundlePicturesOut },
  {
    // Zen's "Floating panes" snippet (gone: it styled panes by a selector they no longer have, leaving the page on the
    // window's colour under a page-coloured bar) for what it drew, the app's own pane cards.
    id: "zen-pane-cards-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const look = get("appearance")
      if (!Array.isArray(look?.snippets) || !look.snippets.includes("Floating panes")) return
      set("appearance", { ...look, snippets: look.snippets.filter((x: unknown) => x !== "Floating panes"), paneCards: true })
    }),
  },
  {
    // appearance.json's `paneTitles` (a split's panes named above them, only with the tab bar off: on, they always had
    // their tabs' strip), now `paneTabBars` with the tab bar on or off: each keeps what it showed. Its switch's keys follow.
    id: "pane-tab-bars-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const look = get("appearance")
      if (look && "paneTitles" in look) {
        const { paneTitles, ...rest } = look, strips = look.tabBar !== false || paneTitles === true
        set("appearance", "paneTabBars" in look ? rest : { ...rest, ...(strips ? {} : { paneTabBars: false }) })
      }
      const keys = get("hotkeys"), hk = keys && renamedKey(keys, "setting:pane-titles", "setting:pane-tab-bars")
      if (hk) set("hotkeys", hk)
    }),
  },
  {
    // The companion summoned (hold ⌃⌥): no cursor waits at rest (`screen_cursor` out), and double Control is no key: the
    // companion's becomes ⌃⌥, dictation's goes (its default, fn⌃, if none is left).
    id: "summoned-keys-2026-11",
    run: (v) => eachSettings(v, (get, set) => {
      const keys = (x: unknown, to: string | null) => [...new Set(strs(x).flatMap((k) => (k === "double_control" ? (to ? [to] : []) : [k])))]
      const c = get("plugins/companion/data")
      if (c && ("screen_cursor" in c || strs(c.keys).includes("double_control"))) {
        const { screen_cursor: _, ...rest } = c
        set("plugins/companion/data", Array.isArray(c.keys) ? { ...rest, keys: keys(c.keys, "control_option") } : rest)
      }
      const d = get("plugins/dictation/data")
      if (d && strs(d.keys).includes("double_control")) {
        const { keys: was, ...rest } = d, left = keys(was, null)
        set("plugins/dictation/data", left.length ? { ...rest, keys: left } : rest)
      }
    }),
  },
]

/** The app's plugins that moved to Vaultite's plugin directory: id -> where they're installed from now. Off the app in
 *  the same change (an install can't take an id the app has); bundles name them with `install`. */
export const MOVED: Record<string, string> = {
  "app-windows": "Vaultite/plugins/app-windows",
  books: "Vaultite/plugins/books",
  cursor: "Vaultite/plugins/cursor",
  dispatch: "Vaultite/plugins/dispatch",
  "dock-icon": "Vaultite/plugins/dock-icon",
  "grok-bot": "Vaultite/plugins/grok-bot",
  health: "Vaultite/plugins/health",
  hermes: "Vaultite/plugins/hermes",
  learning: "Vaultite/plugins/learning",
  lessons: "Vaultite/plugins/lessons",
  muse: "Vaultite/plugins/muse",
  openclaw: "Vaultite/plugins/openclaw",
  opencode: "Vaultite/plugins/opencode",
  "page-tabs": "Vaultite/plugins/page-tabs",
  podcasts: "Vaultite/plugins/podcasts",
  projects: "Vaultite/plugins/projects",
  today: "Vaultite/plugins/today",
}
const movedStep = (id: string) => `moved:${id}`

/** Every step's id: what a vault made as the app's defaults are now has had (a new one, the sandbox). */
export const DONE = [...STEPS.map((s) => s.id), ...Object.keys(MOVED).map(movedStep)]

/** Run the steps this vault hasn't had; a new vault (`fresh`) has them marked done. One that can't run now (a settings
 *  file iCloud holds) runs at the next start, and so do a step's files iCloud hadn't brought yet (`later`), alone. */
export async function migrate(v: Vault, fresh: boolean) {
  let done: string[], later: Record<string, string[]>
  try {
    const conf = v.readConfig(FILE)
    done = strs(conf?.done)
    later = Object.fromEntries(Object.entries(isObj<Item>(conf?.later) ? conf!.later : {}).map(([id, rels]) => [id, strs(rels)]))
  } catch { return }
  const todo = STEPS.filter((s) => !done.includes(s.id) || later[s.id]?.length)
  if (!todo.length) return
  for (const s of todo) {
    if (!fresh) {
      try {
        const left = await s.run(v, done.includes(s.id) ? later[s.id] : undefined)
        if (left?.length) later[s.id] = left
        else delete later[s.id]
      } catch (e) { console.error(`bringing the vault's settings up to date (${s.id}):`, e); break }
    }
    if (!done.includes(s.id)) done = [...done, s.id]
  }
  v.patchConfig(FILE, { done, later: Object.keys(later).length ? later : null })
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
