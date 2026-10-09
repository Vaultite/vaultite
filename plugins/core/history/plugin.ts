// File history: snapshots of text files on this machine (not the vault: disposable, and they
// shouldn't sync), at most one per file per interval, so any bad edit can be undone. Restoring is an ordinary edit.
import crypto from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { HTTPError, isTextKind, kindOf, LOADED, LOCAL, Plugin, Text, vaultHere } from "../../../core/plugins.ts"
import { fetchFromICloud, READ_WAIT, type Vault, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

const HOUR = 3600_000

/** `ns`: the exact time (a rewrite of the same size within a millisecond, an agent's, changes only it). */
type Stat = { mtime: number; size: number; ns?: string }
/** What's kept for a file: its head's stat and hash, and when its last snapshot was taken (ms). */
type Meta = Stat & { path: string; hash: string; last: number; gone?: boolean }
/** `version`: the vault's version at the last comparison (nothing to compare while it's the same). */
type State = { root: string; heads: Map<string, Meta>; skip: Map<string, string>; pruned: number; version: number }

const sha1 = (s: string | Buffer) => crypto.createHash("sha1").update(s).digest("hex")
const states = new WeakMap<Vault, State>()

/** This vault's folder of snapshots, and what's known about it (read from disk the first time). */
function state(vault: Vault): State {
  let s = states.get(vault)
  if (s) return s
  const { key, real } = vaultHere(vault.path)
  const root = path.join(LOCAL, "history", key)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, "vault.txt"), real + "\n")
  // The first prune a minute after the start (it looks at every snapshot: not while a server is starting), then hourly.
  s = { root, heads: new Map(), skip: new Map(), pruned: Date.now() - HOUR + 60_000, version: -1 }
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith("tmp-")) { fs.rmSync(path.join(root, name), { force: true }); continue } // (a copy a stop cut off)
    const m = readMeta(path.join(root, name))
    if (m && !m.gone) s.heads.set(m.path, m)
  }
  states.set(vault, s)
  return s
}

const dirOf = (s: State, rel: string) => path.join(s.root, sha1(rel).slice(0, 16))

function readMeta(dir: string): Meta | null {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) } catch { return null }
}
// (whole or not at all: a head cut off by a crash would become the next snapshot, losing the version to restore)
const writeMeta = (s: State, m: Meta) => writeAtomic(path.join(dirOf(s, m.path), "meta.json"), JSON.stringify(m))

/** A copy of a file's bytes for its history (`tmp()`), taken as they're read so what's hashed is what's kept, at any size
 *  and never all in memory: its hash, or null when it isn't text we keep (not UTF-8, or NUL bytes; the copy removed);
 *  undefined when it can't be read now (iCloud stalls giving it: looked at again on the next sync). */
async function take(abs: string, to: string): Promise<string | null | undefined> {
  const hash = crypto.createHash("sha1"), utf8 = new TextDecoder("utf-8", { fatal: true })
  const src = fs.createReadStream(abs), out = fs.createWriteStream(to)
  let read = 0, text = true, stalled = false, timer: ReturnType<typeof setTimeout> | undefined
  const wait = () => { clearTimeout(timer); timer = setTimeout(() => { stalled = true; src.destroy() }, READ_WAIT) }
  let result: string | null | undefined
  try {
    wait()
    for await (const chunk of src as AsyncIterable<Buffer>) {
      wait()
      if (read < 8000 && chunk.subarray(0, 8000 - read).includes(0)) { text = false; break }
      read += chunk.length
      try { utf8.decode(chunk, { stream: true }) } catch { text = false; break }
      hash.update(chunk)
      if (!out.write(chunk)) await once(out, "drain")
    }
    if (text) try { utf8.decode() } catch { text = false }
    result = stalled ? undefined : text ? hash.digest("hex") : null
  } catch (e) {
    fetchFromICloud(abs, e)
    result = stalled || Math.abs((e as NodeJS.ErrnoException).errno ?? 0) === 11 ? undefined : null
  } finally {
    clearTimeout(timer)
    src.destroy()
    out.end()
    await once(out, "close").catch(() => {})
  }
  if (typeof result !== "string") fs.rmSync(to, { force: true })
  return result
}

let tmpN = 0
const tmp = (s: State) => path.join(s.root, `tmp-${process.pid}-${++tmpN}`)

/** The files to follow now: Markdown (the index) and text files by kind, any size, none hidden. */
function candidates(vault: Vault) {
  const out = new Map<string, Stat>()
  const ms = (ns: bigint) => Number(ns / 1000000n)
  for (const [rel, e] of vault.entries) out.set(rel, { mtime: ms(e.stat.ns), size: e.stat.size, ns: String(e.stat.ns) })
  for (const [rel, st] of vault.others) {
    if (isTextKind(kindOf(rel))) out.set(rel, { mtime: ms(st.ns), size: st.size, ns: String(st.ns) })
  }
  return out
}

function settings() {
  const s = plugin.settings()
  const n = (v: unknown, d: number) => (typeof v === "number" && v >= 0 ? v : d)
  return { interval: n(s.interval_min, 5) * 60_000, keep: n(s.keep_days, 7) * 24 * HOUR }
}

/** Keep the head (the version saved at `t`) as a snapshot of the file: moved, not copied (a big file's is instant), and
 *  dated now, as its own mtime says when it was taken. The head is gone after. */
function snapshot(s: State, rel: string, t: number) {
  const dir = dirOf(s, rel), file = path.join(dir, `${t}.snap`)
  if (fs.existsSync(file)) return fs.rmSync(path.join(dir, "head"), { force: true })
  fs.renameSync(path.join(dir, "head"), file)
  const now = new Date()
  fs.utimesSync(file, now, now)
}

/** Start following a file (or again): its content (`copy`, take's) is the head. */
function track(s: State, rel: string, st: Stat, copy: string, hash: string) {
  const dir = dirOf(s, rel)
  fs.mkdirSync(dir, { recursive: true })
  fs.renameSync(copy, path.join(dir, "head"))
  const m: Meta = { path: rel, ...st, hash, last: readMeta(dir)?.last ?? 0 }
  writeMeta(s, m)
  s.heads.set(rel, m)
}

/** A file gone (deleted, moved away, or no longer text we keep): its last content becomes a snapshot. */
function untrack(s: State, rel: string) {
  const m = s.heads.get(rel)!
  try { snapshot(s, rel, m.mtime) } catch { /* its head went missing */ }
  writeMeta(s, { ...m, gone: true })
  s.heads.delete(rel)
}

/** A file renamed or moved: its snapshots go with it. */
function carry(s: State, from: string, to: string) {
  const src = dirOf(s, from), dst = dirOf(s, to)
  const m = s.heads.get(from)!
  s.heads.delete(from)
  if (!fs.existsSync(dst)) fs.renameSync(src, dst)
  else {
    for (const f of fs.readdirSync(src)) if (f.endsWith(".snap") && !fs.existsSync(path.join(dst, f))) fs.renameSync(path.join(src, f), path.join(dst, f))
    fs.rmSync(src, { recursive: true, force: true })
  }
  writeMeta(s, { ...m, path: to, last: Math.max(m.last, readMeta(dst)?.last ?? 0) })
}

/** The vault's folder is there (a whole top-level folder missing may be iCloud or a disk away: not "deleted"). */
function present(vault: Vault, rel: string) {
  try { return fs.statSync(rel.includes("/") ? vault.abs(rel.split("/")[0]) : vault.path).isDirectory() } catch { return false }
}

let offCheck = { at: 0, off: false }
const isOff = (vault: Vault) => {
  if (Date.now() - offCheck.at > 5000) {
    offCheck = { at: Date.now(), off: vault.switchedOff().has(plugin.id) }
  }
  return offCheck.off
}

/** After every sync: what changed since last time. Nothing to do when no file changed (the vault's version). */
export async function follow(vault: Vault) {
  if (isOff(vault)) {
    const s = states.get(vault)
    if (s) s.version = -1 // turned on again: compare every file
    return
  }
  const s = state(vault)
  if (s.version === vault.version) { // no file changed since the last look
    if (Date.now() - s.pruned > HOUR) prune(vault)
    return
  }
  s.version = vault.version
  const now = candidates(vault)
  const added: string[] = [], changed: string[] = []
  for (const [rel, st] of now) {
    const m = s.heads.get(rel)
    if (!m) { if (s.skip.get(rel) !== `${st.mtime}:${st.size}`) added.push(rel) }
    else if (m.mtime !== st.mtime || m.size !== st.size || (m.ns !== undefined && m.ns !== st.ns)) changed.push(rel)
  }
  const gone = [...s.heads.keys()].filter((r) => !now.has(r) && present(vault, r))
  if (added.length || changed.length || gone.length) {
    const { interval } = settings()
    for (const rel of changed) {
      const m = s.heads.get(rel)!, st = now.get(rel)!, copy = tmp(s)
      const hash = await take(vault.abs(rel), copy)
      if (hash === undefined) { s.version = -1; continue } // (looked at again next time)
      if (hash === null) { untrack(s, rel); s.skip.set(rel, `${st.mtime}:${st.size}`); continue }
      if (hash !== m.hash) {
        // The head is the previous content: kept, unless a snapshot was taken less than the interval ago.
        if (Date.now() - m.last >= interval) {
          try { snapshot(s, rel, m.mtime); m.last = Date.now() } catch { /* no head */ }
        }
        fs.renameSync(copy, path.join(dirOf(s, rel), "head"))
        m.hash = hash
      } else fs.rmSync(copy, { force: true })
      m.mtime = st.mtime; m.size = st.size; m.ns = st.ns
      writeMeta(s, m)
    }
    // A new path with a gone file's content is that file, renamed or moved.
    const byHash = new Map(gone.map((r) => [s.heads.get(r)!.hash, r]))
    for (const rel of added) {
      const st = now.get(rel)!, copy = tmp(s)
      const hash = await take(vault.abs(rel), copy)
      if (hash === undefined) { s.version = -1; continue }
      if (hash === null) { s.skip.set(rel, `${st.mtime}:${st.size}`); continue }
      s.skip.delete(rel)
      const from = byHash.get(hash)
      if (from) { byHash.delete(hash); gone.splice(gone.indexOf(from), 1); carry(s, from, rel) }
      track(s, rel, st, copy, hash)
    }
    for (const rel of gone) untrack(s, rel)
  }
  if (Date.now() - s.pruned > HOUR) prune(vault)
}

/** Drop snapshots taken more than keep_days ago, and what's left of files that have none and are gone. */
export function prune(vault: Vault, at = Date.now()) {
  const s = state(vault)
  s.pruned = at
  const { keep } = settings()
  for (const name of fs.readdirSync(s.root)) {
    const dir = path.join(s.root, name)
    let files: string[]
    try { files = fs.readdirSync(dir) } catch { continue } // vault.txt
    let left = 0
    for (const f of files) {
      if (!f.endsWith(".snap")) continue
      const p = path.join(dir, f)
      if (at - fs.statSync(p).mtimeMs > keep) fs.rmSync(p, { force: true })
      else left++
    }
    if (!left && !files.includes("head")) fs.rmSync(dir, { recursive: true, force: true })
  }
}

// One look at a time, off the sync (a file iCloud is slow to give waits there); the routes wait for it.
let following: Promise<void> | null = null, again = false
plugin.onSync((vault) => {
  if (following) { again = true; return }
  following = (async () => {
    do { again = false; await follow(vault) } while (again)
  })().catch((e) => console.error("history:", e)).finally(() => { following = null })
})
const timer = setInterval(() => { try { if (plugin.loaded) prune(plugin.vault) } catch (e) { console.error(e) } }, HOUR)
timer.unref()
plugin.onUnload(() => clearInterval(timer))

const relOf = (p: unknown) => {
  const rel = String(p ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  if (!rel) throw new HTTPError(400, "which file? ?path=Notes/Idea.md")
  return rel
}

function versions(s: State, rel: string) {
  let names: string[] = []
  try { names = fs.readdirSync(dirOf(s, rel)) } catch { /* none */ }
  return names.filter((f) => f.endsWith(".snap")).map((f) => {
    const t = Number(f.slice(0, -5))
    return { t, size: fs.statSync(path.join(dirOf(s, rel), f)).size }
  }).sort((a, b) => b.t - a.t)
}

/** Versions other plugins keep of a file (a git plugin's commits), shown beside these: each plugin that's on offering the service
 *  `versions:<source>`, fn(path) -> { label, versions: [{ id, t, title?, by? }] } or null, fn(path, id) -> its text. */
type Other = { id: string; t: number; title?: string; by?: string }
type VersionsFn = (rel: string, id?: string) => Promise<{ label: string; versions: Other[] } | string | null>
function sources(): [string, VersionsFn][] {
  const off = plugin.vault.switchedOff()
  return LOADED.filter((p) => p !== plugin && !off.has(p.id))
    .flatMap((p) => Object.entries(p.services).filter(([k]) => k.startsWith("versions:")).map(([k, fn]) => [k.slice(9), fn as VersionsFn] as [string, VersionsFn]))
}
async function others(rel: string) {
  const all = await Promise.all(sources().map(async ([source, fn]) => {
    try {
      const r = await fn(rel)
      if (!r || typeof r !== "object" || !Array.isArray(r.versions)) return null
      const versions = r.versions.filter((v) => typeof v?.id === "string" && Number.isFinite(v?.t)).slice(0, 200)
        .map((v) => ({ id: v.id, t: v.t, ...(v.title ? { title: String(v.title).slice(0, 200) } : {}), ...(v.by ? { by: String(v.by).slice(0, 80) } : {}) }))
      return { source, label: String(r.label || source), versions }
    } catch { return null }
  }))
  return all.filter((x) => x !== null && x.versions.length)
}

// What another plugin reads of a file's past (Activity's day recaps): its versions oldest first, each `t` when its text
// was written (the head, its text now, last), and one version's text.
plugin.provide("history:versions", async (rel: string) => {
  await following
  const s = state(plugin.vault)
  const head = s.heads.get(rel)
  const v = versions(s, rel).reverse().map((x) => ({ t: x.t }))
  if (head && !v.some((x) => x.t === head.mtime)) v.push({ t: head.mtime })
  return { gone: !head && !!readMeta(dirOf(s, rel))?.gone, versions: v }
})
plugin.provide("history:text", async (rel: string, t: number) => {
  await following
  const s = state(plugin.vault)
  for (const f of [`${t}.snap`, ...(s.heads.get(rel)?.mtime === t ? ["head"] : [])]) {
    try { return fs.readFileSync(path.join(dirOf(s, rel), f), "utf8").replace(/\r\n?/g, "\n") } catch { /* the next */ }
  }
  return null
})
/** The files followed whose text was last written at or after `since` (ms). */
plugin.provide("history:changed", async (since: number) => {
  await following
  return [...state(plugin.vault).heads.values()].filter((m) => m.mtime >= since).map((m) => m.path)
})

plugin.route("GET", "history", async (req) => {
  await following
  const s = state(plugin.vault)
  if (!req.query.path) {
    const out = []
    for (const name of fs.readdirSync(s.root)) {
      const m = readMeta(path.join(s.root, name))
      if (!m) continue
      const v = versions(s, m.path)
      if (v.length) out.push({ path: m.path, versions: v.length, latest: v[0].t, gone: !!m.gone })
    }
    return out.sort((a, b) => b.latest - a.latest)
  }
  const rel = relOf(req.query.path)
  return { path: rel, versions: versions(s, rel), others: await others(rel) }
})

plugin.route("GET", "history/version", async (req) => {
  await following
  const s = state(plugin.vault)
  const rel = relOf(req.query.path)
  if (req.query.source) {
    const fn = sources().find(([source]) => source === req.query.source)?.[1]
    const text = fn && req.query.id ? await fn(rel, String(req.query.id)).catch(() => null) : null
    if (typeof text !== "string") throw new HTTPError(404, `no version ${req.query.id} of '${rel}' from ${req.query.source}`)
    return new Text(text.replace(/\r\n?/g, "\n"), "text/plain; charset=utf-8")
  }
  const t = Number(req.query.t)
  if (!Number.isFinite(t)) throw new HTTPError(400, "which version? &t=<ms> from GET /api/history?path=")
  let data: Buffer
  try { data = fs.readFileSync(path.join(dirOf(s, rel), `${t}.snap`)) } catch { throw new HTTPError(404, `no version ${t} of '${rel}'`) }
  let text: string | Buffer
  try { text = data.toString("utf8").replace(/\r\n?/g, "\n") } catch { text = data } // (too big for one string: its bytes)
  return new Text(text, "text/plain; charset=utf-8")
})

// ---------- operations (core/ops.ts)

const when = (t: number) => { const d = new Date(t), p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}` }

plugin.op({
  id: "history.list",
  cli: "history",
  mcp: "history",
  summary: "A file's earlier versions (kept on this machine for a week), newest first; without a file, every file that has some.",
  help: `To see what a file said before an edit (yours, an AI's, another device's): its versions, then history.read with one's
time. Restoring is writing that text back (an ordinary edit, kept here too). A deleted file's last text is kept as well.

  vau history Notes/Idea.md
  vau history`,
  kind: "read",
  params: { path: { type: "string", format: "path", description: "the file (Notes/Idea.md, or its name)" } },
  args: ["path"],
  run: async ({ path: p }, ctx) => await ctx.api("GET", p ? `history?path=${encodeURIComponent(p)}` : "history"),
  text: (r) => (Array.isArray(r)
    ? (r.length ? r.map((f: { path: string; versions: number; latest: number; gone: boolean }) => `- ${f.path}: ${f.versions} version${f.versions === 1 ? "" : "s"}, the latest ${when(f.latest)}${f.gone ? " (deleted)" : ""}`).join("\n") : "No earlier versions kept yet.")
    : (r.versions.length ? [`${r.path}, newest first (history.read with its t):`, ...r.versions.map((v: { t: number; size: number }) => `- ${when(v.t)} (t ${v.t}, ${v.size} bytes)`)].join("\n") : `No earlier versions of ${r.path}.`)),
})

plugin.op({
  id: "history.read",
  mcp: "read_version",
  summary: "One earlier version of a file: its text then (t from history.list).",
  help: "  vau history.read Notes/Idea.md 1759420800000",
  kind: "read",
  params: {
    path: { type: "string", format: "path", required: true, description: "the file" },
    t: { type: "integer", required: true, description: "the version's time, in ms (history.list gives them)" },
  },
  args: ["path", "t"],
  run: async ({ path: p, t }, ctx) => ({ path: p, t, text: String(await ctx.api("GET", `history/version?path=${encodeURIComponent(p)}&t=${t}`)) }),
  text: (r) => r.text,
})
