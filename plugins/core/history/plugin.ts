import crypto from "node:crypto"
import { once } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { HTTPError, isTextKind, kindOf, LOADED, LOCAL, localDate, localTime, logger, Plugin, Text, vaultHere } from "../../../core/plugins.ts"
import { fetchFromICloud, READ_WAIT, type Vault, writeAtomic } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)
const log = logger("history")

const HOUR = 3600_000

type Stat = { mtime: number; size: number; ns?: string }
const META = z.object({ mtime: z.number(), size: z.number(), ns: z.string().optional(), path: z.string(), hash: z.string(), last: z.number(), gone: z.boolean().optional() })
type Meta = z.infer<typeof META>
const ERRNO = z.object({ errno: z.number() }).catch({ errno: 0 })
const KEEP = z.object({ path: z.unknown(), text: z.string().optional().catch(undefined) })
type State = { root: string; heads: Map<string, Meta>; skip: Map<string, string>; pruned: number; version: number; seen: Map<string, object>
  saving: ReturnType<typeof setTimeout> | null }
const INDEX = "heads.json"

const sha1 = (s: string | Buffer) => crypto.createHash("sha1").update(s).digest("hex")
const states = new WeakMap<Vault, State>()

function state(vault: Vault): State {
  let s = states.get(vault)
  if (s) return s
  const { key, real } = vaultHere(vault.path)
  const root = path.join(LOCAL, "history", key)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, "vault.txt"), real + "\n")
  s = { root, heads: new Map(), skip: new Map(), pruned: Date.now() - HOUR + 60_000, version: -1, seen: new Map(), saving: null }
  let index: Meta[] | null = null
  try { index = z.array(META).parse(JSON.parse(fs.readFileSync(path.join(root, INDEX), "utf8"))) } catch { /* none yet */ }
  for (const m of index ?? []) s.heads.set(m.path, m)
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith("tmp-")) { fs.rmSync(path.join(root, name), { force: true }); continue }
    if (index) continue
    const m = readMeta(path.join(root, name))
    if (m && !m.gone) s.heads.set(m.path, m)
  }
  if (!index) (s.saving = setTimeout(() => saveIndex(s), 10_000)).unref?.()
  states.set(vault, s)
  return s
}

const dirOf = (s: State, rel: string) => path.join(s.root, sha1(rel).slice(0, 16))

function readMeta(dir: string): Meta | null {
  try { return META.parse(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"))) } catch { return null }
}
const writeMeta = (s: State, m: Meta) => writeAtomic(path.join(dirOf(s, m.path), "meta.json"), JSON.stringify(m))

function current(s: State, rel: string): Meta | undefined {
  const m = readMeta(dirOf(s, rel))
  if (m && !m.gone && m.path === rel) s.heads.set(rel, m)
  else s.heads.delete(rel)
  return s.heads.get(rel)
}

function saveIndex(s: State) {
  if (s.saving) clearTimeout(s.saving)
  s.saving = null
  try { writeAtomic(path.join(s.root, INDEX), JSON.stringify([...s.heads.values()])) } catch (e) { log.error("writing the index", e) }
}

/** undefined: unreadable now (iCloud may give it at its next sync). */
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
    result = stalled || Math.abs(ERRNO.parse(e).errno) === 11 ? undefined : null
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

function candidates(s: State, vault: Vault) {
  const out = new Map<string, Stat>()
  let followed = 0, all = 0
  const look = (rel: string, st: { ns: bigint; size: number }) => {
    all++
    if (s.heads.has(rel)) followed++
    if (s.seen.get(rel) === st) return
    s.seen.set(rel, st)
    out.set(rel, { mtime: Number(st.ns / 1000000n), size: st.size, ns: String(st.ns) })
  }
  for (const [rel, e] of vault.entries) look(rel, e.stat)
  for (const [rel, st] of vault.others) if (isTextKind(kindOf(rel))) look(rel, st)
  const followedNow = (rel: string) => vault.entries.has(rel) || (vault.others.has(rel) && isTextKind(kindOf(rel)))
  if (s.seen.size > all) for (const rel of s.seen.keys()) if (!followedNow(rel)) s.seen.delete(rel)
  return { out, gone: followed < s.heads.size ? [...s.heads.keys()].filter((r) => !followedNow(r) && present(vault, r)) : [] }
}

function settings() {
  const s = plugin.settings()
  const n = (v: unknown, d: number) => (typeof v === "number" && v >= 0 ? v : d)
  return { interval: n(s.interval_min, 5) * 60_000, keep: n(s.keep_days, 7) * 24 * HOUR }
}

function snapshot(s: State, rel: string, t: number) {
  const dir = dirOf(s, rel), file = path.join(dir, `${t}.snap`)
  if (fs.existsSync(file)) return fs.rmSync(path.join(dir, "head"), { force: true })
  fs.renameSync(path.join(dir, "head"), file)
  const now = new Date()
  fs.utimesSync(file, now, now)
}

function track(s: State, rel: string, st: Stat, copy: string, hash: string) {
  const dir = dirOf(s, rel)
  fs.mkdirSync(dir, { recursive: true })
  fs.renameSync(copy, path.join(dir, "head"))
  const m: Meta = { path: rel, ...st, hash, last: readMeta(dir)?.last ?? 0 }
  writeMeta(s, m)
  s.heads.set(rel, m)
}

function untrack(s: State, rel: string) {
  const m = s.heads.get(rel)!
  try { snapshot(s, rel, m.mtime) } catch { /* its head went missing */ }
  writeMeta(s, { ...m, gone: true })
  s.heads.delete(rel)
}

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

/** A whole top-level folder missing may be iCloud or a disk away, not a delete. */
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

export async function follow(vault: Vault) {
  if (isOff(vault)) {
    const s = states.get(vault)
    if (s) { s.version = -1; s.seen.clear() }
    return
  }
  const s = state(vault)
  if (s.version === vault.version) {
    if (Date.now() - s.pruned > HOUR) prune(vault)
    return
  }
  s.version = vault.version
  const { out: now, gone } = candidates(s, vault)
  const added: string[] = [], changed: string[] = []
  const differs = (m: Meta, st: Stat) => m.mtime !== st.mtime || m.size !== st.size || (m.ns !== undefined && m.ns !== st.ns)
  for (const [rel, st] of now) {
    let m = s.heads.get(rel)
    if (!m || differs(m, st)) m = current(s, rel)
    if (!m) { if (s.skip.get(rel) !== `${st.mtime}:${st.size}`) added.push(rel) }
    else if (differs(m, st)) changed.push(rel)
  }
  for (let i = gone.length - 1; i >= 0; i--) if (!current(s, gone[i])) gone.splice(i, 1)
  if (added.length || changed.length || gone.length) {
    s.saving ??= setTimeout(() => saveIndex(s), 10_000)
    s.saving.unref?.()
    const { interval } = settings()
    for (const rel of changed) {
      const m = s.heads.get(rel)!, st = now.get(rel)!, copy = tmp(s)
      const hash = await take(vault.abs(rel), copy)
      if (hash === undefined) { s.version = -1; s.seen.delete(rel); continue }
      if (hash === null) { untrack(s, rel); s.skip.set(rel, `${st.mtime}:${st.size}`); continue }
      if (hash !== m.hash) {
        if (Date.now() - m.last >= interval) {
          try { snapshot(s, rel, m.mtime); m.last = Date.now() } catch { /* no head */ }
        }
        fs.renameSync(copy, path.join(dirOf(s, rel), "head"))
        m.hash = hash
      } else fs.rmSync(copy, { force: true })
      m.mtime = st.mtime; m.size = st.size; m.ns = st.ns
      writeMeta(s, m)
    }
    const byHash = new Map(gone.map((r) => [s.heads.get(r)!.hash, r]))
    for (const rel of added) {
      const st = now.get(rel)!, copy = tmp(s)
      const hash = await take(vault.abs(rel), copy)
      if (hash === undefined) { s.version = -1; s.seen.delete(rel); continue }
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

export function prune(vault: Vault, at = Date.now()) {
  const s = state(vault)
  s.pruned = at
  const { keep } = settings()
  for (const name of fs.readdirSync(s.root)) {
    const dir = path.join(s.root, name)
    let files: string[]
    try { files = fs.readdirSync(dir) } catch { continue }
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

let following: Promise<void> | null = null, again = false
plugin.onSync((vault) => {
  if (following) { again = true; return }
  following = (async () => {
    do { again = false; await follow(vault) } while (again)
  })().catch((e) => { states.get(vault)?.seen.clear(); log.error("following changes", e) }).finally(() => { following = null })
})
const timer = setInterval(() => { try { if (plugin.loaded) prune(plugin.vault) } catch (e) { log.error("pruning", e) } }, HOUR)
timer.unref()
plugin.onUnload(() => {
  clearInterval(timer)
  const s = plugin.loaded ? states.get(plugin.vault) : undefined
  if (s?.saving) saveIndex(s)
})

const relOf = (p: unknown) => {
  const rel = String(p ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  if (!rel) throw new HTTPError(400, "which file? ?path=Notes/Idea.md")
  return rel
}

function times(s: State, rel: string) {
  return namesIn(dirOf(s, rel)).filter((f) => f.endsWith(".snap")).map((f) => Number(f.slice(0, -5))).sort((a, b) => b - a)
}
const listed = new Map<string, { at: string; names: string[] }>()
function namesIn(dir: string): string[] {
  let st: fs.BigIntStats
  try { st = fs.statSync(dir, { bigint: true }) } catch { listed.delete(dir); return [] }
  const at = `${st.ino}:${st.mtimeNs}`, hit = listed.get(dir)
  if (hit?.at === at) return hit.names
  let names: string[] = []
  try { names = fs.readdirSync(dir) } catch { /* gone meanwhile */ }
  // A coarse clock can give a folder's next change the same mtime.
  if (Date.now() - Number(st.mtimeNs / 1_000_000n) > 2000) listed.set(dir, { at, names }); else listed.delete(dir)
  return names
}
function versions(s: State, rel: string) {
  return times(s, rel).map((t) => ({ t, size: fs.statSync(path.join(dirOf(s, rel), `${t}.snap`)).size }))
}

/** Service `versions:<source>`: fn(path) -> { label, versions } or null; fn(path, id) -> that version's text. */
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

/** A file's versions, oldest first, its text now last. */
plugin.provide("history:versions", async (rel: string) => {
  await following
  const s = state(plugin.vault)
  const head = s.heads.get(rel)
  const v = times(s, rel).reverse().map((t) => ({ t }))
  if (head && !v.some((x) => x.t === head.mtime)) v.push({ t: head.mtime })
  return { gone: !head && !!readMeta(dirOf(s, rel))?.gone, versions: v }
})
/** One version's text. */
plugin.provide("history:text", async (rel: string, t: number) => {
  await following
  const s = state(plugin.vault)
  for (const f of [`${t}.snap`, ...(s.heads.get(rel)?.mtime === t ? ["head"] : [])]) {
    try { return fs.readFileSync(path.join(dirOf(s, rel), f), "utf8").replace(/\r\n?/g, "\n") } catch { /* the next */ }
  }
  return null
})
const followed = (vault: Vault, rel: string) => !isOff(vault) && (vault.entries.has(rel) || (vault.others.has(rel) && isTextKind(kindOf(rel))))
function keepDisk(rel: string) {
  const vault = plugin.vault
  if (!followed(vault, rel)) return false
  try {
    const st = fs.statSync(vault.abs(rel), { bigint: true })
    const file = path.join(dirOf(state(vault), rel), `${Number(st.mtimeNs / 1000000n)}.snap`)
    if (fs.existsSync(file)) return true
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(vault.abs(rel), file)
    const now = new Date()
    fs.utimesSync(file, now, now)
    return true
  } catch { return false }
}
/** Keeps a file's text now as a version, whatever the interval; sync, so it runs before the write. */
plugin.provide("history:keep", keepDisk)
function keepText(rel: string, text: string) {
  const vault = plugin.vault
  if (!followed(vault, rel)) return false
  const dir = dirOf(state(vault), rel)
  fs.mkdirSync(dir, { recursive: true })
  let t = Date.now()
  while (fs.existsSync(path.join(dir, `${t}.snap`))) t++
  writeAtomic(path.join(dir, `${t}.snap`), text)
  return true
}

plugin.route("POST", "history/keep", (req) => {
  const b = KEEP.parse(req.body ?? {})
  const rel = relOf(b.path)
  return { kept: b.text !== undefined ? keepText(rel, b.text) : keepDisk(rel) }
})

/** The files followed whose text was last written at or after `since` (ms). */
plugin.provide("history:changed", async (since: number) => {
  await following
  return [...state(plugin.vault).heads.values()].filter((m) => m.mtime >= since).map((m) => m.path)
})

const Kept = z.union([
  z.array(z.looseObject({ path: z.string(), versions: z.number(), latest: z.number(), gone: z.boolean() })),
  z.looseObject({ path: z.string(), versions: z.array(z.looseObject({ t: z.number(), size: z.number() })) }),
])

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
  return { path: rel, versions: await byAgents(rel, versions(s, rel)), others: await others(rel) }
})

type Change = { t: number; last?: number; actor: { kind: string; name: string }; paths?: string[] }
async function byAgents(rel: string, vs: { t: number; size: number }[]): Promise<{ t: number; size: number; by?: string }[]> {
  if (!vs.length) return vs
  const changes = (await plugin.ask<Change[]>("activity:changes", [], vs.at(-1)!.t - 60_000)).filter((e) => e.paths?.includes(rel))
  return vs.map((v) => {
    const e = changes.findLast((c) => c.t - 1000 <= v.t && v.t <= (c.last ?? c.t) + 5000)
    return e?.actor.kind === "agent" ? { ...v, by: e.actor.name } : v
  })
}

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
  try { text = data.toString("utf8").replace(/\r\n?/g, "\n") } catch { text = data }
  return new Text(text, "text/plain; charset=utf-8")
})

const when = (t: number) => `${localDate(t)} ${localTime(t)}`

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
  run: async ({ path: p }, ctx) => Kept.parse(await ctx.api("GET", p ? `history?path=${encodeURIComponent(p)}` : "history")),
  text: (r) => (Array.isArray(r)
    ? (r.length ? r.map((f) => `- ${f.path}: ${f.versions} version${f.versions === 1 ? "" : "s"}, the latest ${when(f.latest)}${f.gone ? " (deleted)" : ""}`).join("\n") : "No earlier versions kept yet.")
    : (r.versions.length ? [`${r.path}, newest first (history.read with its t):`, ...r.versions.map((v) => `- ${when(v.t)} (t ${v.t}, ${v.size} bytes)`)].join("\n") : `No earlier versions of ${r.path}.`)),
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
