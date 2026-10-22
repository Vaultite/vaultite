// A real vault's benchmark (an Obsidian one: links, attachments), on a copy without .obsidian/plugins: boot, memory, endpoints, a rename, typing.
// node tools/perf/bigvault.ts --vault <dir> [--root <checkout>] [--runs 5] [--dataview <dir>] [--browser] [--profile f] [--out r.json] [--compare b.json]
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { chromium } from "playwright-core"
import { hold } from "../qa_slots.ts"
import { freePort, isolated } from "./vault.ts"

const arg = (name: string, dflt = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const SRC = arg("vault"), ROOT = path.resolve(arg("root", path.join(import.meta.dirname, "..", "..")))
const RUNS = Number(arg("runs", "5")), OUT = arg("out"), COMPARE = arg("compare"), DATAVIEW = arg("dataview")
const BROWSER = process.argv.includes("--browser"), PROFILE = arg("profile")
if (!SRC || !fs.statSync(SRC, { throwIfNoEntry: false })?.isDirectory()) { console.error("usage: node tools/perf/bigvault.ts --vault <dir> [...]"); process.exit(2) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-bigvault-"))
const VAULT = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local")
const PORT = await freePort(), BASE = `http://127.0.0.1:${PORT}/`
const HEADERS = { "X-Vaultite-Client": "app/web", "Content-Type": "application/json" }

// ---------- the copy, and what to measure on it
try { execFileSync("/bin/cp", ["-cR", path.resolve(SRC), VAULT], { stdio: "ignore" }) } catch { fs.cpSync(SRC, VAULT, { recursive: true }) }
for (const p of [".obsidian/plugins", ".git", ".vaultite/plugins/workspaces", ".vaultite/plugins/machines"]) fs.rmSync(path.join(VAULT, p), { recursive: true, force: true })

/** Every file under the vault, as the index sees them (no hidden folders). */
function walk(dir = "", out: string[] = []) {
  for (const d of fs.readdirSync(path.join(VAULT, dir), { withFileTypes: true })) {
    if (d.name.startsWith(".")) continue
    const rel = dir ? `${dir}/${d.name}` : d.name
    if (d.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}
const all = walk(), md = all.filter((f) => f.endsWith(".md"))
const texts = new Map(md.map((f) => [f, fs.readFileSync(path.join(VAULT, f), "utf8")]))
const LINK = /\[\[([^[\]\n|#^]+)/g
const inbound = new Map<string, number>()
let links = 0
for (const t of texts.values()) for (const m of t.matchAll(LINK)) { links++; const k = m[1].trim().split("/").pop()!.toLowerCase(); inbound.set(k, (inbound.get(k) ?? 0) + 1) }
const stemOf = (f: string) => f.slice(f.lastIndexOf("/") + 1).replace(/\.md$/, "")
const byStem = new Map(md.map((f) => [stemOf(f).toLowerCase(), f]))
const mostLinked = [...inbound].filter(([k]) => byStem.has(k)).sort((a, b) => b[1] - a[1])[0]
const RENAME = mostLinked ? byStem.get(mostLinked[0])! : md[0]
const heavyScore = (f: string) => texts.get(f)!.length + 200 * (texts.get(f)!.match(LINK)?.length ?? 0)
const NOTE = arg("note") || [...md].sort((a, b) => heavyScore(b) - heavyScore(a))[0]
const dirs = new Map<string, number>()
for (const f of all) { const d = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""; dirs.set(d, (dirs.get(d) ?? 0) + 1) }
const [BIG_DIR, BIG_N] = [...dirs].sort((a, b) => b[1] - a[1])[0]
// A word from the heavy note's text: something that's there, in many files or few.
const SEARCH = arg("search") || (stemOf(NOTE).split(/\s+/).find((w) => w.length > 3) ?? stemOf(NOTE))
const DQL = arg("dql", `TABLE file.mtime FROM "${BIG_DIR}" SORT file.mtime DESC LIMIT 50`)
const bytes = all.reduce((n, f) => n + fs.statSync(path.join(VAULT, f)).size, 0)
const result: Record<string, any> = {
  vault: path.basename(path.resolve(SRC)), root: ROOT, date: new Date().toISOString(), node: process.version,
  files: all.length, markdown: md.length, mb: +(bytes / 1048576).toFixed(0), links,
  subjects: { note: NOTE, rename: RENAME, renameInbound: mostLinked?.[1] ?? 0, bigFolder: BIG_DIR, bigFolderFiles: BIG_N, search: SEARCH },
}
console.log(`${result.vault}: ${all.length} files (${md.length} Markdown, ${result.mb} MB), ${links} wikilinks; heavy note ${NOTE}, ` +
  `most linked ${RENAME} (${result.subjects.renameInbound} links), biggest folder ${BIG_DIR || "(top)"} (${BIG_N} files)`)

// ---------- the server
const cpu = (c: ChildProcess) => execFileSync("/bin/ps", ["-o", "time=", "-p", String(c.pid)], { encoding: "utf8" }).trim()
  .split(":").reduce((acc, x) => acc * 60 + Number(x), 0) * 1000
const rss = (c: ChildProcess) => Math.round(Number(execFileSync("/bin/ps", ["-o", "rss=", "-p", String(c.pid)], { encoding: "utf8" }).trim()) / 1024)

let server: ChildProcess | null = null
async function boot() {
  const t0 = performance.now()
  const child = server = spawn(process.execPath, ["server.ts"], {
    cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, ...isolated(path.join(tmp, "home")), VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL, PORT: String(PORT), HOST: "127.0.0.1", VAULTITE_QUIET: "1" },
  })
  let said = ""
  child.stderr!.on("data", (b: Buffer) => { said = (said + b).slice(-4000) })
  child.once("exit", (code) => { if (code && !child.killed) console.error(`the server stopped (exit ${code}):\n${said}`) })
  const answers = async (url: string) => {
    for (;;) {
      try { const r = await fetch(BASE + url, { headers: HEADERS }); await r.arrayBuffer(); if (r.ok) return performance.now() - t0 } catch { /* not up yet */ }
      if (child.exitCode !== null) throw new Error("the server exited")
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  const [up, ready] = await Promise.all([answers(""), answers("api/vault")])
  return { up: Math.round(up), ready: Math.round(ready), cpu: cpu(child), rss: rss(child) }
}

async function time(method: string, url: string, body?: unknown) {
  const t0 = performance.now()
  const r = await fetch(BASE + url, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
  const buf = Buffer.from(await r.arrayBuffer())
  if (!r.ok) throw new Error(`${method} ${url} answered ${r.status}: ${buf.toString().slice(0, 300)}`)
  return { ms: performance.now() - t0, bytes: buf.length, json: () => JSON.parse(buf.toString()) }
}
const median = (xs: number[]) => +[...xs].sort((a, b) => a - b)[xs.length >> 1].toFixed(1)

const q = encodeURIComponent
const ENDPOINTS: [string, string, string, unknown?][] = [
  ["vault (an idle request: the sync)", "GET", "api/vault"],
  ["files (the tree, links, backlinks)", "GET", "api/files"],
  ["state", "GET", "api/state"],
  ["graph (whole vault)", "GET", "api/graph"],
  ["graph (the note's local one)", "GET", `api/graph?path=${q(NOTE)}&depth=1`],
  ["render the heavy note", "GET", `api/render?path=${q(NOTE)}`],
  ["raw file (open in the editor)", "GET", `api/file?path=${q(NOTE)}`],
  ["search a word", "GET", `api/search?q=${q(SEARCH)}`],
  ["search two words", "GET", `api/search?q=${q(`${SEARCH} the`)}`],
  ["unlinked mentions", "GET", `api/backlinks/unlinked?path=${q(NOTE)}`],
  ["tags", "GET", "api/tags"],
]

try {
  const boots: Awaited<ReturnType<typeof boot>>[] = []
  for (let i = 0; i < 2; i++) {
    boots.push(await boot())
    if (i === 0) {
      if (DATAVIEW) {
        const vau = (...a: string[]) => execFileSync(process.execPath, [path.join(ROOT, "bin", "vau"), "--url", BASE, ...a], { encoding: "utf8", env: { ...process.env, VAULTITE_URL: BASE } })
        vau("plugin", "install", path.resolve(DATAVIEW)); vau("plugin", "on", "dataview")
        ENDPOINTS.push(["dataview TABLE of a folder", "GET", `api/dataview/query?q=${q(DQL)}`],
          ["dataview LIST FROM [[most linked]]", "GET", `api/dataview/query?q=${q(`LIST FROM [[${stemOf(RENAME)}]]`)}`])
      }
      const firsts: Record<string, any> = {}
      for (const [name, method, url, body] of ENDPOINTS) { const t = await time(method, url, body); firsts[name] = Math.round(t.ms) }
      result.cold = firsts
      await new Promise<void>((r) => { server!.once("exit", () => r()); server!.kill() })
    }
  }
  // The second boot is the one measured: the copy's first read by the OS (and any cache the app writes) is behind it.
  result.boot = { first: boots[0], again: boots[1] }
  const child = server!
  const endpoints: Record<string, any> = {}
  for (const [name, method, url, body] of ENDPOINTS) {
    const first = await time(method, url, body)
    const ms: number[] = []
    const c0 = cpu(child)
    for (let i = 0; i < RUNS; i++) ms.push((await time(method, url, body)).ms)
    endpoints[name] = { first: Math.round(first.ms), median: median(ms), cpu: +((cpu(child) - c0) / RUNS).toFixed(0), bytes: first.bytes }
  }
  // After an edit (a note changed on disk, as by an AI): what the app asks for again.
  const notePath = path.join(VAULT, NOTE)
  for (const [name, url] of [["files after an edit", "api/files"], ["graph after an edit", "api/graph"], ["search after an edit", `api/search?q=${q(SEARCH)}`]]) {
    const ms: number[] = []
    for (let i = 0; i < RUNS; i++) { fs.appendFileSync(notePath, `\nOne more line ${i}.\n`); ms.push((await time("GET", url)).ms) }
    endpoints[name] = { median: median(ms) }
  }
  result.endpoints = endpoints

  // A rename of the most linked note: every file linking to it rewritten (core/vault.ts relink), then back.
  const to = RENAME.replace(/\.md$/, " renamed.md")
  const moved = await time("POST", "api/file/move", { from: RENAME, to })
  const updated = moved.json().updated.length
  const back = await time("POST", "api/file/move", { from: to, to: RENAME })
  result.rename = { ms: Math.round(moved.ms), back: Math.round(back.ms), updated, cpu: 0 }
  result.rss = { ready: boots[1].rss, after: rss(child) }

  if (BROWSER) result.browser = await browse()
} finally {
  const last = server as ChildProcess | null
  if (last && last.exitCode === null) await new Promise<void>((r) => { last.once("exit", () => r()); last.kill() })
  try { execFileSync("tmux", ["-L", `vaultite-${PORT}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

/** In Chrome (a QA slot): the app loaded until its tree shows, the biggest folder opened and shown whole, the heavy
 *  note opened in the editor, and 40 keys typed into it (each from keydown to the next frame). */
async function browse() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  await hold() // (this machine's QA slot: tools/qa_slots.ts)
  const browser = await chromium.launch({ executablePath: chromium.executablePath() })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(() => {
      const w = window as any
      w.__keys = []
      const paint = () => new Promise<number>((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => r(performance.now()); c.port2.postMessage(0) }))
      addEventListener("keydown", (e) => { const t = e.timeStamp; paint().then((n) => w.__keys.push(n - t)) }, true)
    })
    const page = await ctx.newPage()
    const out: Record<string, number> = {}
    let t0 = performance.now()
    await page.goto(BASE)
    await page.waitForSelector("aside [role=tree] [data-tree-path]", { timeout: 120_000 })
    out.treeShown = Math.round(performance.now() - t0)
    if (BIG_DIR) {
      const tree = page.locator("aside [role=tree]").first()
      await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {})
      await wait(300)
      // (a folder deep down: its parents opened first)
      const parts = BIG_DIR.split("/")
      for (let i = 0; i < parts.length; i++) {
        const p = parts.slice(0, i + 1).join("/")
        t0 = performance.now()
        await tree.locator(`div[data-tree-path="${p}"] button`).first().click()
        await page.waitForFunction((p: string) => !!document.querySelector(`div[data-tree-path^="${CSS.escape(p)}/"]`), p, { timeout: 60_000 })
        out.folderOpened = Math.round(performance.now() - t0)
      }
    }
    await page.evaluate(() => { localStorage.setItem("vaultite.fileMode", "live") })
    t0 = performance.now()
    await page.evaluate((p: string) => { location.hash = `#file/${encodeURIComponent(p)}` }, NOTE)
    await page.waitForFunction(() => document.querySelectorAll(".cm-content .cm-line").length > 2, null, { timeout: 60_000 })
    out.noteOpened = Math.round(performance.now() - t0)
    const cdp = PROFILE ? await ctx.newCDPSession(page) : null
    /** 40 keys typed at the note's end: each one's latency (median, p95, max), under `key`. */
    const typing = async (key: string) => {
      await page.click(".cm-content")
      await page.keyboard.press("ControlOrMeta+End")
      await wait(500)
      await page.evaluate(() => { (window as any).__keys = [] })
      await page.keyboard.type(" the quick brown fox jumps over the lazy", { delay: 60 })
      await wait(300)
      const s = ([...await page.evaluate(() => (window as any).__keys)] as number[]).sort((a, b) => a - b)
      out[key] = +s[s.length >> 1].toFixed(1)
      out[`${key}P95`] = +s[Math.floor(s.length * 0.95)].toFixed(1)
      out[`${key}Max`] = +s[s.length - 1].toFixed(1)
    }
    if (cdp) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start") }
    await typing("keyMs")
    if (cdp) fs.writeFileSync(PROFILE, JSON.stringify((await cdp.send("Profiler.stop")).profile))
    // The biggest folder shown whole (past files.json's folderLimit) and scrolled to its end, then typing again.
    const more = page.locator(`aside [role=tree] [data-tree-more="${BIG_DIR}"] button`)
    if (BIG_DIR && await more.count()) {
      t0 = performance.now()
      await more.click()
      await page.waitForFunction(([d, n]: [string, number]) => document.querySelectorAll(`div[data-tree-path^="${CSS.escape(d)}/"]`).length > n, [BIG_DIR, 200] as [string, number], { timeout: 120_000 }).catch(() => {})
      out.folderShownWhole = Math.round(performance.now() - t0)
      for (let i = 0; i < 10; i++) { await page.locator("aside [role=tree]").first().hover(); await page.mouse.wheel(0, 20000); await wait(300) }
      out.treeRows = await page.evaluate(() => document.querySelectorAll("aside [role=tree] [data-tree-path]").length)
      await typing("wholeFolderKeyMs")
    }
    return out
  } finally {
    await browser.close()
  }
}

// ---------- the table
const before = COMPARE ? JSON.parse(fs.readFileSync(COMPARE, "utf8")) : null
const vs = (a: number | undefined, b: number | undefined) => (a !== undefined && b ? ` (was ${a}, ${(a / b).toFixed(1)}x)` : "")
const b = result.boot.again, bb = before?.boot?.again
console.log(`boot: answers ${b.up} ms, indexed (api/vault) ${b.ready} ms${vs(bb?.ready, b.ready)}, cpu ${b.cpu} ms, rss ${b.rss} MB; ` +
  `first boot ${result.boot.first.ready} ms; rss after the run ${result.rss.after} MB${vs(before?.rss?.after, result.rss.after)}`)
for (const [name, e] of Object.entries(result.endpoints as Record<string, any>)) {
  const x = before?.endpoints?.[name]
  console.log(`${name.padEnd(36)} ${e.first !== undefined ? `cold ${String(result.cold[name] ?? "").padStart(6)} ms, ` : "".padEnd(17)}` +
    `median ${String(e.median).padStart(8)} ms${vs(x?.median, e.median)}${e.bytes !== undefined ? `, ${e.bytes < 10240 ? `${e.bytes} B` : `${(e.bytes / 1024).toFixed(0)} KB`}` : ""}`)
}
console.log(`rename ${RENAME}: ${result.rename.ms} ms${vs(before?.rename?.ms, result.rename.ms)}, ${result.rename.updated} files relinked; back ${result.rename.back} ms`)
if (result.browser) console.log(`browser: ${Object.entries(result.browser).map(([k, v]) => `${k} ${v}${before?.browser?.[k] !== undefined ? ` (was ${before.browser[k]})` : ""}`).join(", ")}`)
if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
process.exit(0)
