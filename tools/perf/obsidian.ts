import "../test/isolate.ts"
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { z } from "zod"
import { Page, targets } from "./cdp.ts"
import { freePort } from "./vault.ts"

const arg = (name: string, dflt = "") => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const OBSIDIAN = arg("obsidian"), SRC = path.resolve(arg("vault")), LAUNCHES = Number(arg("launches", "5")), OUT = arg("out")
const ROOTS = arg("roots", path.join(import.meta.dirname, "..", "..")).split(",").map((r) => path.resolve(r))
const DROP = process.argv.includes("--drop")
if (!OBSIDIAN || !fs.existsSync(SRC)) { console.error("usage: node tools/perf/obsidian.ts --obsidian <its binary> --vault <dir> [--roots <checkout>,...] [--launches 5] [--drop] [--out r.json]\n" +
  "Vaultite's desktop app against Obsidian's, launches in turn so both see the same load; the first of each is cold (--drop: the OS file cache emptied with sudo -n)"); process.exit(2) }
const QUERIES = { rare: "7341", common: "lantern", words: "copper meadow harbor" }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-obsidian-race-"))

type Kind = { obsidian: boolean; command: string; args: (vault: string, port: number) => string[]; env: (profile: string, vault: string) => Record<string, string> }
const Probe = z.object({ shown: z.number().nullable(), tree: z.boolean(), note: z.boolean(), indexed: z.boolean(), fcp: z.number().nullable() })
const PAINT = `(() => { const p = performance.getEntriesByName("first-contentful-paint")[0]; return p ? performance.timeOrigin + p.startTime : null })()`
const OBSIDIAN_PROBE = `(() => { const a = window.app, d = document, snap = d.getElementById("startup-snapshot"), mc = a?.metadataCache
  return { shown: snap?.hasAttribute("data-loaded") ? Date.now() : null, tree: !snap && !!d.querySelector(".nav-files-container .tree-item"),
    note: !snap && !!d.querySelector(".mod-root .cm-content .cm-line"), fcp: ${PAINT},
    indexed: !!(mc?.initialized && mc.inProgressTaskCount === 0 && !mc.linkResolverQueue?.items?.length && Object.keys(mc.resolvedLinks || {}).length > 100) } })()`
const VAULTITE_PROBE = `(() => { const d = document
  return { shown: null, tree: !!d.querySelector("aside [role=tree] [data-tree-path]"), note: !!d.querySelector(".cm-content .cm-line"), indexed: false, fcp: ${PAINT} } })()`

const clean = () => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^(VAULTITE_(?!TEST)|CLAUDE)/.test(e[0])))
function kinds(): [string, Kind][] {
  const obsidian: Kind = {
    obsidian: true, command: OBSIDIAN, args: (_v, port) => ["--no-sandbox", `--remote-debugging-port=${port}`],
    env: (profile, vault) => {
      const cfg = path.join(profile, "config", "obsidian")
      fs.mkdirSync(cfg, { recursive: true })
      const list = path.join(cfg, "obsidian.json")
      if (!fs.existsSync(list)) fs.writeFileSync(list, JSON.stringify({ vaults: { "0123456789abcdef": { path: vault, ts: Date.now(), open: true } }, updateDisabled: true }))
      return { XDG_CONFIG_HOME: path.join(profile, "config") }
    },
  }
  const vaultite = (root: string): Kind => ({
    obsidian: false, command: z.string().parse(createRequire(path.join(root, "package.json"))("electron")),
    args: (vault, port) => ["--no-sandbox", `--remote-debugging-port=${port}`, root, "--vault", vault],
    env: (profile) => {
      fs.mkdirSync(path.join(profile, "t"), { recursive: true })
      return { VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(profile, "userData"), VAULTITE_LOCAL: path.join(profile, "local"), TMPDIR: path.join(profile, "t") }
    },
  })
  return [["obsidian", obsidian], ...ROOTS.map((r, i): [string, Kind] => [ROOTS.length > 1 ? `vaultite ${i} (${path.basename(r)})` : "vaultite", vaultite(r)])]
}

function pssMB(root: number) {
  const all = fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d)).flatMap((p) => {
    try { const s = fs.readFileSync(`/proc/${p}/stat`, "utf8"); return [{ pid: Number(p), ppid: Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[1]) }] } catch { return [] }
  })
  const tree = new Set([root])
  for (let grew = true; grew;) { grew = false; for (const p of all) if (!tree.has(p.pid) && tree.has(p.ppid)) { tree.add(p.pid); grew = true } }
  let kb = 0
  const pssOf = (pid: number) => { try { return Number(/Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"))?.[1] ?? 0) } catch { return 0 } }
  for (const pid of tree) kb += pssOf(pid)
  return Math.round(kb / 1024)
}

async function firstPage(k: Kind, port: number, t0: number) {
  const ours = (url: string) => (k.obsidian ? url.startsWith("app://") : url.startsWith("http") || url.includes("last-screen"))
  while (!(await targets(port)).some((x) => x.type === "page" && ours(x.url)) && performance.now() - t0 < 60000) await sleep(5)
  return Math.round(performance.now() - t0)
}

function startedFrom(profile: string) {
  const mine = (pid: string) => { try { return fs.readFileSync(`/proc/${pid}/environ`, "utf8").includes(profile) } catch { return false } }
  return process.platform === "linux" ? fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d) && mine(d)).map(Number) : []
}

async function pageOf(k: Kind, port: number, t0: number) {
  for (;;) {
    const t = (await targets(port)).find((x) => x.type === "page" && (k.obsidian ? x.url.startsWith("app://") && !x.url.includes("starter") : x.url.startsWith("http")))
    if (t) return Page.open(t)
    if (performance.now() - t0 > 60000) throw new Error(`no page in a minute: ${JSON.stringify(await targets(port))}`)
    await sleep(15)
  }
}

async function pictureShown(port: number) {
  const t = (await targets(port)).find((x) => x.type === "page" && x.url.startsWith("file:") && x.url.includes("last-screen"))
  if (!t) return null
  const p = await Page.open(t)
  try { return await p.value(z.number().nullable(), PAINT) } catch { return null } finally { await p.close().catch(() => {}) }
}

async function indexed(page: Page) {
  const origin = new URL(page.url).origin
  try { const r = await fetch(`${origin}/api/vault`, { headers: { "X-Vaultite-Client": "app/web" }, signal: AbortSignal.timeout(500) }); await r.arrayBuffer(); return r.ok } catch { return false }
}

async function poll(k: Kind, page: Page, port: number, at: Record<string, number>, mark: (key: string, when?: number) => void, epoch: number) {
  const s = await page.value(Probe, k.obsidian ? OBSIDIAN_PROBE : VAULTITE_PROBE).catch(() => null)
  if (!s) return
  for (const [key, when] of [["shown", s.shown], ["paint", s.fcp]] as const) if (when) mark(key, when - epoch)
  for (const key of ["tree", "note"] as const) if (s[key]) mark(key)
  if (k.obsidian ? s.indexed : at.indexed === undefined && await indexed(page)) mark("indexed")
  const picture = !k.obsidian && at.shown === undefined ? await pictureShown(port) : null
  if (picture) mark("shown", picture - epoch)
}

async function watch(k: Kind, page: Page, port: number, cold: boolean, t0: number, epoch: number) {
  const at: Record<string, number> = {}
  const mark = (key: string, when = performance.now() - t0) => { at[key] ??= Math.round(when) }
  const done = () => at.tree !== undefined && at.indexed !== undefined && (cold || at.note !== undefined || performance.now() - t0 > 30000)
  while (performance.now() - t0 < 180000 && !done()) {
    await poll(k, page, port, at, mark, epoch)
    await sleep(15)
  }
  at.shown ??= at.paint
  return at
}

async function setQuery(k: Kind, page: Page, q: string) {
  const field = `document.querySelector("[data-search-view] input[aria-label='Search the vault']")`
  if (k.obsidian) return page.run(`app.internalPlugins.getPluginById("global-search").instance.openGlobalSearch(${JSON.stringify(q)})`)
  if (!(await page.value(z.boolean(), `!!${field}`))) await page.run(`location.hash = "#view/search"`)
  while (!(await page.value(z.boolean(), `!!${field}`))) await sleep(15)
  return page.run(`(() => { const i = ${field}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event("input", { bubbles: true })) })()`)
}

async function search(k: Kind, page: Page) {
  const out: Record<string, number> = {}
  const rows = `document.querySelectorAll(${JSON.stringify(k.obsidian ? ".search-result-file-title" : "section[aria-label='In files'] [data-keyrow]")}).length`
  for (const [name, q] of Object.entries(QUERIES)) {
    await setQuery(k, page, "")
    for (let i = 0; i < 200 && (await page.value(z.number(), rows)) > 0; i++) await sleep(15)
    await sleep(300)
    const t0 = performance.now()
    await setQuery(k, page, q)
    while (performance.now() - t0 < 30000 && (await page.value(z.number(), rows)) === 0) await sleep(5)
    out[`search ${name}`] = Math.round(performance.now() - t0)
    await sleep(800)
  }
  return out
}

async function launch(name: string, k: Kind, n: number, note: string) {
  const dir = path.join(tmp, name.replace(/ \(.*\)$/, "").replace(/\W+/g, "-")), vault = path.join(dir, "vault"), profile = path.join(dir, "profile")
  if (n === 0) { fs.mkdirSync(profile, { recursive: true }); execFileSync("cp", ["-r", SRC, vault]) }
  if (n === 0 && DROP) execFileSync("sudo", ["-n", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"])
  const port = await freePort()
  const t0 = performance.now(), epoch = Date.now()
  const child = spawn(k.command, k.args(vault, port), { env: { ...clean(), ...k.env(profile, vault) }, stdio: "ignore", detached: true })
  try {
    const window = await firstPage(k, port, t0)
    const page = await pageOf(k, port, t0)
    const at = { window, ...(await watch(k, page, port, n === 0, t0, epoch)) }
    const open = k.obsidian ? `app.workspace.openLinkText(${JSON.stringify(note)}, "", false)` : `location.hash = "#file/" + encodeURIComponent(${JSON.stringify(note)})`
    if (n === 0) { await page.run(open); for (let i = 0; i < 300 && !(await page.value(z.boolean(), `!!document.querySelector(".cm-content .cm-line")`)); i++) await sleep(50) }
    await sleep(8000)
    const memory = pssMB(child.pid ?? 0)
    const found = await search(k, page)
    if (k.obsidian) await page.run(`(async () => { await app.commands.executeCommandById("file-explorer:open"); await ${open} })()`)
    else await page.run(open)
    await sleep(1500)
    await page.close()
    for (let i = 0; i < 100 && child.exitCode === null; i++) await sleep(100)
    return { ...at, memory, ...found }
  } finally {
    for (const pid of [-(child.pid ?? 0), ...startedFrom(profile)]) { try { process.kill(pid, "SIGKILL") } catch { void 0 } }
  }
}

const ROWS = ["window", "shown", "paint", "tree", "note", "indexed", "memory", ...Object.keys(QUERIES).map((q) => `search ${q}`)]
const median = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[(s.length - 1) >> 1] : NaN }
const note = `Clippings/${fs.readdirSync(path.join(SRC, "Clippings")).sort()[6]}`
const subjects = kinds()
const runs = new Map<string, Record<string, number>[]>(subjects.map(([n]) => [n, []]))
try {
  for (let n = 0; n < LAUNCHES; n++) {
    for (const [name, k] of subjects) {
      const r = await launch(name, k, n, note)
      console.log(`${name} ${n ? "warm" : "cold"} ${n}: ${JSON.stringify(r)}`)
      runs.get(name)?.push(r)
      await sleep(2000)
    }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const table: Record<string, Record<string, Record<string, number>>> = {}
for (const [name, rs] of runs) {
  table[name] = { cold: rs[0] ?? {}, warm: Object.fromEntries(ROWS.map((row) => [row, median(rs.slice(1).map((r) => r[row]))])) }
}
for (const phase of ["warm", "cold"]) {
  console.log(`\n${phase} (${phase === "warm" ? `median of ${LAUNCHES - 1}` : "one launch"}; ms, memory MB)`)
  console.log(["", ...subjects.map(([n]) => n)].map((c) => c.padEnd(22)).join(""))
  for (const row of ROWS) console.log([row, ...subjects.map(([n]) => String(table[n][phase][row] ?? ""))].map((c) => c.padEnd(22)).join(""))
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ vault: SRC, note, date: new Date().toISOString(), table, runs: Object.fromEntries(runs) }, null, 2))
process.exit(0)
