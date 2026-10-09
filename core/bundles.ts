// Bundles: a setup of the app to pick, save and share (plugins, settings, panels, pins, look), as a folder shaped like
// .vaultite/ (core/docs/bundles.md). Applying is small edits through the API's routes, undone from previous.json.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { settingsOf, type SettingDecls } from "./blocks.ts"
import { copies, templates } from "./pages.ts"
import { inPagesDir, PAGES_DIR } from "./fileprops.ts"
import { HTTPError, type Plugin, ROOT, Text } from "./plugins.ts"
import { blocksIn } from "./sections.ts"
import { readSidebars, type Sidebars } from "./sidebars.ts"
import { type Item, readText, type Vault, writeAtomic } from "./vault.ts"

export const APP_BUNDLES = path.join(ROOT, "bundles")
export const VAULT_BUNDLES = ".vaultite/bundles"
const PREVIOUS = `${VAULT_BUNDLES}/previous.json`
const ONBOARDING = `${VAULT_BUNDLES}/onboarding.json`
/** The setup a vault opened for the first time starts from (core/start.ts), and one that skips the offer gets. */
export const DEFAULT_BUNDLE = "minimal"
/** Ids a bundle can't take: they're routes. */
const RESERVED = new Set(["restore", "import", "onboarding", "previous"])
/** The settings files a bundle may hold, as the vault's .vaultite/ has them. */
export const CONFIGS = ["plugins", "sidebars", "pages", "appearance", "hotkeys"] as const
/** The app's own appearance when a key isn't set (web/src/core/prefs.ts DEFAULTS): a bundle setting one of these
 *  removes the key instead, so a vault never holds a default. */
const LOOK_DEFAULTS: Item = { theme: "system", scheme: "gruvbox", density: "compact", sidebarScroll: "panels", fileIcons: true, tabBar: true, lineNumbers: false, interfaceFont: "", textFont: "", monoFont: "", snippets: [] }
/** A bundle is read whole each time the bundles are listed: past this it's listed with the error, not read. */
const MAX_BYTES = 64 * 1024 * 1024

/** A bundle's files by relative path: text, or the bytes of one that isn't (an image, a font, wasm). */
export type Files = Record<string, string | Buffer>
/** `error`: why its files couldn't be read (then there are none). */
export type Bundle = { id: string; source: "app" | "vault"; files: Files; error?: string }
/** What the bundle code needs of the app (core/app.ts): its vault, plugins, and its own API to make the edits. */
export type Host = {
  vault: Vault
  /** The app's plugins, then the vault's that are loaded. */
  plugins: () => Plugin[]
  /** The vault's own plugins, loaded or not (GET /api/plugins). */
  vaultPlugins: () => Item[]
  /** One request to this API (method, route under /api/, body): its body; HTTPError when it fails. */
  call: (method: string, route: string, body?: unknown) => Promise<unknown>
  /** Load or unload vault plugins after plugins.json changed, and install their pages. */
  syncPlugins: () => Promise<unknown>
  /** Allow vault plugins to run on this machine as their files are now (core/trust.ts), when this machine's owner asked. */
  allow?: (ids: string[]) => Promise<void>
}

const isObj = (v: unknown): v is Item => !!v && typeof v === "object" && !Array.isArray(v)
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const hash = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 16)
/** A bundle file's text ("" for bytes that aren't). */
const textOf = (f: string | Buffer | undefined) => (typeof f === "string" ? f : "")
export const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
const ID = /^[a-z0-9][a-z0-9-]*$/

// ---------- reading bundles ----------

/** A path a bundle may hold: relative, no `..`, no hidden segment. */
export const safePath = (p: string) => !!p && !p.startsWith("/") && p.split("/").every((s) => !!s && s !== ".." && !s.startsWith("."))

const tooBig = () => new HTTPError(413, `a bundle holds at most ${MAX_BYTES / 1024 / 1024} MB`)

/** A folder's files by relative path (hidden ones left out): text, or bytes when it isn't UTF-8. */
function readFolder(dir: string): Files {
  const out: Files = {}
  let bytes = 0
  const walk = (sub: string) => {
    for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith(".")) continue
      const rel = sub ? `${sub}/${e.name}` : e.name, abs = path.join(dir, rel)
      if (e.isDirectory()) walk(rel)
      else if (e.isFile()) {
        if ((bytes += fs.statSync(abs).size) > MAX_BYTES) throw tooBig()
        try { out[rel] = readText(abs) } catch (err) { if (!(err instanceof TypeError)) throw err; out[rel] = fs.readFileSync(abs) }
      }
    }
  }
  walk("")
  return out
}

/** Every bundle there is: the app's, then the user's (each with its id, the folder's name). */
export function list(vault: Vault): Bundle[] {
  const out: Bundle[] = []
  for (const [source, dir] of [["app", APP_BUNDLES], ["vault", vault.abs(VAULT_BUNDLES)]] as const) {
    let names: string[] = []
    try { names = fs.readdirSync(dir).sort() } catch { continue }
    for (const id of names) {
      if (!ID.test(id) || RESERVED.has(id) || !fs.existsSync(path.join(dir, id, "bundle.json"))) continue
      if (out.some((b) => b.id === id)) continue // (a user's bundle can't take one of the app's ids)
      try { out.push({ id, source, files: readFolder(path.join(dir, id)) }) } catch (e) {
        out.push({ id, source, files: {}, error: `it can't be read: ${(e as Error).message}` })
      }
    }
  }
  return out
}

export function find(vault: Vault, id: string): Bundle {
  const all = list(vault)
  const b = all.find((x) => x.id === id)
  if (!b) throw new HTTPError(404, `there's no bundle '${id}'`)
  return b
}

/** A JSON file of the bundle as an object (null when it hasn't that file; a 400 when it isn't an object). */
function json(b: Bundle | Files, rel: string): Item | null {
  const files = "files" in b && typeof (b as Bundle).id === "string" ? (b as Bundle).files : b as Files
  const t = files[rel]
  if (t === undefined) return null
  try { const o = JSON.parse(textOf(t)); if (isObj(o)) return o } catch { /* below */ }
  throw new HTTPError(400, `the bundle's ${rel} isn't a JSON object`)
}

/** What a bundle's files are: its settings, the vault plugins it brings, the vault files it adds. */
function parts(files: Files) {
  const code = new Set<string>()
  for (const f of Object.keys(files)) { const m = /^plugins\/([^/]+)\/manifest\.json$/.exec(f); if (m) code.add(m[1]) }
  const settings = new Map<string, string>() // plugin id -> its data.json path
  const vaultFiles: string[] = [], hidden: string[] = [] // vault paths, and .vaultite/ ones (themes, snippets, plugin folders)
  for (const f of Object.keys(files)) {
    if (f === "bundle.json" || CONFIGS.some((c) => f === `${c}.json`)) continue
    const m = /^plugins\/([^/]+)\/(.+)$/.exec(f)
    if (m) {
      if (code.has(m[1])) hidden.push(`.vaultite/${f}`)
      else if (m[2] === "data.json") settings.set(m[1], f)
      continue
    }
    if (/^(themes\/[^/]+\/|snippets\/)/.test(f)) { hidden.push(`.vaultite/${f}`); continue }
    vaultFiles.push(f)
  }
  return { code: [...code], settings, vaultFiles, hidden }
}

export type Info = {
  id: string; source: "app" | "vault"; name: string; description: string; icon: string; tint: string; author: string; sort: number
  /** One of the app's kept under More on the page (bundle.json's `more`). */
  more: boolean
  /** The look it sets (appearance.json's), for its card. */
  theme: string | null; scheme: string | null; density: string | null
  /** The app plugins that are on with it (null: it leaves them as they are), and the pages it pins (null: same). */
  on: string[] | null; pinned: string[] | null
  /** Its sidebars' panels (null: it leaves them as they are, or the default), for its card. */
  panels: { left: string[]; right: string[]; collapsed: string[] } | null
  /** What the first page it pins draws, for its card: its blocks in order (null: it pins nothing; [] not known). */
  home: HomeBlock[] | null
  /** Vault plugins it brings: they run code. */
  code: string[]
  hotkeys: boolean
  problems: string[]
}
export type HomeBlock = { block: string; view: string | null; wide: boolean }

/** The blocks of the first page a bundle pins (the vault's copy, wherever it moved, else the bundle's, else the
 *  template a plugin ships), at most 6. */
function homeOf(b: Bundle, host: Host, pinned: string[] | null): HomeBlock[] | null {
  if (pinned && !pinned.length) return null
  const first = pinned?.[0]
  if (!first) return []
  let text = ""
  try { text = readText(host.vault.abs(host.vault.relocated(first))) } catch {
    text = textOf(b.files[first]) || (templates(host.plugins()).find(([, rel]) => rel === first)?.[2] ?? "")
  }
  const out: HomeBlock[] = []
  for (const b of blocksIn(text)) {
    out.push({ block: b.name, view: /^view:\s*['"]?(\w+)/m.exec(b.text)?.[1] ?? null, wide: /^wide:\s*true\s*$/m.test(b.text) })
    if (out.length >= 6) break
  }
  return out
}

export function info(b: Bundle, host: Host): Info {
  const m = (() => { try { return json(b, "bundle.json") ?? {} } catch { return {} } })()
  const str = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d)
  let look: Item = {}
  try { look = json(b, "appearance.json") ?? {} } catch { /* problems says */ }
  let on: string[] | null = null, pinned: string[] | null = null
  try {
    const t = pluginTargets(b, host)
    on = t ? [...t.entries()].filter(([, v]) => v).map(([k]) => k) : null
    const p = json(b, "pages.json")
    pinned = p && Array.isArray(p.pinned) ? strs(p.pinned) : null
  } catch { /* problems says */ }
  let panels: Info["panels"] = null
  try { const s = readSidebars(json(b, "sidebars.json")); if (s) panels = { left: s.left, right: s.right, collapsed: s.collapsed } } catch { /* problems says */ }
  return {
    id: b.id, source: b.source, name: str(m.name, b.id), description: str(m.description), icon: str(m.icon, "package"), tint: str(m.tint, "primary"),
    sort: typeof m.sort === "number" ? m.sort : 1000, more: b.source === "app" && m.more === true,
    author: str(m.author), theme: str(look.theme) || null, scheme: str(look.scheme) || null, density: str(look.density) || null,
    on, pinned, panels, home: homeOf(b, host, pinned), code: parts(b.files).code, hotkeys: b.files["hotkeys.json"] !== undefined,
    problems: b.error ? [b.error] : problems(b.files),
  }
}

/** What's wrong with a bundle's files (the shapes, not whether this app has what it names: the plan says that). */
export function problems(files: Files): string[] {
  const out: string[] = []
  if (files["bundle.json"] === undefined) out.push("it has no bundle.json")
  for (const f of Object.keys(files)) {
    if (!safePath(f)) out.push(`${f}: not a path a bundle may hold`)
    if (f.endsWith(".json")) { try { const o = JSON.parse(textOf(files[f])); if (!isObj(o)) out.push(`${f} isn't a JSON object`) } catch { out.push(`${f} isn't valid JSON`) } }
  }
  const ok = (rel: string) => { try { return json(files, rel) } catch { return null } }
  const m = ok("bundle.json")
  if (m && (typeof m.name !== "string" || !m.name.trim())) out.push("bundle.json needs a name")
  const pj = ok("plugins.json")
  if (pj) for (const k of ["disabled", "enabled"]) if (pj[k] !== undefined && !Array.isArray(pj[k])) out.push(`plugins.json: ${k} must be a list of plugin ids`)
  const pg = ok("pages.json")
  if (pg && pg.pinned !== undefined && !Array.isArray(pg.pinned)) out.push("pages.json: pinned must be a list of vault paths")
  const sb = ok("sidebars.json")
  if (sb && Object.keys(sb).length && !readSidebars(sb)) out.push("sidebars.json needs left or right (a list of panels), or {} for the default")
  return out
}

// ---------- what applying changes ----------

/** The app's plugins, and the vault's (loaded or not), by id: whether it's opt-in (`enabled`, else on unless
 *  `disabled`) and its settings' declarations. */
function known(host: Host) {
  const out = new Map<string, { name: string; optIn: boolean; vault: boolean; settings: SettingDecls }>()
  for (const p of host.plugins()) {
    out.set(p.id, { name: String(p.manifest.name ?? p.id), optIn: p.tier === "vault" || !!p.manifest.offByDefault, vault: p.tier === "vault", settings: settingsOf(p.manifest) })
  }
  for (const v of host.vaultPlugins()) {
    if (!out.has(v.id)) out.set(v.id, { name: String(v.name ?? v.id), optIn: true, vault: true, settings: isObj(v.settings) ? v.settings as SettingDecls : {} })
  }
  return out
}

/** Which plugins the bundle turns on (true) or off (false), by id: the app's (by its plugins.json) and the vault
 *  plugins it brings. Null when it has no plugins.json (it leaves them as they are). */
function pluginTargets(b: Bundle, host: Host): Map<string, boolean> | null {
  const pj = json(b, "plugins.json")
  if (!pj) return null
  const disabled = Array.isArray(pj.disabled) ? new Set(strs(pj.disabled)) : null
  const enabled = Array.isArray(pj.enabled) ? new Set(strs(pj.enabled)) : null
  const out = new Map<string, boolean>()
  for (const p of host.plugins()) {
    if (p.tier === "vault") continue
    if (p.manifest.offByDefault) { if (enabled) out.set(p.id, enabled.has(p.id)) } else if (disabled) out.set(p.id, !disabled.has(p.id))
  }
  for (const id of parts(b.files).code) out.set(id, !!enabled?.has(id))
  return out
}

/** Is a plugin on by its own switch (plugins.json as it is)? */
function switchedOn(conf: Item, id: string, optIn: boolean) {
  return optIn ? strs(conf.enabled).includes(id) : !strs(conf.disabled).includes(id)
}

/** Pages the app brings (plugins' dashboards, the app's bundles' files): unpinned when the bundle applied doesn't pin
 *  them. Every other pin is the user's own and stays (their dashboards too, even saved in a bundle of theirs). */
function brought(host: Host) {
  const out = new Set(templates(host.plugins()).map(([, rel]) => rel))
  for (const b of list(host.vault)) if (b.source === "app") for (const f of parts(b.files).vaultFiles) out.add(f)
  for (const f of [...out]) out.add(host.vault.relocated(f)) // (and where the user moved them)
  return out
}

/** The list `cur` should become: the bundle's pins first, then the user's own as they were. */
function pinsFor(cur: string[], want: string[], brings: Set<string>) {
  return [...want, ...cur.filter((p) => !want.includes(p) && !brings.has(p))]
}

/** The edits that turn list `cur` into `want` (same pages, new order, some in or out), one pin at a time: unpin the
 *  ones leaving, then place each from the last (at the end) to the first (before the one placed after it). */
export function pinOps(cur: string[], want: string[]): { path: string; pinned: boolean; before?: string | null }[] {
  const ops: { path: string; pinned: boolean; before?: string | null }[] = cur.filter((p) => !want.includes(p)).map((p) => ({ path: p, pinned: false }))
  const left = cur.filter((p) => want.includes(p))
  if (left.join("\n") === want.join("\n")) return ops
  for (let i = want.length - 1; i >= 0; i--) ops.push({ path: want[i], pinned: true, before: want[i + 1] ?? null })
  return ops
}

type Change = { key: string; from: unknown; to: unknown }
export type Plan = {
  /** Plugins it turns on and off (ids), and ids it names that this app doesn't have. */
  plugins: { on: string[]; off: string[]; missing: string[] }
  /** Vault plugins it brings (they run code): `kept` when the vault has one by that id already (yours stays). */
  code: { id: string; name: string; kept: boolean }[]
  settings: (Change & { plugin: string })[]
  /** Settings it can't set here: `local` ones (this machine's), or a plugin this app doesn't have. */
  skipped: { plugin: string; key: string; why: string }[]
  /** The panels it sets (null: it leaves them), whether they change, and the workspace whose own ones it drops. */
  panels: { setup: Sidebars | null; changed: boolean; workspace: number | null }
  /** The pages it pins, the vault's list it makes, what's pinned and unpinned, pins it can't make, and the workspace's
   *  own list (null: none). Null: pins stay as they are. */
  pins: { want: string[]; list: string[]; pin: string[]; unpin: string[]; missing: string[]; workspace: string[] | null } | null
  appearance: Change[]
  hotkeys: Change[]
  /** Vault files it adds (and plugin dashboards it brings back), and the ones already there (left as they are). */
  files: { add: string[]; kept: string[] }
  /** Nothing would change. */
  empty: boolean
}

/** The workspace slot n (1-5) as saved, or null (none, or Workspaces isn't here). */
async function slotOf(host: Host, n: number | null): Promise<Item | null> {
  if (!n || !host.plugins().some((p) => p.id === "workspaces")) return null
  try {
    const w = ((await host.call("GET", "workspaces")) as Item).workspaces
    return Array.isArray(w) && isObj(w[n - 1]) ? w[n - 1] as Item : null
  } catch { return null }
}

/** What applying bundle b would change in this vault (and in workspace n, the one the user is on). */
export async function plan(b: Bundle, host: Host, n: number | null): Promise<Plan> {
  const v = host.vault, kinds = known(host)
  const { code, settings, vaultFiles, hidden } = parts(b.files)
  // plugins
  const conf = v.config("plugins")
  const targets = pluginTargets(b, host)
  const on: string[] = [], off: string[] = []
  for (const [id, want] of targets ?? []) {
    const k = kinds.get(id)
    const now = k ? switchedOn(conf, id, k.optIn) : false
    if (want !== now) (want ? on : off).push(id)
  }
  const pj = json(b, "plugins.json")
  const missing = [...new Set([...strs(pj?.disabled), ...strs(pj?.enabled)])].filter((id) => !kinds.has(id) && !code.includes(id))
  const codeInfo = code.map((id) => {
    const m = (() => { try { return json(b, `plugins/${id}/manifest.json`) ?? {} } catch { return {} } })()
    return { id, name: typeof m.name === "string" ? m.name : id, kept: fs.existsSync(v.abs(`.vaultite/plugins/${id}/manifest.json`)) }
  })
  // settings
  const set: Plan["settings"] = [], skipped: Plan["skipped"] = []
  for (const [id, rel] of settings) {
    const k = kinds.get(id)
    const want = json(b, rel) ?? {}
    if (!k) { for (const key of Object.keys(want)) skipped.push({ plugin: id, key, why: "this app has no such plugin" }); continue }
    const cur = v.config(`plugins/${id}/data`)
    for (const [key, to] of Object.entries(want)) {
      if (k.settings[key]?.local) { skipped.push({ plugin: id, key, why: "this machine's own (who may reach it), never set by a bundle" }); continue }
      // (a number the user set, a history's days: one lower would cut what it keeps)
      if (typeof cur[key] === "number" && typeof to === "number" && to < cur[key]) { skipped.push({ plugin: id, key, why: `yours is higher (${cur[key]}), never lowered by a bundle` }); continue }
      if (!same(cur[key], to)) set.push({ plugin: id, key, from: cur[key] ?? null, to })
    }
  }
  // panels
  const slot = await slotOf(host, n)
  const sb = json(b, "sidebars.json")
  const setup = sb ? readSidebars(sb) : null
  const ownPanels = slot ? readSidebars(slot.sidebars) : null
  const panels = { setup, changed: !!sb && (!same(readSidebars(v.config("sidebars")), setup) || !!ownPanels), workspace: sb && ownPanels ? n : null }
  // files: added when there's none (a vault plugin: its whole folder, when the vault has none by that id)
  const add: string[] = [], kept: string[] = []
  // (its pages go in PAGES_DIR, built in like the plugins': only .vaultite/ is written)
  const at = placeOf(b), there = (f: string) => fs.existsSync(v.abs(at(f)))
  for (const f of vaultFiles) (there(f) ? kept : add).push(at(f))
  for (const h of hidden) {
    const pm = /^\.vaultite\/plugins\/([^/]+)\//.exec(h)
    if (pm ? codeInfo.find((c) => c.id === pm[1])!.kept : fs.existsSync(v.abs(h))) continue
    add.push(h)
  }
  // pins
  let pins: Plan["pins"] = null
  const pg = json(b, "pages.json")
  if (pg && Array.isArray(pg.pinned)) {
    const all = templates(host.plugins()), tpl = new Map(all.map(([, rel, text]) => [rel, text])), mine = copies(v, all)
    const want: string[] = [], gone: string[] = []
    for (const p of strs(pg.pinned)) {
      if (!safePath(p)) { gone.push(p); continue }
      // (a file of the user's by a page's name isn't that page: its pages are in PAGES_DIR)
      if (fs.existsSync(v.abs(p)) && !(tpl.has(p) || vaultFiles.includes(p))) want.push(p)
      else if (mine.has(p)) want.push(mine.get(p)!) // (the user's copy of a plugin's page)
      else if (vaultFiles.includes(p)) want.push(at(p))
      else if (tpl.has(p)) { want.push(`${PAGES_DIR}/${p}`); if (!fs.existsSync(v.abs(`${PAGES_DIR}/${p}`))) add.push(`${PAGES_DIR}/${p}`) } // a plugin's page, built in
      else gone.push(p)
    }
    const cur = strs(v.config("pages").pinned), brings = brought(host)
    const listed = pinsFor(cur, want, brings)
    const own = slot && Array.isArray(slot.pinned) ? strs(slot.pinned) : null
    pins = { want, list: listed, pin: listed.filter((p) => !cur.includes(p)), unpin: cur.filter((p) => !listed.includes(p)), missing: gone,
      workspace: own && pinsFor(own, want, brings) }
  }
  // appearance, hotkeys: the keys it sets (an appearance value that's the app's default is written as no key)
  const diff = (name: string, defaults: Item = {}) => {
    const cur = v.config(name), eff = (k: string, x: unknown) => x ?? defaults[k] ?? null
    return Object.entries(json(b, `${name}.json`) ?? {}).filter(([k, to]) => !same(eff(k, cur[k]), eff(k, to)))
      .map(([key, to]) => ({ key, from: cur[key] ?? null, to: Object.hasOwn(defaults, key) && same(to, defaults[key]) ? null : to }))
  }
  const appearance = diff("appearance", LOOK_DEFAULTS), hotkeys = diff("hotkeys")
  const pinsChange = !!pins && (pins.list.join("\n") !== strs(v.config("pages").pinned).join("\n") ||
    (!!pins.workspace && pins.workspace.join("\n") !== strs(slot!.pinned).join("\n")))
  const empty = !on.length && !off.length && !set.length && !panels.changed && !pinsChange && !appearance.length && !hotkeys.length && !add.length
  return { plugins: { on, off, missing }, code: codeInfo, settings: set, skipped, panels, pins, appearance, hotkeys, files: { add, kept }, empty }
}

// ---------- applying, and restoring the setup from before ----------

/** What's kept before an apply (.vaultite/bundles/previous.json), to put back. Values are the keys' old ones (null:
 *  the key wasn't there); `absent`: settings files that weren't there at all. */
export type Previous = {
  bundle: string; name: string; at: string
  config: Record<string, Item>
  /** Each changed file's keys in their order before, so a restore leaves them as they were. */
  order?: Record<string, string[]>
  absent: string[]
  /** The vault's pinned pages before, and the pages the apply pinned. */
  pins: string[] | null; pinned: string[]
  /** The workspace the apply changed: its own panels and pins before (null: none of its own), the pages it pinned. */
  workspace: { n: number; sidebars: unknown; pins: string[] | null; pinned: string[] } | null
  /** Files it added, with their text's hash (trashed on restore while unchanged). */
  added: { path: string; hash: string }[]
}

const readPrevious = (v: Vault): Previous | null => {
  try { const o = JSON.parse(readText(v.abs(PREVIOUS))); return isObj(o) && typeof o.bundle === "string" ? o as Previous : null } catch { return null }
}

/** For /api/state: the setup that can be restored, and whether a new vault is still being offered the bundles. */
export function status(v: Vault) {
  const p = readPrevious(v)
  return { previous: p ? { bundle: p.bundle, name: p.name, at: p.at } : null, onboarding: fs.existsSync(v.abs(ONBOARDING)) }
}

/** A vault opened for the first time (no .vaultite/ before the app made it): offer the bundles. */
export function markNew(v: Vault) {
  writeAtomic(v.abs(ONBOARDING), JSON.stringify({ since: new Date().toISOString() }, null, 2) + "\n")
}

/** A new vault is still being offered the bundles (no plugin's pages are installed until it has picked: core/app.ts). */
export const offering = (v: Vault) => fs.existsSync(v.abs(ONBOARDING))

function doneOnboarding(v: Vault) {
  try { fs.unlinkSync(v.abs(ONBOARDING)) } catch { /* not offered */ }
}

/** The PATCH that turns `cur` into `next`: the keys that change, null for the ones that go. */
function patchOf(cur: Item, next: Item) {
  const out: Item = {}
  for (const [k, val] of Object.entries(next)) if (!same(cur[k], val)) out[k] = val
  for (const k of Object.keys(cur)) if (!(k in next)) out[k] = null
  return out
}

/** Copy a file into the vault (a vault plugin's, a dashboard): never over one that's there. */
function addFile(v: Vault, rel: string, data: string | Buffer, added: Previous["added"]) {
  if (fs.existsSync(v.abs(rel)) || v.relocated(rel) !== rel) return
  writeAtomic(v.abs(rel), data)
  added.push({ path: rel, hash: hash(data) })
}

/** Make a list of pinned pages `want`, one pin at a time: the vault's (POST /api/pins) or workspace n's own. */
async function pinTo(host: Host, cur: string[], want: string[], n: number | null) {
  for (const op of pinOps(cur, want)) {
    try { await host.call("POST", n ? `workspaces/${n}/pins` : "pins", op) } catch (e) {
      if (!(e instanceof HTTPError) || e.status !== 404) throw e // (a page that's gone meanwhile: skipped)
    }
  }
}

/** Where a bundle's file goes: a page (a dashboard) in PAGES_DIR, built in like the plugins' pages; anything else it
 *  brings (an image) at its own path, as applying it is the user's doing. */
const placeOf = (b: Bundle) => (f: string) => {
  const data = b.files[f]
  return f.endsWith(".md") && typeof data === "string" && /^---\n[\s\S]*?^type:\s*dashboard\s*$/m.test(data) ? `${PAGES_DIR}/${f}` : f
}

/** Applying it puts code in the vault or turns a vault plugin on: it asks first, like turning one on does. */
export const runsCode = (p: Plan) => p.code.some((c) => !c.kept || p.plugins.on.includes(c.id))

/** `remember: false`: no previous setup to restore (a new vault's first, core/start.ts, or the offer skipped). */
export async function apply(b: Bundle, host: Host, n: number | null, allowCode: boolean, { remember = true } = {}) {
  const v = host.vault
  if (b.error) throw new HTTPError(400, `${b.id}: ${b.error}`)
  const p = await plan(b, host, n)
  const { code, vaultFiles } = parts(b.files)
  if (runsCode(p) && !allowCode) {
    throw new HTTPError(409, `${info(b, host).name} brings vault plugins (${p.code.map((c) => c.name).join(", ")}): they run code on this machine. Apply it with allowCode to confirm.`)
  }
  const prev: Previous = { bundle: b.id, name: info(b, host).name, at: new Date().toISOString(), config: {}, absent: [], pins: null, pinned: [], workspace: null, added: [] }
  const keep = (name: string, patch: Item) => {
    if (!Object.keys(patch).length) return
    const cur = v.config(name)
    if (!fs.existsSync(v.abs(`.vaultite/${name}.json`))) prev.absent.push(name)
    prev.order ??= {}
    prev.order[name] ??= Object.keys(cur)
    const was = prev.config[name] ??= {}
    for (const k of Object.keys(patch)) if (!(k in was)) was[k] = k in cur ? cur[k] : null
  }
  const patch = async (name: string, body: Item) => {
    if (!Object.keys(body).length) return
    keep(name, body)
    await host.call("PATCH", name.startsWith("plugins/") ? `config/plugin/${name.split("/")[1]}` : `config/${name}`, body)
  }
  // 1. Files first, so the plugins and pins that need them find them. Vault plugins' folders, only when there's none.
  const at = placeOf(b)
  for (const f of vaultFiles) addFile(v, at(f), b.files[f], prev.added)
  for (const rel of p.files.add) {
    const was = inPagesDir(rel) ? rel.slice(PAGES_DIR.length + 1) : rel // (a page's own path, in PAGES_DIR)
    if (rel.startsWith(".vaultite/") && !inPagesDir(rel)) addFile(v, rel, b.files[rel.slice(".vaultite/".length)], prev.added)
    else if (!b.files[was]) { const t = templates(host.plugins()).find(([, r]) => r === was); if (t) addFile(v, rel, t[2], prev.added) }
  }
  // 2. Plugins on and off: plugins.json's two lists, changed for the plugins that change (the rest as they are).
  const conf = v.config("plugins")
  const kinds = known(host)
  let disabled = strs(conf.disabled), enabled = strs(conf.enabled)
  for (const id of [...p.plugins.on, ...p.plugins.off]) {
    const want = p.plugins.on.includes(id), optIn = kinds.get(id)?.optIn ?? code.includes(id)
    if (optIn) enabled = want ? [...enabled.filter((x) => x !== id), id] : enabled.filter((x) => x !== id)
    else disabled = want ? disabled.filter((x) => x !== id) : [...disabled.filter((x) => x !== id), id]
  }
  // The vault plugins it brought, asked for with allowCode, are allowed on this machine (not ones it found there: those keep
  // waiting until allowed on their own).
  const brought = p.code.filter((c) => !c.kept && p.plugins.on.includes(c.id)).map((c) => c.id)
  if (allowCode && brought.length) await host.allow?.(brought)
  await patch("plugins", patchOf({ disabled: strs(conf.disabled), enabled: strs(conf.enabled) }, { disabled, enabled }))
  await host.syncPlugins()
  // 3. Settings, appearance, hotkeys: the keys that change.
  const byPlugin = new Map<string, Item>()
  for (const s of p.settings) byPlugin.set(s.plugin, { ...byPlugin.get(s.plugin), [s.key]: s.to })
  for (const [id, body] of byPlugin) await patch(`plugins/${id}/data`, body)
  await patch("appearance", Object.fromEntries(p.appearance.map((c) => [c.key, c.to])))
  await patch("hotkeys", Object.fromEntries(p.hotkeys.map((c) => [c.key, c.to])))
  // 4. Panels: sidebars.json becomes the bundle's ({} for the default), and the workspace drops its own.
  const slot = await slotOf(host, n)
  if (json(b, "sidebars.json")) {
    const next = p.panels.setup ? { ...p.panels.setup } as Item : {}
    if (next.heightsAt === undefined) delete next.heightsAt
    await patch("sidebars", patchOf(v.config("sidebars"), next))
  }
  // 5. Pins: the vault's list, then the workspace's own (the same edits), one at a time.
  if (p.pins) {
    const cur = strs(v.config("pages").pinned)
    prev.pins = Array.isArray(v.config("pages").pinned) ? cur : null
    if (!fs.existsSync(v.abs(".vaultite/pages.json"))) prev.absent.push("pages")
    prev.pinned = p.pins.list.filter((x) => !cur.includes(x))
    await pinTo(host, cur, p.pins.list, null)
    // A bundle pinning nothing still says so: with no list, the plugins' pages would all be pinned (core/app.ts).
    if (!Array.isArray(v.config("pages").pinned)) await host.call("PATCH", "config/pages", { pinned: [] })
  }
  if (slot && n && (p.panels.workspace || (p.pins && Array.isArray(slot.pinned)))) {
    const own = Array.isArray(slot.pinned) ? strs(slot.pinned) : null
    prev.workspace = { n, sidebars: slot.sidebars ?? null, pins: own, pinned: [] }
    if (p.panels.workspace) await host.call("PUT", `workspaces/${n}`, { sidebars: null })
    if (own && p.pins?.workspace) {
      prev.workspace.pinned = p.pins.workspace.filter((x) => !own.includes(x))
      await pinTo(host, own, p.pins.workspace, n)
    }
  }
  doneOnboarding(v)
  if (remember) writeAtomic(v.abs(PREVIOUS), JSON.stringify(prev, null, 1) + "\n")
  return { applied: prev.name, plan: p, previous: { bundle: prev.bundle, name: prev.name, at: prev.at } }
}

/** Put back the setup from before the last apply, and forget it. Changes made since to other keys stay. */
export async function restore(host: Host) {
  const v = host.vault
  const prev = readPrevious(v)
  if (!prev) throw new HTTPError(404, "there's no previous setup to restore")
  // Settings: each key it changed, back to what it was (null removes it); a file that wasn't there goes when empty.
  for (const [name, was] of Object.entries(prev.config)) {
    if (Object.keys(was).length) await host.call("PATCH", name.startsWith("plugins/") ? `config/plugin/${name.split("/")[1]}` : `config/${name}`, was)
    // (keys put back in their old order, those added since after them)
    const now = v.config(name), order = prev.order?.[name] ?? []
    const back: Item = {}
    for (const k of [...order, ...Object.keys(now)]) if (k in now && !(k in back)) back[k] = now[k]
    if (JSON.stringify(back) !== JSON.stringify(now)) v.setConfig(name, back)
    if (prev.absent.includes(name) && !Object.keys(v.config(name)).length) {
      try { fs.unlinkSync(v.abs(`.vaultite/${name}.json`)) } catch { /* gone */ }
    }
  }
  await host.syncPlugins()
  // Pins: the old list, plus pages pinned since that the apply didn't pin; the workspace's the same way.
  if (prev.pins !== null || prev.pinned.length) {
    const cur = strs(v.config("pages").pinned), old = prev.pins ?? []
    await pinTo(host, cur, [...old, ...cur.filter((x) => !old.includes(x) && !prev.pinned.includes(x))], null)
    // (no list before: none again, and no file when there was none)
    const conf = v.config("pages")
    if (prev.pins === null && !strs(conf.pinned).length && "pinned" in conf) {
      if (prev.absent.includes("pages") && Object.keys(conf).length === 1) fs.unlinkSync(v.abs(".vaultite/pages.json"))
      else await host.call("PATCH", "config/pages", { pinned: null })
    }
  }
  const w = prev.workspace
  if (w) {
    if (w.sidebars) await host.call("PUT", `workspaces/${w.n}`, { sidebars: w.sidebars })
    const slot = await slotOf(host, w.n)
    if (w.pins && slot && Array.isArray(slot.pinned)) {
      const cur = strs(slot.pinned)
      await pinTo(host, cur, [...w.pins, ...cur.filter((x) => !w.pins!.includes(x) && !w.pinned.includes(x))], w.n)
    }
  }
  // Files it added, while they're as it wrote them: to the trash.
  const trashed: string[] = []
  for (const a of prev.added) {
    let data: Buffer
    try { data = fs.readFileSync(v.abs(a.path)) } catch { continue }
    if (hash(data) !== a.hash) continue
    toTrash(v, a.path)
    trashed.push(a.path)
  }
  for (const a of prev.added) pruneDirs(v, path.dirname(a.path))
  fs.unlinkSync(v.abs(PREVIOUS))
  await host.syncPlugins()
  return { restored: prev.name, trashed }
}

/** A file to the vault's .trash (a note through the vault, so its index and pins follow). */
function toTrash(v: Vault, rel: string) {
  if (rel.endsWith(".md") && (!rel.startsWith(".") || inPagesDir(rel))) v.trash(rel)
  else v.toTrash(rel)
}

/** Remove folders left empty (up to the vault's top, never .vaultite/ itself or its kinds' folders). */
function pruneDirs(v: Vault, rel: string) {
  for (let d = rel; d && d !== "." && !["Dashboards", ".vaultite", ".vaultite/plugins", ".vaultite/themes", ".vaultite/snippets"].includes(d); d = path.dirname(d)) {
    try { if (fs.readdirSync(v.abs(d)).length) return; fs.rmdirSync(v.abs(d)) } catch { return }
  }
}

// ---------- saving the current setup, export, import ----------

export type SaveOptions = { name: string; description?: string; icon?: string; tint?: string; hotkeys?: boolean; vaultPlugins?: boolean; workspace?: number | null; replace?: boolean }

/** The current setup as a bundle's files: plugins, non-default settings (never `local` ones), panels and pins, look,
 *  hotkeys and vault plugins if asked, and pinned dashboards no plugin brings. */
export async function current(host: Host, o: SaveOptions): Promise<Files> {
  const v = host.vault, kinds = known(host)
  const files: Files = {}
  const put = (rel: string, o: unknown) => { files[rel] = JSON.stringify(o, null, 2) + "\n" }
  put("bundle.json", { name: o.name.trim(), ...(o.description?.trim() ? { description: o.description.trim() } : {}), icon: o.icon || "package", ...(o.tint ? { tint: o.tint } : {}) })
  const conf = v.config("plugins")
  const app = host.plugins().filter((p) => p.tier !== "vault")
  const vaultOn = o.vaultPlugins ? host.vaultPlugins().filter((x) => x.on).map((x) => String(x.id)) : []
  put("plugins.json", {
    disabled: strs(conf.disabled).filter((id) => app.some((p) => p.id === id && !p.manifest.offByDefault)),
    enabled: strs(conf.enabled).filter((id) => app.some((p) => p.id === id && p.manifest.offByDefault) || vaultOn.includes(id)),
  })
  for (const id of vaultOn) {
    const dir = v.abs(`.vaultite/plugins/${id}`)
    for (const [rel, data] of Object.entries(readFolder(dir))) if (rel !== "data.json") files[`plugins/${id}/${rel}`] = data
  }
  // Settings: declared ones (manifest.json's `settings`) set to something other than their default, of plugins that are
  // on; never `local` ones (this machine's).
  for (const [id, k] of kinds) {
    if (!switchedOn(conf, id, k.optIn) || (k.vault && !vaultOn.includes(id))) continue
    const data = v.config(`plugins/${id}/data`)
    const keep = Object.fromEntries(Object.entries(data).filter(([key, val]) => {
      const d = k.settings[key]
      return d && !d.local && !same(val, d.default)
    }))
    if (Object.keys(keep).length) put(`plugins/${id}/data.json`, keep)
  }
  const slot = await slotOf(host, o.workspace ?? null)
  put("sidebars.json", readSidebars(slot?.sidebars) ?? readSidebars(v.config("sidebars")) ?? {})
  const pinned = slot && Array.isArray(slot.pinned) ? strs(slot.pinned) : strs(v.config("pages").pinned)
  // (a built-in page by its own path, Dashboards/Today.md: where it goes is the vault's business)
  put("pages.json", { pinned: pinned.map((p) => (inPagesDir(p) ? p.slice(PAGES_DIR.length + 1) : p)) })
  const look = v.config("appearance")
  if (Object.keys(look).length) put("appearance.json", look)
  if (o.hotkeys) { const h = v.config("hotkeys"); if (Object.keys(h).length) put("hotkeys.json", h) }
  // The dashboards it pins that no plugin brings (and their other tabs), and the theme and snippets it uses.
  const tpl = new Set(templates(host.plugins()).map(([, rel]) => rel))
  const add = (rel: string) => {
    if (files[rel] !== undefined || tpl.has(rel) || !safePath(rel)) return
    let text: string
    try { text = readText(v.abs(rel)) } catch { return }
    if (rel.endsWith(".base") || (rel.endsWith(".md") && /^---\n[\s\S]*?^type:\s*dashboard\s*$/m.test(text))) {
      files[rel] = text
      const tabs = /^tabs:\s*\[(.*)\]\s*$/m.exec(text)?.[1]
      for (const t of tabs ? tabs.split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : []) add(`${path.dirname(rel) === "." ? "" : path.dirname(rel) + "/"}${t}.md`)
    }
  }
  for (const p of pinned) add(p)
  const scheme = typeof look.scheme === "string" && look.scheme.startsWith("theme:") ? look.scheme.slice(6) : null
  if (scheme && safePath(scheme)) {
    try { for (const [rel, data] of Object.entries(readFolder(v.abs(`.vaultite/themes/${scheme}`)))) files[`themes/${scheme}/${rel}`] = data } catch (e) { if (e instanceof HTTPError) throw e }
  }
  for (const s of strs(look.snippets)) {
    try { if (safePath(s)) files[`snippets/${s}.css`] = readText(v.abs(`.vaultite/snippets/${s}.css`)) } catch { /* not there */ }
  }
  return files
}

/** Write a bundle's files as the user's bundle `id` (a new folder; `replace`: the one there goes to the trash first). */
function writeBundle(v: Vault, id: string, files: Files, replace: boolean) {
  const rel = `${VAULT_BUNDLES}/${id}`
  if (fs.existsSync(v.abs(rel))) {
    if (!replace) throw new HTTPError(409, `there's a bundle '${id}' already`)
    v.toTrash(rel)
  }
  for (const [f, data] of Object.entries(files)) writeAtomic(v.abs(`${rel}/${f}`), data)
}

/** A free id for a new bundle of the user's, from its name (not one of the app's, nor a route). */
function freeId(v: Vault, name: string, replace: boolean) {
  const base = slug(name) || "bundle"
  const taken = (id: string) => RESERVED.has(id) || fs.existsSync(path.join(APP_BUNDLES, id)) || (!replace && fs.existsSync(v.abs(`${VAULT_BUNDLES}/${id}`)))
  let id = base, i = 2
  while (taken(id)) id = `${base}-${i++}`
  return id
}

export async function save(host: Host, o: SaveOptions) {
  if (typeof o.name !== "string" || !o.name.trim()) throw new HTTPError(400, "a bundle needs a name")
  const files = await current(host, o)
  const id = freeId(host.vault, o.name, !!o.replace)
  writeBundle(host.vault, id, files, !!o.replace)
  return { bundle: info(find(host.vault, id), host) }
}

/** A bundle as one JSON file: a JSON file as its JSON, text as a string, other bytes as `{"base64": ...}`. */
export function exportOf(b: Bundle) {
  if (b.error) throw new HTTPError(400, `${b.id}: ${b.error}`)
  const files: Record<string, unknown> = {}
  for (const [f, data] of Object.entries(b.files)) {
    if (typeof data !== "string") { files[f] = { base64: data.toString("base64") }; continue }
    if (f.endsWith(".json")) { try { files[f] = JSON.parse(data); continue } catch { /* as text */ } }
    files[f] = data
  }
  return { vaultite: "bundle", format: 1, id: b.id, files }
}

/** A bundle from its JSON file (exportOf's), into the user's bundles. Never applied here. */
export function importOf(v: Vault, body: unknown, host: Host) {
  const o = isObj(body) && isObj(body.file) ? body.file : body
  if (!isObj(o) || o.vaultite !== "bundle" || !isObj(o.files)) throw new HTTPError(400, "that isn't a Vaultite bundle (a JSON file with \"vaultite\": \"bundle\" and its files)")
  if (typeof o.format === "number" && o.format > 1) throw new HTTPError(400, "this bundle was made by a newer Vaultite: update the app to import it")
  const files: Files = {}
  let bytes = 0
  for (const [f, val] of Object.entries(o.files)) {
    if (!safePath(f)) throw new HTTPError(400, `${f}: not a path a bundle may hold`)
    const data = typeof val === "string" ? val
      : !f.endsWith(".json") && isObj(val) && typeof val.base64 === "string" ? Buffer.from(val.base64, "base64") : JSON.stringify(val, null, 2) + "\n"
    if ((bytes += Buffer.byteLength(data)) > MAX_BYTES) throw tooBig()
    files[f] = data
  }
  const bad = problems(files)
  if (bad.length) throw new HTTPError(400, `that bundle can't be read: ${bad.join("; ")}`)
  const name = String(JSON.parse(textOf(files["bundle.json"])).name)
  const id = freeId(v, typeof o.id === "string" && ID.test(o.id) ? o.id : name, false)
  writeBundle(v, id, files, false)
  return { bundle: info(find(v, id), host) }
}

/** How pages look in a list (their `icon`, `tint` and `plugin`), from the vault's file, else the bundle's or the plugin
 *  template's: for the preview, before the files are there. */
function pageLooks(b: Bundle, host: Host, paths: string[]) {
  const tpl = new Map(templates(host.plugins()).map(([, rel, text]) => [rel, text]))
  const out: Record<string, { icon: string | null; tint: string | null; plugin: string | null }> = {}
  for (const p of paths) {
    let text = ""
    try { text = readText(host.vault.abs(p)) } catch { text = textOf(b.files[p]) || (tpl.get(p) ?? "") }
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ""
    const key = (k: string) => new RegExp(`^${k}:\\s*['"]?([\\w-]+)['"]?\\s*$`, "m").exec(fm)?.[1] ?? null
    out[p] = { icon: key("icon"), tint: key("tint"), plugin: key("plugin") }
  }
  return out
}

// ---------- the routes ----------

const workspaceOf = (x: unknown) => { const n = Number(x); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null }

/** /api/bundles/...: undefined when it isn't one of these routes. */
export async function handle(host: Host, method: string, parts: string[], query: Record<string, string>, body: Item): Promise<unknown> {
  const v = host.vault
  const [id, action] = parts
  if (parts.length === 0 && method === "GET") {
    const all = list(v).map((b) => info(b, host))
    all.sort((a, b) => (a.source === b.source ? 0 : a.source === "app" ? -1 : 1) || a.sort - b.sort || a.name.localeCompare(b.name))
    return { bundles: all, ...status(v) }
  }
  if (parts.length === 0 && method === "POST") return save(host, { ...body, workspace: workspaceOf(body.workspace) } as SaveOptions)
  if (parts.length === 1 && id === "restore" && method === "POST") return restore(host)
  if (parts.length === 1 && id === "import" && method === "POST") return importOf(v, body, host)
  if (parts.length === 1 && id === "onboarding" && method === "POST") {
    // Skipping the offer is starting from the default, like a new vault does (nothing to restore).
    if (offering(v)) await apply(find(v, DEFAULT_BUNDLE), host, null, false, { remember: false })
    return status(v)
  }
  if (parts.length === 1 && method === "GET") {
    const b = find(v, id)
    const p = await plan(b, host, workspaceOf(query.workspace))
    return { bundle: info(b, host), files: Object.keys(b.files), plan: p, pages: pageLooks(b, host, [...p.pins?.list ?? [], ...p.pins?.unpin ?? []]) }
  }
  if (parts.length === 1 && method === "DELETE") {
    const b = find(v, id)
    if (b.source !== "vault") throw new HTTPError(400, `${info(b, host).name} comes with the app: it can't be deleted`)
    return { deleted: id, trashed: v.toTrash(`${VAULT_BUNDLES}/${id}`) }
  }
  if (parts.length === 2 && action === "apply" && method === "POST") return apply(find(v, id), host, workspaceOf(body.workspace), body.allowCode === true)
  if (parts.length === 2 && action === "export" && method === "GET") {
    const b = find(v, id)
    return new Text(JSON.stringify(exportOf(b), null, 2) + "\n", "application/json; charset=utf-8", { "Content-Disposition": `attachment; filename="${b.id}.bundle.json"` })
  }
  return undefined
}
