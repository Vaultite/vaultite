// Extensions installed on this Mac: files in userData/extensions/<id>/<version>, state in extensions.json. From the
// Chrome Web Store, a folder or .crx file, or another browser of this Mac (one the store dropped, as MV2's).
import { app, net } from "electron"
import { writeAtomic } from "../setup.ts"
import { idOfKey, openCrx, unzip } from "./crx.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"

export type Installed = {
  id: string; name: string; version: string
  /** Its folder under userData/extensions/<id>/. */
  dir: string
  on: boolean
  /** Shown in the page's bar, not only in the extensions menu. */
  pinned: boolean
  /** Where updates come from: the Web Store, or nowhere (a folder, a file, another browser's copy). */
  from: "store" | "folder"
  added: number
  /** Optional permissions the user allowed (permissions.request). */
  granted?: string[]
  /** Forced on by this Mac's policy (extpolicy.ts): from its folder (with the files' signature when copied) or the store. */
  managed?: { source: string; sig?: string }
}
/** `seen`: the version each session (by profile) last loaded, for the extension's onInstalled and onStartup. */
type State = { list: Installed[]; checked: number; seen: Record<string, Record<string, string>>
  /** Each profile's session partition, to load extensions into at launch. */
  partitions: Record<string, string> }

const STORE = "https://clients2.google.com/service/update2/crx"
export const ID = /^[a-p]{32}$/
const root = () => path.join(app.getPath("userData"), "extensions")
const stateFile = () => path.join(root(), "extensions.json")
let state: State | null = null

export function load(): State {
  if (state) return state
  let j: Partial<State> = {}
  try { j = JSON.parse(fs.readFileSync(stateFile(), "utf8")) } catch { /* none yet */ }
  const list = (Array.isArray(j.list) ? j.list : []).filter((x): x is Installed => !!x && ID.test(x.id) && typeof x.dir === "string"
    && fs.existsSync(path.join(root(), x.id, x.dir, "manifest.json")))
  state = { list, checked: typeof j.checked === "number" ? j.checked : 0, seen: j.seen && typeof j.seen === "object" ? j.seen : {},
    partitions: j.partitions && typeof j.partitions === "object" ? j.partitions : {} }
  return state
}
export function save() {
  fs.mkdirSync(root(), { recursive: true })
  writeAtomic(stateFile(), JSON.stringify(load(), null, 2))
}
export const installed = () => load().list
export const get = (id: string) => load().list.find((x) => x.id === id)
export const dirOf = (x: Installed) => path.join(root(), x.id, x.dir)

// ---------- reading an extension's files ----------

export type Manifest = Record<string, unknown> & {
  name?: string; version?: string; manifest_version?: number; description?: string; default_locale?: string
  icons?: Record<string, string>; permissions?: string[]; optional_permissions?: string[]; host_permissions?: string[]
  content_scripts?: { js?: string[]; world?: string }[]
  action?: { default_title?: string; default_icon?: string | Record<string, string>; default_popup?: string }
  browser_action?: Manifest["action"]
  options_ui?: { page?: string }; options_page?: string; commands?: Record<string, { description?: string }>
  key?: string
}
const manifests = new Map<string, Manifest>()
export function manifestOf(dir: string): Manifest {
  let m = manifests.get(dir)
  if (!m) {
    const text = fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^﻿/, "")
    m = JSON.parse(text) as Manifest
    manifests.set(dir, m)
  }
  return m
}

/** A manifest's text as shown: "__MSG_name__" from its default locale's messages. */
export function said(dir: string, text: unknown): string {
  if (typeof text !== "string") return ""
  const m = /^__MSG_(\w+)__$/.exec(text)
  if (!m) return text
  const locale = String(manifestOf(dir).default_locale ?? "en")
  for (const l of [locale, "en", "en_US"]) {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, "_locales", l, "messages.json"), "utf8").replace(/^﻿/, "")) as Record<string, { message?: string }>
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase())?.[1]?.message
      if (hit) return hit
    } catch { /* that locale isn't there */ }
  }
  return text
}

/** A file of the extension's as a data URL (an icon), the size nearest `want` when there are several; "" if none. */
export function imageOf(dir: string, icon: unknown, want = 32): string {
  let rel = typeof icon === "string" ? icon : ""
  if (icon && typeof icon === "object") {
    const sizes = Object.keys(icon).map(Number).filter((n) => n > 0).sort((a, b) => a - b)
    const size = sizes.find((n) => n >= want) ?? sizes[sizes.length - 1]
    rel = size ? String((icon as Record<string, unknown>)[String(size)]) : ""
  }
  if (!rel) return ""
  const file = path.resolve(dir, rel.replace(/^\/+/, ""))
  if (!file.startsWith(path.resolve(dir) + path.sep)) return ""
  try {
    const buf = fs.readFileSync(file)
    if (buf.length > 512 * 1024) return ""
    const ext = path.extname(file).slice(1).toLowerCase()
    const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", ico: "image/x-icon" } as Record<string, string>)[ext]
    return mime ? `data:${mime};base64,${buf.toString("base64")}` : ""
  } catch { return "" }
}

// ---------- installing ----------

const shim = () => (createRequire(import.meta.url)("./extensions.preload.cjs") as { storageShim: () => void }).storageShim
const SHIM = "vaultite/content.js"

/** Ready an unpacked extension for Electron: its Web Store key (so its id is the store's), and the storage shim before
 *  its content scripts (Electron's content scripts have no sync area, and a preload can't reach them). */
function prepare(dir: string, key?: Buffer) {
  manifests.delete(dir)
  const m = manifestOf(dir)
  if (key && !m.key) m.key = key.toString("base64")
  for (const cs of m.content_scripts ?? []) {
    if (cs.world === "MAIN" || !cs.js?.length || cs.js[0] === SHIM) continue
    cs.js = [SHIM, ...cs.js]
  }
  fs.mkdirSync(path.join(dir, "vaultite"), { recursive: true })
  fs.writeFileSync(path.join(dir, SHIM), `(${String(shim())})();\n`)
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2))
  manifests.delete(dir)
}

/** The id of an unpacked extension: its manifest's key's, else (Chrome's way for one without) its folder's. */
export function idOfFolder(dir: string, m: Manifest = manifestOf(dir)) {
  if (typeof m.key === "string") { try { return idOfKey(Buffer.from(m.key, "base64")) } catch { /* below */ } }
  return idOfKey(Buffer.from(path.resolve(dir)))
}

/** Put a prepared folder in place as `id`'s next version and record it (replacing the one it updates). */
function place(tmp: string, id: string, from: Installed["from"]): Installed {
  const m = manifestOf(tmp)
  const version = typeof m.version === "string" && /^[\w.-]{1,40}$/.test(m.version) ? m.version : "0"
  const dir = `${version}-${crypto.randomBytes(3).toString("hex")}`
  const to = path.join(root(), id, dir)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(tmp, to)
  manifests.delete(tmp)
  const had = get(id)
  const x: Installed = { id, name: said(to, m.name) || id, version, dir, on: !!had?.managed || (had?.on ?? true), pinned: had?.pinned ?? true, from, added: had?.added ?? Date.now(),
    ...(had?.granted ? { granted: had.granted } : {}), ...(had?.managed ? { managed: had.managed } : {}) }
  const s = load()
  s.list = [...s.list.filter((y) => y.id !== id), x]
  save()
  if (had && had.dir !== dir) fs.rm(path.join(root(), id, had.dir), { recursive: true, force: true }, () => {})
  return x
}

const scratch = () => { const d = path.join(root(), `.new-${crypto.randomBytes(6).toString("hex")}`); fs.mkdirSync(d, { recursive: true }); return d }

/** Install (or update) from a CRX's bytes. */
export function fromCrx(crx: Buffer, id: string | undefined, from: Installed["from"]): Installed {
  const { zip, key } = openCrx(crx, id)
  const tmp = scratch()
  try {
    unzip(zip, tmp)
    prepare(tmp, key)
    return place(tmp, idOfKey(key), from)
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e }
}

/** Install a copy of an unpacked extension's folder (Chrome's or Brave's copy, or one being made). */
export function fromFolder(src: string): Installed {
  if (!fs.existsSync(path.join(src, "manifest.json"))) throw new Error("that folder isn't an extension: it has no manifest.json")
  const id = idOfFolder(src, manifestOf(src))
  manifests.delete(src)
  const tmp = scratch()
  try {
    fs.cpSync(src, tmp, { recursive: true, filter: (f) => !/[/\\](\.git|node_modules)$/.test(f) })
    // Keyless, Electron would name the copy by its own path: its source's path as its key gives the id Chrome gives
    // that folder unpacked (idOfFolder), which its pages' addresses use.
    prepare(tmp, Buffer.from(path.resolve(src)))
    return place(tmp, id, "folder")
  } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e }
}

/** The Web Store's package of an extension, for this Chrome; null when it doesn't offer it (a removed or MV2 one). */
async function download(id: string, url?: string): Promise<Buffer | null> {
  const to = url ?? `${STORE}?response=redirect&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=${encodeURIComponent(`id=${id}&installsource=ondemand&uc`)}`
  const r = await net.fetch(to, { signal: AbortSignal.timeout(60_000) } as RequestInit)
  if (r.status === 204) return null
  if (!r.ok) throw new Error(`the Chrome Web Store answered ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  return buf.length ? buf : null
}

export class NotOffered extends Error {}

export async function fromStore(id: string): Promise<Installed> {
  if (!ID.test(id)) throw new Error("that isn't an extension's id")
  const crx = await download(id)
  if (!crx) throw new NotOffered("the Chrome Web Store doesn't offer it to this browser any more (it may be a Manifest V2 extension)")
  return fromCrx(crx, id, "store")
}

/** What a session's loading an extension is to it: its install, an update (from which version), or a start. */
export function lifecycle(profile: string, x: Installed): { reason: "install" | "update"; previousVersion?: string } | "startup" {
  const s = load(), had = s.seen[profile]?.[x.id]
  if (had === x.version) return "startup"
  ;(s.seen[profile] ??= {})[x.id] = x.version
  save()
  return had === undefined ? { reason: "install" } : { reason: "update", previousVersion: had }
}

export function partitionSeen(profile: string, partition: string) {
  const s = load()
  if (s.partitions[profile] === partition || !/^persist:[\w-]{1,80}$/.test(partition)) return
  s.partitions[profile] = partition
  save()
}

export class Managed extends Error { constructor() { super("this Mac manages it: it stays on (its policy file says which)") } }

export function remove(id: string) {
  if (get(id)?.managed) throw new Managed()
  const s = load()
  s.list = s.list.filter((x) => x.id !== id)
  for (const seen of Object.values(s.seen)) delete seen[id]
  save()
  fs.rm(path.join(root(), id), { recursive: true, force: true }, () => {})
}

export function change(id: string, patch: Partial<Pick<Installed, "on" | "pinned" | "granted">>) {
  const x = get(id)
  if (!x) throw new Error("no such extension")
  if (x.managed && patch.on === false) throw new Managed()
  Object.assign(x, patch)
  save()
  return x
}

/** The Web Store's newer versions of the store's extensions: each one installed, the list of what changed. */
export async function update(): Promise<Installed[]> {
  const s = load()
  const mine = s.list.filter((x) => x.from === "store")
  s.checked = Date.now()
  save()
  if (!mine.length) return []
  const q = mine.map((x) => `x=${encodeURIComponent(`id=${x.id}&v=${x.version}&uc`)}`).join("&")
  const r = await net.fetch(`${STORE}?response=updatecheck&acceptformat=crx3&prodversion=${process.versions.chrome}&${q}`, { signal: AbortSignal.timeout(60_000) } as RequestInit)
  if (!r.ok) throw new Error(`the Chrome Web Store answered ${r.status}`)
  const xml = await r.text()
  const out: Installed[] = []
  for (const m of xml.matchAll(/<app appid="([a-p]{32})"[^>]*>\s*<updatecheck([^>]*)\/?>/g)) {
    const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[2])?.[1] ?? ""
    const x = get(m[1])
    if (!x || attr("status") !== "ok" || !/^https:\/\//.test(attr("codebase")) || attr("version") === x.version) continue
    try {
      const crx = await download(x.id, attr("codebase").replace(/&amp;/g, "&"))
      if (crx) out.push(fromCrx(crx, x.id, "store"))
    } catch (e) { console.error(`vaultite: couldn't update the extension ${x.name}:`, e) }
  }
  return out
}

// ---------- other browsers' extensions on this Mac ----------

export type Found = { browser: string; id: string; name: string; version: string; icon: string; dir: string }
const HOME = os.homedir()
/** VAULTITE_TEST_BROWSERS: a folder with brave/ and chrome/ in it (QA), as import.ts's. */
const BROWSERS: [string, string][] = process.env.VAULTITE_TEST_BROWSERS
  ? [["Brave", path.join(process.env.VAULTITE_TEST_BROWSERS, "brave")], ["Chrome", path.join(process.env.VAULTITE_TEST_BROWSERS, "chrome")]]
  : process.platform === "darwin"
  ? [["Brave", "BraveSoftware/Brave-Browser"], ["Chrome", "Google/Chrome"], ["Edge", "Microsoft Edge"], ["Arc", "Arc/User Data"], ["Vivaldi", "Vivaldi"], ["Chromium", "Chromium"]]
    .map(([n, d]) => [n, path.join(HOME, "Library/Application Support", d)])
  : [["Brave", "BraveSoftware/Brave-Browser"], ["Chrome", "google-chrome"], ["Edge", "microsoft-edge"], ["Vivaldi", "vivaldi"], ["Chromium", "chromium"]]
    .map(([n, d]) => [n, path.join(HOME, ".config", d)])

/** Extensions installed in this Mac's other Chromium browsers (their profiles' newest copies), not Vaultite's yet. */
export function others(): Found[] {
  const out = new Map<string, Found>()
  for (const [browser, base] of BROWSERS) {
    let profiles: string[] = []
    try { profiles = fs.readdirSync(base).filter((p) => p === "Default" || /^Profile \d+$/.test(p)) } catch { continue }
    for (const prof of profiles) {
      const exts = path.join(base, prof, "Extensions")
      let ids: string[] = []
      try { ids = fs.readdirSync(exts).filter((i) => ID.test(i)) } catch { continue }
      for (const id of ids) {
        if (out.has(id) || get(id)) continue
        try {
          const versions = fs.readdirSync(path.join(exts, id)).filter((v) => fs.existsSync(path.join(exts, id, v, "manifest.json")))
          const v = versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
          if (!v) continue
          const dir = path.join(exts, id, v), m = manifestOf(dir)
          // (the browser's own parts, which aren't extensions a person installed)
          if (!m.name || (m as { theme?: unknown }).theme) continue
          out.set(id, { browser, id, name: said(dir, m.name), version: String(m.version ?? ""), icon: imageOf(dir, m.icons, 32), dir })
        } catch { /* unreadable: left out */ }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A browser's profile that keeps `id`'s settings (chrome.storage's local and sync areas, each a folder of its own). */
export type Source = { browser: string; profile: string; name: string; dir: string }

/** The profiles of this Mac's other browsers that have `id` with settings, Brave's Default first. */
export function sources(id: string): Source[] {
  if (!ID.test(id)) return []
  const out: Source[] = []
  for (const [browser, base] of BROWSERS) {
    let profiles: string[] = []
    try { profiles = fs.readdirSync(base).filter((p) => p === "Default" || /^Profile \d+$/.test(p)) } catch { continue }
    let names: Record<string, { name?: unknown }> = {}
    try { names = JSON.parse(fs.readFileSync(path.join(base, "Local State"), "utf8"))?.profile?.info_cache ?? {} } catch { /* named by folder */ }
    for (const prof of profiles.sort((a, b) => (a === "Default" ? -1 : b === "Default" ? 1 : a.localeCompare(b, undefined, { numeric: true })))) {
      const dir = path.join(base, prof)
      if (!AREAS.some((a) => fs.existsSync(path.join(dir, a, id)))) continue
      const name = names[prof]?.name
      out.push({ browser, profile: prof, name: typeof name === "string" && name ? name : prof, dir })
    }
  }
  return out
}
/** chrome.storage's areas as Chromium keeps them in a profile, local then sync. */
export const AREAS = ["Local Extension Settings", "Sync Extension Settings"] as const

/** A native messaging app's manifest for `name`, as Chrome and its kin keep them on this Mac, if it lets `ext` in. */
export function nativeHost(name: string, ext: string): { path: string } | null {
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(name)) return null
  const dirs = process.platform === "darwin"
    ? [...BROWSERS.map(([, b]) => path.join(b, "NativeMessagingHosts")), "/Library/Google/Chrome/NativeMessagingHosts", "/Library/Application Support/Chromium/NativeMessagingHosts"]
    : [...BROWSERS.map(([, b]) => path.join(b, "NativeMessagingHosts")), "/etc/opt/chrome/native-messaging-hosts", "/etc/chromium/native-messaging-hosts"]
  for (const d of dirs) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(d, `${name}.json`), "utf8")) as { path?: string; allowed_origins?: string[] }
      if (typeof j.path === "string" && path.isAbsolute(j.path) && j.allowed_origins?.includes(`chrome-extension://${ext}/`)) return { path: j.path }
    } catch { /* not there */ }
  }
  return null
}
