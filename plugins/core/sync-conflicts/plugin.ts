import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { HTTPError, LOCAL, localDate, localTime, merge3, Plugin } from "../../../core/plugins.ts"

export const plugin = new Plugin(import.meta.url)

export type Version = { id: string; at: number; from: string }
export type VersionText = Version & { text: string | null }

const SCAN_MS = 10 * 60_000, FIRST_MS = 20_000, RECHECK_MS = 3000, MANY = 300

const SWIFT = path.join(import.meta.dirname, "versions.swift")
export const helperName = () => `versions-${crypto.createHash("sha1").update(fs.readFileSync(SWIFT)).digest("hex").slice(0, 12)}`
const runnable = (p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false } }
const quiet = (bin: string, args: string[], timeout = 300_000) => new Promise<{ ok: boolean; out: string; err: string }>((done) =>
  execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => done({ ok: !e, out: String(out), err: String(err).trim() || (e?.message ?? "") })))

export async function buildHelper(dir: string, archs: string[] = []): Promise<string> {
  const out = path.join(dir, helperName())
  if (runnable(out)) return out
  if (!(await quiet("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${out}.${process.pid}`
  const slices = archs.map((a) => [`${tmp}-${a}`, "-target", `${a}-apple-macos13`])
  try {
    for (const [file, ...target] of slices.length ? slices : [[tmp]]) {
      const r = await quiet("/usr/bin/xcrun", ["swiftc", "-O", ...target, SWIFT, "-o", file])
      if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").filter((l) => l.includes("error")).slice(0, 2).join(" ")}`)
    }
    if (slices.length) {
      const r = await quiet("/usr/bin/xcrun", ["lipo", "-create", ...slices.map((s) => s[0]), "-output", tmp])
      if (!r.ok) throw new Error(`lipo: ${r.err}`)
    }
    fs.renameSync(tmp, out)
  } finally { for (const f of [tmp, ...slices.map((s) => s[0])]) fs.rmSync(f, { force: true }) }
  return out
}

let built: Promise<string> | null = null
const helper = () => built ??= (async () => {
  const shipped = path.join(import.meta.dirname, "bin", helperName())
  return runnable(shipped) ? shipped : await buildHelper(path.join(LOCAL, "bin"))
})().catch((e) => { built = null; throw e })
async function run(args: string[], timeout = 120_000) {
  const r = await quiet(await helper(), args, timeout)
  if (!r.ok) throw new Error(`versions ${args[0]}: ${r.err.split("\n")[0]}`)
  return r.out
}

const VersionOut = z.object({ id: z.string(), at: z.number(), from: z.unknown().optional(), text: z.unknown().optional() })
const valid = <T>(one: z.ZodType<T>) => z.array(z.unknown()).catch([]).transform((list) => list.flatMap((v) => {
  const r = one.safeParse(v)
  return r.success ? [r.data] : []
}))
const Versions = valid(VersionOut.transform((v): Version => ({ id: v.id, at: v.at, from: String(v.from ?? "") })))
const VersionTexts = valid(VersionOut.transform((v): VersionText => ({ id: v.id, at: v.at, from: String(v.from ?? ""), text: typeof v.text === "string" ? v.text.replace(/\r\n?/g, "\n") : null })))
const ScanLine = z.object({ path: z.string(), versions: Versions })
const ReadOut = z.object({ versions: VersionTexts })
const ResolveOut = z.object({ resolved: z.number().catch(0) })

export const store = {
  on(vault: string) {
    if (process.platform !== "darwin") return false
    try { return fs.realpathSync(vault).startsWith(path.join(os.homedir(), "Library", "Mobile Documents") + path.sep) } catch { return false }
  },
  async scan(paths: string[]): Promise<Map<string, Version[]>> {
    const out = new Map<string, Version[]>()
    if (!paths.length) return out
    for (const line of (await run(["scan", ...paths])).split("\n")) {
      if (!line.trim()) continue
      try {
        const o = ScanLine.safeParse(JSON.parse(line))
        if (o.success && o.data.versions.length) out.set(o.data.path, o.data.versions)
      } catch {}
    }
    return out
  },
  async read(abs: string): Promise<VersionText[]> {
    return ReadOut.parse(JSON.parse(await run(["read", abs], 30_000))).versions
  },
  async resolve(abs: string, ids: string[]): Promise<number> {
    return ResolveOut.parse(JSON.parse(await run(["resolve", abs, ...ids], 30_000))).resolved
  },
}

type Found = Record<string, Version[]>
const found = (): Found => plugin.kept<Found>("found", {})
const synced = async (): Promise<Found> => (await plugin.ask<Found>("sync:conflicts", {})) ?? {}
plugin.state(async () => {
  const all: Found = { ...found() }
  for (const [p, vs] of Object.entries(await synced())) all[p] = [...(all[p] ?? []), ...vs]
  return { syncConflicts: all }
})

const root = () => { try { return fs.realpathSync(plugin.vault.path) } catch { return plugin.vault.path } }
const relOf = (abs: string, from: string) => path.relative(from, abs).split(path.sep).join("/")
const skipped = (rel: string) => !rel || rel.startsWith("..") || rel.split("/").some((p) => p === ".git" || p === "node_modules")

let scanning: Promise<void> | null = null, again: Promise<void> | null = null, lastScan = 0
function scanAll(fresh = false): Promise<void> {
  if (scanning) return fresh ? (again ??= scanning.then(() => { again = null; return scanAll() })) : scanning
  const s = scanning = (async () => {
    try {
      if (!store.on(plugin.vault.path)) { if (Object.keys(found()).length) plugin.keep("found", null); return }
      const from = root(), next: Found = {}
      for (const [abs, vs] of await store.scan([from])) { const rel = relOf(abs, from); if (!skipped(rel)) next[rel] = vs }
      plugin.keep("found", Object.keys(next).length ? next : null)
      lastScan = Date.now()
    } catch (e) { console.warn(`sync-conflicts: ${e instanceof Error ? e.message : String(e)}`) }
  })()
  void s.finally(() => { if (scanning === s) scanning = null })
  return s
}
async function recheck(rels: string[]) {
  if (!rels.length || !store.on(plugin.vault.path)) return
  const from = root()
  const got = await store.scan(rels.map((r) => path.join(from, r)))
  const next = { ...found() }
  for (const rel of rels) delete next[rel]
  for (const [abs, vs] of got) { const rel = relOf(abs, from); if (!skipped(rel)) next[rel] = vs }
  plugin.keep("found", Object.keys(next).length ? next : null)
}

let pending = new Set<string>(), timer: ReturnType<typeof setTimeout> | null = null
plugin.onChange((paths) => {
  if (!store.on(plugin.vault.path)) return
  if (paths === null) { if (Date.now() - lastScan > 2 * 60_000) void scanAll(); return }
  for (const p of paths) if (!skipped(p)) pending.add(p)
  timer ??= setTimeout(() => {
    timer = null
    const rels = [...pending]
    pending = new Set()
    if (rels.length > MANY) return void scanAll()
    recheck(rels.filter((r) => fs.statSync(plugin.vault.abs(r), { throwIfNoEntry: false })?.isFile() || found()[r]))
      .catch((e) => console.warn(`sync-conflicts: ${e instanceof Error ? e.message : String(e)}`))
  }, RECHECK_MS)
  timer.unref?.()
})
const first = setTimeout(() => void scanAll(), FIRST_MS), every = setInterval(() => void scanAll(), SCAN_MS)
first.unref?.()
every.unref?.()
plugin.onUnload(() => { clearTimeout(first); clearInterval(every); if (timer) clearTimeout(timer) })

// iCloud names a Mac by its host name, the first part of its Tailscale name.
async function labelOf(from: string) {
  const name = from.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const ms = await plugin.ask<{ label: string; url: string }[]>("machines", [])
  const m = ms.find((x) => { try { return new URL(x.url).hostname.split(".")[0].toLowerCase() === name } catch { return false } })
  return m?.label || from || "another device"
}

async function baseFor(rel: string, other: VersionText, mtime: number): Promise<string | null> {
  if (other.text === null) return null
  const h = await plugin.ask<{ versions?: { t: number }[] }>("history:versions", {}, rel)
  const times = (h.versions ?? []).map((v) => v.t).filter((t) => t < mtime).sort((a, b) => b - a).slice(0, 100)
  let older: string | null = null
  for (const t of times) {
    const text = await plugin.ask<string | null>("history:text", null, rel, t)
    if (text === null) continue
    if (text === other.text) return text
    if (older === null && t <= other.at) older = text
  }
  return older
}

const fileOf = (p: unknown) => {
  const rel = String(p ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  if (!rel || skipped(rel)) throw new HTTPError(400, "which file? ?path=Notes/Idea.md")
  const abs = plugin.vault.abs(rel)
  if (!path.resolve(abs).startsWith(path.resolve(plugin.vault.path) + path.sep)) throw new HTTPError(400, `${rel} isn't a vault path`)
  const st = fs.statSync(abs, { throwIfNoEntry: false })
  if (!st?.isFile()) throw new HTTPError(404, `${rel} isn't in the vault`)
  return { rel, abs, mtime: st.mtimeMs }
}

function mergeOf(text: string, v: VersionText, base: string | null): "same" | "clean" | "clashes" | "none" {
  if (v.text === null) return "none"
  if (v.text === text) return "same"
  const m = base === null ? null : merge3(base, text, v.text)
  return m === null ? "clashes" : m === text ? "same" : "clean"
}

plugin.route("GET", "sync-conflicts/versions", async (req) => {
  await plugin.ownerOnly(req, "Other versions of a file")
  const { rel, abs, mtime } = fileOf(req.query.path)
  const text = fs.readFileSync(abs, "utf8").replace(/\r\n?/g, "\n")
  const fromSync = (await plugin.ask<(VersionText & { base: string | null })[]>("sync:conflicts", [], rel) ?? [])
    .map((v) => ({ ...v, label: v.from, merge: mergeOf(text, v, v.base) }))
  if (!store.on(plugin.vault.path)) return { path: rel, versions: fromSync }
  const vs = await store.read(abs)
  if (vs.length !== (found()[rel]?.length ?? 0)) void recheck([rel]).catch(() => {})
  const versions = await Promise.all(vs.sort((a, b) => a.at - b.at).map(async (v) => {
    const base = await baseFor(rel, v, mtime)
    return { ...v, label: await labelOf(v.from), base, merge: mergeOf(text, v, base) }
  }))
  return { path: rel, versions: [...versions, ...fromSync] }
}, { lock: false })

const ResolveBody = z.object({ path: z.unknown().optional(), id: z.string().catch("") }).catch({ path: undefined, id: "" })
plugin.route("POST", "sync-conflicts/resolve", async (req) => {
  await plugin.ownerOnly(req, "Other versions of a file")
  const b = ResolveBody.parse(req.body ?? {})
  const { rel, abs } = fileOf(b.path)
  if (!b.id) throw new HTTPError(400, "which version? {path, id} (from GET sync-conflicts/versions)")
  if (b.id.startsWith("sync:")) return { resolved: await plugin.ask<number>("sync:settle", 0, rel, b.id) }
  const resolved = await store.resolve(abs, [b.id])
  await recheck([rel])
  return { resolved }
}, { lock: false })

plugin.provide("versions:icloud", async (rel: string, id?: string) => {
  const vs = found()[rel]
  if (!vs?.length) return null
  if (id === undefined) return { label: "iCloud's other versions", versions: vs.map((v) => ({ id: v.id, t: v.at, by: v.from })) }
  return (await store.read(plugin.vault.abs(rel))).find((v) => v.id === id)?.text ?? null
})

const when = (t: number) => `${localDate(t)} ${localTime(t)}`
plugin.op({
  id: "sync-conflicts.list",
  cli: "conflicts",
  summary: "Files iCloud Drive kept another version of out of sight (two devices changed them at once), on this machine.",
  help: `Each file with versions iCloud kept apart when it showed another (macOS's unresolved conflicts), and when and
on which device each was saved. The user settles them in the note (a banner offers to merge one in); a file's versions'
text: sync-conflicts.read. Nothing here changes them.

  vau conflicts
  vau conflicts --scan     look at the whole vault again first`,
  kind: "read",
  params: { scan: { type: "boolean", description: "look at the whole vault again first (a few seconds)" } },
  run: async ({ scan }) => {
    if (scan) { lastScan = 0; await scanAll(true) }
    const all = found()
    return { on: store.on(plugin.vault.path), files: Object.entries(all).sort(([a], [b]) => a.localeCompare(b)).map(([p, versions]) => ({ path: p, versions })) }
  },
  text: (r: { on: boolean; files: { path: string; versions: Version[] }[] }) => !r.on ? "This vault isn't in iCloud Drive on this machine: iCloud keeps no versions apart here."
    : !r.files.length ? "No file has another version iCloud kept apart."
    : r.files.map((f) => `- ${f.path}: ${f.versions.map((v) => `${when(v.at)} from ${v.from || "another device"}`).join("; ")}`).join("\n"),
})

plugin.op({
  id: "sync-conflicts.read",
  summary: "A file's versions iCloud Drive kept out of sight, with their text, oldest first.",
  help: "  vau sync-conflicts.read Notes/Idea.md",
  kind: "read",
  params: { path: { type: "string", format: "path", required: true, description: "the file" } },
  args: ["path"],
  run: async ({ path: p }, ctx) => await ctx.api("GET", `sync-conflicts/versions?path=${encodeURIComponent(p)}`),
  text: (r: { path: string; versions: (VersionText & { label: string })[] }) => !r.versions.length ? `iCloud keeps no other version of ${r.path}.`
    : r.versions.map((v) => `## ${when(v.at)} from ${v.label}\n\n${v.text ?? "(not text)"}`).join("\n\n"),
})
