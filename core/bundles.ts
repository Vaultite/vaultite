// Bundles: a setup of the app to pick, save and share (plugins, settings, panels, pins, look), as a folder shaped like
// .vaultite/ (core/docs/bundles.md). Applying is small edits through the API's routes, undone from previous.json.
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fenceLayout, settingsOf, type SettingDecls } from "./blocks.ts"
import { pageAt, templates } from "./pages.ts"
import { asLocked, git, parseSource, readLock, tagsOf } from "./installs.ts"
import { MOVED } from "./migrations.ts"
import { switched } from "./pluginmeta.ts"
import { OpError } from "./ops.ts"
import { HTTPError, type Plugin, ROOT, Text } from "./plugins.ts"
import { blockName, scan } from "./sections.ts"
import { readSidebars, type Sidebars } from "./sidebars.ts"
import { type Item, readText, type Vault, writeAtomic } from "./vault.ts"
import { isObj } from "./values.ts"

export const APP_BUNDLES = path.join(ROOT, "bundles")
const VAULT_BUNDLES = ".vaultite/bundles"
const PREVIOUS = `${VAULT_BUNDLES}/previous.json`
const ONBOARDING = `${VAULT_BUNDLES}/onboarding.json`
/** The setup a vault opened for the first time starts from (core/start.ts), and one that skips the offer gets. */
export const DEFAULT_BUNDLE = "standard"
/** The app's bundles that were folded into others: a vault that applied one has the one it's in now (tidy). */
const FOLDED: Record<string, string> = { minimal: "standard", pages: "life-os", "self-hosted": "agent-cockpit" }
/** Ids a bundle can't take: they're routes. */
const RESERVED = new Set(["restore", "import", "onboarding", "previous"])
/** The settings files a bundle may hold, as the vault's .vaultite/ has them. */
export const CONFIGS = ["plugins", "sidebars", "pages", "appearance", "hotkeys", "newtab"] as const
/** The picture a bundle's card shows instead of its sketch: a screenshot of the app it makes. */
export const PREVIEW = "preview.png"
/** The app's own appearance when a key isn't set (web/src/core/prefs.ts DEFAULTS): a bundle setting one of these
 *  removes the key instead, so a vault never holds a default. */
const LOOK_DEFAULTS: Item = { theme: "system", scheme: "gruvbox", density: "compact", sidebarScroll: "panels", panelDividers: false, quickTextSize: false, fileIcons: true, tabBar: true, lineNumbers: false, interfaceFont: "", textFont: "", monoFont: "", snippets: [] }
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
  /** One request to this API (method, route under /api/, body): its body; OpError when it fails. */
  call: (method: string, route: string, body?: unknown) => Promise<unknown>
  /** Load or unload vault plugins after plugins.json changed; those turned on write their pages (core/pages.ts), but
   *  with `pages: false` (a restore: they were on before). */
  syncPlugins: (opts?: { pages?: boolean }) => Promise<unknown>
  /** Write the pages of the plugins that are on that the pages folder has no file for (core/pages.ts). */
  writePages?: (opts?: { pin?: boolean; only?: string[] }) => string[]
  /** Allow vault plugins to run on this machine as their files are now (core/trust.ts), when this machine's owner asked. */
  allow?: (ids: string[]) => Promise<void>
  /** Install a vault plugin from its source (plugin.install, off), and uninstall one (plugin.uninstall). */
  install?: (source: string, tag: string | null) => Promise<void>
  uninstall?: (id: string) => Promise<void>
}

const isPng = (f: string | Buffer | undefined) => Buffer.isBuffer(f) && f.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [])
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const hash = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 16)
/** A bundle file's text ("" for bytes that aren't). */
const textOf = (f: string | Buffer | undefined) => (typeof f === "string" ? f : "")
/** A dashboard's Markdown: a `type: dashboard` line after an opening `---`. */
const DASHBOARD = /^---\n[\s\S]*?^type:\s*dashboard\s*$/m
export const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
const ID = /^[a-z0-9][a-z0-9-]*$/
/** The plugins' pages as bundles name them (Dashboards/Today.md), with their text. */
const pluginPages = (host: Host) => new Map(templates(host.plugins()).map(([, name, text]) => [`Dashboards/${name}`, text]))
/** Where a bundle's page goes in this vault: Dashboards/ means its pages folder (core/pages.ts pageAt). */
const homed = (v: Vault, p: string) => (p.startsWith("Dashboards/") ? pageAt(v, p.slice("Dashboards/".length)) : p)

// ---------- reading bundles ----------

/** A path a bundle may hold: relative, no `..`, no hidden segment. */
const safePath = (p: string) => !!p && !p.startsWith("/") && p.split("/").every((s) => !!s && s !== ".." && !s.startsWith("."))

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
function list(vault: Vault): Bundle[] {
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

/** A vault plugin a bundle installs from where it comes from (plugins.json `install`), rather than bringing its files;
 *  one it turns on that moved out of the app (core/migrations.ts MOVED) too. Not one the app (`host`) has itself. */
type Install = { id: string; name: string; source: string; tag: string | null }
function installsOf(files: Files, host?: Host): Install[] {
  let pj: Item | null = null
  try { pj = json(files, "plugins.json") } catch { return [] }
  const o = pj && isObj(pj.install) ? pj.install : {}
  const out = Object.entries(o).filter(([id, v]) => ID.test(id) && isObj(v) && typeof v.source === "string" && !!v.source)
    .map(([id, v]) => ({ id, name: typeof (v as Item).name === "string" ? String((v as Item).name) : id, source: String((v as Item).source), tag: typeof (v as Item).tag === "string" ? String((v as Item).tag) : null }))
  for (const id of strs(pj?.enabled)) {
    if (Object.hasOwn(MOVED, id) && !out.some((x) => x.id === id)) out.push({ id, name: id.charAt(0).toUpperCase() + id.slice(1), source: MOVED[id], tag: null })
  }
  return out.filter((x) => !host?.plugins().some((p) => p.id === x.id && p.tier !== "vault"))
}

/** What a bundle's files are: its settings, the vault plugins it brings, the vault files it adds. */
function parts(files: Files) {
  const code = new Set<string>()
  for (const f of Object.keys(files)) { const m = /^plugins\/([^/]+)\/manifest\.json$/.exec(f); if (m) code.add(m[1]) }
  const settings = new Map<string, string>() // plugin id -> its data.json path
  const vaultFiles: string[] = [], hidden: string[] = [] // vault paths, and .vaultite/ ones (themes, snippets, plugin folders)
  for (const f of Object.keys(files)) {
    if (f === "bundle.json" || f === PREVIEW || CONFIGS.some((c) => f === `${c}.json`)) continue
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
  /** The look it sets (appearance.json's), for its card. */
  theme: string | null; scheme: string | null; density: string | null
  /** The app plugins that are on with it (null: it leaves them as they are), and the pages it pins (null: same). */
  on: string[] | null; pinned: string[] | null
  /** Its sidebars' panels (null: it leaves them as they are, or the default), for its card. */
  panels: { left: string[]; right: string[]; collapsed: string[] } | null
  /** What the first page it pins draws, for its card: its blocks in order (null: it pins nothing; [] not known). */
  home: HomeBlock[] | null
  /** Vault plugins it brings or installs: they run code. */
  code: string[]
  /** The repository it was imported from (bundle.json's `from`), or null. */
  from: string | null
  hotkeys: boolean
  /** Its preview.png's version (GET /api/bundles/<id>/preview.png), or null when it has none. */
  preview: string | null
  problems: string[]
}
type HomeBlock = { block: string; view: string | null; wide: boolean }

/** The blocks of the first page a bundle pins (the vault's copy, wherever it moved, else the bundle's, else the
 *  template a plugin ships), at most 6. */
function homeOf(b: Bundle, host: Host, pinned: string[] | null): HomeBlock[] | null {
  if (pinned && !pinned.length) return null
  const first = pinned?.[0]
  if (!first) return []
  let text = ""
  try { text = readText(host.vault.abs(host.vault.relocated(homed(host.vault, first)))) } catch {
    text = textOf(b.files[first]) || (pluginPages(host).get(first) ?? "")
  }
  const out: HomeBlock[] = []
  const s = scan(text)
  for (const f of s.fences) {
    // (a ```base fence: its first view's type, a kanban drawn as a board)
    const name = f.close === null ? null : blockName(f.info) ?? (f.info.trim().split(/\s/)[0] === "base" ? "base" : null)
    if (!name) continue
    const body = s.lines.slice(f.open + 1, f.close!).join("\n")
    const view = (name === "base" ? /^\s*-?\s*type:\s*['"]?(\w+)/m : /^view:\s*['"]?(\w+)/m).exec(body)?.[1] ?? null
    out.push({ block: name, view: view === "kanban" ? "board" : view, wide: fenceLayout(f.info, body).wide })
    if (out.length >= 6) break
  }
  return out
}

function info(b: Bundle, host: Host): Info {
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
    sort: typeof m.sort === "number" ? m.sort : 1000,
    author: str(m.author), theme: str(look.theme) || null, scheme: str(look.scheme) || null, density: str(look.density) || null,
    on, pinned, panels, home: homeOf(b, host, pinned), code: [...parts(b.files).code, ...installsOf(b.files, host).map((x) => x.id)], from: str(m.from) || null, hotkeys: b.files["hotkeys.json"] !== undefined,
    preview: Buffer.isBuffer(b.files[PREVIEW]) ? hash(b.files[PREVIEW]) : null,
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
  if (pj?.install !== undefined && (!isObj(pj.install) || Object.entries(pj.install).some(([id, v]) => !ID.test(id) || !isObj(v) || typeof v.source !== "string"))) {
    out.push("plugins.json: install must name each plugin's source ({\"<id>\": {\"source\": \"owner/name\", \"tag\": \"v1.0.0\"}})")
  }
  const pg = ok("pages.json")
  if (pg && pg.pinned !== undefined && !Array.isArray(pg.pinned)) out.push("pages.json: pinned must be a list of vault paths")
  const sb = ok("sidebars.json")
  if (sb && Object.keys(sb).length && !readSidebars(sb)) out.push("sidebars.json needs left or right (a list of panels), or {} for the default")
  if (files[PREVIEW] !== undefined && !isPng(files[PREVIEW])) out.push(`${PREVIEW} isn't a PNG image`)
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
    if (p.tier === "vault" || p.manifest.alwaysOn) continue
    if (p.manifest.offByDefault) { if (enabled) out.set(p.id, enabled.has(p.id)) } else if (disabled) out.set(p.id, !disabled.has(p.id))
  }
  for (const id of [...parts(b.files).code, ...installsOf(b.files, host).map((x) => x.id)]) out.set(id, !!enabled?.has(id))
  return out
}

/** Is a plugin on by its own switch (plugins.json as it is)? */
function switchedOn(conf: Item, id: string, optIn: boolean) {
  return optIn ? strs(conf.enabled).includes(id) : !strs(conf.disabled).includes(id)
}

/** Pages the app brings (plugins' dashboards, the app's bundles' files): unpinned when the bundle applied doesn't pin
 *  them. Every other pin is the user's own and stays (their dashboards too, even saved in a bundle of theirs). */
function brought(host: Host) {
  const out = new Set([...pluginPages(host).keys()].map((p) => homed(host.vault, p)))
  for (const b of list(host.vault)) if (b.source === "app") for (const f of parts(b.files).vaultFiles) out.add(homed(host.vault, f))
  for (const f of [...out]) out.add(host.vault.relocated(f)) // (and where the user moved them)
  return out
}

/** CSS snippets the app's bundles bring (Life OS's serif titles): turned off when the bundle applied doesn't use them,
 *  as their pins are, so one bundle's look doesn't stay on in another. The user's own stay. */
function broughtSnippets(host: Host) {
  const out = new Set<string>()
  for (const b of list(host.vault)) if (b.source === "app") for (const f of Object.keys(b.files)) { const m = /^snippets\/(.+)\.css$/.exec(f); if (m) out.add(m[1]) }
  return out
}

/** The list `cur` should become: the bundle's pins first, then the user's own as they were. */
function pinsFor(cur: string[], want: string[], brings: Set<string>) {
  return [...want, ...cur.filter((p) => !want.includes(p) && !brings.has(p))]
}

/** The edits that turn list `cur` into `want` (same pages, new order, some in or out), one pin at a time: unpin the
 *  ones leaving, then place each from the last (at the end) to the first (before the one placed after it). */
function pinOps(cur: string[], want: string[]): { path: string; pinned: boolean; before?: string | null }[] {
  const ops: { path: string; pinned: boolean; before?: string | null }[] = cur.filter((p) => !want.includes(p)).map((p) => ({ path: p, pinned: false }))
  const left = cur.filter((p) => want.includes(p))
  if (left.join("\n") === want.join("\n")) return ops
  for (let i = want.length - 1; i >= 0; i--) ops.push({ path: want[i], pinned: true, before: want[i + 1] ?? null })
  return ops
}

type Change = { key: string; from: unknown; to: unknown }
export type Plan = {
  /** Plugins it turns on and off (ids), ids it names that this app doesn't have, and `added`: plugins the user added
   *  (the vault's, on) that it doesn't name, left as they are unless applied with offAdded. */
  plugins: { on: string[]; off: string[]; missing: string[]; added: string[] }
  /** Vault plugins it brings (they run code): `kept` when the vault has one by that id already (yours stays); `source`
   *  where one it installs comes from (plugins.json `install`), else it brings its files. */
  code: { id: string; name: string; kept: boolean; source?: string; tag?: string | null }[]
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
  /** A new tab's keys it sets (newtab.json: its sections, buttons, page). */
  newtab: Change[]
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
  const added = targets ? [...kinds].filter(([id, k]) => k.vault && !targets.has(id) && switchedOn(conf, id, true)).map(([id]) => id) : []
  const installs = installsOf(b.files, host)
  const missing = [...new Set([...strs(pj?.disabled), ...strs(pj?.enabled)])].filter((id) => !kinds.has(id) && !code.includes(id) && !installs.some((x) => x.id === id))
  const here = (id: string) => fs.existsSync(v.abs(`.vaultite/plugins/${id}/manifest.json`))
  const codeInfo: Plan["code"] = [...code.map((id) => {
    const m = (() => { try { return json(b, `plugins/${id}/manifest.json`) ?? {} } catch { return {} } })()
    return { id, name: typeof m.name === "string" ? m.name : id, kept: here(id) }
  }), ...installs.filter((x) => !code.includes(x.id)).map((x) => ({ id: x.id, name: kinds.get(x.id)?.name ?? x.name, kept: here(x.id), source: x.source, tag: x.tag }))]
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
  // (its pages go in the vault's pages folder, as the plugins' do)
  const at = placeOf(b, v), there = (f: string) => fs.existsSync(v.abs(at(f)))
  for (const f of vaultFiles) (there(f) ? kept : add).push(at(f))
  for (const h of hidden) {
    const pm = /^\.vaultite\/plugins\/([^/]+)\//.exec(h)
    if (pm ? codeInfo.find((c) => c.id === pm[1])!.kept : fs.existsSync(v.abs(h))) continue
    add.push(h)
  }
  // A page it names (a pin, the new tab's) as this vault has it: one the bundle brings, a plugin's page in the pages
  // folder (added when it isn't there), or the user's file; null when there's none.
  const tpl = pluginPages(host)
  const placed = (p: string): string | null => {
    if (!safePath(p)) return null
    if (vaultFiles.includes(p)) return at(p)
    if (tpl.has(p)) { const to = homed(v, p); if (!fs.existsSync(v.abs(to)) && !add.includes(to)) add.push(to); return to }
    return fs.existsSync(v.abs(p)) ? p : null
  }
  // pins
  let pins: Plan["pins"] = null
  const pg = json(b, "pages.json")
  if (pg && Array.isArray(pg.pinned)) {
    const want: string[] = [], gone: string[] = []
    for (const p of strs(pg.pinned)) {
      const here = placed(p)
      if (here) want.push(here)
      else gone.push(p)
    }
    const cur = strs(v.config("pages").pinned), brings = brought(host)
    const listed = pinsFor(cur, want, brings)
    const own = slot && Array.isArray(slot.pinned) ? strs(slot.pinned) : null
    pins = { want, list: listed, pin: listed.filter((p) => !cur.includes(p)), unpin: cur.filter((p) => !listed.includes(p)), missing: gone,
      workspace: own && pinsFor(own, want, brings) }
  }
  // appearance, hotkeys: the keys it sets (an appearance value that's the app's default is written as no key)
  const diff = (name: string, want: Item, defaults: Item = {}) => {
    const cur = v.config(name), eff = (k: string, x: unknown) => x ?? defaults[k] ?? null
    return Object.entries(want).filter(([k, to]) => !same(eff(k, cur[k]), eff(k, to)))
      .map(([key, to]) => ({ key, from: cur[key] ?? null, to: Object.hasOwn(defaults, key) && same(to, defaults[key]) ? null : to }))
  }
  const look = { ...json(b, "appearance.json") }, snippets = strs(v.config("appearance").snippets), bringsCss = broughtSnippets(host)
  const ownCss = [...strs(look.snippets), ...snippets.filter((s) => !strs(look.snippets).includes(s) && !bringsCss.has(s))]
  if (Object.hasOwn(look, "snippets") || ownCss.length < snippets.length) look.snippets = ownCss
  const appearance = diff("appearance", look, LOOK_DEFAULTS), hotkeys = diff("hotkeys", json(b, "hotkeys.json") ?? {})
  // The new tab's page as this vault has it (a page that isn't here: the sections stay).
  const nt = json(b, "newtab.json")
  const newtab = nt ? Object.entries({ ...nt, ...(typeof nt.page === "string" ? { page: placed(nt.page) } : {}) })
    .filter(([k, to]) => !same(v.config("newtab")[k], to)).map(([key, to]) => ({ key, from: v.config("newtab")[key] ?? null, to: to ?? null })) : []
  const pinsChange = !!pins && (pins.list.join("\n") !== strs(v.config("pages").pinned).join("\n") ||
    (!!pins.workspace && pins.workspace.join("\n") !== strs(slot!.pinned).join("\n")))
  const empty = !on.length && !off.length && !set.length && !panels.changed && !pinsChange && !appearance.length && !hotkeys.length && !newtab.length && !add.length
  return { plugins: { on, off, missing, added }, code: codeInfo, settings: set, skipped, panels, pins, appearance, hotkeys, newtab, files: { add, kept }, empty }
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
  /** Vault plugins it installed from their source (uninstalled on restore). */
  installed?: string[]
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

/** A new vault is still being offered the bundles (no plugin writes its pages until it has picked: core/app.ts). */
export const offering = (v: Vault) => fs.existsSync(v.abs(ONBOARDING))

function doneOnboarding(v: Vault) {
  try { fs.unlinkSync(v.abs(ONBOARDING)) } catch { /* not offered */ }
}

/** Bring a vault's bundles up to date as it opens: one of the user's under an id the app's took moves to a free id,
 *  and a setup applied from a bundle since folded into another (FOLDED) is that one's. */
export function tidy(v: Vault) {
  const prev = readPrevious(v), dir = v.abs(VAULT_BUNDLES), was = prev?.bundle
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { /* none of the user's */ }
  for (const id of names) {
    if (!fs.existsSync(path.join(APP_BUNDLES, id)) || !fs.existsSync(path.join(dir, id, "bundle.json"))) continue
    const to = freeId(v, id, false)
    fs.renameSync(path.join(dir, id), path.join(dir, to))
    if (prev?.bundle === id) prev.bundle = to
  }
  // (one of the user's by a folded id, saved since, is theirs)
  const into = prev && Object.hasOwn(FOLDED, prev.bundle) && !fs.existsSync(path.join(dir, prev.bundle, "bundle.json")) ? FOLDED[prev.bundle] : null
  if (prev && into) {
    prev.bundle = into
    try { prev.name = String(JSON.parse(readText(path.join(APP_BUNDLES, into, "bundle.json"))).name ?? prev.name) } catch { /* its old name */ }
  }
  if (prev && prev.bundle !== was) writeAtomic(v.abs(PREVIOUS), JSON.stringify(prev, null, 1) + "\n")
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
      if (!(e instanceof OpError) || e.status !== 404) throw e // (a page that's gone meanwhile: skipped)
    }
  }
}

/** Where a bundle's file goes: a page (a dashboard) in Dashboards/ in the vault's pages folder, as the plugins' pages;
 *  anything else (an image) at its own path. */
const placeOf = (b: Bundle, v: Vault) => (f: string) => {
  const data = b.files[f]
  return f.endsWith(".md") && typeof data === "string" && DASHBOARD.test(data) ? homed(v, f) : f
}

/** Applying it puts code in the vault or turns a vault plugin on: it asks first, like turning one on does. */
const runsCode = (p: Plan) => p.code.some((c) => !c.kept || p.plugins.on.includes(c.id))

/** `remember: false`: no previous setup to restore (a new vault's first, or the offer skipped). `offAdded`: the plugins
 *  the user added that it doesn't name go off too. `pages: false`: its plugins write no pages (a vault opening). */
export async function apply(b: Bundle, host: Host, n: number | null, allowCode: boolean, { remember = true, offAdded = false, pages = true } = {}) {
  const v = host.vault
  if (b.error) throw new HTTPError(400, `${b.id}: ${b.error}`)
  const p = await plan(b, host, n)
  if (offAdded) p.plugins.off.push(...p.plugins.added)
  const { vaultFiles } = parts(b.files)
  if (runsCode(p) && !allowCode) {
    throw new HTTPError(409, `${info(b, host).name} brings vault plugins (${p.code.map((c) => c.name).join(", ")}): they run code on this machine. Apply it with allowCode to confirm.`)
  }
  const prev: Previous = { bundle: b.id, name: info(b, host).name, at: new Date().toISOString(), config: {}, absent: [], pins: null, pinned: [], workspace: null, added: [] }
  // (the pins as they were: the plugins it turns on may pin their pages before its own pins are made)
  const pinsWere = Array.isArray(v.config("pages").pinned) ? strs(v.config("pages").pinned) : null, pagesWere = fs.existsSync(v.abs(".vaultite/pages.json"))
  // 0. Plugins it installs from their source, first: one that can't be fetched stops the apply before anything changed.
  const fetch = p.code.filter((c) => c.source && !c.kept)
  if (fetch.length && !host.install) throw new HTTPError(501, "this server can't install plugins")
  for (const c of fetch) {
    try { await host.install!(c.source!, c.tag ?? null) } catch (e) {
      for (const id of prev.installed ?? []) await host.uninstall?.(id).catch(() => {})
      throw new HTTPError(e instanceof OpError ? e.status : 502, `couldn't install ${c.name} from ${c.source}: ${(e as Error).message}`)
    }
    (prev.installed ??= []).push(c.id)
  }
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
  const at = placeOf(b, v)
  for (const f of vaultFiles) addFile(v, at(f), b.files[f], prev.added)
  const tpl = new Map([...pluginPages(host)].map(([p, text]) => [homed(v, p), text]))
  for (const rel of p.files.add) {
    if (rel.startsWith(".vaultite/")) addFile(v, rel, b.files[rel.slice(".vaultite/".length)], prev.added)
    else if (tpl.has(rel)) addFile(v, rel, tpl.get(rel)!, prev.added) // (a plugin's page it pins)
  }
  // 2. Plugins on and off: plugins.json's two lists, changed for the plugins that change (the rest as they are).
  const conf = v.config("plugins")
  const kinds = known(host)
  let disabled = strs(conf.disabled), enabled = strs(conf.enabled)
  for (const id of [...p.plugins.on, ...p.plugins.off]) {
    ;({ disabled, enabled } = switched({ disabled, enabled }, id, p.plugins.on.includes(id), kinds.get(id)?.optIn ?? p.code.some((c) => c.id === id)))
  }
  // The vault plugins it brought, asked for with allowCode, are allowed on this machine (not ones it found there: those keep
  // waiting until allowed on their own).
  const brought = p.code.filter((c) => !c.kept && p.plugins.on.includes(c.id)).map((c) => c.id)
  if (allowCode && brought.length) await host.allow?.(brought)
  await patch("plugins", patchOf({ disabled: strs(conf.disabled), enabled: strs(conf.enabled) }, { disabled, enabled }))
  await host.syncPlugins()
  // (pinned here, the pins below make the list the bundle's)
  if (pages && json(b, "plugins.json")) host.writePages?.()
  // 3. Settings, appearance, hotkeys: the keys that change.
  const byPlugin = new Map<string, Item>()
  for (const s of p.settings) byPlugin.set(s.plugin, { ...byPlugin.get(s.plugin), [s.key]: s.to })
  for (const [id, body] of byPlugin) await patch(`plugins/${id}/data`, body)
  await patch("appearance", Object.fromEntries(p.appearance.map((c) => [c.key, c.to])))
  await patch("hotkeys", Object.fromEntries(p.hotkeys.map((c) => [c.key, c.to])))
  await patch("newtab", Object.fromEntries(p.newtab.map((c) => [c.key, c.to])))
  // 4. Panels: sidebars.json becomes the bundle's ({} for the default), and the workspace drops its own.
  const slot = await slotOf(host, n)
  if (json(b, "sidebars.json")) {
    const next = p.panels.setup ? { ...p.panels.setup } as Item : {}
    if (next.heightsAt === undefined) delete next.heightsAt
    await patch("sidebars", patchOf(v.config("sidebars"), next))
  }
  // 5. Pins: the vault's list, then the workspace's own (the same edits), one at a time. The pages of plugins it installed
  // are known only now they're loaded: planned again, adding the ones missing.
  let pins = p.pins
  if (fetch.length && pins) {
    const again = await plan(b, host, n), theirs = new Map([...pluginPages(host)].map(([q, text]) => [homed(v, q), text]))
    for (const rel of again.files.add) if (theirs.has(rel)) addFile(v, rel, theirs.get(rel)!, prev.added)
    pins = again.pins
  }
  if (pins) {
    const cur = strs(v.config("pages").pinned)
    prev.pins = pinsWere
    if (!pagesWere) prev.absent.push("pages")
    prev.pinned = pins.list.filter((x) => !(pinsWere ?? []).includes(x))
    await pinTo(host, cur, pins.list, null)
    // A bundle pinning nothing still says so: with no list, the pages plugins write would all be pinned (core/pages.ts).
    if (!Array.isArray(v.config("pages").pinned)) await host.call("PATCH", "config/pages", { pinned: [] })
  }
  if (slot && n && (p.panels.workspace || (pins && Array.isArray(slot.pinned)))) {
    const own = Array.isArray(slot.pinned) ? strs(slot.pinned) : null
    prev.workspace = { n, sidebars: slot.sidebars ?? null, pins: own, pinned: [] }
    if (p.panels.workspace) await host.call("PUT", `workspaces/${n}`, { sidebars: null })
    if (own && pins?.workspace) {
      prev.workspace.pinned = pins.workspace.filter((x) => !own.includes(x))
      await pinTo(host, own, pins.workspace, n)
    }
  }
  doneOnboarding(v)
  if (remember) writeAtomic(v.abs(PREVIOUS), JSON.stringify(prev, null, 1) + "\n")
  return { applied: prev.name, plan: { ...p, pins }, previous: { bundle: prev.bundle, name: prev.name, at: prev.at } }
}

/** Put back the setup from before the last apply, and forget it. Changes made since to other keys stay. */
async function restore(host: Host) {
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
  await host.syncPlugins({ pages: false })
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
  // Plugins it installed, while off and as installed (not one turned on since, or edited): uninstalled.
  const lock = readLock(v), conf = v.config("plugins")
  for (const id of prev.installed ?? []) {
    const dir = v.abs(`.vaultite/plugins/${id}`)
    if (!lock[id] || strs(conf.enabled).includes(id) || !fs.existsSync(dir) || !asLocked(dir, lock[id])) continue
    await host.uninstall?.(id)
    trashed.push(`.vaultite/plugins/${id}`)
  }
  fs.unlinkSync(v.abs(PREVIOUS))
  await host.syncPlugins({ pages: false })
  return { restored: prev.name, trashed }
}

/** A file to the vault's .trash (a note through the vault, so its index and pins follow). */
function toTrash(v: Vault, rel: string) {
  if (rel.endsWith(".md") && !rel.startsWith(".")) v.trash(rel)
  else v.toTrash(rel)
}

/** Remove folders left empty (up to the vault's top, never .vaultite/ itself or its kinds' folders). */
function pruneDirs(v: Vault, rel: string) {
  for (let d = rel; d && d !== "." && !["Dashboards", ".vaultite", ".vaultite/plugins", ".vaultite/themes", ".vaultite/snippets"].includes(d); d = path.dirname(d)) {
    try { if (fs.readdirSync(v.abs(d)).length) return; fs.rmdirSync(v.abs(d)) } catch { return }
  }
}

// ---------- saving the current setup, export, import ----------

type SaveOptions = { name: string; description?: string; icon?: string; tint?: string; hotkeys?: boolean; vaultPlugins?: boolean; workspace?: number | null; replace?: boolean
  /** A screenshot of the app it makes, a PNG as base64: its card's picture. */
  preview?: string }

/** The current setup as a bundle's files: plugins, non-default settings (never `local` ones), panels and pins, look,
 *  hotkeys and vault plugins if asked, and the pinned dashboards (a plugin's unchanged by its name). */
async function current(host: Host, o: SaveOptions): Promise<Files> {
  const v = host.vault, kinds = known(host)
  const files: Files = {}
  const put = (rel: string, o: unknown) => { files[rel] = JSON.stringify(o, null, 2) + "\n" }
  put("bundle.json", { name: o.name.trim(), ...(o.description?.trim() ? { description: o.description.trim() } : {}), icon: o.icon || "package", ...(o.tint ? { tint: o.tint } : {}) })
  if (typeof o.preview === "string" && o.preview) {
    const png = Buffer.from(o.preview.replace(/^data:image\/png;base64,/, ""), "base64")
    if (!isPng(png)) throw new HTTPError(400, "the preview isn't a PNG image")
    files[PREVIEW] = png
  }
  const conf = v.config("plugins")
  await setupOf(host, o, files, put, conf, kinds)
  const pinned = pinnedOf(await slotOf(host, o.workspace ?? null), v)
  const look = v.config("appearance")
  if (Object.keys(look).length) put("appearance.json", look)
  const tab = v.config("newtab")
  if (Object.keys(tab).length) put("newtab.json", { ...tab, ...(typeof tab.page === "string" ? { page: asBundle(host, tab.page) } : {}) })
  // The dashboards it pins, the new tab's page, and the theme and snippets it uses.
  const add = (at: string) => {
    if (files[at] !== undefined || asBundle(host, at) !== at || !safePath(at)) return
    let text: string
    try { text = readText(v.abs(at)) } catch { return }
    if (at.endsWith(".base") || (at.endsWith(".md") && DASHBOARD.test(text))) files[at] = text
  }
  for (const p of pinned) add(p)
  if (typeof tab.page === "string") add(tab.page)
  const scheme = typeof look.scheme === "string" && look.scheme.startsWith("theme:") ? look.scheme.slice(6) : null
  if (scheme && safePath(scheme)) {
    try { for (const [rel, data] of Object.entries(readFolder(v.abs(`.vaultite/themes/${scheme}`)))) files[`themes/${scheme}/${rel}`] = data } catch (e) { if (e instanceof HTTPError) throw e }
  }
  for (const s of strs(look.snippets)) {
    let css: string
    try { if (!safePath(s)) continue; css = readText(v.abs(`.vaultite/snippets/${s}.css`)) } catch { continue }
    files[`snippets/${s}.css`] = css
    // The fonts beside it that it loads (url("Instrument Serif.woff2")).
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+\.(?:woff2?|ttf|otf))["']?\s*\)/gi)) {
      let name: string
      try { name = decodeURIComponent(m[1]) } catch { continue }
      if (name.includes("/") || !safePath(name)) continue
      try { files[`snippets/${name}`] = fs.readFileSync(v.abs(`.vaultite/snippets/${name}`)) } catch { /* not there */ }
    }
  }
  return files
}

/** A page as a bundle names it: a plugin's page as its plugin wrote it by its name (Dashboards/Today.md: where it goes
 *  is the applying vault's business), any other by its path. */
function asBundle(host: Host, p: string) {
  let text: string
  try { text = readText(host.vault.abs(p)) } catch { return p }
  for (const [as, t] of pluginPages(host)) if (t === text && as.endsWith(`/${path.basename(p)}`)) return as
  return p
}

/** The pages pinned: workspace slot's own list, else the vault's. */
const pinnedOf = (slot: Item | null, v: Vault) => (slot && Array.isArray(slot.pinned) ? strs(slot.pinned) : strs(v.config("pages").pinned))

/** The setup's part of a bundle (all but the look): plugins and their settings, vault plugins if asked, panels, pins,
 *  hotkeys if asked. */
async function setupOf(host: Host, o: SaveOptions, files: Files, put: (rel: string, o: unknown) => void, conf: Item, kinds: ReturnType<typeof known>) {
  const v = host.vault
  const app = host.plugins().filter((p) => p.tier !== "vault")
  // Installed plugins that are on go as where they come from (installed when applied); the vault's own, asked for, as
  // their files. One edited here since, or from a folder on this machine, is the vault's own.
  const lock = readLock(v), install: Item = {}, own: string[] = []
  for (const x of host.vaultPlugins().filter((x) => x.on)) {
    const id = String(x.id), l = lock[id]
    let unedited = false
    try { unedited = !!l && asLocked(v.abs(`.vaultite/plugins/${id}`), l) } catch { /* unreadable: its own */ }
    if (unedited && !/^(\/|~\/|\.|file:)/.test(l.source)) install[id] = { name: String(x.name ?? id), source: l.source, ...(l.tag ? { tag: l.tag } : {}) }
    else if (o.vaultPlugins) own.push(id)
  }
  const vaultOn = [...Object.keys(install), ...own]
  put("plugins.json", {
    disabled: strs(conf.disabled).filter((id) => app.some((p) => p.id === id && !p.manifest.offByDefault && !p.manifest.alwaysOn)),
    enabled: strs(conf.enabled).filter((id) => app.some((p) => p.id === id && p.manifest.offByDefault) || vaultOn.includes(id)),
    ...(Object.keys(install).length ? { install } : {}),
  })
  for (const id of own) {
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
  put("pages.json", { pinned: pinnedOf(slot, v).map((p) => asBundle(host, p)) })
  if (o.hotkeys) { const h = v.config("hotkeys"); if (Object.keys(h).length) put("hotkeys.json", h) }
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

async function save(host: Host, o: SaveOptions) {
  if (typeof o.name !== "string" || !o.name.trim()) throw new HTTPError(400, "a bundle needs a name")
  const files = await current(host, o)
  const id = freeId(host.vault, o.name, !!o.replace)
  writeBundle(host.vault, id, files, !!o.replace)
  return { bundle: info(find(host.vault, id), host) }
}

/** One part of a bundle to share or leave out: `on` what's sent unless the user says; `own` a page with text of the
 *  user's own (outside its blocks and headings). */
type ShareItem = { path: string; kind: "picture" | "page" | "file" | "settings" | "hotkeys" | "code"; label: string; on: boolean; own?: boolean; keys?: string[] }

const ownText = (t: string) => t.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
  .split("\n").some((l) => !!l.trim() && !/^#{1,6}\s/.test(l.trim()))

/** The parts sharing sends, the user's own off (the picture, a page with their text); `dropped`: pins to their notes,
 *  never sent. */
function shareOf(b: Bundle, host: Host): { items: ShareItem[]; dropped: string[] } {
  const { code, settings, vaultFiles } = parts(b.files)
  const items: ShareItem[] = []
  if (b.files[PREVIEW] !== undefined) items.push({ path: PREVIEW, kind: "picture", label: "Picture", on: false })
  for (const f of vaultFiles) {
    const t = b.files[f]
    const page = typeof t === "string" && (f.endsWith(".md") || f.endsWith(".base"))
    const own = page && f.endsWith(".md") && ownText(t as string)
    items.push({ path: f, kind: page ? "page" : "file", label: f.replace(/\.(md|base)$/, ""), on: !own, ...(page ? { own } : {}) })
  }
  for (const [id, rel] of settings) {
    let keys: string[] = []
    try { keys = Object.keys(json(b, rel) ?? {}) } catch { /* problems says */ }
    const p = host.plugins().find((x) => x.id === id)
    items.push({ path: rel, kind: "settings", label: String(p?.manifest.name ?? id), on: true, keys })
  }
  if (b.files["hotkeys.json"] !== undefined) items.push({ path: "hotkeys.json", kind: "hotkeys", label: "Hotkeys", on: true })
  for (const id of code) {
    let name = id
    try { const m = json(b, `plugins/${id}/manifest.json`); if (typeof m?.name === "string") name = m.name } catch { /* its id */ }
    items.push({ path: `plugins/${id}/`, kind: "code", label: name, on: true })
  }
  return { items, dropped: dropped(b, host) }
}

/** Pins (and a new tab's page) that aren't pages the bundle brings or the app has. */
function dropped(b: Bundle, host: Host) {
  const tpl = pluginPages(host)
  const known = (p: string) => b.files[p] !== undefined || tpl.has(p)
  let pins: string[] = [], page: unknown = null
  try { pins = strs(json(b, "pages.json")?.pinned) } catch { /* problems says */ }
  try { page = json(b, "newtab.json")?.page } catch { /* problems says */ }
  return [...pins, ...(typeof page === "string" ? [page] : [])].filter((p, i, all) => !known(p) && all.indexOf(p) === i)
}

/** A bundle as shared: its parts as shareOf chose them, `include` and `leave` (paths: a plugin's code as plugins/<id>/)
 *  changing that; pins to what isn't sent are taken out. `all`: every file as it is (a copy kept to undo a delete). */
function shared(b: Bundle, host: Host, o: { all?: boolean; include?: string[]; leave?: string[] } = {}): Bundle {
  if (o.all || b.error) return b
  const { items, dropped: gone } = shareOf(b, host)
  const out = items.filter((x) => !(x.on || o.include?.includes(x.path)) || !!o.leave?.includes(x.path)).map((x) => x.path)
  const left = (f: string) => out.some((x) => (x.endsWith("/") ? f.startsWith(x) : f === x))
  const files: Files = Object.fromEntries(Object.entries(b.files).filter(([f]) => !left(f)))
  const drop = new Set([...gone, ...out])
  const pg = (() => { try { return json(files, "pages.json") } catch { return null } })()
  if (pg && Array.isArray(pg.pinned)) files["pages.json"] = JSON.stringify({ ...pg, pinned: strs(pg.pinned).filter((x) => !drop.has(x)) }, null, 2) + "\n"
  const nt = (() => { try { return json(files, "newtab.json") } catch { return null } })()
  if (nt && typeof nt.page === "string" && drop.has(nt.page)) { const { page: _, ...rest } = nt; files["newtab.json"] = JSON.stringify(rest, null, 2) + "\n" }
  return { ...b, files }
}

/** A bundle as one JSON file: a JSON file as its JSON, text as a string, other bytes as `{"base64": ...}`. */
function exportOf(b: Bundle) {
  if (b.error) throw new HTTPError(400, `${b.id}: ${b.error}`)
  const files: Record<string, unknown> = {}
  for (const [f, data] of Object.entries(b.files)) {
    if (typeof data !== "string") { files[f] = { base64: data.toString("base64") }; continue }
    if (f.endsWith(".json")) { try { files[f] = JSON.parse(data); continue } catch { /* as text */ } }
    files[f] = data
  }
  return { vaultite: "bundle", format: 1, id: b.id, files }
}

/** An export's files, checked (400 with what's wrong). */
function filesOf(o: unknown): { files: Files; id: string | null } {
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
  return { files, id: typeof o.id === "string" && ID.test(o.id) ? o.id : null }
}

/** A bundle from a repository (its newest tag, else its default branch): its folder at the top, without the repository's
 *  own files, or one .bundle.json. bundle.json's `from` keeps where. */
async function fetchFrom(given: string): Promise<{ files: Files; id: string | null }> {
  let src
  try { src = parseSource(given) } catch { throw new HTTPError(400, `'${given}' isn't a bundle's repository: owner/name on GitHub (owner/name/folder for one in a folder), a git URL, or a folder`) }
  if (src.archive) throw new HTTPError(400, "a bundle comes from a repository or a folder, not a zip")
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-bundle-"))
  try {
    let dir = src.folder ?? path.join(tmp, "clone")
    if (!src.folder) {
      const tag = src.tag ?? (await tagsOf(src.url!, src.dir))[0] ?? null
      await git(["-c", "core.symlinks=false", "clone", "--quiet", "--depth", "1", "--no-tags", "--single-branch", ...(tag ? ["--branch", tag] : []), src.url!, dir])
      if (src.dir) dir = path.join(dir, src.dir)
    }
    if (!fs.existsSync(dir)) throw new HTTPError(404, `${given} has no folder ${src.dir}`)
    let files: Files, id: string | null = null
    if (fs.existsSync(path.join(dir, "bundle.json"))) {
      const all = readFolder(dir)
      let named: string[] = []
      try { named = [...strs(json(all, "pages.json")?.pinned), String(json(all, "newtab.json")?.page ?? "")] } catch { /* problems says */ }
      const own = (f: string) => f.includes("/") || f === "bundle.json" || f === PREVIEW || CONFIGS.some((c) => f === `${c}.json`) || named.includes(f)
      files = Object.fromEntries(Object.entries(all).filter(([f]) => own(f)))
    } else {
      const one = fs.readdirSync(dir).filter((n) => n.endsWith(".bundle.json"))
      if (one.length !== 1) throw new HTTPError(404, `${given} has no bundle: a bundle.json at its top (the bundle's folder), or one .bundle.json`)
      let o: unknown
      try { o = JSON.parse(readText(path.join(dir, one[0]))) } catch { throw new HTTPError(400, `${one[0]} isn't JSON`) }
      ;({ files, id } = filesOf(o))
    }
    const from = src.tag ? given.replace(/@[^@/]+$/, "") : given
    const m = json(files, "bundle.json") ?? {}
    files["bundle.json"] = JSON.stringify({ ...m, from }, null, 2) + "\n"
    return { files, id: id ?? slug(given.split("/").at(-1)!.replace(/\.git$|@.*$/g, "")) }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** What an import is given: an export (or `{file}`: one), or `{from}`: a repository to fetch it from. Checked. */
async function incomingFiles(body: unknown) {
  const got = isObj(body) && typeof body.from === "string" ? await fetchFrom(body.from) : filesOf(isObj(body) && isObj(body.file) ? body.file : body)
  const bad = problems(got.files)
  if (bad.length) throw new HTTPError(400, `that bundle can't be read: ${bad.join("; ")}`)
  return got
}

/** The id an imported bundle takes: the user's one from the same repository (`from`: getting it again replaces it),
 *  else a free one. */
function idFor(v: Vault, files: Files, want: string | null) {
  let from: unknown = null
  try { from = json(files, "bundle.json")?.from } catch { /* problems says */ }
  const was = typeof from === "string" && from ? list(v).find((b) => b.source === "vault" && (() => { try { return json(b, "bundle.json")?.from === from } catch { return false } })()) : null
  return { id: was?.id ?? freeId(v, want ?? String(JSON.parse(textOf(files["bundle.json"])).name), false), replaces: was?.id ?? null }
}

/** A bundle into the user's bundles (from an export or a repository). Never applied here. */
async function importOf(v: Vault, body: unknown, host: Host) {
  const { files, id: want } = await incomingFiles(body)
  const { id, replaces } = idFor(v, files, want)
  writeBundle(v, id, files, !!replaces)
  return { bundle: info(find(v, id), host) }
}

/** What importing a bundle would add, and what applying it then would change here, without writing anything: the
 *  import's preview. `file`: it as an export, to import as previewed (a repository isn't fetched again). */
async function incoming(host: Host, body: Item) {
  const { files, id: want } = await incomingFiles(body)
  const { id, replaces } = idFor(host.vault, files, want)
  const b: Bundle = { id, source: "vault", files }
  const p = await plan(b, host, workspaceOf(body.workspace))
  return { bundle: info(b, host), files: Object.keys(files), plan: p, pages: pageLooks(b, host, [...p.pins?.list ?? [], ...p.pins?.unpin ?? []]), replaces, file: exportOf(b) }
}

/** How pages look in a list (their `icon`, `tint` and `plugin`), from the vault's file, else the bundle's or the plugin
 *  template's: for the preview, before the files are there. */
function pageLooks(b: Bundle, host: Host, paths: string[]) {
  const tpl = pluginPages(host)
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
    return { bundles: all, default: DEFAULT_BUNDLE, ...status(v) }
  }
  if (parts.length === 0 && method === "POST") return save(host, { ...body, workspace: workspaceOf(body.workspace) } as SaveOptions)
  if (parts.length === 1 && id === "restore" && method === "POST") return restore(host)
  if (parts.length === 1 && id === "import" && method === "POST") return importOf(v, body, host)
  if (parts.length === 2 && id === "import" && action === "preview" && method === "POST") return incoming(host, body)
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
  if (parts.length === 2 && action === "apply" && method === "POST") return apply(find(v, id), host, workspaceOf(body.workspace), body.allowCode === true, { offAdded: body.offAdded === true })
  if (parts.length === 2 && action === PREVIEW && method === "GET") {
    const png = find(v, id).files[PREVIEW]
    if (!isPng(png)) throw new HTTPError(404, `${id} has no preview`)
    return new Text(png as Buffer, "image/png", { "Cache-Control": "private, max-age=31536000, immutable" })
  }
  if (parts.length === 2 && action === "share" && method === "GET") return shareOf(find(v, id), host)
  if (parts.length === 2 && action === "export" && (method === "GET" || method === "POST")) {
    const b = find(v, id)
    const o = method === "GET" ? { all: query.all === "1" } : { all: body.all === true, include: strs(body.include), leave: strs(body.leave) }
    return new Text(JSON.stringify(exportOf(shared(b, host, o)), null, 2) + "\n", "application/json; charset=utf-8", { "Content-Disposition": `attachment; filename="${b.id}.bundle.json"` })
  }
  return undefined
}
