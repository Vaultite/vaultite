import { AsyncLocalStorage } from "node:async_hooks"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { setImmediate as turn } from "node:timers/promises"
import { withKindBlocks } from "./blocks.ts"
import type { Manifest } from "./contracts/manifest.ts"
import type { KeptText, StartTexts } from "./fmcache.ts"
import { merge3, patchFrontmatter, same } from "./textedit.ts"
import { dates, dump, YAMLError } from "./yaml.ts"
import { tagsOf } from "./sections.ts"
import { bodyLine, FM, frontmatter, loadFm, parseText, prose, stripNl } from "./frontmatter.ts"
import { ARCHIVE_DIR, archiveTwin, effectiveType, excluder, homeFolder, inArchive, isArchived, isHiddenPath } from "./fileprops.ts"
import { kindOf } from "./filetypes.ts"
import { type LinkFile, linkResolver, mapLinks, relativePath, type Resolve, resolvePath } from "./links.ts"
import { errorContext } from "./serverlog.ts"
import { noteRead, noteSource } from "./sources.ts"
import { codeOf, errnoOf, messageOf, strings } from "./values.ts"
import { guard, setGate, watching, written } from "./writegate.ts"
import { logger } from "./log.ts"

const log = logger("vault")
export { extract, hasTag, tagName, tagsOf } from "./sections.ts"
export { ARCHIVE_DIR, archiveTwin, effectiveType, inArchive, isArchived, isHiddenPath, unarchived } from "./fileprops.ts"
export { bodyLine, FM, frontmatter, keepBlocks, loadFm, parseText, prose, renameProperty, renameTagText, setPropertyText } from "./frontmatter.ts"

export type Item = Record<string, any>


/** A write the vault refuses because the file isn't in a state it can safely change (the API answers 409). */
export class ConflictError extends Error {}
/** Something that isn't there (the API answers 404). */
export class NotFound extends Error {}
/** A settings file that can't be read safely for a read-modify-write: `busy` (mid-sync, try again: 503), else broken (409). */
export class ConfigError extends Error {
  busy: boolean
  status: number
  constructor(message: string, busy: boolean) { super(`${message}: not overwriting it (fix it, or try again)`); this.busy = busy; this.status = busy ? 503 : 409 }
}

const pad = (n: number) => String(n).padStart(2, "0")

/** The vault's settings folder. */
export const SETTINGS_DIR = ".vaultite"

/** "YYYY-MM-DD HH:MM:SS" in this machine's time (the vault's times are the user's local ones, as they read them). */
export function stamp(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const nowStamp = () => stamp(new Date())

/** Local "YYYY-MM-DD HHMMSS", for names of trashed files. */
export function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** A title as an id's words, accents off their letters: "Café: idea #2" -> "cafe-idea-2" (notes' and logs' ids). */
export function slug(s: unknown) {
  return str(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Names Windows keeps for devices, with any extension (CON, nul.md, COM1). */
export const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i

/** File name for a title: other Markdown apps forbid * " \ / < > : | ? # ^ [ ] in names, and Windows (where a synced
 *  vault may go) a name ending in a dot or one of its device names. */
export function safeName(title: unknown) {
  const name = str(title).replaceAll(":", " -").replace(/[*"\\/<>|?#^[\]\x00-\x1f]/g, " ").replace(/\s+/g, " ").replace(/[\s.]+$/, "").trim()
  return !name ? "Untitled" : DEVICE_NAME.test(name) ? `${name}_` : name
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

let tmpN = 0
const HELD_LONG = 30_000
const VOUCH = 10_000

/** A new file, whole or not at all (a full disk or a crash mid-write leaves no cut-off file to be refused as "already
 *  exists"); false if one came at `p` meanwhile. Renamed, not hard-linked: iCloud Drive's folders may not take links. */
export function writeNew(p: string, data: string | Buffer): boolean {
  guard(p)
  const told = typeof data === "string" ? watching(p) : null
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${++tmpN}`
  try {
    fs.writeFileSync(tmp, data, { flag: "wx" })
    // (iCloud's placeholder of it counts: another Mac's copy, not here yet; a second would be iCloud's "Name 2")
    if (fs.existsSync(p) || !gone(p, { code: "ENOENT" })) { fs.rmSync(tmp, { force: true }); return false }
    renameFile(tmp, p)
    told?.(null, data as string)
    written(p)
    return true
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** Text written as writeAtomic does, keeping the Windows line endings (\r\n) a file there has: text is read as \n. */
export function writeText(p: string, text: string) {
  let crlf = false
  try {
    const fd = fs.openSync(p, "r"), buf = Buffer.alloc(8192)
    try { crlf = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).includes("\r\n") } finally { fs.closeSync(fd) }
  } catch { /* a new file */ }
  writeAtomic(p, crlf ? text.replace(/\r?\n/g, "\r\n") : text)
}

/** Windows won't replace or move a file another process, or this one's own reads under way, has open (a reader, the
 *  search indexer, antivirus): EPERM, EACCES or EBUSY until it lets go. */
const held = (e: unknown) => process.platform === "win32" && ["EPERM", "EACCES", "EBUSY"].includes(codeOf(e) ?? "")

/** A folder removed with all in it. On Windows, Electron's Node (the app's) neither removes a read-only file (git's
 *  objects: a clone, a folder with a repository in it) nor waits for a watcher or antivirus to let go of one. */
export function removeTree(dir: string) {
  for (let wait = 10; ; wait *= 2) {
    try { return fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {
      const code = codeOf(e) ?? ""
      if (process.platform !== "win32" || wait > 320 || !["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(code)) throw e
      if (code === "EPERM" || code === "EACCES") {
        try { for (const f of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) if (!f.isDirectory()) fs.chmodSync(path.join(f.parentPath, f.name), 0o666) } catch { /* going */ }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait)
    }
  }
}

/** fs.renameSync, retried a moment on Windows while another process holds the file; one this process reads can't end
 *  while it waits, so then, to a name that's free, it's copied and the original removed (its readers share deleting). */
export function renameFile(from: string, to: string) {
  for (let wait = 5; ; wait *= 2) {
    try { return fs.renameSync(from, to) } catch (e) {
      if (!held(e)) throw e
      // (a folder there, or a read-only file, won't let go)
      const st = fs.statSync(to, { throwIfNoEntry: false })
      if (st && (st.isDirectory() || !(st.mode & 0o200))) throw e
      if (wait <= 160) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait); continue }
      if (st) throw e
      fs.cpSync(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false })
      fs.rmSync(from, { recursive: true, force: true })
      return
    }
  }
}

/** The temporary copy `tmp` in place of `p`: renamed, or on Windows, while `p` is held open, written over it at once
 *  (its readers share writing, not replacing; waiting would hold this process's own). */
function replace(tmp: string, p: string, data: string | Buffer) {
  try { fs.renameSync(tmp, p) } catch (e) {
    const st = held(e) ? fs.statSync(p, { throwIfNoEntry: false }) : null
    if (!st?.isFile() || !(st.mode & 0o200)) throw e
    fs.writeFileSync(p, data)
    fs.rmSync(tmp, { force: true })
  }
}

/** A file replaced whole or not at all; `mode` is the new file's (0o600: this machine's user only). */
export function writeAtomic(p: string, text: string | Buffer, { mode }: { mode?: number } = {}) {
  guard(p)
  const told = typeof text === "string" ? watching(p) : null
  let before: string | null = null
  if (told) try { before = fs.readFileSync(p, "utf8") } catch { /* a new file */ }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${process.pid}-${++tmpN}`
  try {
    fs.writeFileSync(tmp, text, mode === undefined ? "utf8" : { encoding: "utf8", mode })
    replace(tmp, p, text)
  } catch (e) {
    // (a write macOS refused, EPERM from a server whose app was replaced under it, leaves no copy behind in the vault)
    fs.rmSync(tmp, { force: true })
    throw e
  }
  told?.(before, text as string)
  written(p)
}

function configStat(file: string) {
  const st = fs.statSync(file, { bigint: true })
  return `${st.mtimeNs}:${st.size}`
}

function gone(file: string, e: unknown) {
  return codeOf(e) === "ENOENT" && !fs.existsSync(path.join(path.dirname(file), `.${path.basename(file)}.icloud`))
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** A text file, line endings as \n. Throws ENOENT, a TypeError when it isn't UTF-8, or a read iCloud hasn't given yet
 *  (notHereYet: the API answers 503): a placeholder (asked for, there at a later sync) or one readSoon waits on. */
export function readText(p: string) {
  return textOf(readBytes(p))
}
const textOf = (buf: Buffer) => decoder.decode(buf).replace(/\r\n?/g, "\n")

/** A file's bytes, read now; a placeholder iCloud left is asked for and throws as readText says. */
export function readBytes(p: string): Buffer {
  if (Date.now() - (reading.get(p)?.since ?? Infinity) >= SLOW && !onDisk(p)) throw stillDownloading(p)
  try { const b = fs.readFileSync(p); if (fetching.size) fetching.delete(p); return b } catch (e) {
    if (!placeholder(e)) throw e
    fetchFromICloud(p, e)
    throw stillDownloading(p, e)
  }
}

function onDisk(p: string) {
  const st = fs.statSync(p, { throwIfNoEntry: false })
  return !!st?.isFile() && !evicted(p, st)
}

/** A read iCloud hasn't given yet, as notHereYet knows it (errno 11, EDEADLK). */
const stillDownloading = (p: string, cause?: unknown) =>
  Object.assign(new Error(`iCloud is still downloading ${path.basename(p)}; try again in a moment`), { code: "EDEADLK", errno: -11, cause })

/** How long a sync waits for a file before going on without it; a read going on SLOW ms is held (iCloud). */
export const READ_WAIT = 2000
const SLOW = 1000
const ARRIVAL = 60_000
const reading = new Map<string, { since: number; data: Promise<Buffer> }>()

/** A file's bytes off the main thread (a placeholder iCloud left: once down), so iCloud never holds the server; null
 *  after `wait` ms, or at once while an earlier read of it is held (no second thread on it), unless `join`ing it. */
export function readSoon(p: string, wait = READ_WAIT, { join = false } = {}): Promise<Buffer | null> {
  const was = reading.get(p)
  let data: Promise<Buffer>
  if (was && Date.now() - was.since >= SLOW) {
    if (!join) return Promise.resolve(null)
    data = was.data
  } else {
    data = arrived(p).finally(() => { if (reading.get(p) === r) reading.delete(p) })
    data.catch(() => {})
    const r = { since: Date.now(), data }
    reading.set(p, r)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((ok) => { timer = setTimeout(ok, wait, null) })
  return Promise.race([data, late]).finally(() => clearTimeout(timer))
}

async function arrived(p: string): Promise<Buffer> {
  for (let t0 = Date.now(), pause = 250; ; pause = Math.min(pause * 2, 2000)) {
    try { const b = await fs.promises.readFile(p); fetching.delete(p); return b } catch (e) {
      if (!placeholder(e) || Date.now() - t0 > ARRIVAL) throw e
      fetchFromICloud(p, e)
      await new Promise((ok) => setTimeout(ok, pause))
    }
  }
}

const readEnd = (p: string) => reading.get(p)?.data.then(() => {}, () => {}) ?? null

/** Files read for over `after` ms and still being read (iCloud downloading them), absolute paths. */
export function slowReads(after = SLOW) {
  const now = Date.now()
  return [...reading].filter(([, r]) => now - r.since >= after).map(([p]) => p).sort()
}

/** iCloud Drive (macOS): a file it evicted (Optimize Mac Storage) or another device changed can be a placeholder a
 *  read can't bring down (errno 11, EDEADLK), asked for with `brctl download`. Tests stand in for it. */
export const iCloud = {
  on: process.platform === "darwin",
  /** Whether a stat is of a placeholder: a size, nothing on disk. Cheap: from a stat the scan takes anyway. */
  evicted: (_abs: string, st: { blocks: number | bigint; size: number | bigint }) => Number(st.blocks) === 0 && Number(st.size) > 0,
  download(p: string, done: (err: Error | null) => void) { execFile("/usr/bin/brctl", ["download", p], { timeout: 60_000 }, done) },
}
const placeholder = (e: unknown) => iCloud.on && Math.abs(errnoOf(e) ?? 0) === 11
const evicted = (abs: string, st: fs.BigIntStats | fs.Stats) => iCloud.on && iCloud.evicted(abs, st)

const fetching = new Map<string, number>()
export function fetchFromICloud(p: string, e: unknown) {
  if (!placeholder(e)) return
  const now = Date.now()
  if (now - (fetching.get(p) ?? 0) < 60_000) return
  fetching.set(p, now)
  iCloud.download(p, (err) => {
    if (err && fs.existsSync(p)) log.warn(`couldn't ask iCloud for ${p}: ${err.message}`)
  })
}

/** Keep a vault in iCloud Drive downloaded on this Mac (Finder's Keep Downloaded, macOS 15), so iCloud stops evicting
 *  the files the server reads. Once per vault (`done` lists those): turned off in Finder, it stays off. */
export function keepDownloaded(vault: string, done: string) {
  if (!iCloud.on) return
  let real: string
  try { real = fs.realpathSync(vault) } catch { return }
  if (!real.startsWith(path.join(os.homedir(), "Library", "Mobile Documents") + path.sep)) return
  let kept: string[] = []
  try { const d = JSON.parse(fs.readFileSync(done, "utf8")).keptDownloaded; if (Array.isArray(d)) kept = d } catch { /* none yet */ }
  if (kept.includes(real)) return
  const mark = () => {
    try { writeAtomic(done, JSON.stringify({ keptDownloaded: [...kept, real] }, null, 2) + "\n") } catch (e) { log.warn(`couldn't note it's kept downloaded: ${messageOf(e)}`) }
  }
  // (the xattr Finder's Keep Downloaded sets; `xattr -d` with that name, or Finder, undoes it)
  execFile("/usr/bin/xattr", ["-p", PINNED, real], (no) => {
    if (!no) return mark()
    execFile("/usr/bin/xattr", ["-w", PINNED, "1", real], (err) => {
      if (err) return log.warn(`couldn't keep ${real} downloaded: ${err.message}`)
      log.info(`iCloud keeps ${real} downloaded on this Mac (Keep Downloaded; Finder turns it off)`)
      mark()
    })
  })
}
const PINNED = "com.apple.fileprovider.pinned#PX"

/** A file as a plugin's reader of its format gets it (the services `text:<ext>`): its text, or for a file that isn't
 *  text (a workbook, a Word document, a book: core/filetypes.ts's "binary") its bytes. */
export function formatInput(abs: string, rel: string): string | Buffer {
  return kindOf(rel) === "binary" ? readBytes(abs) : readText(abs)
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

const norm = (v: unknown) => (blank(v) ? null : stable(v))

function withKeys(text: string, m: RegExpExecArray | null, fm: Item, set: Item): string {
  if (!Object.keys(set).length) return text
  if (!m) return `${frontmatter(set)}${text && !text.startsWith("\n") ? "\n" : ""}${text}`
  const inner = patchFrontmatter(m[1] ?? "", fm, Object.fromEntries(Object.entries(set).map(([k, v]) => [k, dates(v)])), [],
    [...Object.keys(fm), ...Object.keys(set).filter((k) => !(k in fm))], (key, value) => dump({ [key]: value }), loadFm)
  return inner === null ? text : `---\n${inner}\n---\n${text.slice(m[0].length)}`
}

const isEmpty = (y: unknown) => y !== null && typeof y === "object" && !Array.isArray(y) && !Object.keys(y).length

const publics = new WeakMap<object, unknown>()

/** An item without its private `_` keys and empty records. Copies only what changes, since /api/state is megabytes
 *  of items that have nothing private; a frozen one's is kept. */
export function publicOf(x: unknown): unknown {
  if (x === null || typeof x !== "object") return x
  if (Object.isFrozen(x)) {
    let y = publics.get(x)
    if (y === undefined) publics.set(x, y = Object.freeze(publicCopy(x)))
    return y
  }
  return publicCopy(x)
}

function publicCopy(x: object): unknown {
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

/** Who asked for the write being made: X-Vaultite-Client ("app/desktop", "cli", "mcp"; null: curl, a script), -Agent
 *  (the CLI's coding agent), and its app terminal, session, model and effort (-Terminal, -Session, -Model, -Effort). */
export type Writer = { client: string | null; agent: string | null; terminal?: string | null; session?: string | null; model?: string | null; effort?: string | null }
/** Set by the API around each request that came over HTTP (core/app.ts), read by the hooks that run on its writes. */
export const requestWriter = new AsyncLocalStorage<Writer>()
/** onCreate's hooks (Vault.onCreate): the keys to add to a new file. `writer` is null outside a request over HTTP. */
export type CreateHook = (path: string, fm: Item, writer: Writer | null) => Item | void
/** A Markdown file's text as onSave's hooks see it: its frontmatter, read, and the rest after it. */
export type NoteText = { fm: Item; body: string }
/** onSave's hooks (Vault.onSave): the keys to set in a file the app saves over its older text (`was`). */
export type SaveHook = (path: string, now: NoteText, was: NoteText, writer: Writer | null) => Item | void
/** A new file as onCreateFile's hooks see it, read-only: its size, and its first or last `n` bytes, read only when asked
 *  (an upload can be any size). */
export type NewFile = { size: number; head: (n: number) => Buffer; tail: (n: number) => Buffer }
/** onCreateFile's hooks (Vault.onCreateFile): told of a new file that isn't Markdown; they never change its bytes. */
export type FileCreateHook = (path: string, file: NewFile, writer: Writer | null) => void
/** onWrite's hooks (Vault.onWrite): told after a request wrote a Markdown file, its text before (null: new) and after. */
export type WriteHook = (path: string, before: string | null, after: string, writer: Writer) => void

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

type Awaitable<T> = T | Promise<T>

export type KindSpec = {
  /** the frontmatter `type:` (person, note, log...) */
  type: string
  /** its name in /api/state and the API (people, notes, logs...) */
  collection: string
  /** its usual folder ("People"; "Logs" holds subfolders when recursive is true): only where its first file goes
   *  (Vault.home). Its files are the ones whose `type` is its, wherever they are (Vault.kindFor). */
  folder?: string
  /** what settings call its files ("Daily notes"; else its collection's name) */
  label?: string
  /** files it claims without a `type` (a daily note by its name in its folder): asked at each sync, so keep it cheap */
  owns?: (rel: string) => boolean
  /** or a single file ("ME.md", in any case; a function when a setting names it), its kind with or without a `type`;
   *  elsewhere, the one file of its type */
  file?: string | (() => string)
  recursive?: boolean
  titleKey?: string
  /** file -> [item, problems] (the vault adds `id` and `modified`, a local stamp) */
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
  /** its files' blocks (["person"]: ```block-person), or a function of its frontmatter: written on top of a new file,
   *  and by `vau type --apply` and `vau migrate`; only what a file places is drawn. */
  blocks?: string[] | ((fm: Item) => string[])
  /** `## ` headings its files' view draws instead of their text (["timeline"]): only in its files, never in any note */
  sections?: string[]
  /** frontmatter keys the app keeps as local times (stamp: "YYYY-MM-DD HH:MM:SS"): shown, not edited by hand */
  stamps?: string[]
  dropWhenCleared?: string[]
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

type Stat = { ns: bigint; size: number; born: number }
const CACHES = new Set(["node_modules", "__pycache__"])
const unscanned = (rel: string) => rel.split("/").some((n, i, all) => (n.startsWith(".") && (n !== ARCHIVE_DIR || i === all.length - 1)) ||
  n.endsWith(".icloud") || n.includes(".tmp-") || (i < all.length - 1 && CACHES.has(n)))
const sameStat = (a: Stat, b: Stat) => a.ns === b.ns && a.size === b.size
const NOT_SETTINGS = new Set([".vaultite/artifacts", ".vaultite/cache", ".vaultite/generated"])
const unseen = (rel: string) => NOT_SETTINGS.has(rel.split("/").slice(0, 2).join("/")) ||
  (unscanned(rel) && !/^\.(vaultite|obsidian)(\/|$)/.test(rel) && !rel.endsWith(".icloud"))

/** What a [[link]] finds a note by, past its path: its aliases, and whether it's archived (Vault.linkNames). */
export function linkKey(e: Entry) {
  const a = e.fm.aliases
  return `${(Array.isArray(a) ? a : a ? [a] : []).map(String).join("\u0001")}${e.archived ? "\u0002" : ""}`
}

export class Entry {
  rel: string
  stat: Stat
  kind: Kind | null
  fm: Item = {}
  body = ""
  /** The file's text as read (line ends as \n): fm and body come from it, and body is a slice of it, so it costs no memory. */
  text = ""
  /** The file's line (0-based) the body starts on, past the frontmatter and blank lines. */
  bodyLine = 0
  item: Item | null = null
  problems: string[] = []
  broken = false

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

function named(k: Kind, item: Item, rel: string, owned: Item): Item {
  const title = item[k.titleKey]
  if (k.spec.filename || typeof title !== "string" || !title.trim() || stemOf(rel) === title) return owned
  const had = Array.isArray(owned.aliases) ? owned.aliases.map(String) : []
  return had.includes(title) ? owned : { ...owned, aliases: [title, ...had] }
}

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

function rendered(k: Kind, item: Item): [Item, string] {
  const [owned, body] = k.render(item)
  return [{ ...owned, archived: isArchived(item) ? true : null }, body]
}

/** In-memory index of the vault's files. One per server; requests take turns through `lock` (see server.ts). */
export class Vault {
  path: string
  kinds: Kind[] = []
  entries = new Map<string, Entry>()
  byId = new Map<string, string>()
  others = new Map<string, Stat>()
  folders: string[] = []
  private missing = new Map<string, number>()
  version = 0
  settingsVersion = 0
  private settingsSeen = ""
  private ordered = new Map<Kind, readonly Item[]>()
  private settings = new Map<string, string | null>()
  private lastGood = new Map<string, { text: string; stat: string }>()
  private queue: Promise<unknown> = Promise.resolve()
  private next: Promise<boolean> | null = null
  private hooks = new Set<(vault: Vault) => void>()
  private types: Map<string, Kind> | null = null
  private plainDirs: string[] = []
  plain: () => string[] = () => []
  defaults: () => Record<string, Item> = () => ({})
  private seeds: { version: number; all: Record<string, Item> } | null = null
  pluginList: { id: string; manifest: Manifest; tier?: string }[] = []
  private off: { conf: string | null | undefined; list: unknown; off: Set<string> } | null = null
  startTexts: StartTexts | null = null
  downloading: string[] = []
  private evicted: string[] = []
  private arrivals = new Set<(rel: string) => void>()
  private writes = new Set<(rel: string) => void>()

  mayWrite: (plugin: string, rel: string) => boolean = () => false
  writerHere = true
  writeRefused: (plugin: string, rel: string) => void = (plugin, rel) => log.error(`write refused: ${plugin} may not write ${rel} on its own`)

  constructor(p: string) {
    this.path = p
    setGate(p, { may: (plugin, rel) => this.mayWrite(plugin, rel), refused: (plugin, rel) => this.writeRefused(plugin, rel), watch: (rel) => this.watch(rel),
      wrote: (rel) => { for (const fn of this.writes) fn(rel) } })
  }

  lock<T>(fn: () => Promise<T> | T): Promise<T> {
    const watched = async () => {
      const t0 = Date.now(), by = errorContext.getStore() ?? "the server's own work"
      const dog = setInterval(() => log.error(`held ${Math.round((Date.now() - t0) / 1000)} s by ${by}`), HELD_LONG)
      dog.unref()
      try { return await fn() } finally { clearInterval(dog) }
    }
    const run = this.queue.then(watched, watched)
    this.queue = run.catch(() => {})
    return run
  }

  private watched = false
  private stale = true
  private walked = 0
  private linkedOut = false

  watching(on: boolean, untold?: () => boolean) {
    this.watched = on
    this.untold = on ? untold ?? null : null
    this.stale = true
    this.heardCount++
  }
  private untold: (() => boolean) | null = null
  private async drain() {
    await turn(); await turn()
    for (let waited = 0; this.untold?.() && waited < 1000; waited += 20) await new Promise((r) => setTimeout(r, 20))
    return !this.next && this.vouched() && !!this.untold && !this.untold()
  }
  heardCount = 0

  heard(rel: string | null) {
    if (rel && unseen(rel)) return
    if (rel && this.indexed(rel)) return
    this.stale = true
    this.heardCount++
  }

  async hear(rels: string[] | null): Promise<boolean> {
    const told = rels?.filter((r) => !unseen(r) && !this.indexed(r))
    if (told && !told.length) return false
    if (!told || this.next || !this.vouched() || told.some((r) => !this.entries.has(r) && !this.others.has(r))) {
      for (const r of rels ?? [null]) this.heard(r)
      return this.synced({ trusting: true })
    }
    this.heardCount++
    return this.lock(async () => {
      if (!this.vouched()) return this.sync()
      const stats = told.map((r) => fs.statSync(this.abs(r), { bigint: true, throwIfNoEntry: false }))
      if (this.walks(told, stats)) return this.sync()
      const md = told.filter((r, i) => stats[i] && r.endsWith(".md"))
      const { texts, late } = await this.readAll(md)
      if (late.length || texts.size < md.length) return this.sync()
      return this.take(told, stats, texts)
    })
  }

  private letGo = new Set<string>()
  async caughtUp() {
    await turn(); await turn()
    return this.vouched() && !!this.untold && !this.untold()
  }

  told(rels: Iterable<string>) {
    for (const r of rels) if (!unseen(r) && !this.indexed(r)) return false
    return true
  }

  private indexed(rel: string) {
    const was = this.entries.get(rel)?.stat ?? this.others.get(rel)
    if (this.entries.get(rel)?.broken) return false
    try {
      const st = fs.statSync(this.abs(rel), { bigint: true, throwIfNoEntry: false })
      if (!was) return !st && this.letGo.has(rel)
      return !!st && st.isFile() && sameStat(was, statFrom(st))
    } catch {
      return false
    }
  }

  async reread(rels: string[]): Promise<boolean> {
    if (!this.vouched()) return this.sync()
    const stats = rels.map((rel) => fs.statSync(this.abs(rel), { bigint: true, throwIfNoEntry: false }))
    if (this.walks(rels, stats)) return this.sync()
    return this.take(rels, stats)
  }

  private walks(rels: string[], stats: (fs.BigIntStats | undefined)[]) {
    return rels.some((rel, i) => unscanned(rel) || (stats[i] ? !stats[i]!.isFile() || evicted(this.abs(rel), stats[i]!) ||
      (rel.includes("/") && !this.folders.includes(rel.slice(0, rel.lastIndexOf("/")))) : this.folders.includes(rel)))
  }

  private take(rels: string[], stats: (fs.BigIntStats | undefined)[], texts?: Map<string, string | Error>) {
    let changed = false
    for (const [i, rel] of rels.entries()) {
      const st = stats[i] ? statFrom(stats[i]!) : null, e = this.entries.get(rel), other = this.others.get(rel)
      if (!st) {
        if (e) this.drop(rel)
        else if (other) { this.others.delete(rel); this.letGo.add(rel); this.version++ }
        changed ||= !!(e || other)
      } else if (!rel.endsWith(".md")) {
        if (!other || !sameStat(other, st)) { this.others.set(rel, st); this.version++; changed = true }
      } else if (!e || !sameStat(e.stat, st) || e.broken) {
        this.read(rel, st, texts?.get(rel))
        changed = true
      }
    }
    if (changed) this.version++
    for (const fn of this.hooks) {
      try { fn(this) } catch (e) { log.error("a plugin's after-sync hook failed", e) }
    }
    return changed
  }

  private rewalk: ReturnType<typeof setTimeout> | null = null
  vouched(within = VOUCH) {
    return this.watched && !this.stale && !this.linkedOut && !this.downloading.length && !this.evicted.length &&
      !this.missing.size && Date.now() - this.walked < within
  }

  synced({ trusting = false, drained = false } = {}): Promise<boolean> {
    if (trusting && !this.next && this.vouched()) return Promise.resolve(false)
    if (drained && this.untold && !this.next) return this.drain().then((ok) => (ok ? false : this.synced()))
    if (trusting && !this.next && this.vouched(Infinity)) {
      this.rewalk ??= setTimeout(() => { this.rewalk = null; this.synced().catch((e) => log.error("the walk after a trusted read failed", e)) }, 100)
      return Promise.resolve(false)
    }
    return this.next ??= turn().then(() => this.lock(() => {
      this.next = null
      return this.sync()
    }))
  }

  abs(rel: string) {
    noteRead(rel)
    return path.join(this.path, rel)
  }

  afterSync(fn: (vault: Vault) => void) {
    return added(this.hooks, fn)
  }

  onArrive(fn: (rel: string) => void) {
    return added(this.arrivals, fn)
  }

  onWrote(fn: (rel: string) => void) {
    return added(this.writes, fn)
  }

  private async readAll(rels: string[]) {
    const texts = new Map<string, string | Error>(), late: string[] = [], was = new Set(this.downloading)
    const deadline = Date.now() + READ_WAIT
    let at = 0
    const next = async () => {
      for (let rel = rels[at++]; rel !== undefined; rel = rels[at++]) {
        const abs = path.join(this.path, rel)
        try {
          const data = await readSoon(abs, Math.max(deadline - Date.now(), 200))
          if (data !== null) { texts.set(rel, textOf(data)); continue }
          late.push(rel)
          if (!was.has(rel)) readEnd(abs)?.then(() => { for (const fn of this.arrivals) fn(rel) })
        } catch (e) {
          if (placeholder(e)) late.push(rel)
          else texts.set(rel, e instanceof Error ? e : new Error(messageOf(e)))
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(64, rels.length) }, next))
    return { texts, late: late.sort() }
  }

  async fetchSettings() {
    this.evicted = []
    this.settingsStats()
    await this.fetchEvicted(this.evicted)
  }

  private async fetchEvicted(rels: string[]) {
    const late: string[] = [], was = new Set(this.downloading)
    await Promise.all(rels.map(async (rel) => {
      const abs = path.join(this.path, rel)
      if (await readSoon(abs).catch(() => true) !== null) return
      late.push(rel)
      if (!was.has(rel)) readEnd(abs)?.then(() => { for (const fn of this.arrivals) fn(rel) })
    }))
    return late
  }

  private movers = new Set<MoveHook>()
  onMove(fn: MoveHook) {
    return added(this.movers, fn)
  }
  moved(from: string, to: string | null, trashed?: string) {
    for (const fn of this.movers) {
      try { fn(from, to, trashed) } catch (e) { log.error("a plugin's move hook failed", e) }
    }
  }

  linkFiles(names?: Set<string>, also?: Map<string, string>): LinkFile[] {
    const out: LinkFile[] = []
    const named = (rel: string) => {
      const n = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase(), dot = n.lastIndexOf(".")
      return names!.has(n) || (dot > 0 && names!.has(n.slice(0, dot))) || also!.has(rel)
    }
    for (const [rel, e] of this.entries) {
      const a = e.fm.aliases, aliases = (Array.isArray(a) ? a : a ? [a] : []).map(String)
      if (!names || named(rel) || aliases.some((x) => names.has(x.trim().toLowerCase()))) out.push({ path: rel, aliases, archived: e.archived })
    }
    for (const rel of this.others.keys()) if (!names || named(rel)) out.push({ path: rel })
    return out
  }
  private links: { version: number; resolve: Resolve<string>; names: Map<string, string> } | null = null
  resolveLink(target: string, from?: string): string | null {
    const was = this.links
    if (was?.version !== this.version) {
      if (was && this.sameLinkNames(was.names)) was.version = this.version
      else this.links = { version: this.version, resolve: linkResolver(this.linkFiles()), names: this.linkNames() }
    }
    return this.links!.resolve(target, from)
  }
  linkNames(): Map<string, string> {
    const out = new Map<string, string>()
    for (const [rel, e] of this.entries) out.set(rel, linkKey(e))
    for (const rel of this.others.keys()) out.set(rel, "")
    return out
  }
  private sameLinkNames(names: Map<string, string>) {
    if (names.size !== this.entries.size + this.others.size) return false
    for (const [rel, e] of this.entries) if (names.get(rel) !== linkKey(e)) return false
    for (const rel of this.others.keys()) if (names.get(rel) !== "") return false
    return true
  }

  relink(moves: [string, string][]): string[] {
    if (!moves.length) return []
    const fwd = new Map(moves), back = new Map(moves.map(([f, t]) => [t, f]))
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1)
    const names = [...new Set(moves.flatMap(([from, to]) => {
      const a = this.entries.get(to)?.fm.aliases, own = [base(from), base(from).replace(/\.[^.]+$/, ""), ...(Array.isArray(a) ? a : a ? [a] : []).map(String)]
      return own.flatMap((n) => [n, encodeURI(n), encodeURIComponent(n)]).map((n) => n.trim().toLowerCase()).filter(Boolean)
    }))]
    const now = this.linkFiles(new Set([...names, ...moves.flatMap(([, to]) => [base(to), base(to).replace(/\.[^.]+$/, "")].map((n) => n.toLowerCase()))]), back)
    const before = linkResolver(now.map((f) => (back.has(f.path) ? { ...f, path: back.get(f.path)! } : f)))
    const after = linkResolver(now, { twins: false })
    const is = new Set([...this.entries.keys(), ...this.others.keys()]), was = new Set([...is].map((p) => back.get(p) ?? p))
    const wiki = (t: string, was: string, now: string) => {
      const old = before(t, was), np = old === null ? undefined : fwd.get(old)
      if (np === undefined || after(t, now) === np) return null
      const name = /\.md$/i.test(np) && !/\.md$/i.test(t) ? np.slice(0, -3) : np
      return !t.includes("/") && after(base(name), now) === np ? base(name) : name
    }
    const find = (dir: string, h: string, files: Set<string>) => {
      for (const p of h.startsWith("/") ? [h.slice(1)] : [resolvePath(dir, h), resolvePath("", h)]) {
        if (p !== null && files.has(p)) return { p, md: false, relative: !h.startsWith("/") && p === resolvePath(dir, h) }
        if (p !== null && files.has(`${p}.md`)) return { p: `${p}.md`, md: true, relative: !h.startsWith("/") && p === resolvePath(dir, h) }
      }
      return null
    }
    // A Markdown link by the file's name alone (Obsidian's shortest path: `[a](Note.md)` for Sub/Note.md), as the index reads it.
    const named = (h: string, was: string, now: string) => {
      if (/^\.\.?\//.test(h) || h.startsWith("/")) return null
      const old = before(h, was), np = old === null ? undefined : fwd.get(old)
      if (np === undefined || after(h, now) === np) return null
      const out = after(base(np), now) === np ? base(np) : np
      return /\.md$/i.test(np) && !/\.md$/i.test(h) ? out.slice(0, -3) : out
    }
    const mapper = (self: string, rel: string) => (t: string, md: boolean) => {
      if (!md) return wiki(t, self, rel)
      const old = find(dirOf(self), t, was)
      if (!old) return named(t, self, rel)
      const np = fwd.get(old.p) ?? old.p
      if (find(dirOf(rel), t, is)?.p === np) return null
      const out = old.md ? np.slice(0, -3) : np
      return t.startsWith("/") ? `/${out}` : old.relative ? relativePath(dirOf(rel), out) : out
    }
    const mentions = (text: string) => { const low = text.toLowerCase(); return names.some((n) => low.includes(n)) }
    const changed: string[] = []
    for (const [rel, e] of [...this.entries]) {
      const self = back.get(rel) ?? rel
      const fm = JSON.stringify(e.fm)
      if (!e.body.includes("[[") && !e.body.includes("](") && !fm.includes("[[") && !fm.includes("](")) continue
      if (self === rel && !e.broken && !mentions(e.body) && !mentions(fm)) continue
      const map = mapper(self, rel)
      // (`key: [[X]]` unquoted reads as a list in a list, not text: such a file is read)
      const fmStrings = stringsIn(e.fm)
      if (!e.broken && fmStrings !== null && mapLinks(e.body, map) === e.body && fmStrings.every((v) => mapLinks(v, map) === v)) continue
      let text: string
      try { text = readText(this.abs(rel)) } catch { continue }
      const neu = mapLinks(text, map)
      if (neu === text) continue
      writeText(this.abs(rel), neu)
      changed.push(rel)
    }
    return changed
  }

  switchedOff(): Set<string> {
    const { disabled, enabled, ai } = this.config("plugins"), conf = this.settings.get("plugins")
    const memo = this.off
    if (memo && memo.conf === conf && memo.list === this.pluginList) return memo.off
    const on = new Set<string>(Array.isArray(enabled) ? enabled : [])
    const off = new Set<string>(Array.isArray(disabled) ? disabled : [])
    for (const p of this.pluginList) {
      if (ai === false && p.manifest.ai === true) off.add(p.id)
      else if (p.manifest.alwaysOn === true) off.delete(p.id)
      else if (p.manifest.offByDefault === true && !on.has(p.id)) off.add(p.id)
    }
    const known = new Set(this.pluginList.map((p) => p.id))
    for (let grew = true; grew;) {
      grew = false
      for (const p of this.pluginList) {
        if (!off.has(p.id) && (p.manifest.requires ?? []).some((r) => off.has(r) || !known.has(r))) { off.add(p.id); grew = true }
      }
    }
    this.off = { conf, list: this.pluginList, off }
    return off
  }

  private on<F>(hooks: Set<{ plugin: string; fn: F }>): F[] {
    const off = hooks.size ? this.switchedOff() : new Set<string>()
    const own = hooks.size && requestWriter.getStore()?.client === "guest" ? new Set(this.pluginList.filter((p) => p.tier === "core").map((p) => p.id)) : null
    return [...hooks].filter((h) => !off.has(h.plugin) && (!own || own.has(h.plugin))).map((h) => h.fn)
  }

  private placers = new Set<{ plugin: string; fn: ArchiveHook }>()
  onArchive(plugin: string, fn: ArchiveHook) {
    return added(this.placers, { plugin, fn })
  }
  private placed(rel: string, archived: boolean): string | null {
    for (const fn of this.on(this.placers)) {
      try { const to = fn(rel, archived); if (typeof to === "string") return to } catch (e) { log.error("a plugin's archive hook failed", e) }
    }
    return null
  }

  private creators = new Set<{ plugin: string; fn: CreateHook }>()
  onCreate(plugin: string, fn: CreateHook) {
    return added(this.creators, { plugin, fn })
  }
  creating(rel: string, fm: Item): Item {
    const who = requestWriter.getStore() ?? null
    const out: Item = {}
    for (const fn of this.on(this.creators)) {
      try {
        for (const [k, v] of Object.entries(fn(rel, fm, who) ?? {})) if (!(k in fm) && !(k in out) && !blank(v)) out[k] = v
      } catch (e) { log.error("a plugin's create hook failed", e) }
    }
    return out
  }
  created(rel: string, text: string): string {
    if (!rel.toLowerCase().endsWith(".md") || !this.creators.size) return text
    const m = FM.exec(text)
    let fm: Item
    try { fm = m ? loadFm(m[1] ?? "") : {} } catch { return text }
    return withKeys(text, m, fm, this.creating(rel, fm))
  }

  private writers = new Set<{ plugin: string; fn: WriteHook }>()
  onWrite(plugin: string, fn: WriteHook) {
    return added(this.writers, { plugin, fn })
  }
  private watch(rel: string): ((before: string | null, after: string) => void) | null {
    const who = requestWriter.getStore()
    if (!who || !this.writers.size || !/\.md$/i.test(rel) || isHiddenPath(rel)) return null
    const fns = this.on(this.writers)
    if (!fns.length) return null
    return (before, after) => {
      for (const fn of fns) try { fn(rel, before, after, who) } catch (e) { log.error("a plugin's write hook failed", e) }
    }
  }

  private savers = new Set<{ plugin: string; fn: SaveHook }>()
  onSave(plugin: string, fn: SaveHook) {
    return added(this.savers, { plugin, fn })
  }
  saving(rel: string, was: string, text: string): string {
    if (!rel.toLowerCase().endsWith(".md") || !this.savers.size || was === text) return text
    const m = FM.exec(text), w = FM.exec(was)
    let now: NoteText, before: NoteText
    try {
      now = { fm: m ? loadFm(m[1] ?? "") : {}, body: m ? text.slice(m[0].length) : text }
      before = { fm: w ? loadFm(w[1] ?? "") : {}, body: w ? was.slice(w[0].length) : was }
    } catch { return text }
    const who = requestWriter.getStore() ?? null
    const set: Item = {}
    for (const fn of this.on(this.savers)) {
      try {
        for (const [k, v] of Object.entries(fn(rel, now, before, who) ?? {})) if (!(k in set) && !blank(v) && norm(v) !== norm(now.fm[k])) set[k] = v
      } catch (e) { log.error("a plugin's save hook failed", e) }
    }
    return withKeys(text, m, now.fm, set)
  }

  private fileCreators = new Set<{ plugin: string; fn: FileCreateHook }>()
  onCreateFile(plugin: string, fn: FileCreateHook) {
    return added(this.fileCreators, { plugin, fn })
  }
  fileCreated(rel: string, file: NewFile) {
    if (rel.toLowerCase().endsWith(".md")) return
    const who = requestWriter.getStore() ?? null
    for (const fn of this.on(this.fileCreators)) {
      try { fn(rel, file, who) } catch (e) { log.error("a plugin's new-file hook failed", e) }
    }
  }

  private kindsVersion = 0
  private kindsSeen = ""

  register(kind: Kind) {
    this.kinds.push(kind)
    this.ordered.clear()
    this.types = null
    this.kindsVersion++
    return kind
  }

  unregister(kind: Kind) {
    this.kinds = this.kinds.filter((k) => k !== kind)
    this.ordered.clear()
    this.types = null
    this.kindsVersion++
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

  kindFor(rel: string, fm: Item): Kind | null {
    for (const d of this.plainDirs) if (rel.startsWith(d + "/")) return null
    const typed = this.typed(fm)
    if (typed) return typed
    const untyped = typeof fm.type !== "string" || !fm.type.trim()
    return this.kinds.find((k) => k.owns(rel) || (untyped && !!k.spec.owns?.(rel))) ?? null
  }

  private typed(fm: Item): Kind | null {
    const t = fm.type
    if (typeof t !== "string" || !t.trim()) return null
    this.types ??= new Map(this.kinds.map((k) => [k.type.toLowerCase(), k]))
    return this.types.get(t.trim().toLowerCase()) ?? null
  }

  relocated(rel: string): string {
    if (!rel || this.entries.has(rel) || this.others.has(rel) || this.missing.has(rel.split("/")[0])) return rel
    const tail = `/${rel}`
    let hit: string | null = null
    for (const map of [this.entries, this.others] as Map<string, unknown>[]) {
      for (const r of map.keys()) {
        if (!r.endsWith(tail)) continue
        if (hit !== null) return rel
        hit = r
      }
    }
    return hit ?? rel
  }

  folderSet(collection: string): string | null {
    const f = this.configWithDefaults("folders")[collection]
    return typeof f === "string" ? f.trim().replace(/^\/+|\/+$/g, "") : null
  }

  home(collection: string, where?: (item: Item) => boolean): string | null {
    const set = where ? null : this.folderSet(collection)
    if (set !== null) return set
    const items = this.shared(collection), missing = [...this.missing.keys()].join("\0"), had = where ? undefined : this.homes.get(items)
    if (had?.missing === missing) return had.home
    const k = this.kind(collection), paths: string[] = []
    for (const item of items) {
      const id = String(item.id)
      if ((!where || where(item)) && !this.missing.has(id.split("/", 1)[0])) paths.push(id)
    }
    const home = homeFolder(paths, k.folder, k.recursive)
    if (!where) this.homes.set(items, { missing, home })
    return home
  }
  private homes = new WeakMap<readonly Item[], { missing: string; home: string | null }>()

  pagesHome(): string {
    const mine = [...this.entries.values()].filter((e) => e.fm.type === "dashboard").map((e) => e.rel)
    return this.folderSet("dashboards") ?? homeFolder(mine, "Dashboards") ?? "Dashboards"
  }

  private scan() {
    this.evicted = []
    this.linkedOut = false
    const found = new Map<string, Stat>()
    const others = new Map<string, Stat>()
    const folders: string[] = []
    const stack = [""]
    const root = path.join(this.path, "/")
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
        if ((name.startsWith(".") && (name !== ARCHIVE_DIR || !d.isDirectory())) || name.endsWith(".icloud")) continue
        const rel = sub ? `${sub}/${name}` : name
        let st: fs.BigIntStats | null | undefined = null
        try {
          if (!d.isDirectory()) st = fs.statSync(root + rel, { bigint: true, throwIfNoEntry: false })
        } catch {
          continue
        }
        if (st === undefined) continue
        if (d.isSymbolicLink()) this.linkedOut = true
        if (st === null || st.isDirectory()) {
          if (CACHES.has(name)) continue
          if (st) { const key = `${st.dev}:${st.ino}`; if (linked.has(key)) continue; linked.add(key) }
          folders.push(rel)
          stack.push(rel)
          continue
        }
        const stat = statFrom(st)
        if (name.endsWith(".md") && !name.includes(".tmp-")) { found.set(rel, stat); if (evicted(root + rel, st)) this.evicted.push(rel) }
        else others.set(rel, stat)
      }
    }
    folders.sort()
    if (others.size !== this.others.size || folders.length !== this.folders.length || folders.some((f, i) => f !== this.folders[i]) ||
      [...others].some(([r, st]) => { const was = this.others.get(r); return !was || !sameStat(was, st) })) this.version++
    this.others = others
    this.folders = folders
    const seen = this.settingsStats()
    if (seen !== this.settingsSeen) this.settingsVersion++
    this.settingsSeen = seen
    return found
  }

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
        if (st.isDirectory()) { stack.push(rel); continue }
        const away = evicted(this.abs(rel), st)
        if (away) this.evicted.push(rel)
        out.push(`${rel}:${st.mtimeNs}:${st.size}${away ? ":evicted" : ""}`)
      }
    }
    const look = (dir: string, file: (name: string) => string | null) => {
      try { return fs.readdirSync(this.abs(`.obsidian/${dir}`)).map(file).filter((f): f is string => f !== null) } catch { return [] }
    }
    for (const name of ["app.json", "types.json", "daily-notes.json", "templates.json", "appearance.json", "hotkeys.json", "themes", "snippets",
      ...look("themes", (n) => `themes/${n}/theme.css`), ...look("snippets", (n) => (n.endsWith(".css") ? `snippets/${n}` : null))]) {
      try {
        const st = fs.statSync(this.abs(`.obsidian/${name}`), { bigint: true })
        out.push(`${name}:${st.mtimeNs}:${st.size}`)
      } catch { /* not an Obsidian vault */ }
    }
    return out.sort().join("\n")
  }

  waiting() { return this.missing.size > 0 }

  async sync(): Promise<boolean> {
    const t0 = Date.now()
    this.stale = false
    try {
      const changed = await this.walk()
      this.walked = t0
      return changed
    } catch (e) {
      this.stale = true
      throw e
    }
  }

  private async walk(): Promise<boolean> {
    this.settings.clear()
    try {
      const plain = this.plain().map((d) => d.replace(/^\/+|\/+$/g, "")).filter(Boolean)
      if (plain.join("\n") !== this.plainDirs.join("\n")) this.plainDirs = plain
    } catch (e) { log.error("couldn't ask which folders hold patterns", e) }
    const found = this.scan()
    const kinds = `${this.kindsVersion}:${this.settingsVersion}:${this.plainDirs.join("\n")}`, recheck = kinds !== this.kindsSeen
    this.kindsSeen = kinds
    let changed = [...found].filter(([r, st]) => {
      const e = this.entries.get(r)
      return !e || !sameStat(e.stat, st) || e.broken || (recheck && e.kind !== this.kindFor(r, e.fm))
    }).map(([r]) => r)
    const reread = new Set(changed), start = this.startTexts, kept = new Map<string, KeptText>()
    if (start) {
      const away = new Set(this.evicted)
      for (const r of changed) { const k = start.had.get(r), st = found.get(r)!; if (k && k[0] === String(st.ns) && k[1] === st.size && !away.has(r)) kept.set(r, k) }
    }
    const [{ texts, late: unread }, away] = await Promise.all([this.readAll(kept.size ? changed.filter((r) => !kept.has(r)) : changed),
      this.fetchEvicted(this.evicted.filter((r) => !reread.has(r)))])
    for (const [r, k] of kept) texts.set(r, k[2])
    if (start) for (const r of changed) {
      const t = texts.get(r), st = found.get(r)!
      if (typeof t === "string") start.now.set(r, kept.get(r) ?? [String(st.ns), st.size, t])
    }
    const late = [...unread, ...away].sort()
    if (late.join("\n") !== this.downloading.join("\n")) { this.downloading = late; this.version++ }
    changed = changed.filter((r) => texts.has(r))
    const now = Date.now()
    const vanished = (top: string) => {
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
    const first = !this.entries.size
    let since = performance.now()
    for (const rel of changed.sort()) {
      if (first && performance.now() - since > 20) { await turn(); since = performance.now() }
      const st = found.get(rel)!
      const was = this.entries.get(rel)
      const e = this.read(rel, st, texts.get(rel))
      if (was && was.broken && e.broken && sameStat(was.stat, st) && same(was.problems, e.problems)) unchanged.add(rel)
    }
    changed = changed.filter((r) => !unchanged.has(r))
    if (changed.length || gone.length) this.version++
    for (const fn of this.hooks) {
      try { fn(this) } catch (e) { log.error("a plugin's after-sync hook failed", e) }
    }
    return !!(changed.length || gone.length)
  }

  read(rel: string, st: Stat, text?: string | Error): Entry {
    const e = new Entry(rel, st, null)
    const old = this.entries.get(rel)
    if (old?.kind) this.ordered.delete(old.kind)
    try {
      const t = text ?? readText(this.abs(rel))
      if (typeof t !== "string") throw t
      ;[e.fm, e.body] = parseText(t)
      e.text = t
      e.bodyLine = bodyLine(t)
    } catch (ex) {
      const name = ex instanceof YAMLError ? "YAMLError" : ex instanceof TypeError ? "UnicodeDecodeError" : "OSError"
      e.problems = [`can't read the frontmatter (${name}); nothing from this file was updated`]
      e.broken = true
      if (old) { e.fm = old.fm; e.body = old.body; e.text = old.text; e.bodyLine = old.bodyLine; e.item = old.item; e.kind = old.kind } else e.kind = this.kindFor(rel, {})
      this.entries.set(rel, e)
      return e
    }
    if (old?.item && old.kind) this.byId.delete(old.kind.collection + "\0" + old.item.id)
    const kind = e.kind = this.kindFor(rel, e.fm)
    if (kind) this.ordered.delete(kind)
    if (kind === null) {
      this.entries.set(rel, e)
      return e
    }
    let item: Item | null, problems: string[]
    try {
      [item, problems] = kind.parse(e.fm, prose(e.body), stemOf(rel))
    } catch (ex) {
      item = null
      problems = [`${kind.plugin ?? "plugin"} couldn't read this file: ${messageOf(ex)}`]
      log.error(`${kind.plugin ?? "a plugin"} couldn't read a file`, ex, { file: rel })
    }
    if (item !== null) {
      item.modified = stamp(new Date(Number(st.ns / 1000000n)))
      if (e.fm.type !== undefined && e.fm.type !== null && str(e.fm.type).trim().toLowerCase() !== kind.type) {
        problems = [`\`type: ${str(e.fm.type)}\` in ${kind.file ?? rel} (expected ${kind.type})`, ...problems]
      }
      item.id = rel.slice(0, -3)
      if (e.archived) item.archived = true
      else delete item.archived
      e.item = Object.freeze(item)
      this.byId.set(kind.collection + "\0" + item.id, rel)
    }
    e.problems = problems
    this.entries.set(rel, e)
    return e
  }

  drop(rel: string) {
    const e = this.entries.get(rel)
    if (this.letGo.size > 4096) this.letGo.clear()
    this.letGo.add(rel)
    if (e) this.version++
    if (e?.kind) this.ordered.delete(e.kind)
    this.entries.delete(rel)
    if (e && e.item && e.kind) this.byId.delete(e.kind.collection + "\0" + e.item.id)
  }

  items(collection: string): Item[] {
    return this.shared(collection).map((i) => ({ ...i }))
  }

  shared(collection: string): readonly Item[] {
    const k = this.kind(collection)
    noteSource("kinds", collection)
    let hit = this.ordered.get(k)
    if (!hit) {
      const items: Item[] = []
      for (const e of this.entries.values()) if (e.kind === k && e.item !== null) items.push(e.item)
      this.ordered.set(k, hit = Object.freeze(k.order(items)))
    }
    return hit
  }

  get(collection: string, ref: unknown): Item | null {
    if (ref === null || ref === undefined) return null
    const k = this.kind(collection)
    const r = str(ref)
    let rel = this.byId.get(collection + "\0" + r)
    if (rel === undefined && k.folder) rel = this.byId.get(collection + "\0" + `${k.folder}/${r}`)
    if (rel === undefined && r.includes("/")) rel = this.byId.get(collection + "\0" + archiveTwin(r))
    const one = k.file
    if (rel === undefined && one && [one, one.slice(0, -3), k.collection].some((x) => x.toLowerCase() === r.toLowerCase())) {
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

  find(collection: string, item: Item): Item | null {
    const k = this.kind(collection)
    const key = k.key ? k.key(item) : null
    if (key === null || key === undefined) return null
    for (const e of this.entries.values()) if (e.kind === k && e.item !== null && k.key!(e.item) === key) return { ...e.item }
    return null
  }

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
      throw new ConflictError(`${existing.rel} has frontmatter that can't be read; fix it before the app writes to it`)
    }
    const fresh = old ? null : this.target(k, neu, null)
    const text = this.compose(k, existing, old, fresh === null ? owned : { ...named(k, neu, fresh, owned), ...this.creating(fresh, { type: k.type, ...owned }) }, body)
    const cur = old ? old.id + ".md" : null
    const rel = this.target(k, neu, old, archiving)
    if (text === null && rel === cur) return old
    if (text !== null) writeAtomic(this.abs(rel), text)
    const e = this.read(rel, statOf(this.abs(rel)))
    if (cur !== null && rel !== cur) this.relink([[cur, rel]])
    this.version++
    return e.item !== null ? { ...e.item } : null
  }

  async fillIn(rel: string, before: Entry | null) {
    const e = this.entries.get(rel), kind = e?.kind
    if (!e || e.item === null || !kind?.fill || e.broken) return
    try {
      const filled = await kind.fill({ ...e.item }, before && before.kind === kind ? before.item : null)
      if (filled) await this.save(kind.collection, filled, e.item.id)
    } catch (ex) {
      const now = this.entries.get(rel)
      if (now) now.problems = [...now.problems, `${kind.plugin ?? "plugin"} couldn't fill in this file: ${messageOf(ex)}`]
      log.error(`${kind.plugin ?? "a plugin"} couldn't fill in a file`, ex, { file: rel })
    }
  }

  private compose(k: Kind, e: Entry | null, old: Item | null, owned: Item, body: string): string | null {
    const full: Item = { type: k.type, ...owned }
    if (e === null) return frontmatter(mergeFm({}, full), withKindBlocks(k.blocksFor(full), body) ?? body)
    let raw: string
    try {
      raw = readText(this.abs(e.rel))
    } catch (ex) {
      throw new ConflictError(`couldn't read ${e.rel} to change it (${messageOf(ex)}); try again`, { cause: ex })
    }
    const m = FM.exec(raw)
    const [baseOwned, baseBody] = rendered(k, old!)
    const changes: Item = {}
    const removals: string[] = []
    for (const [key, v] of Object.entries(owned)) {
      if (norm(v) === norm(baseOwned[key])) continue
      if (blank(v)) {
        if (!(key in e.fm) || blank(e.fm[key])) continue
        if (key === "archived" || k.spec.dropWhenCleared?.includes(key)) removals.push(key)
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

  private patchBody(k: Kind, e: Entry, baseBody: string, neu: string) {
    const conflict = () => new ConflictError(`${e.rel} changed where this edit goes; reload it and try again`)
    const merged = !baseBody.trim() && e.body.trim() ? `${stripNl(e.body).trimEnd()}\n\n${stripNl(neu).trim()}` : merge3(stripNl(baseBody), stripNl(neu), stripNl(e.body), true)
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

  private target(k: Kind, item: Item, old: Item | null, archiving = false) {
    const cur = old ? old.id + ".md" : null
    const on = isArchived(item)
    const folder = cur === null ? this.home(k.collection) ?? k.folder ?? ""
      : ((archiving || on !== isArchived(old)) && this.placers.size ? this.placed(cur, on) : null) ?? dirOf(cur)
    let want = k.filename(item, { folder, old }) + ".md"
    if (cur === want) return cur
    if (cur !== null) {
      const here = dirOf(cur)
      if (k.filename(item, { folder: here, old }) === k.filename(old!, { folder: here, old })) {
        if (folder === here) return cur
        want = joinPath(folder, cur.slice(here ? here.length + 1 : 0))
      }
    }
    let rel = want, n = 1
    while (this.entries.has(rel) || fs.existsSync(this.abs(rel))) {
      if (cur && sameFile(this.abs(rel), this.abs(cur))) break
      rel = `${want.slice(0, -3)} ${n}.md`
      n++
    }
    if (cur && fs.existsSync(this.abs(cur))) {
      guard(this.abs(cur))
      guard(this.abs(rel))
      fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true })
      renameFile(this.abs(cur), this.abs(rel))
      this.drop(cur)
      this.moved(cur, rel)
    }
    return rel
  }

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
    return to
  }

  toTrash(rel: string) {
    guard(this.abs(rel))
    const ext = fs.statSync(this.abs(rel)).isDirectory() ? "" : path.extname(rel), stem = `.trash/${rel.slice(0, rel.length - ext.length)} ${localStamp()}`
    let to = stem + ext
    for (let n = 1; fs.existsSync(this.abs(to)); n++) to = `${stem} ${n}${ext}`
    fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true })
    renameFile(this.abs(rel), this.abs(to))
    return to
  }

  config(name: string, fallback?: Item): Item {
    if (name.startsWith("plugins/") && name.endsWith("/data")) noteSource("settings", name.slice(8, -5))
    let text = this.settings.get(name)
    if (text === undefined) {
      const file = this.abs(`.vaultite/${name}.json`)
      try {
        const stat = configStat(file)
        text = readText(file)
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

  excluded(rel: string): boolean {
    if (this.exclusions?.version !== this.settingsVersion) this.exclusions = { version: this.settingsVersion, test: excluder(this.configWithDefaults("files").excluded) }
    return this.exclusions.test(rel)
  }
  private exclusions: { version: number; test: (rel: string) => boolean } | null = null

  samples(): string[] {
    return strings(this.config("files").samples).map((d) => d.replace(/^\/+|\/+$/g, "")).filter(Boolean)
  }
  sampleOf(rel: string): string | null {
    return this.samples().find((d) => rel.startsWith(`${d}/`)) ?? null
  }

  configWithDefaults(name: string): Item {
    if (this.seeds?.version !== this.settingsVersion) {
      let all: Record<string, Item> = {}
      try { all = this.defaults() } catch (e) { log.error("couldn't gather the plugins' setting defaults", e) }
      this.seeds = { version: this.settingsVersion, all }
    }
    return { ...this.seeds.all[name], ...this.config(name) }
  }

  readConfig(name: string): Item | null {
    let buf: Buffer
    const file = this.abs(`.vaultite/${name}.json`)
    let stat = ""
    try { stat = configStat(file); buf = fs.readFileSync(file) } catch (e) {
      fetchFromICloud(file, e)
      if (gone(file, e)) return null
      const last = this.lastGood.get(name)
      if (last && stat && last.stat === stat) return JSON.parse(last.text)
      if (codeOf(e) === "ENOENT") throw new ConfigError(`.vaultite/${name}.json is in iCloud only for now`, true)
      throw new ConfigError(`.vaultite/${name}.json can't be read`, true)
    }
    try {
      const text = buf.toString("utf8"), d = JSON.parse(text)
      if (d && typeof d === "object" && !Array.isArray(d)) { this.lastGood.set(name, { text, stat }); return d }
    } catch { /* below */ }
    throw new ConfigError(`.vaultite/${name}.json isn't a JSON object`, false)
  }

  patchConfig(name: string, changes: Item, { nullRemoves = true }: { nullRemoves?: boolean } = {}): Item {
    const cur = this.readConfig(name)
    const next: Item = { ...(cur ?? {}) }
    for (const [k, v] of Object.entries(changes)) { if (v === null && nullRemoves) delete next[k]; else if (v !== undefined) next[k] = v }
    if (JSON.stringify(next) !== JSON.stringify(cur ?? {})) this.setConfig(name, next)
    return next
  }

  forgetConfig(name: string) {
    this.settings.delete(name)
  }

  removeConfig(name: string) {
    fs.rmSync(this.abs(`.vaultite/${name}.json`), { force: true })
    this.settings.delete(name)
    this.lastGood.delete(name)
    this.stale = true
  }

  setConfig(name: string, data: unknown) {
    const file = this.abs(`.vaultite/${name}.json`), text = JSON.stringify(data, null, 2) + "\n"
    writeAtomic(file, text)
    this.settings.delete(name)
    this.stale = true
    try { this.lastGood.set(name, { text, stat: configStat(file) }) } catch { this.lastGood.delete(name) }
  }

  problemList() {
    return [...this.entries.values()].filter((e) => e.problems.length).sort((a, b) => cmp(a.rel, b.rel))
      .flatMap((e) => e.problems.map((m) => ({ file: e.rel, problem: m })))
      .concat(this.downloading.map((r) => ({ file: r, problem: "iCloud is still downloading it" })))
  }
}

function stringsIn(v: unknown, out: string[] = []): string[] | null {
  if (typeof v === "string") out.push(v)
  else if (Array.isArray(v)) { for (const x of v) if (Array.isArray(x) || stringsIn(x, out) === null) return null }
  else if (v && typeof v === "object") { for (const x of Object.values(v)) if (stringsIn(x, out) === null) return null }
  return out
}

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
