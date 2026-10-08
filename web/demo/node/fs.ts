// node:fs for the demo's server (web/demo/worker.ts): a tree of folders and files in memory, with the calls the server
// makes. Sync like Node's; `changes` tells the worker what to keep in IndexedDB.
import path from "path-browserify"

type File = { dir: false; data: Uint8Array; ns: bigint; born: bigint; ino: number }
type Dir = { dir: true; kids: Map<string, Node>; ns: bigint; born: bigint; ino: number }
type Node = File | Dir
type Opts = { encoding?: string | null; flag?: string; recursive?: boolean; force?: boolean; withFileTypes?: boolean; bigint?: boolean; throwIfNoEntry?: boolean } | string | null | undefined

let ino = 1, last = 0n
/** Now in ns, never the same twice: the vault tells a change by its mtime. */
const now = () => (last = BigInt(Date.now()) * 1_000_000n > last ? BigInt(Date.now()) * 1_000_000n : last + 1n)
const mkdir = (): Dir => { const t = now(); return { dir: true, kids: new Map(), ns: t, born: t, ino: ino++ } }
const root = mkdir()
const enc = new TextEncoder()

const watchers = new Set<{ root: string; fn: (rel: string) => void }>()
/** Every path written or removed (absolute), for the worker. */
export const changes = new Set<(abs: string) => void>()
function changed(abs: string) {
  for (const fn of changes) fn(abs)
  for (const w of watchers) if (abs === w.root || abs.startsWith(w.root + "/")) w.fn(abs.slice(w.root.length + 1))
}

function fail(code: string, call: string, p: string): never {
  const what: Record<string, string> = { ENOENT: "no such file or directory", EEXIST: "file already exists", ENOTDIR: "not a directory",
    EISDIR: "illegal operation on a directory", ENOTEMPTY: "directory not empty", EINVAL: "invalid argument", EBADF: "bad file descriptor" }
  throw Object.assign(new Error(`${code}: ${what[code] ?? code}, ${call} '${p}'`), { code, errno: -1, syscall: call, path: p })
}

const abs = (p: unknown) => path.resolve("/", p instanceof URL ? decodeURIComponent(p.pathname) : String(p))
function find(p: string): Node | null {
  let n: Node = root
  for (const part of p.split("/").filter(Boolean)) {
    if (!n.dir) return null
    const next = n.kids.get(part)
    if (!next) return null
    n = next
  }
  return n
}
function get(p: string, call: string) { return find(p) ?? fail("ENOENT", call, p) }
function parent(p: string, call: string): Dir {
  const d = find(path.dirname(p))
  if (!d) fail("ENOENT", call, p)
  if (!d.dir) fail("ENOTDIR", call, p)
  return d
}
const bytes = (data: unknown, encoding?: string | null): Uint8Array =>
  typeof data === "string" ? (encoding === "base64" ? Buffer.from(data, "base64") : enc.encode(data)) : data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
const encodingOf = (o: Opts) => (typeof o === "string" ? o : o?.encoding ?? null)

export class Stats {
  dev = 1; mode: number; nlink = 1; uid = 0; gid = 0; blksize = 4096
  ino: number; size: number; mtimeMs: number; ctimeMs: number; atimeMs: number; birthtimeMs: number
  mtime: Date; ctime: Date; atime: Date; birthtime: Date
  private n: Node
  constructor(n: Node) {
    this.n = n
    this.ino = n.ino
    this.mode = n.dir ? 0o40755 : 0o100644
    this.size = n.dir ? 64 : n.data.length
    this.mtimeMs = this.ctimeMs = this.atimeMs = Number(n.ns / 1_000_000n)
    this.birthtimeMs = Number(n.born / 1_000_000n)
    this.mtime = this.ctime = this.atime = new Date(this.mtimeMs)
    this.birthtime = new Date(this.birthtimeMs)
  }
  isFile() { return !this.n.dir }
  isDirectory() { return this.n.dir }
  isSymbolicLink() { return false }
}
/** statSync(p, { bigint: true }): sizes and times as bigints, with the ns ones. */
function bigStats(n: Node) {
  const s = new Stats(n) as unknown as Record<string, unknown>
  for (const k of ["dev", "mode", "nlink", "uid", "gid", "blksize", "ino", "size", "mtimeMs", "ctimeMs", "atimeMs", "birthtimeMs"]) s[k] = BigInt(s[k] as number)
  Object.assign(s, { mtimeNs: n.ns, ctimeNs: n.ns, atimeNs: n.ns, birthtimeNs: n.born })
  return s
}
export class Dirent {
  name: string
  parentPath: string
  private n: Node
  constructor(name: string, parentPath: string, n: Node) { this.name = name; this.parentPath = parentPath; this.n = n }
  get path() { return this.parentPath }
  isFile() { return !this.n.dir }
  isDirectory() { return this.n.dir }
  isSymbolicLink() { return false }
}

export function existsSync(p: unknown) { try { return !!find(abs(p)) } catch { return false } }
export function statSync(p: unknown, o?: { bigint?: boolean; throwIfNoEntry?: boolean }) {
  const n = find(abs(p))
  if (!n) { if (o?.throwIfNoEntry === false) return undefined; fail("ENOENT", "stat", abs(p)) }
  return (o?.bigint ? bigStats(n) : new Stats(n)) as Stats
}
export const lstatSync = statSync
export function accessSync(p: unknown) { get(abs(p), "access") }
export function realpathSync(p: unknown) { const a = abs(p); get(a, "realpath"); return a }
realpathSync.native = realpathSync
export function readlinkSync(p: unknown): string { fail("EINVAL", "readlink", abs(p)) }

export function readFileSync(p: unknown, o?: Opts) {
  const a = typeof p === "number" ? fdPath(p) : abs(p)
  const n = get(a, "open")
  if (n.dir) fail("EISDIR", "read", a)
  const e = encodingOf(o), buf = Buffer.from(n.data.buffer, n.data.byteOffset, n.data.byteLength)
  return e ? buf.toString(e as BufferEncoding) : Buffer.from(buf)
}
export function writeFileSync(p: unknown, data: unknown, o?: Opts) {
  const a = abs(p), flag = typeof o === "object" && o ? o.flag : undefined
  const d = parent(a, "open"), name = path.basename(a), was = d.kids.get(name)
  if (was?.dir) fail("EISDIR", "open", a)
  if (was && flag === "wx") fail("EEXIST", "open", a)
  const add = bytes(data, encodingOf(o))
  const next = flag?.startsWith("a") && was ? concat(was.data, add) : add.slice()
  const t = now()
  d.kids.set(name, { dir: false, data: next, ns: t, born: was?.born ?? t, ino: was?.ino ?? ino++ })
  d.ns = was ? d.ns : t
  changed(a)
}
const concat = (a: Uint8Array, b: Uint8Array) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out }
export function appendFileSync(p: unknown, data: unknown, o?: Opts) { writeFileSync(p, data, { encoding: encodingOf(o), flag: "a" }) }
export function copyFileSync(from: unknown, to: unknown) { writeFileSync(to, readFileSync(from)) }

export function mkdirSync(p: unknown, o?: Opts | number) {
  const a = abs(p), recursive = typeof o === "object" && !!o?.recursive
  let n: Dir = root, first: string | undefined
  const parts = a.split("/").filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const next = n.kids.get(parts[i])
    const at = "/" + parts.slice(0, i + 1).join("/")
    if (next) {
      if (!next.dir) fail(i === parts.length - 1 ? "EEXIST" : "ENOTDIR", "mkdir", a)
      if (i === parts.length - 1 && !recursive) fail("EEXIST", "mkdir", a)
      n = next
      continue
    }
    if (!recursive && i < parts.length - 1) fail("ENOENT", "mkdir", a)
    const d = mkdir()
    n.kids.set(parts[i], d)
    n.ns = d.ns
    first ??= at
    n = d
  }
  if (first) changed(first)
  return first
}
export function mkdtempSync(prefix: string) { const p = prefix + Math.random().toString(36).slice(2, 8); mkdirSync(p, { recursive: true }); return p }

export function readdirSync(p: unknown, o?: Opts) {
  const a = abs(p), n = get(a, "scandir")
  if (!n.dir) fail("ENOTDIR", "scandir", a)
  const types = typeof o === "object" && !!o?.withFileTypes, deep = typeof o === "object" && !!o?.recursive
  const out: (string | Dirent)[] = []
  const walk = (d: Dir, at: string, rel: string) => {
    for (const [name, kid] of [...d.kids].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
      out.push(types ? new Dirent(name, at, kid) : rel + name)
      if (deep && kid.dir) walk(kid, `${at}/${name}`, `${rel}${name}/`)
    }
  }
  walk(n, a === "/" ? "" : a, "")
  return out
}

export function rmSync(p: unknown, o?: Opts) {
  const a = abs(p), n = find(a), force = typeof o === "object" && !!o?.force
  if (!n) { if (force) return; fail("ENOENT", "rm", a) }
  if (n.dir && !(typeof o === "object" && o?.recursive)) fail("EISDIR", "rm", a)
  parent(a, "rm").kids.delete(path.basename(a))
  changed(a)
}
export function unlinkSync(p: unknown) {
  const a = abs(p)
  if (get(a, "unlink").dir) fail("EISDIR", "unlink", a)
  rmSync(a)
}
export function rmdirSync(p: unknown, o?: Opts) {
  const a = abs(p), n = get(a, "rmdir")
  if (!n.dir) fail("ENOTDIR", "rmdir", a)
  if (n.kids.size && !(typeof o === "object" && o?.recursive)) fail("ENOTEMPTY", "rmdir", a)
  rmSync(a, { recursive: true })
}
export function renameSync(from: unknown, to: unknown) {
  const a = abs(from), b = abs(to), n = get(a, "rename")
  const into = parent(b, "rename"), there = into.kids.get(path.basename(b))
  if (there?.dir && !n.dir) fail("EISDIR", "rename", b)
  if (there?.dir && there.kids.size) fail("ENOTEMPTY", "rename", b)
  if (n.dir && (b + "/").startsWith(a + "/")) fail("EINVAL", "rename", b)
  parent(a, "rename").kids.delete(path.basename(a))
  into.kids.set(path.basename(b), n)
  into.ns = now()
  changed(a)
  changed(b)
}
export function cpSync(from: unknown, to: unknown, o?: Opts) {
  const a = abs(from), b = abs(to), n = get(a, "cp")
  if (!n.dir) return copyFileSync(a, b)
  if (!(typeof o === "object" && o?.recursive)) fail("EISDIR", "cp", a)
  mkdirSync(b, { recursive: true })
  for (const name of n.kids.keys()) cpSync(`${a}/${name}`, `${b}/${name}`, o)
}
export function chmodSync() {}
export function utimesSync() {}

// Files open for reading (only reads: what the server opens is to look at a file's start).
const fds = new Map<number, string>()
let fdN = 10
const fdPath = (fd: number) => fds.get(fd) ?? fail("EBADF", "read", String(fd))
export function openSync(p: unknown, flags = "r") {
  const a = abs(p)
  if (flags !== "r") fail("EINVAL", "open", a)
  get(a, "open")
  fds.set(++fdN, a)
  return fdN
}
export function closeSync(fd: number) { fds.delete(fd) }
export function fstatSync(fd: number, o?: { bigint?: boolean }) { return statSync(fdPath(fd), o) }
export function readSync(fd: number, buf: Uint8Array, off = 0, len = buf.length - off, pos: number | null = 0) {
  const data = get(fdPath(fd), "read") as File, from = pos ?? 0
  const part = data.data.subarray(from, from + len)
  buf.set(part, off)
  return part.length
}

/** Changes under `root` as Node's fs.watch tells them (recursive or not, the demo tells every one). */
export function watch(p: unknown, o: unknown, fn?: (event: string, name: string | null) => void) {
  const listener = (typeof o === "function" ? o : fn) as (event: string, name: string | null) => void
  const w = { root: abs(p), fn: (rel: string) => listener("change", rel) }
  watchers.add(w)
  return { on() { return this }, close() { watchers.delete(w) }, unref() {}, ref() {} }
}
export function createReadStream(): never { throw new Error("streams need the Vaultite app") }
export const createWriteStream = createReadStream

const later = <A extends unknown[], T>(fn: (...a: A) => T) => (...a: A) => new Promise<T>((ok, no) => { try { ok(fn(...a)) } catch (e) { no(e) } })
export function stat(p: unknown, o: unknown, cb?: (e: unknown, s?: unknown) => void) {
  const done = (typeof o === "function" ? o : cb) as (e: unknown, s?: unknown) => void
  queueMicrotask(() => { try { done(null, statSync(p, typeof o === "object" ? o as { bigint?: boolean } : undefined)) } catch (e) { done(e) } })
}
export const promises = {
  stat: later(statSync), lstat: later(statSync), readFile: later(readFileSync), writeFile: later(writeFileSync), readdir: later(readdirSync),
  mkdir: later(mkdirSync), rm: later(rmSync), rename: later(renameSync), unlink: later(unlinkSync), access: later(accessSync),
  appendFile: later(appendFileSync), copyFile: later(copyFileSync), realpath: later(realpathSync),
  open: later((p: unknown) => {
    const fd = openSync(p)
    return { fd, stat: later(() => fstatSync(fd)), close: later(() => closeSync(fd)),
      read: later((buf: Uint8Array, off?: number, len?: number, pos?: number | null) => ({ bytesRead: readSync(fd, buf, off, len, pos), buffer: buf })),
      readFile: later((o?: Opts) => readFileSync(fd, o)) }
  }),
}
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, COPYFILE_EXCL: 1, O_RDONLY: 0 }

export default {
  Stats, Dirent, existsSync, statSync, lstatSync, accessSync, realpathSync, readlinkSync, readFileSync, writeFileSync, appendFileSync,
  copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, rmdirSync, renameSync, cpSync, chmodSync, utimesSync, openSync,
  closeSync, fstatSync, readSync, watch, createReadStream, createWriteStream, stat, promises, constants,
}
