// Server benchmark on a made-up vault: boot, each endpoint's time and CPU, the first-load burst, bytes on the wire, refreshes.
// node tools/perf/server.ts [--scale 1] [--runs 15] [--boots 3] [--only boot] [--out r.json] [--compare b.json] [--root <dir>] [--client none]
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { freePort, isolated, makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const SCALE = Number(arg("scale", "1")), RUNS = Number(arg("runs", "15")), OUT = arg("out", ""), COMPARE = arg("compare", "")
const BOOTS = Number(arg("boots", "3")), ONLY = arg("only", "")
const PORT = Number(arg("port", "")) || await freePort()
const BASE = `http://127.0.0.1:${PORT}`

/** Asked as the web app asks (Activity looks up any other caller's process on each request, which isn't the app's cost);
 *  `--client none` asks as a script or an agent does (no header). */
const CLIENT = arg("client", "app/web")
const APP: Record<string, string> = CLIENT === "none" ? {} : { "X-Vaultite-Client": CLIENT }
const ENDPOINTS = ["/api/state", "/api/vault", "/api/files", "/api/plugins", "/api/graph", "/api/tags", "/api/search?q=light",
  "/api/render?path=Dashboards/Today.md", "/api/render?path=Dashboards/People.md", "/api/render?path=Dashboards/Health.md",
  "/api/query?q=" + encodeURIComponent(JSON.stringify({ from: "Notes/", type: "note", sort: ["-updated"], limit: 50 })), "/"]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-perf-"))
const VAULT = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local")

type Boot = { child: ChildProcess; up: number; ready: number; cpu: number }

/** Start the server; resolves once the API answers, with when the page answered first and its CPU by then. */
async function boot(): Promise<Boot> {
  const t0 = performance.now()
  const child = spawn(process.execPath, ["server.ts"], {
    cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL, PORT: String(PORT), HOST: "127.0.0.1" },
  })
  // What it said last, to show if it stops on its own (a crash is a finding, not noise).
  let said = ""
  child.stderr!.on("data", (b: Buffer) => { said = (said + b.toString()).slice(-4000) })
  child.once("exit", (code, signal) => { if (code) console.error(`the server stopped (exit ${code}${signal ? `, ${signal}` : ""}):\n${said.split("\n").filter((l) => !l.startsWith('"')).join("\n")}`) })
  const answers = async (url: string) => {
    for (;;) {
      try {
        const r = await fetch(BASE + url, { headers: APP })
        const body = await r.text()
        if (!r.ok) throw new Error(`${url} answered ${r.status} while the server started: ${body.slice(0, 200)}`) // a bug, not a wait
        return performance.now() - t0
      } catch (e) {
        if (!(e instanceof TypeError)) throw e // TypeError: fetch failed, not up yet
      }
      if (child.exitCode !== null) throw new Error("the server exited")
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  try {
    const [up, ready] = await Promise.all([answers("/"), answers("/api/vault")])
    return { child, up, ready, cpu: cpu(child) }
  } catch (e) {
    child.kill()
    throw e
  }
}

/** A process's CPU time so far (user + system), in ms. */
function cpu(c: ChildProcess) {
  const t = execFileSync("/bin/ps", ["-o", "time=", "-p", String(c.pid)], { encoding: "utf8" }).trim() // [h:]m:ss.cc
  return t.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) * 1000
}

const stop = (c: ChildProcess) => new Promise<void>((r) => { c.once("exit", () => r()); c.kill() })

async function time(url: string, headers: Record<string, string> = {}) {
  const t0 = performance.now()
  const r = await fetch(BASE + url, { headers: { ...APP, ...headers } })
  const buf = await r.arrayBuffer()
  return { ms: performance.now() - t0, status: r.status, bytes: buf.byteLength }
}

/** Bytes on the wire to a client over the network, as Tailscale Serve passes it on (undici decompresses, so the size is
 *  the Content-Length), and the status of asking again with its ETag (304: nothing sent). */
async function wire(url: string, enc: string) {
  const headers = { "Accept-Encoding": enc, "X-Forwarded-For": "100.64.0.1" }
  const r = await fetch(BASE + url, { headers: { ...APP, ...headers } })
  const len = r.headers.get("content-length")
  const body = await r.arrayBuffer()
  const etag = r.headers.get("etag")
  const again = etag ? (await fetch(BASE + url, { headers: { ...APP, ...headers, "If-None-Match": etag } })) : null
  await again?.arrayBuffer()
  return { bytes: len ? Number(len) : body.byteLength, encoding: r.headers.get("content-encoding") ?? "identity",
    cache: r.headers.get("cache-control") ?? "", again: again?.status ?? null }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), min: +s[0].toFixed(2) }
}

/** Each endpoint's times, CPU and bytes, then the first-load burst, against a running server. */
async function measure(child: ChildProcess) {
  const assets = fs.readFileSync(path.join(ROOT, "web", "dist", "index.html"), "utf8").match(/\.\/assets\/[^"]+/g) ?? []
  const endpoints: Record<string, unknown> = {}
  for (const url of [...ENDPOINTS, ...assets.map((a) => a.slice(1))]) {
    await time(url) // warm-up
    const ms: number[] = []
    let last = { status: 0, bytes: 0 }
    const c0 = cpu(child)
    for (let i = 0; i < RUNS; i++) { const t = await time(url); ms.push(t.ms); last = t }
    if (last.status !== 200) throw new Error(`${url} answered ${last.status}`)
    const cpuMs = +((cpu(child) - c0) / RUNS).toFixed(1)
    const w = await wire(url, "br, gzip")
    endpoints[url] = { ...stats(ms), cpu: cpuMs, status: last.status, bytes: last.bytes, wire: w.bytes, encoding: w.encoding, cache: w.cache, again: w.again }
  }
  result.endpoints = endpoints
  // What a first load asks for at once (web/src/core/data.ts and the shell): all in flight together.
  const burst = ["/api/state?since=0", "/api/files", "/api/plugins", "/api/render?path=Dashboards/Today.md", "/api/graph", "/api/tags", "/api/vault", "/api/config/plugins"]
  const bursts: number[] = []
  const c0 = cpu(child)
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    await Promise.all(burst.map((u) => time(u)))
    bursts.push(performance.now() - t0)
  }
  result.burst = { requests: burst.length, ...stats(bursts), cpu: +((cpu(child) - c0) / RUNS).toFixed(1) }

  // A change on disk and the web app's refresh after it (GET /api/state?since=<v>), over the network: a note, a timeline
  // line, a workspace's tabs. A checkout that doesn't know `since` answers the whole state.
  const first = (dir: string) => path.join(VAULT, dir, fs.readdirSync(path.join(VAULT, dir)).filter((f) => f.endsWith(".md")).sort()[0])
  const note = first("Notes"), person = first("People"), ws = path.join(VAULT, ".vaultite/plugins/workspaces/data.json")
  fs.mkdirSync(path.dirname(ws), { recursive: true })
  const edits: Record<string, (i: number) => void> = {
    note: (i) => fs.appendFileSync(note, `\nEdited ${i}.\n`),
    person: (i) => fs.writeFileSync(person, fs.readFileSync(person, "utf8").replace(/## Timeline\n/, `## Timeline\n\n- 2026-09-29 · note · Perf ${i}\n`)),
    workspaces: (i) => fs.writeFileSync(ws, JSON.stringify({ workspaces: [{ name: "Perf", panels: [], layout: { root: { id: "g0",
      tabs: Array.from({ length: 1 + (i % 4) }, (_, k) => ({ id: `t${k}`, to: "file:ME.md" })), active: "t0" } } }] })),
  }
  const refreshes: Record<string, unknown> = {}
  const headers = { ...APP, "Accept-Encoding": "br, gzip", "X-Forwarded-For": "100.64.0.1" }
  for (const [kind, edit] of Object.entries(edits)) {
    let v = ((await (await fetch(`${BASE}/api/state?since=0`, { headers: APP })).json()) as { v?: string }).v ?? "0"
    const ms: number[] = [], wires: number[] = []
    const c1 = cpu(child)
    for (let i = 0; i < RUNS; i++) {
      edit(i)
      const t0 = performance.now()
      const r = await fetch(`${BASE}/api/state?since=${encodeURIComponent(v)}`, { headers })
      const len = Number(r.headers.get("content-length"))
      v = ((await r.json()) as { v?: string }).v ?? "0"
      ms.push(performance.now() - t0)
      wires.push(len)
    }
    refreshes[kind] = { ...stats(ms), cpu: +((cpu(child) - c1) / RUNS).toFixed(1), wire: stats(wires).median }
  }
  result.refresh = refreshes
}

makeVault(VAULT, SCALE)
const result: Record<string, unknown> = { scale: SCALE, runs: RUNS, node: process.version, date: new Date().toISOString() }
try {
  const boots: Boot[] = [await boot()]
  for (let i = 0; i < BOOTS; i++) { await stop(boots[boots.length - 1].child); boots.push(await boot()) }
  const child = boots[boots.length - 1].child
  const warm = boots.slice(1)
  result.boot = { firstMs: +boots[0].ready.toFixed(0), firstCpu: boots[0].cpu, warm: stats(warm.map((b) => b.ready)),
    warmUp: stats(warm.map((b) => b.up)).median, warmCpu: stats(warm.map((b) => b.cpu)).median }
  if (ONLY !== "boot") await measure(child)
  await stop(child)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const fmt = (n: number) => n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)}M` : n >= 1024 ? `${(n / 1024).toFixed(0)}K` : `${n}B`
const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const ratio = (a?: number, b?: number) => a && b ? ` (${(a / b).toFixed(1)}x)` : ""
const boot0 = result.boot as { firstMs: number; warm: { median: number }; firstCpu: number; warmCpu: number; warmUp: number }
console.log(`scale ${SCALE}, node ${process.version}, ${ROOT}`)
console.log(`boot: new vault ${boot0.firstMs}ms${ratio(before?.boot.firstMs, boot0.firstMs)} (cpu ${boot0.firstCpu}ms${ratio(before?.boot.firstCpu, boot0.firstCpu)}), ` +
  `again: page ${boot0.warmUp}ms${ratio(before?.boot.warmUp, boot0.warmUp)}, API ${boot0.warm.median}ms${ratio(before?.boot.warm.median, boot0.warm.median)} ` +
  `(cpu ${boot0.warmCpu}ms${ratio(before?.boot.warmCpu, boot0.warmCpu)})`)
if (ONLY === "boot") {
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  process.exit(0)
}
const burst0 = result.burst as { median: number; p90: number; cpu: number }
console.log(`first-load burst (8 requests at once): median ${burst0.median}ms p90 ${burst0.p90}ms${ratio(before?.burst.median, burst0.median)}, ` +
  `cpu ${burst0.cpu}ms${ratio(before?.burst.cpu, burst0.cpu)}`)
type Row = { median: number; p90: number; cpu: number; bytes: number; wire: number; encoding: string; cache: string; again: number | null }
for (const [url, e] of Object.entries(result.endpoints as Record<string, Row>)) {
  const b = before?.endpoints[url] as Row | undefined
  console.log(`${url.slice(0, 50).padEnd(50)} ${String(e.median).padStart(7)}ms p90 ${String(e.p90).padStart(7)}ms cpu ${String(e.cpu).padStart(5)}ms ` +
    `${fmt(e.bytes).padStart(6)} wire ${fmt(e.wire).padStart(6)} ${e.encoding.padEnd(8)} ${e.cache.includes("immutable") ? "immutable" : e.again === 304 ? "etag" : ""}` +
    (b ? `  time${ratio(b.median, e.median)} cpu${ratio(b.cpu, e.cpu)} wire${ratio(b.wire, e.wire)}` : ""))
}
type Refresh = { median: number; cpu: number; wire: number }
for (const [kind, e] of Object.entries(result.refresh as Record<string, Refresh>)) {
  const b = before?.refresh?.[kind] as Refresh | undefined
  console.log(`refresh after a change (${kind})`.padEnd(50) + ` ${String(e.median).padStart(7)}ms cpu ${String(e.cpu).padStart(5)}ms wire ${fmt(e.wire).padStart(6)}` +
    (b ? `  time${ratio(b.median, e.median)} cpu${ratio(b.cpu, e.cpu)} wire${ratio(b.wire, e.wire)}` : ""))
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
