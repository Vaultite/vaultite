// In-process benchmark of core/app.ts on a made-up vault: CPU and fs calls per request, opening in phases, sizes.
// node tools/perf/app.ts [--scale 1] [--runs 20] [--out r.json] [--compare before.json] [--root <checkout>]
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"
import { isolated, makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const SCALE = Number(arg("scale", "1")), RUNS = Number(arg("runs", "20")), OUT = arg("out", ""), COMPARE = arg("compare", "")
const CORE = pathToFileURL(path.join(path.resolve(arg("root", path.join(import.meta.dirname, "..", ".."))), "core")).href

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-perf-"))
const VAULT = path.join(tmp, "vault")
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
process.env.VAULTITE_VAULT = VAULT
Object.assign(process.env, isolated(path.join(tmp, "home")))

// --- counting file system calls
const COUNTED = ["statSync", "lstatSync", "readdirSync", "readFileSync", "existsSync", "writeFileSync", "openSync", "renameSync", "mkdirSync", "realpathSync"] as const
const calls: Record<string, number> = {}
for (const name of COUNTED) {
  const orig = (fs as unknown as Record<string, (...a: unknown[]) => unknown>)[name]
  ;(fs as unknown as Record<string, unknown>)[name] = function (this: unknown, ...a: unknown[]) {
    calls[name] = (calls[name] ?? 0) + 1
    return orig.apply(this, a)
  }
}
const counts = () => ({ ...calls })
const diff = (a: Record<string, number>, b: Record<string, number>, n = 1) =>
  Object.fromEntries(COUNTED.map((k) => [k, +(((b[k] ?? 0) - (a[k] ?? 0)) / n).toFixed(1)]).filter(([, v]) => v))
const total = (d: Record<string, number>) => +Object.values(d).reduce((x, y) => x + y, 0).toFixed(1)
const cpuMs = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }

const ENDPOINTS = ["state", "vault", "files", "plugins", "graph", "tags", "search?q=light", "render?path=Dashboards/Today.md",
  "render?path=Dashboards/People.md", "render?path=Dashboards/Health.md",
  "query?q=" + encodeURIComponent(JSON.stringify({ from: "Notes/", type: "note", sort: ["-updated"], limit: 50 }))]
const EDITED = ["state", "files", "graph"]

makeVault(VAULT, SCALE)
const result: Record<string, unknown> = { scale: SCALE, runs: RUNS, node: process.version, date: new Date().toISOString() }
try {
  const t0 = performance.now(), c0 = cpuMs(), f0 = counts()
  const { open, jsonOf } = await import(`${CORE}/app.ts`)
  const { Text } = await import(`${CORE}/plugins.ts`)
  const imported = { ms: performance.now() - t0, cpu: cpuMs() - c0, fs: total(diff(f0, counts())) }
  const opening = async () => {
    const t = performance.now(), c = cpuMs(), f = counts()
    const app = await open(VAULT)
    return { app, ms: +(performance.now() - t).toFixed(0), cpu: +(cpuMs() - c).toFixed(0), fs: diff(f, counts()) }
  }
  const first = await opening()
  const again = await opening() // the same vault, as a restarted server finds it
  result.open = { import: { ms: +imported.ms.toFixed(0), cpu: +imported.cpu.toFixed(0), fs: imported.fs },
    first: { ms: first.ms, cpu: first.cpu, fs: total(first.fs), calls: first.fs }, again: { ms: again.ms, cpu: again.cpu, fs: total(again.fs), calls: again.fs } }
  const app = again.app
  /** One GET as server.ts serves it. */
  const request = async (url: string) => {
    const u = new URL(url, "http://x/api/")
    const parts = u.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent)
    const query = Object.fromEntries(u.searchParams)
    await app.syncPlugins()
    await (app.vault.synced ? app.vault.synced() : app.vault.lock(() => app.vault.sync()))
    const out = await app.run("GET", parts, query, {})
    return out.body instanceof Text ? out.body.text : jsonOf(out.body)
  }
  // Also after an edit (a note changed on disk, as by an AI): what the app asks for again then.
  const note = path.join(VAULT, "Notes", fs.readdirSync(path.join(VAULT, "Notes")).sort()[0])
  const endpoints: Record<string, unknown> = {}
  for (const url of [...ENDPOINTS, ...EDITED.map((u) => `${u} after an edit`)]) {
    const edit = url.endsWith(" after an edit"), get = url.replace(" after an edit", "")
    await request(get)
    const c = cpuMs(), f = counts()
    let bytes = 0
    for (let i = 0; i < RUNS; i++) {
      if (edit) fs.appendFileSync(note, "\nOne more line.\n")
      bytes = Buffer.byteLength(await request(get))
    }
    const d = diff(f, counts(), RUNS)
    endpoints[url] = { cpu: +((cpuMs() - c) / RUNS).toFixed(2), fs: total(d), calls: d, bytes }
  }
  result.endpoints = endpoints
  // What a first load asks for, all at once: the syncs they wait for (server.ts coalesces them where it can).
  const burst = ["state", "files", "plugins", "render?path=Dashboards/Today.md", "graph", "tags", "vault", "config/plugins"]
  const c = cpuMs(), f = counts()
  for (let i = 0; i < RUNS; i++) await Promise.all(burst.map(request))
  const d = diff(f, counts(), RUNS)
  result.burst = { requests: burst.length, cpu: +((cpuMs() - c) / RUNS).toFixed(2), fs: total(d), calls: d }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

type Row = { cpu: number; fs: number; bytes: number }
const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const ratio = (a?: number, b?: number) => (a && b ? ` (${(a / b).toFixed(1)}x)` : "")
const fmt = (n: number) => (n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${n}B`)
const o = result.open as Record<string, { ms: number; cpu: number; fs: number }>
console.log(`scale ${SCALE}, node ${process.version}`)
for (const k of ["import", "first", "again"]) {
  const b = before?.open?.[k]
  console.log(`open ${k.padEnd(6)} ${String(o[k].ms).padStart(6)}ms cpu ${String(o[k].cpu).padStart(6)}ms${ratio(b?.cpu, o[k].cpu)} fs calls ${String(o[k].fs).padStart(7)}${ratio(b?.fs, o[k].fs)}`)
}
const bu = result.burst as Row
console.log(`first-load burst: cpu ${bu.cpu}ms${ratio(before?.burst.cpu, bu.cpu)}, fs calls ${bu.fs}${ratio(before?.burst.fs, bu.fs)}`)
for (const [url, e] of Object.entries(result.endpoints as Record<string, Row>)) {
  const b = before?.endpoints[url] as Row | undefined
  console.log(`${url.slice(0, 44).padEnd(44)} cpu ${String(e.cpu).padStart(7)}ms${ratio(b?.cpu, e.cpu).padEnd(8)} fs ${String(e.fs).padStart(7)}${ratio(b?.fs, e.fs).padEnd(9)} ${fmt(e.bytes).padStart(6)}`)
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
process.exit(0)
