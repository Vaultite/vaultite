// The vault: the user's Markdown files are the only store, indexed in memory and re-read when they change (sync).
// Plugins register kinds (file <-> item); writes are small edits so what people wrote by hand stays (core/CLAUDE.md).
import { AsyncLocalStorage } from "node:async_hooks"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { merge3, patchFrontmatter, renameKey, same } from "./textedit.ts"
import { dates, dump, load, YAMLError } from "./yaml.ts"
import { blocksIn, fmTags, renameTagsIn, scan, tagName, tagsOf, withoutBlocks } from "./sections.ts"
import { ARCHIVE_DIR, archiveTwin, effectiveType, homeFolder, inArchive, isArchived, PAGES_DIR } from "./fileprops.ts"
import { kindOf } from "./filetypes.ts"
import { type LinkFile, linkResolver, mapLinks, relativePath, type Resolve, resolvePath } from "./links.ts"
import { errorContext } from "./serverlog.ts"
import { noteRead, noteSource } from "./sources.ts"
// A file's tags (frontmatter `tags` and inline #tags) and whether a list has one (nested ones too), for plugins.
export { hasTag, tagName, tagsOf } from "./sections.ts"
// A file's type (its kind's, else its frontmatter's), whether it's archived (`archived: true`) and archive folders:
// core/fileprops.ts.
export { ARCHIVE_DIR, archiveTwin, effectiveType, inArchive, inPagesDir, isArchived, isHiddenPath, PAGES_DIR, unarchived } from "./fileprops.ts"

// Items are plain records: what a plugin's parse makes of a file. Keys starting with _ are private (the API drops them).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>


/** A write the vault refuses because the file isn't in a state it can safely change (the API answers 409). */
export class ConflictError extends Error {}
/** Something that isn't there (the API answers 404). */
export class NotFound extends Error {}
/** A settings file that's there but can't be used now (readConfig): `busy` when it can't be read (iCloud syncing it),
 *  else it isn't a JSON object. */
/** A settings file that can't be read safely for a read-modify-write: `busy` (mid-sync, try again: 503), else broken (409). */
export class ConfigError extends Error {
  busy: boolean
  status: number
  constructor(message: string, busy: boolean) { super(`${message}: not overwriting it (fix it, or try again)`); this.busy = busy; this.status = busy ? 503 : 409 }
}

// ---------- helpers (plugins use these too) ----------

const pad = (n: number) => String(n).padStart(2, "0")

/** The vault's settings folder. */
export const SETTINGS_DIR = ".vaultite"

/** "YYYY-MM-DD HH:MM:SS" in UTC. */
export function stamp(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export const nowUtc = () => stamp(new Date())

/** Local "YYYY-MM-DD HHMMSS", for names of trashed files. */
export function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** A title as an id's words, accents off their letters: "Café: idea #2" -> "cafe-idea-2" (notes' and logs' ids). */
export function slug(s: unknown) {
  return str(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** File name for a title: other Markdown apps forbid * " \ / < > : | ? # ^ [ ] in names. */
export function safeName(title: unknown) {
  const name = str(title).replaceAll(":", " -").replace(/[*"\\/<>|?#^[\]]/g, " ")
  return name.replace(/\s+/g, " ").trim() || "Untitled"
}

/** Python-like truthiness: "", 0, null, false, [] and {} are all false. */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v && typeof v === "object") return Object.keys(v).length > 0
  return !!v
}

/** A value as text, the way the app always showed it (null is "", booleans True/False as YAML read them). */
export function str(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "string") return v
  if (typeof v === "boolean") return v ? "True" : "False"
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export function splitTags(s: unknown): string[] {
  if (Array.isArray(s)) return s.map((t) => str(t).trim()).filter(Boolean)
  return (truthy(s) ? str(s) : "").split(",").map((t) => t.trim()).filter(Boolean)
}

export function frontmatter(data: Item, body = "") {
  const fm = dump(dates(data) as Item).trim()
  const b = (body ?? "").trim()
  return b ? `---\n${fm}\n---\n\n${b}\n` : `---\n${fm}\n---\n`
}

export const FM = /^---\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/

/** Frontmatter text -> a record. Throws when it doesn't parse or isn't key: value lines. */
export function loadFm(raw: string): Item {
  const fm = load(raw) ?? {}
  if (typeof fm !== "object" || Array.isArray(fm)) throw new YAMLError("frontmatter is not a set of key: value lines")
  return fm as Item
}

/** [frontmatter, body]. Throws on a broken header. */
export function parseText(text: string): [Item, string] {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!m) return [{}, text.trim()]
  return [loadFm(m[1]), m[2].trim()]
}

/** A file's text with its frontmatter key `from` renamed `to`, nothing else changed (core/textedit.ts renameKey); null
 *  when it has no such key, already has `to`, or its header can't be changed line by line. */
export function renameProperty(text: string, from: string, to: string): string | null {
  const m = FM.exec(text)
  if (!m) return null
  const inner = renameKey(m[1] ?? "", from, to, loadFm)
  // (what follows the closing --- stays as it was, its line break included)
  return inner === null ? null : `---\n${inner}\n---${text.slice(m[0].length - (m[0].endsWith("\n") ? 1 : 0))}`
}

/** A file's text with one frontmatter key set to `value` (undefined: removed), only that key's lines rewritten; null
 *  when the header can't be patched line by line (it's left alone then). A file without a header gets one. */
export function setPropertyText(text: string, key: string, value: unknown): string | null {
  const m = FM.exec(text)
  const raw = m ? m[1] ?? "" : ""
  let old: Item
  try { old = m ? loadFm(raw) : {} } catch { return null }
  const inner = patchFrontmatter(raw, old, value === undefined ? {} : { [key]: dates(value) }, value === undefined ? [key] : [], [],
    (k, v) => dump({ [k]: v }), loadFm)
  if (inner === null) return null
  const rest = m ? text.slice(m[0].length) : text
  if (!inner.trim()) return rest.replace(/^\n/, "")
  return `---\n${inner}\n---\n${m ? rest : rest ? `\n${rest}` : ""}`
}

/** A file's text with tag `from`, and those nested under it, renamed `to`: in its frontmatter `tags` (a list or text, as
 *  it was written; a tag twice once) and its #tags. null when its header can't be patched line by line. */
export function renameTagText(text: string, from: string, to: string): string | null {
  const f = tagName(from).toLowerCase(), t = tagName(to)
  const hit = (x: string) => x.toLowerCase() === f || x.toLowerCase().startsWith(`${f}/`)
  let out = text
  const m = FM.exec(text)
  if (m) {
    let fm: Item
    try { fm = loadFm(m[1] ?? "") } catch { return null }
    for (const key of ["tags", "tag"]) {
      const list = fm[key] == null ? [] : fmTags(fm[key])
      if (!list.some(hit)) continue
      const seen = new Set<string>(), renamed: string[] = []
      for (const x of list.map((x) => (hit(x) ? t + x.slice(f.length) : x))) if (!seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); renamed.push(x) }
      const next = setPropertyText(out, key, Array.isArray(fm[key]) ? renamed : renamed.join(", "))
      if (next === null) return null
      out = next
    }
  }
  const head = FM.exec(out)?.[0] ?? ""
  return head + renameTagsIn(out.slice(head.length), from, to)
}

const stripNl = (s: string) => s.replace(/^\n+|\n+$/g, "")

/** The body without its blocks: what a kind parses. */
export function prose(body: string) {
  return withoutBlocks(body ?? "")
}

/** `neu` (a body written whole) with the blocks `old` placed: those above all of its text on top, the rest at the end. */
export function keepBlocks(old: string, neu: string) {
  const top: string[] = [], end: string[] = []
  const s = scan(old ?? "")
  for (const b of blocksIn(old ?? "", s)) (prose(s.lines.slice(0, b.open).join("\n")).trim() ? end : top).push(s.lines.slice(b.open, b.close + 1).join("\n"))
  if (!top.length && !end.length) return neu
  return [top.join("\n\n"), stripNl(neu ?? ""), end.join("\n\n")].filter(Boolean).join("\n\n")
}

let tmpN = 0
/** How long a turn with the vault may take before the log says what holds it (and again each time after). */
const HELD_LONG = 30_000

/** A new file, whole or not at all (a full disk or a crash mid-write leaves no cut-off file to be refused as "already
 *  exists"); false if one came at `p` meanwhile. Renamed, not hard-linked: iCloud Drive's folders may not take links. */
export function writeNew(p: string, data: string | Buffer): boolean {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${++tmpN}`
  try {
    fs.writeFileSync(tmp, data, { flag: "wx" })
    if (fs.existsSync(p)) { fs.rmSync(tmp, { force: true }); return false }
    fs.renameSync(tmp, p)
    return true
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** A file replaced whole or not at all; `mode` is the new file's (0o600: this machine's user only). */
export function writeAtomic(p: string, text: string | Buffer, { mode }: { mode?: number } = {}) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${++tmpN}`
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? "utf8" : { encoding: "utf8", mode })
    fs.renameSync(tmp, p)
  } catch (e) {
    // (a write macOS refused, EPERM from a server whose app was replaced under it, leaves no copy behind in the vault)
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** A settings file's mtime and size, which change with every write (readConfig: is the text read last still it?). */
function configStat(file: string) {
  const st = fs.statSync(file, { bigint: true })
  return `${st.mtimeNs}:${st.size}`
}

/** A read failed because the file isn't there (not because iCloud holds it or has it in the cloud only for now). */
function gone(file: string, e: unknown) {
  return (e as NodeJS.ErrnoException).code === "ENOENT" && !fs.existsSync(path.join(path.dirname(file), `.${path.basename(file)}.icloud`))
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** A text file, line endings as \n. Throws ENOENT, a TypeError when it isn't UTF-8, or EAGAIN while a read of it has
 *  been under way for a while (readSoon: reading it here too would hold the server until iCloud gives it). */
export function readText(p: string) {
  if (Date.now() - (reading.get(p)?.since ?? Infinity) >= SLOW) throw Object.assign(new Error(`iCloud is still downloading ${path.basename(p)}`), { code: "EAGAIN" })
  let buf: Buffer
  try { buf = fs.readFileSync(p) } catch (e) { fetchFromICloud(p, e); throw e }
  return textOf(buf)
}
const textOf = (buf: Buffer) => decoder.decode(buf).replace(/\r\n?/g, "\n")

/** How long a sync waits for a file before going on without it; a read going on SLOW ms is held (iCloud). */
export const READ_WAIT = 2000
const SLOW = 1000
/** The last read of each file (readSoon) while it's under way, by absolute path, and when it began. */
const reading = new Map<string, { since: number; data: Promise<Buffer> }>()

/** A file's bytes read off the main thread, so a file iCloud is slow to give never holds the server; null when that
 *  takes over `wait` ms, or at once while an earlier read of it is held (the read goes on: no second thread on it). */
export function readSoon(p: string, wait = READ_WAIT): Promise<Buffer | null> {
  const was = reading.get(p)
  if (was && Date.now() - was.since >= SLOW) return Promise.resolve(null)
  const data = fs.promises.readFile(p).catch((e) => { fetchFromICloud(p, e); throw e })
    .finally(() => { if (reading.get(p) === r) reading.delete(p) })
  data.catch(() => {}) // (heard by whoever waits on it)
  const r = { since: Date.now(), data }
  reading.set(p, r)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((ok) => { timer = setTimeout(ok, wait, null) })
  return Promise.race([data, late]).finally(() => clearTimeout(timer))
}

/** When a read under way (readSoon) ends, however it ends; null when none is. */
const readEnd = (p: string) => reading.get(p)?.data.then(() => {}, () => {}) ?? null

/** Files read for over `after` ms and still being read (iCloud downloading them), absolute paths. */
export function slowReads(after = SLOW) {
  const now = Date.now()
  return [...reading].filter(([, r]) => now - r.since >= after).map(([p]) => p).sort()
}

/** iCloud may leave a file another device changed as a placeholder that a read here can't materialize (errno 11,
 *  EDEADLK): ask iCloud for it (`brctl download`, once a minute per file) so the next sync reads it. */
const fetching = new Map<string, number>()
export function fetchFromICloud(p: string, e: unknown) {
  if (process.platform !== "darwin" || Math.abs((e as NodeJS.ErrnoException)?.errno ?? 0) !== 11) return
  const now = Date.now()
  if (now - (fetching.get(p) ?? 0) < 60_000) return
  fetching.set(p, now)
  // A file moved or archived meanwhile (an inbox item marked done) has nothing left to fetch: not an error.
  execFile("/usr/bin/brctl", ["download", p], { timeout: 60_000 }, (err) => {
    if (err && fs.existsSync(p)) console.error(`couldn't ask iCloud for ${p}: ${err.message}`)
  })
}

/** A file as a plugin's reader of its format gets it (the services `text:<ext>`): its text, or for a file that isn't
 *  text (a workbook, a Word document, a book: core/filetypes.ts's "binary") its bytes. */
export function formatInput(abs: string, rel: string): string | Buffer {
  return kindOf(rel) === "binary" ? fs.readFileSync(abs) : readText(abs)
}

export function blank(v: unknown) {
  return v === null || v === undefined || v === false || v === "" ||
    (Array.isArray(v) && !v.length) || (typeof v === "object" && v !== null && !Array.isArray(v) && !Object.keys(v).length)
}

/** The keys a kind owns, in its order (blank ones dropped), then every other key the file already had. */
export function mergeFm(existing: Item, owned: Item): Item {
  const out: Item = {}
  for (const [k, v] of Object.entries(owned)) if (!blank(v)) out[k] = v
  for (const [k, v] of Object.entries(existing)) if (!(k in owned)) out[k] = v
  return out
}

/** A number from YAML, or null. Strings like '30' count; anything else doesn't. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return v
  if (typeof v !== "string") return null
  const s = v.trim().replace(/(\d)_(?=\d)/g, "$1")
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(s)) return null
  return Number(s)
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable((v as Item)[k])).join(",")}}`
  return JSON.stringify(v ?? null)
}

/** A value as it would be read back from YAML, blank ones as null: for comparing old and new values. */
const norm = (v: unknown) => (blank(v) ? null : stable(v))

const isEmpty = (y: unknown) => y !== null && typeof y === "object" && !Array.isArray(y) && !Object.keys(y).length

/** An item without its private `_` keys and empty records. Copies only what changes, since /api/state is megabytes
 *  of items that have nothing private. */
export function publicOf(x: unknown): unknown {
  if (x === null || typeof x !== "object") return x
  if (Array.isArray(x)) {
    let out: unknown[] | null = null
    for (let i = 0; i < x.length; i++) {
      const y = publicOf(x[i]), drop = isEmpty(y)
      if (out === null && (drop || y !== x[i])) out = x.slice(0, i)
      if (out !== null && !drop) out.push(y)
    }
    return out ?? x
  }
  const obj = x as Item, keys = Object.keys(obj)
  let out: Item | null = null
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i], v = obj[k], y = k.startsWith("_") ? undefined : publicOf(v)
    if (out === null && (y !== v || k.startsWith("_"))) {
      out = {}
      for (let j = 0; j < i; j++) out[keys[j]] = obj[keys[j]]
    }
    if (out !== null && !k.startsWith("_")) out[k] = y
  }
  return out ?? x
}

// ---------- who's writing ----------

/** Who asked for the write being made: the API request's X-Vaultite-Client ("app/desktop", "cli", "mcp"; null for
 *  anyone who doesn't say: curl, a script) and X-Vaultite-Agent (the CLI's coding agent). */
export type Writer = { client: string | null; agent: string | null }
/** Set by the API around each request that came over HTTP (core/app.ts), read by the hooks that run on its writes. */
export const requestWriter = new AsyncLocalStorage<Writer>()
/** onCreate's hooks (Vault.onCreate): the keys to add to a new file. `writer` is null outside a request over HTTP. */
export type CreateHook = (path: string, fm: Item, writer: Writer | null) => Item | void
/** A new file as onCreateFile's hooks see it, read-only: its size, and its first or last `n` bytes, read only when asked
 *  (an upload can be any size). */
export type NewFile = { size: number; head: (n: number) => Buffer; tail: (n: number) => Buffer }
/** onCreateFile's hooks (Vault.onCreateFile): told of a new file that isn't Markdown; they never change its bytes. */
export type FileCreateHook = (path: string, file: NewFile, writer: Writer | null) => void

/** Bytes in memory as a NewFile. */
export const newFile = (b: Buffer): NewFile => ({ size: b.length, head: (n) => b.subarray(0, n), tail: (n) => b.subarray(Math.max(0, b.length - n)) })

/** A file on disk as a NewFile (an upload streamed there). */
export function newFileAt(p: string): NewFile {
  const size = fs.statSync(p).size
  const part = (at: number, n: number) => {
    const fd = fs.openSync(p, "r")
    try { const b = Buffer.alloc(n); return b.subarray(0, fs.readSync(fd, b, 0, n, at)) } finally { fs.closeSync(fd) }
  }
  return { size, head: (n) => part(0, Math.min(n, size)), tail: (n) => part(Math.max(0, size - n), Math.min(n, size)) }
}
/** onMove's hooks (Vault.onMove): `to` null when trashed, then `trashed` is its path in .trash. */
export type MoveHook = (from: string, to: string | null, trashed?: string) => void
/** onArchive's hooks (Vault.onArchive): the folder a file being archived (or unarchived) moves to, or null. */
export type ArchiveHook = (path: string, archived: boolean) => string | null | undefined

// ---------- kinds ----------

type Awaitable<T> = T | Promise<T>

export type KindSpec = {
  /** the frontmatter `type:` (person, note, log...) */
  type: string
  /** its name in /api/state and the API (people, notes, logs...) */
  collection: string
  /** its usual folder ("People"; "Logs" holds subfolders when recursive is true): only where its first file goes
   *  (Vault.home). Its files are the ones whose `type` is its, wherever they are (Vault.kindFor). */
  folder?: string
  /** or a single file ("ME.md", in any case; a function when a setting names it), its kind with or without a `type`;
   *  elsewhere, the one file of its type */
  file?: string | (() => string)
  recursive?: boolean
  titleKey?: string
  /** file -> [item, problems] (the vault adds `id` and `modified`, UTC) */
  parse: (fm: Item, body: string, stem: string) => [Item | null, string[]]
  /** item -> [owned frontmatter, body]; keys the file has beyond `owned` are kept */
  render: (item: Item) => [Item, string]
  /** path relative to the vault, without .md (default: <folder>/<safe name of item[titleKey]>). `folder` is where it goes:
   *  an existing item's own folder, a new one's where the kind's files are (Vault.home); `old` the item before. */
  filename?: (item: Item, at: { folder: string; old: Item | null }) => string
  /** a value that identifies the item for upserts (POST with the same key updates it), or null */
  key?: (item: Item) => string | null | undefined
  /** before a write: fill timestamps, geocode... */
  prepare?: (neu: Item, old: Item | null) => Awaitable<Item>
  /** after the app wrote the file for someone (an edit in the app, a new file; before = what it was): an item to write
   *  back with fields filled in (ids, dates), or null. Never on reading: files changed outside the app stay as they are. */
  fill?: (item: Item, before: Item | null) => Awaitable<Item | null>
  /** sort for /api/state (default: by id) */
  order?: (items: Item[]) => Item[]
  /** an update: the old item with the patch's fields on top (a kind can merge nested fields, like log data) */
  merge?: (old: Item, patch: Item) => Item
  /** its files' view: blocks drawn on top of each file that doesn't place them itself (["person"]: ```block-person),
   *  or a function of its frontmatter. Never written into the files. */
  blocks?: string[] | ((fm: Item) => string[])
  /** `## ` headings its files' view draws instead of their text (["timeline"]): only in its files, never in any note */
  sections?: string[]
  /** frontmatter keys the app keeps as UTC times ("YYYY-MM-DD HH:MM:SS"): shown in local time, not edited by hand */
  stamps?: string[]
}

export class Kind {
  type: string
  collection: string
  folder?: string
  recursive: boolean
  titleKey: string
  spec: KindSpec
  plugin: string | null = null

  constructor(spec: KindSpec) {
    this.spec = spec
    this.type = spec.type
    this.collection = spec.collection
    this.folder = spec.folder
    this.recursive = !!spec.recursive
    this.titleKey = spec.titleKey ?? "title"
  }

  /** Its single file, if it's kept in one (its plugin's setting may move it). */
  get file(): string | undefined {
    const f = this.spec.file
    return typeof f === "function" ? f() : f
  }

  parse(fm: Item, body: string, stem: string) { return this.spec.parse(fm, body, stem) }
  render(item: Item) { return this.spec.render(item) }
  get key() { return this.spec.key }
  get fill() { return this.spec.fill }

  filename(item: Item, at: { folder: string; old: Item | null }) {
    if (this.spec.filename) return this.spec.filename(item, at)
    if (this.file) return at.old ? at.old.id : this.file.slice(0, -3)
    return joinPath(at.folder, safeName(truthy(item[this.titleKey]) ? item[this.titleKey] : "Untitled"))
  }

  blocksFor(fm: Item): string[] {
    const b = this.spec.blocks ?? []
    return typeof b === "function" ? [...b(fm)] : b
  }

  async prepare(neu: Item, old: Item | null) { return this.spec.prepare ? await this.spec.prepare(neu, old) : neu }

  order(items: Item[]) {
    return this.spec.order ? this.spec.order(items) : items.sort((a, b) => cmp(a.id, b.id))
  }

  merge(old: Item, patch: Item) { return this.spec.merge ? this.spec.merge(old, patch) : { ...old, ...patch } }

  /** Whether a file without a known `type` is this kind: only its single file is (any case: ME.md, and Me.md). Every
   *  other file is a kind's by its `type` alone, never by its folder. */
  owns(rel: string) {
    const f = this.file
    return !!f && rel.toLowerCase() === f.toLowerCase()
  }
}

/** A folder and a name in it ("" is the vault's top). */
export const joinPath = (folder: string, name: string) => (folder ? `${folder}/${name}` : name)
/** The folder a path is in ("" at the top). */
export const dirOf = (rel: string) => rel.slice(0, Math.max(0, rel.lastIndexOf("/")))

/** Compare like Python: numbers, strings, and arrays of them element by element. */
export function cmp(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmp(a[i], b[i]); if (c) return c }
    return a.length - b.length
  }
  if (typeof a === "number" && typeof b === "number") return a - b
  const x = String(a ?? ""), y = String(b ?? "")
  return x < y ? -1 : x > y ? 1 : 0
}

/** Sort by a key, like Python's sorted(key=..., reverse=...): stable either way. */
export function sortBy<T>(xs: T[], key: (x: T) => unknown, reverse = false): T[] {
  return xs.map((x, i) => [x, key(x), i] as const)
    .sort((p, q) => (reverse ? cmp(q[1], p[1]) : cmp(p[1], q[1])) || p[2] - q[2]).map((p) => p[0])
}

/** A file's modified time (ns), size, and when it was made (ms: macOS keeps a birth time; else its oldest time). */
type Stat = { ns: bigint; size: number; born: number }
/** Folders of installed packages and compiled caches (a code project dropped into the vault): never listed. Every
 *  request walks the vault, and these can hold tens of thousands of files nobody opens. */
const CACHES = new Set(["node_modules", "__pycache__"])
const sameStat = (a: Stat, b: Stat) => a.ns === b.ns && a.size === b.size
const NOT_SETTINGS = new Set([".vaultite/artifacts", ".vaultite/cache", ".vaultite/generated", PAGES_DIR])

export class Entry {
  rel: string
  stat: Stat
  kind: Kind | null
  fm: Item = {}
  body = ""
  item: Item | null = null
  problems: string[] = []
  broken = false // its header doesn't parse: fm/body/item are the last good read

  constructor(rel: string, stat: Stat, kind: Kind | null) {
    this.rel = rel; this.stat = stat; this.kind = kind
  }

  /** Its type, one rule for the whole app (core/fileprops.ts): its kind's when a kind owns it, else its frontmatter's. */
  get type(): string | null { return effectiveType(this.kind?.type, this.fm) }
  /** `archived: true` in its frontmatter, or in an archive folder (core/fileprops.ts). */
  get archived(): boolean { return isArchived(this.fm) || inArchive(this.rel) }

  tagCache: { fm: Item; body: string; tags: string[] } | null = null
  /** Its tags: frontmatter `tags` and inline #tags in the body (core/sections.ts), worked out once per read. */
  get tags(): string[] {
    const c = this.tagCache
    if (c && c.fm === this.fm && c.body === this.body) return c.tags
    const tags = tagsOf(this.fm, this.body)
    this.tagCache = { fm: this.fm, body: this.body, tags }
    return tags
  }
}

const base = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1)
export const stemOf = (rel: string) => base(rel).replace(/\.md$/, "")

export const ms = (ns: bigint) => Number(ns / 1000000n)

/** What the index keeps of a file's stat. */
export function statFrom(st: fs.BigIntStats): Stat {
  const born = st.birthtimeNs > 0n ? st.birthtimeNs : st.ctimeNs < st.mtimeNs ? st.ctimeNs : st.mtimeNs
  return { ns: st.mtimeNs, size: Number(st.size), born: ms(born) }
}

function statOf(p: string): Stat {
  return statFrom(fs.statSync(p, { bigint: true }))
}

export function sameFile(a: string, b: string) {
  try {
    const x = fs.statSync(a), y = fs.statSync(b)
    return x.dev === y.dev && x.ino === y.ino
  } catch {
    return false
  }
}

/** An item as its kind renders it, plus the core's `archived` (true, or blank: removed when it was there). */
function rendered(k: Kind, item: Item): [Item, string] {
  const [owned, body] = k.render(item)
  return [{ ...owned, archived: isArchived(item) ? true : null }, body]
}

// ---------- the vault ----------

/** In-memory index of the vault's files. One per server; requests take turns through `lock` (see server.ts). */
export class Vault {
  path: string
  kinds: Kind[] = []
  entries = new Map<string, Entry>()       // relpath -> Entry
  byId = new Map<string, string>()         // collection + "\0" + id -> relpath
  others = new Map<string, Stat>()         // files that aren't Markdown (images, PDFs)
  folders: string[] = []                   // every folder, for the file tree
  private missing = new Map<string, number>() // top-level folders gone from disk, since when (sync)
  version = 0                              // bumps on every change to the files (other files and folders too), so callers can cache derived data
  settingsVersion = 0                      // the same for settings: .vaultite/ (see settingsStats) and Obsidian's app.json, types.json
  private settingsSeen = ""                // the settings files' stats at the last sync (settingsStats)
  private ordered = new Map<Kind, Item[]>() // each kind's items in order, until one of its files is read or dropped
  private settings = new Map<string, string | null>() // settings files read since the last sync began (their text)
  private lastGood = new Map<string, { text: string; stat: string }>() // each settings file as it last read or was written, with its mtime and size then (config, readConfig)
  private queue: Promise<unknown> = Promise.resolve()
  private next: Promise<boolean> | null = null // a sync waiting for its turn (synced)
  private hooks = new Set<(vault: Vault) => void>()
  private types: Map<string, Kind> | null = null // each kind by its type, until kinds change
  private plainDirs: string[] = []         // plain(), asked at each sync
  /** The folders whose files are patterns, never items (the Templates plugin's, through the service
   *  `templates:folder`: core/app.ts): a `type: person` template there isn't a person. */
  plain: () => string[] = () => []
  /** The app's plugins that are off until turned on (manifest `offByDefault`), set as they load (core/plugins.ts). */
  optIn = new Set<string>()
  /** Files a sync went on without, still being read (iCloud downloading them): as last read, or not indexed yet. */
  downloading: string[] = []
  private arrivals = new Set<(rel: string) => void>()

  constructor(p: string) {
    this.path = p
  }

  /** Run fn with the vault to itself: writes (and the sync before them) take turns, so a file is never half-updated. */
  lock<T>(fn: () => Promise<T> | T): Promise<T> {
    // (one turn that never ends wedges every request: it's at least said in the log, with what holds it)
    const watched = async () => {
      const t0 = Date.now(), by = errorContext.getStore() ?? "the server's own work"
      const dog = setInterval(() => console.error(`vault: held ${Math.round((Date.now() - t0) / 1000)} s by ${by}`), HELD_LONG)
      dog.unref()
      try { return await fn() } finally { clearInterval(dog) }
    }
    const run = this.queue.then(watched, watched)
    this.queue = run.catch(() => {})
    return run
  }

  /** Sync before a read. Every read asking before the next turn shares one sync that starts after all of them, so an
   *  app's burst of requests walks the vault once, not once each. */
  synced(): Promise<boolean> {
    return this.next ??= turn().then(() => this.lock(() => {
      this.next = null
      return this.sync()
    }))
  }

  abs(rel: string) {
    noteRead(rel) // (a block being traced read this file: core/sources.ts)
    return path.join(this.path, rel)
  }

  /** fn(vault) after every sync, whether or not the index changed (File history compares stats). Returns the function
   *  that removes it. */
  afterSync(fn: (vault: Vault) => void) {
    return added(this.hooks, fn)
  }

  /** fn(rel) when a file a sync went on without (downloading) has been read: Live syncs then. Returns the function that
   *  removes it. */
  onArrive(fn: (rel: string) => void) {
    return added(this.arrivals, fn)
  }

  /** The texts of `rels` (or why one can't be read), read 64 at a time off the main thread. `late`: the ones still
   *  being read after READ_WAIT in all (a file started after that gets a moment). */
  private async readAll(rels: string[]) {
    const texts = new Map<string, string | Error>(), late: string[] = [], queue = [...rels], was = new Set(this.downloading)
    const deadline = Date.now() + READ_WAIT
    const next = async () => {
      for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
        const abs = path.join(this.path, rel)
        try {
          const data = await readSoon(abs, Math.max(deadline - Date.now(), 200))
          if (data !== null) { texts.set(rel, textOf(data)); continue }
          late.push(rel)
          if (!was.has(rel)) readEnd(abs)?.then(() => { for (const fn of this.arrivals) fn(rel) })
        } catch (e) {
          texts.set(rel, e as Error)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(64, queue.length) }, next))
    return { texts, late: late.sort() }
  }

  private movers = new Set<MoveHook>()
  /** fn(from, to) when a file or folder is moved through the API, restored from .trash, or trashed (to: null, and
   *  `trashed` where it went), so open tabs and plugins follow. Returns the function that removes it. */
  onMove(fn: MoveHook) {
    return added(this.movers, fn)
  }
  moved(from: string, to: string | null, trashed?: string) {
    for (const fn of this.movers) {
      try { fn(from, to, trashed) } catch (e) { console.error(e) }
    }
  }

  /** Every file as links see it: its path, `title` (or `name`) and aliases. */
  private linkFiles(): LinkFile[] {
    const out: LinkFile[] = []
    for (const [rel, e] of this.entries) {
      const title = e.fm.title || e.fm.name, aliases = e.fm.aliases
      out.push({ path: rel, title: title ? String(title) : undefined, aliases: (Array.isArray(aliases) ? aliases : aliases ? [aliases] : []).map(String), archived: e.archived })
    }
    for (const rel of this.others.keys()) out.push({ path: rel })
    return out
  }
  private links: { version: number; resolve: Resolve<string> } | null = null
  /** The file a [[link]] written in `from` goes to (core/links.ts: the closest of its name), or null. */
  resolveLink(target: string, from?: string): string | null {
    if (this.links?.version !== this.version) this.links = { version: this.version, resolve: linkResolver(this.linkFiles()) }
    return this.links.resolve(target, from)
  }

  /** Point links to moved files (already in the index at `to`) at their new paths. A link changes only
   *  when it found the file before and wouldn't now. Returns the files changed. */
  relink(moves: [string, string][]): string[] {
    if (!moves.length) return []
    const fwd = new Map(moves), back = new Map(moves.map(([f, t]) => [t, f]))
    const now = this.linkFiles()
    const before = linkResolver(now.map((f) => (back.has(f.path) ? { ...f, path: back.get(f.path)! } : f)))
    const after = linkResolver(now)
    const was = new Set(now.map((f) => back.get(f.path) ?? f.path)), is = new Set(now.map((f) => f.path))
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1)
    // (each link as seen from its file, where it was and where it is: the closest file of a name wins)
    const wiki = (t: string, was: string, now: string) => {
      const old = before(t, was), np = old === null ? undefined : fwd.get(old)
      if (np === undefined || after(t, now) === np) return null
      const name = /\.md$/i.test(np) && !/\.md$/i.test(t) ? np.slice(0, -3) : np
      return !t.includes("/") && after(base(name), now) === np ? base(name) : name
    }
    // A Markdown link's path, relative to its file's folder or from the vault's top; ".md" may be left out.
    const find = (dir: string, h: string, files: Set<string>) => {
      for (const p of h.startsWith("/") ? [h.slice(1)] : [resolvePath(dir, h), resolvePath("", h)]) {
        if (p !== null && files.has(p)) return { p, md: false, relative: !h.startsWith("/") && p === resolvePath(dir, h) }
        if (p !== null && files.has(`${p}.md`)) return { p: `${p}.md`, md: true, relative: !h.startsWith("/") && p === resolvePath(dir, h) }
      }
      return null
    }
    const changed: string[] = []
    for (const [rel, e] of [...this.entries]) {
      const self = back.get(rel) ?? rel
      if (!e.body.includes("[[") && !e.body.includes("](") && !JSON.stringify(e.fm).includes("[[")) continue
      let text: string
      try { text = readText(this.abs(rel)) } catch { continue }
      const neu = mapLinks(text, (t, md) => {
        if (!md) return wiki(t, self, rel)
        const old = find(dirOf(self), t, was)
        if (!old) return null
        const np = fwd.get(old.p) ?? old.p
        if (find(dirOf(rel), t, is)?.p === np) return null
        const out = old.md ? np.slice(0, -3) : np
        return t.startsWith("/") ? `/${out}` : old.relative ? relativePath(dirOf(rel), out) : out
      })
      if (neu === text) continue
      const abs = this.abs(rel)
      writeAtomic(abs, fs.readFileSync(abs, "utf8").includes("\r\n") ? neu.replace(/\n/g, "\r\n") : neu)
      changed.push(rel)
    }
    return changed
  }

  /** The plugins switched off in plugins.json: the app's in `disabled`, and its `offByDefault` ones not in `enabled`
   *  (a vault plugin that isn't on isn't loaded). What they require being off isn't counted (enabled() does). */
  switchedOff(): Set<string> {
    const { disabled, enabled } = this.config("plugins")
    const on = new Set<string>(Array.isArray(enabled) ? enabled : [])
    return new Set([...(Array.isArray(disabled) ? disabled as string[] : []), ...[...this.optIn].filter((id) => !on.has(id))])
  }

  /** The hooks of `hooks` whose plugin is on. */
  private on<F>(hooks: Set<{ plugin: string; fn: F }>): F[] {
    const off = hooks.size ? this.switchedOff() : new Set<string>()
    return [...hooks].filter((h) => !off.has(h.plugin)).map((h) => h.fn)
  }

  private placers = new Set<{ plugin: string; fn: ArchiveHook }>()
  /** fn(path, archived) when the API archives or unarchives an item: the folder its file moves to, or null to leave it.
   *  Only while `plugin` is on. Returns the function that removes it. */
  onArchive(plugin: string, fn: ArchiveHook) {
    return added(this.placers, { plugin, fn })
  }
  /** Where the onArchive hooks move a file being archived (or not), or null. */
  private placed(rel: string, archived: boolean): string | null {
    for (const fn of this.on(this.placers)) {
      try { const to = fn(rel, archived); if (typeof to === "string") return to } catch (e) { console.error(e) }
    }
    return null
  }

  private creators = new Set<{ plugin: string; fn: CreateHook }>()
  /** fn(path, fm, writer) when the API makes a Markdown file: the keys it answers are added (the file's own win). Only
   *  while `plugin` is on. Returns the function that removes it. */
  onCreate(plugin: string, fn: CreateHook) {
    return added(this.creators, { plugin, fn })
  }
  /** The keys the onCreate hooks add to a new file at `rel` whose frontmatter is `fm`. */
  creating(rel: string, fm: Item): Item {
    const who = requestWriter.getStore() ?? null
    const out: Item = {}
    for (const fn of this.on(this.creators)) {
      try {
        for (const [k, v] of Object.entries(fn(rel, fm, who) ?? {})) if (!(k in fm) && !(k in out) && !blank(v)) out[k] = v
      } catch (e) { console.error(e) }
    }
    return out
  }
  /** A new Markdown file's text as the API writes it: with the keys the onCreate hooks add, as a small edit (the
   *  text's own header lines stay as they are). The text as it was when they add none, or its header doesn't read. */
  created(rel: string, text: string): string {
    if (!rel.toLowerCase().endsWith(".md") || !this.creators.size) return text
    const m = FM.exec(text)
    let fm: Item
    try { fm = m ? loadFm(m[1] ?? "") : {} } catch { return text }
    const add = this.creating(rel, fm)
    if (!Object.keys(add).length) return text
    if (!m) return `${frontmatter(add)}${text && !text.startsWith("\n") ? "\n" : ""}${text}`
    const inner = patchFrontmatter(m[1] ?? "", fm, Object.fromEntries(Object.entries(add).map(([k, v]) => [k, dates(v)])), [],
      [...Object.keys(fm), ...Object.keys(add)], (key, value) => dump({ [key]: value }), loadFm)
    return inner === null ? text : `---\n${inner}\n---\n${text.slice(m[0].length)}`
  }

  private fileCreators = new Set<{ plugin: string; fn: FileCreateHook }>()
  /** fn(path, file, writer) when the API makes a file that isn't Markdown (an upload, an SVG), to look at, never to
   *  change. Only while `plugin` is on. Returns the function that removes it. */
  onCreateFile(plugin: string, fn: FileCreateHook) {
    return added(this.fileCreators, { plugin, fn })
  }
  /** Tell the onCreateFile hooks of a new file the API writes (a Markdown file's are created()'s). */
  fileCreated(rel: string, file: NewFile) {
    if (rel.toLowerCase().endsWith(".md")) return
    const who = requestWriter.getStore() ?? null
    for (const fn of this.on(this.fileCreators)) {
      try { fn(rel, file, who) } catch (e) { console.error(e) }
    }
  }

  register(kind: Kind) {
    this.kinds.push(kind)
    this.ordered.clear()
    this.types = null
    return kind
  }

  /** A kind whose plugin was unloaded (a vault plugin): its files become plain files on the next sync. */
  unregister(kind: Kind) {
    this.kinds = this.kinds.filter((k) => k !== kind)
    this.ordered.clear()
    this.types = null
    for (const key of [...this.byId.keys()]) if (key.startsWith(kind.collection + "\0")) this.byId.delete(key)
  }

  kind(collection: string): Kind {
    const k = this.kinds.find((x) => x.collection === collection)
    if (!k) throw new NotFound(collection)
    return k
  }

  has(collection: string) {
    return this.kinds.some((k) => k.collection === collection)
  }

  // --- reading

  /** A file's kind: its `type`'s wherever it is, else the kind kept in that one file (ME.md); never its folder's. Files
   *  in a folder of patterns (Templates/) are plain whatever they say. */
  kindFor(rel: string, fm: Item): Kind | null {
    for (const d of this.plainDirs) if (rel.startsWith(d + "/")) return null
    return this.typed(fm) ?? this.kinds.find((k) => k.owns(rel)) ?? null
  }

  /** The kind a file's `type` names, or null. */
  private typed(fm: Item): Kind | null {
    const t = fm.type
    if (typeof t !== "string" || !t.trim()) return null
    this.types ??= new Map(this.kinds.map((k) => [k.type.toLowerCase(), k]))
    return this.types.get(t.trim().toLowerCase()) ?? null
  }

  /** Where a file is now: `rel`, or, when its folder was moved outside the app (Dashboards/ into Personal/), the one
   *  file whose path ends with it, so pins and paths written before the move still find it. */
  relocated(rel: string): string {
    if (!rel || this.entries.has(rel) || this.others.has(rel) || this.missing.has(rel.split("/")[0])) return rel
    const tail = `/${rel}`
    let hit: string | null = null
    for (const map of [this.entries, this.others] as Map<string, unknown>[]) {
      for (const r of map.keys()) {
        if (!r.endsWith(tail)) continue
        if (hit !== null) return rel // two: which one isn't known
        hit = r
      }
    }
    return hit ?? rel
  }

  /** The folder new files of a kind go to: where most of its files are, preferring folders named like it, or null. So
   *  moving People/ into Personal/ moves where new people go too. */
  home(collection: string, where?: (item: Item) => boolean): string | null {
    const k = this.kind(collection), paths: string[] = []
    for (const e of this.entries.values()) {
      // (not a folder that's gone for now: sync keeps its files a moment, but nothing new goes there)
      if (e.kind === k && e.item !== null && (!where || where(e.item)) && !this.missing.has(e.rel.split("/")[0])) paths.push(e.rel)
    }
    return homeFolder(paths, k.folder, k.recursive)
  }

  /** Every Markdown file with its kind (hidden folders and CACHES left out, not .archive or PAGES_DIR), and the other
   *  files and folders, for the file tree (not PAGES_DIR's). */
  private scan() {
    const found = new Map<string, Stat>()
    const others = new Map<string, Stat>()
    const folders: string[] = []
    const stack = [""], pages = PAGES_DIR + "/"
    if (fs.existsSync(path.join(this.path, PAGES_DIR))) stack.push(PAGES_DIR)
    const root = path.join(this.path, "/") // (joined by hand below: path.join per file is a tenth of the walk)
    // Linked folders followed (and the vault's own): a link back up (`ln -s .. x`) is walked once, not until paths are too long.
    const linked = new Set<string>()
    try { const r = fs.statSync(root, { bigint: true }); linked.add(`${r.dev}:${r.ino}`) } catch { /* read below */ }
    while (stack.length) {
      const sub = stack.pop()!
      let names: fs.Dirent[]
      try {
        names = fs.readdirSync(root + sub, { withFileTypes: true })
      } catch {
        continue
      }
      for (const d of names) {
        const name = d.name
        // (an archive folder is indexed like any: links to archived files resolve)
        if ((name.startsWith(".") && (name !== ARCHIVE_DIR || !d.isDirectory())) || name.endsWith(".icloud")) continue
        const rel = sub ? `${sub}/${name}` : name
        // A folder needs no stat; a file, or a link (to either), does.
        let st: fs.BigIntStats | null | undefined = null
        try {
          if (!d.isDirectory()) st = fs.statSync(root + rel, { bigint: true, throwIfNoEntry: false })
        } catch {
          continue
        }
        if (st === undefined) continue
        if (st === null || st.isDirectory()) {
          if (CACHES.has(name)) continue
          if (st) { const key = `${st.dev}:${st.ino}`; if (linked.has(key)) continue; linked.add(key) }
          if (!rel.startsWith(pages)) folders.push(rel)
          stack.push(rel)
          continue
        }
        const stat = statFrom(st)
        if (name.endsWith(".md") && !name.includes(".tmp-")) found.set(rel, stat)
        else others.set(rel, stat)
      }
    }
    folders.sort()
    // Other files or folders added, gone or changed: a new version too (the file tree shows them).
    if (others.size !== this.others.size || folders.length !== this.folders.length || folders.some((f, i) => f !== this.folders[i]) ||
      [...others].some(([r, st]) => { const was = this.others.get(r); return !was || !sameStat(was, st) })) this.version++
    this.others = others
    this.folders = folders
    // Settings changed (a plugin turned on, an area added, a tab moved in a workspace): /api/state shows them.
    const seen = this.settingsStats()
    if (seen !== this.settingsSeen) this.settingsVersion++
    this.settingsSeen = seen
    return found
  }

  /** The stats of the settings: .vaultite/ (but what isn't settings: artifacts' storage, which artifacts write often,
   *  plugins' caches of live data and the app's own copies in generated/) and Obsidian's app.json and types.json. */
  private settingsStats() {
    const out: string[] = []
    const stack = [".vaultite"]
    while (stack.length) {
      const sub = stack.pop()!
      let names: string[]
      try {
        names = fs.readdirSync(this.abs(sub))
      } catch {
        continue
      }
      for (const name of names) {
        const rel = `${sub}/${name}`
        if (NOT_SETTINGS.has(rel) || CACHES.has(name) || name.includes(".tmp-")) continue
        let st: fs.BigIntStats
        try {
          st = fs.statSync(this.abs(rel), { bigint: true })
        } catch {
          continue
        }
        if (st.isDirectory()) stack.push(rel)
        else out.push(`${rel}:${st.mtimeNs}:${st.size}`)
      }
    }
    for (const name of ["app.json", "types.json"]) {
      try {
        const st = fs.statSync(this.abs(`.obsidian/${name}`), { bigint: true })
        out.push(`${name}:${st.mtimeNs}:${st.size}`)
      } catch { /* not an Obsidian vault */ }
    }
    return out.sort().join("\n")
  }

  /** A top-level folder vanished and its files are still indexed (sync lets go of them a few seconds later). */
  waiting() { return this.missing.size > 0 }

  /** Re-read every file that changed since the last sync. Returns true if anything changed. */
  async sync(): Promise<boolean> {
    this.settings.clear() // read again, like the files
    try {
      const plain = this.plain().map((d) => d.replace(/^\/+|\/+$/g, "")).filter(Boolean)
      if (plain.join("\n") !== this.plainDirs.join("\n")) this.plainDirs = plain
    } catch (e) { console.error(e) }
    const found = this.scan()
    // A file that couldn't be read is tried again every time: iCloud may still have been downloading it. One that didn't
    // change is read again when its kind would now be another (a vault plugin's kind came or went).
    let changed = [...found].filter(([r, st]) => {
      const e = this.entries.get(r)
      return !e || !sameStat(e.stat, st) || e.broken || e.kind !== this.kindFor(r, e.fm)
    }).map(([r]) => r)
    // Read before the index changes; one iCloud is slow to give is left as it was until it arrives.
    const { texts, late } = await this.readAll(changed)
    if (late.join("\n") !== this.downloading.join("\n")) { this.downloading = late; this.version++ }
    changed = changed.filter((r) => texts.has(r))
    // A whole folder missing (vault unmounted, mid-move) is not "everything was deleted" at once; still missing a few
    // seconds later (deleted in Finder, rm -rf) it is. The vault itself missing never is.
    const now = Date.now()
    const vanished = (top: string) => { // true: the file under it is gone
      if (isDir(this.abs(top))) { this.missing.delete(top); return true }
      if (!isDir(this.path)) return false
      const since = this.missing.get(top) ?? now
      this.missing.set(top, since)
      return now - since >= 3000
    }
    const gone = [...this.entries.keys()].filter((r) => !found.has(r) &&
      (r.includes("/") ? vanished(r.split("/")[0]) : isDir(this.path)))
    for (const rel of gone) this.drop(rel)
    if (this.missing.size) {
      const tops = new Set([...this.entries.keys()].map((r) => r.split("/")[0]))
      for (const top of this.missing.keys()) if (!tops.has(top)) this.missing.delete(top)
    }
    const unchanged = new Set<string>()
    // The first read of a vault (all of it) lets the event loop turn every so often: a server starting answers its web
    // app's files meanwhile. (Later syncs don't: a read request may be looking at the index.)
    const first = !this.entries.size
    let since = performance.now()
    // (Reading never writes: a file changed outside the app stays as it is; fillIn runs on the app's own writes.)
    for (const rel of changed.sort()) {
      if (first && performance.now() - since > 20) { await turn(); since = performance.now() }
      const st = found.get(rel)!
      const was = this.entries.get(rel)
      const e = this.read(rel, st, texts.get(rel))
      if (was && was.broken && e.broken && sameStat(was.stat, st) && same(was.problems, e.problems)) unchanged.add(rel) // still can't be read: nothing new
    }
    changed = changed.filter((r) => !unchanged.has(r))
    if (changed.length || gone.length) this.version++
    for (const fn of this.hooks) {
      try { fn(this) } catch (e) { console.error(e) } // a plugin's hook must never break reading the vault
    }
    return !!(changed.length || gone.length)
  }

  /** Read a file into the index: its frontmatter and body, its kind (kindFor) and that kind's item. `text`: its text
   *  (or why it couldn't be read), when already read. */
  read(rel: string, st: Stat, text?: string | Error): Entry {
    const e = new Entry(rel, st, null)
    const old = this.entries.get(rel)
    if (old?.kind) this.ordered.delete(old.kind)
    try {
      const t = text ?? readText(this.abs(rel))
      if (typeof t !== "string") throw t
      ;[e.fm, e.body] = parseText(t)
    } catch (ex) {
      // Keep what we had, so a half-written or broken file doesn't make its item vanish.
      const name = ex instanceof YAMLError ? "YAMLError" : ex instanceof TypeError ? "UnicodeDecodeError" : "OSError"
      e.problems = [`can't read the frontmatter (${name}); nothing from this file was updated`]
      e.broken = true
      if (old) { e.fm = old.fm; e.body = old.body; e.item = old.item; e.kind = old.kind } else e.kind = this.kindFor(rel, {})
      this.entries.set(rel, e)
      return e
    }
    if (old?.item && old.kind) this.byId.delete(old.kind.collection + "\0" + old.item.id)
    const kind = e.kind = this.kindFor(rel, e.fm)
    if (kind) this.ordered.delete(kind)
    if (kind === null) { // a plain file: indexed for links, search and the file tree, nothing to parse
      this.entries.set(rel, e)
      return e
    }
    let item: Item | null, problems: string[]
    try {
      [item, problems] = kind.parse(e.fm, prose(e.body), stemOf(rel))
    } catch (ex) { // a plugin bug must not take the whole vault down
      item = null
      problems = [`${kind.plugin ?? "plugin"} couldn't read this file: ${(ex as Error).message}`]
      console.error(ex)
    }
    if (item !== null) {
      item.modified = stamp(new Date(Number(st.ns / 1000000n)))
      if (e.fm.type !== undefined && e.fm.type !== null && str(e.fm.type).trim().toLowerCase() !== kind.type) {
        problems = [`\`type: ${str(e.fm.type)}\` in ${kind.file ?? rel} (expected ${kind.type})`, ...problems]
      }
      item.id = rel.slice(0, -3)
      // Archiving is the core's: every kind's items say it the same way.
      if (e.archived) item.archived = true
      else delete item.archived
      e.item = item
      this.byId.set(kind.collection + "\0" + item.id, rel)
    }
    e.problems = problems
    this.entries.set(rel, e)
    return e
  }

  drop(rel: string) {
    const e = this.entries.get(rel)
    if (e) this.version++
    if (e?.kind) this.ordered.delete(e.kind)
    this.entries.delete(rel)
    if (e && e.item && e.kind) this.byId.delete(e.kind.collection + "\0" + e.item.id)
  }

  /** A kind's items, in its order: copies, each call's own. The order is worked out again only when one of its files was
   *  read or dropped since. */
  items(collection: string): Item[] {
    const k = this.kind(collection)
    noteSource("kinds", collection)
    let hit = this.ordered.get(k)
    if (!hit) {
      const items: Item[] = []
      for (const e of this.entries.values()) if (e.kind === k && e.item !== null) items.push({ ...e.item })
      this.ordered.set(k, hit = k.order(items))
    }
    return hit.map((i) => ({ ...i }))
  }

  /** An item by id ("People/Alice Park"), by file name ("Alice Park"), or by its key (a note's `id`). */
  get(collection: string, ref: unknown): Item | null {
    if (ref === null || ref === undefined) return null
    const k = this.kind(collection)
    const r = str(ref)
    let rel = this.byId.get(collection + "\0" + r)
    if (rel === undefined && k.folder) rel = this.byId.get(collection + "\0" + `${k.folder}/${r}`)
    // An id from before it was archived or unarchived (an Undo, an agent's earlier answer).
    if (rel === undefined && r.includes("/")) rel = this.byId.get(collection + "\0" + archiveTwin(r))
    const one = k.file
    if (rel === undefined && one && [one, one.slice(0, -3), k.collection].some((x) => x.toLowerCase() === r.toLowerCase())) {
      // its file where it's expected, else wherever the one file of its type is (Work.md moved into Work/)
      rel = this.entries.get(one)?.kind === k ? one : [...this.entries.values()].find((e) => e.kind === k && e.item !== null)?.rel
    }
    if (rel === undefined) {
      const low = r.toLowerCase()
      for (const e of this.entries.values()) {
        if (e.kind === k && e.item !== null && (stemOf(e.rel).toLowerCase() === low || (k.key && k.key(e.item) === r))) {
          rel = e.rel
          break
        }
      }
    }
    const e = rel !== undefined ? this.entries.get(rel) : undefined
    return e && e.item !== null ? { ...e.item } : null
  }

  /** The existing item with the same key as `item` (for upserts), or null. */
  find(collection: string, item: Item): Item | null {
    const k = this.kind(collection)
    const key = k.key ? k.key(item) : null
    if (key === null || key === undefined) return null
    for (const e of this.entries.values()) if (e.kind === k && e.item !== null && k.key!(e.item) === key) return { ...e.item }
    return null
  }

  // --- writing

  /** Write an item to its file (new, updated or renamed), merged over the old one, as small edits; nothing when nothing
   *  changed. Returns it read back. `archiving`: the caller set `archived` (PUT), so the onArchive hooks place it. */
  async save(collection: string, item: Item, id?: string | null, archiving = false): Promise<Item | null> {
    const k = this.kind(collection)
    const old = id ? this.get(collection, id) : this.find(collection, item)
    if (id && old === null) throw new NotFound(`no ${k.type} '${id}'`)
    let neu: Item = old ? k.merge(old, item) : { ...item }
    delete neu.id
    delete neu.modified
    neu = await k.prepare(neu, old)
    const [owned, body] = rendered(k, neu)
    const existing = old ? this.entries.get(old.id + ".md") ?? null : null
    if (existing !== null && existing.broken) {
      // Writing from the last good read would undo whatever was typed since: fix the file first.
      throw new ConflictError(`${existing.rel} has frontmatter that can't be read; fix it before the app writes to it`)
    }
    // A new file gets what the onCreate hooks add, after the kind's own keys (target() only names a new item's file).
    const text = this.compose(k, existing, old, old ? owned : { ...owned, ...this.creating(this.target(k, neu, null), { type: k.type, ...owned }) }, body)
    const cur = old ? old.id + ".md" : null
    const rel = this.target(k, neu, old, archiving)
    if (text === null && rel === cur) return old // nothing changed
    if (text !== null) writeAtomic(this.abs(rel), text)
    const e = this.read(rel, statOf(this.abs(rel)))
    if (cur !== null && rel !== cur) this.relink([[cur, rel]])
    this.version++
    return e.item !== null ? { ...e.item } : null
  }

  /** After the app wrote `rel` for someone (an edit in the app, a new file): what its kind fills in (ids, dates), saved as
   *  a small edit. `before`: its entry before that write. A fill that fails is the file's problem, not the write's. */
  async fillIn(rel: string, before: Entry | null) {
    const e = this.entries.get(rel), kind = e?.kind
    if (!e || e.item === null || !kind?.fill || e.broken) return
    try {
      const filled = await kind.fill({ ...e.item }, before && before.kind === kind ? before.item : null)
      if (filled) await this.save(kind.collection, filled, e.item.id)
    } catch (ex) {
      const now = this.entries.get(rel)
      if (now) now.problems = [...now.problems, `${kind.plugin ?? "plugin"} couldn't fill in this file: ${(ex as Error).message}`]
      console.error(ex)
    }
  }

  /** The file's new text, or null if unchanged: only the frontmatter keys the save changed are rewritten (the rest keep
   *  their lines; a value cleared keeps its key, empty, as Obsidian does), and the body change is applied as a patch.
   *  A change that can't be applied as a small edit is a conflict, never a rewrite of the whole header or body. */
  private compose(k: Kind, e: Entry | null, old: Item | null, owned: Item, body: string): string | null {
    const full: Item = { type: k.type, ...owned }
    if (e === null) return frontmatter(mergeFm({}, full), body)
    let raw: string
    try {
      raw = readText(this.abs(e.rel))
    } catch (ex) {
      throw new ConflictError(`couldn't read ${e.rel} to change it (${(ex as Error).message}); try again`)
    }
    const m = FM.exec(raw)
    const [baseOwned, baseBody] = rendered(k, old!)
    const changes: Item = {}
    const removals: string[] = []
    for (const [key, v] of Object.entries(owned)) {
      if (norm(v) === norm(baseOwned[key])) continue // the item didn't change it: leave the file's line alone
      if (blank(v)) {
        if (!(key in e.fm) || blank(e.fm[key])) continue // not there, or already empty: as it is
        // (`archived` is the core's flag: unarchiving takes it out)
        if (key === "archived") removals.push(key)
        else changes[key] = v === false ? false : Array.isArray(v) ? [] : null
      } else if (norm(v) !== norm(e.fm[key])) changes[key] = v
    }
    const bodyNew = body.trim() === baseBody.trim() ? e.body : this.patchBody(k, e, baseBody, body)
    const bodyChanged = bodyNew.trim() !== e.body.trim()
    if (!Object.keys(changes).length && !removals.length && !bodyChanged) return null
    const rest = m ? raw.slice(m[0].length) : raw
    let fmText = m ? m[1] ?? "" : ""
    if (Object.keys(changes).length || removals.length) {
      const patched = patchFrontmatter(fmText, e.fm, Object.fromEntries(Object.entries(changes).map(([x, v]) => [x, dates(v)])),
        removals, Object.keys(full), (key, value) => dump({ [key]: value }), loadFm)
      if (patched === null) throw new ConflictError(`${e.rel}'s properties can't be changed line by line; edit them in the file`)
      fmText = patched
    }
    const head = fmText || m ? `---\n${fmText}\n---\n` : ""
    if (!bodyChanged) return head + (m ? rest : rest.trim() ? "\n" + rest : "")
    const lead = m && rest.trim() ? rest.slice(0, rest.length - rest.replace(/^\n+/, "").length) : "\n"
    return bodyNew.trim() ? head + (head ? lead : "") + stripNl(bodyNew) + "\n" : head
  }

  /** The body with the item's change applied as a patch; a conflict when it can't apply, or wouldn't read back as the
   *  same item. Blocks stay: the patch goes around them. */
  private patchBody(k: Kind, e: Entry, baseBody: string, neu: string) {
    const conflict = () => new ConflictError(`${e.rel} changed where this edit goes; reload it and try again`)
    const merged = merge3(stripNl(baseBody), stripNl(neu), stripNl(e.body), true)
    if (merged === null) throw conflict()
    const stem = stemOf(e.rel)
    let ok: boolean
    try {
      ok = same(publicOf(k.parse(e.fm, prose(merged).trim(), stem)[0]), publicOf(k.parse(e.fm, neu.trim(), stem)[0]))
    } catch {
      ok = false
    }
    if (!ok) throw conflict()
    return merged
  }

  /** An item's file: its own, renamed in its folder only if this save changed its name (moved where onArchive says when
   *  archived or unarchived); a new one where its kind's files are, else the default folder; never another item's. */
  private target(k: Kind, item: Item, old: Item | null, archiving = false) {
    const cur = old ? old.id + ".md" : null
    const on = isArchived(item)
    const folder = cur === null ? this.home(k.collection) ?? k.folder ?? ""
      : ((archiving || on !== isArchived(old)) && this.placers.size ? this.placed(cur, on) : null) ?? dirOf(cur)
    let want = k.filename(item, { folder, old }) + ".md"
    if (cur === want) return cur
    if (cur !== null) {
      // A save that didn't change what names it (its title) keeps the file's name, however the file was named.
      const here = dirOf(cur)
      if (k.filename(item, { folder: here, old }) === k.filename(old!, { folder: here, old })) {
        if (folder === here) return cur
        want = joinPath(folder, cur.slice(here ? here.length + 1 : 0))
      }
    }
    let rel = want, n = 1
    while (this.entries.has(rel) || fs.existsSync(this.abs(rel))) {
      if (cur && sameFile(this.abs(rel), this.abs(cur))) break // case-only rename
      rel = `${want.slice(0, -3)} ${n}.md`
      n++
    }
    if (cur && fs.existsSync(this.abs(cur))) {
      fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true })
      fs.renameSync(this.abs(cur), this.abs(rel))
      this.drop(cur)
      this.moved(cur, rel)
    }
    return rel
  }

  /** Move an item's file to .trash. Returns false if there's no such item. */
  delete(collection: string, id: string) {
    const item = this.get(collection, id)
    if (!item) return false
    this.trash(item.id + ".md")
    this.version++
    return true
  }

  trash(rel: string) {
    const to = this.toTrash(rel)
    this.drop(rel)
    this.moved(rel, null, to)
  }

  /** Move a file or folder to .trash, named with the time (" 2", " 3"... when taken); returns where it went. Index untouched. */
  toTrash(rel: string) {
    const ext = fs.statSync(this.abs(rel)).isDirectory() ? "" : path.extname(rel), stem = `.trash/${rel.slice(0, rel.length - ext.length)} ${localStamp()}`
    let to = stem + ext
    for (let n = 2; fs.existsSync(this.abs(to)); n++) to = `${stem} ${n}${ext}`
    fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true })
    fs.renameSync(this.abs(rel), this.abs(to))
    return to
  }

  // --- settings (.vaultite/*.json)

  /** A settings file (.vaultite/<name>.json), or `fallback`. While it's there but unreadable (iCloud holds it while it
   *  uploads) or half-written, it's the text it last read as: never {}, which would show no workspaces, no pins. */
  config(name: string, fallback?: Item): Item {
    if (name.startsWith("plugins/") && name.endsWith("/data")) noteSource("settings", name.slice(8, -5))
    let text = this.settings.get(name)
    if (text === undefined) {
      const file = this.abs(`.vaultite/${name}.json`)
      try {
        const stat = configStat(file)
        text = readText(file)
        // (one that isn't an object, `null` by hand, is unreadable: callers read its keys)
        const d = JSON.parse(text)
        if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("not a JSON object")
        this.lastGood.set(name, { text, stat })
      } catch (e) {
        text = gone(file, e) ? null : this.lastGood.get(name)?.text ?? null
      }
      this.settings.set(name, text)
    }
    return text === null ? fallback ?? {} : JSON.parse(text)
  }

  /** A settings file as on disk, for read-modify-write: null when there's none; ConfigError when it can't be read safely
   *  (mid-write, iCloud-only), which a save would wipe. One iCloud holds unchanged since our own write is that text. */
  readConfig(name: string): Item | null {
    let buf: Buffer
    const file = this.abs(`.vaultite/${name}.json`)
    let stat = ""
    try { stat = configStat(file); buf = fs.readFileSync(file) } catch (e) {
      fetchFromICloud(file, e)
      if (gone(file, e)) return null
      const last = this.lastGood.get(name)
      if (last && stat && last.stat === stat) return JSON.parse(last.text)
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ConfigError(`.vaultite/${name}.json is in iCloud only for now`, true)
      throw new ConfigError(`.vaultite/${name}.json can't be read`, true)
    }
    try {
      const text = buf.toString("utf8"), d = JSON.parse(text)
      if (d && typeof d === "object" && !Array.isArray(d)) { this.lastGood.set(name, { text, stat }); return d }
    } catch { /* below */ }
    throw new ConfigError(`.vaultite/${name}.json isn't a JSON object`, false)
  }

  /** Change some keys of .vaultite/<name>.json on disk now (other keys and their order stay; `null` removes one unless
   *  `nullRemoves` is false). One there that doesn't read (iCloud mid-sync) is refused, never overwritten. */
  patchConfig(name: string, changes: Item, { nullRemoves = true }: { nullRemoves?: boolean } = {}): Item {
    const cur = this.readConfig(name)
    const next: Item = { ...(cur ?? {}) }
    for (const [k, v] of Object.entries(changes)) { if (v === null && nullRemoves) delete next[k]; else if (v !== undefined) next[k] = v }
    if (JSON.stringify(next) !== JSON.stringify(cur ?? {})) this.setConfig(name, next)
    return next
  }

  /** Read a settings file again on its next config(): for a check made before the request's sync (which re-reads
   *  them all), like which plugins hear a request starting. */
  forgetConfig(name: string) {
    this.settings.delete(name)
  }

  /** Remove a settings file (gone already: nothing to do). */
  removeConfig(name: string) {
    fs.rmSync(this.abs(`.vaultite/${name}.json`), { force: true })
    this.settings.delete(name)
    this.lastGood.delete(name)
  }

  setConfig(name: string, data: unknown) {
    const file = this.abs(`.vaultite/${name}.json`), text = JSON.stringify(data, null, 2) + "\n"
    writeAtomic(file, text)
    this.settings.delete(name)
    try { this.lastGood.set(name, { text, stat: configStat(file) }) } catch { this.lastGood.delete(name) }
  }

  problemList() {
    return [...this.entries].sort(([a], [b]) => cmp(a, b))
      .flatMap(([r, e]) => e.problems.map((m) => ({ file: r, problem: m })))
      .concat(this.downloading.map((r) => ({ file: r, problem: "iCloud is still downloading it" })))
  }
}

/** Adds `x` to a set of hooks; returns the function that removes it. */
function added<T>(hooks: Set<T>, x: T) {
  hooks.add(x)
  return () => { hooks.delete(x) }
}

function isDir(p: string) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
