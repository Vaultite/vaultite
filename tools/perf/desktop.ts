// Desktop app cold start: spawn to window, page load, first paint and usable, cold then warm, with each part's CPU.
// node tools/perf/desktop.ts [--scale 1] [--launches 5] [--roots <a>,<b> (alternating)] [--out r.json]
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { _electron } from "playwright-core"
import { makeVault } from "./vault.ts"

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const SCALE = Number(arg("scale", "1")), LAUNCHES = Number(arg("launches", "5")), OUT = arg("out", "")
const ROOTS = arg("roots", path.join(import.meta.dirname, "..", "..")).split(",").map((r) => path.resolve(r))

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-desktop-perf-"))

type Launch = { window: number; page: number; paint: number; ready: number; renderer: number; app: number; server: number }

/** CPU milliseconds of the main process's server.ts child: Linux's /proc (ps there counts whole seconds), else ps
 *  ([[dd-]hh:]mm:ss.cc). */
function serverCpu(parent: number) {
  if (process.platform === "linux") {
    for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        // (after the command's closing paren: state, ppid, ... utime and stime are fields 14 and 15, in clock ticks)
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"), f = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
        if (Number(f[1]) !== parent || !fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("server.ts")) continue
        return (Number(f[11]) + Number(f[12])) * 10 // (100 ticks a second)
      } catch { /* gone meanwhile */ }
    }
    return 0
  }
  const out = execFileSync("/bin/ps", ["-Aww", "-o", "pid=,ppid=,time=,command="], { encoding: "utf8" })
  const line = out.split("\n").find((l) => { const [, ppid, , ...cmd] = l.trim().split(/\s+/); return Number(ppid) === parent && cmd.join(" ").includes("server.ts") })
  if (!line) return 0
  return line.trim().split(/\s+/)[2].split(/[-:]/).reverse().reduce((ms, part, i) => ms + Number(part) * [1000, 60000, 3600000, 86400000][i], 0)
}

async function launch(root: string, dir: string): Promise<Launch> {
  const t0 = performance.now(), epoch = Date.now()
  const app = await _electron.launch({
    executablePath: path.join(root, "node_modules", ".bin", "electron"), args: [root, "--vault", path.join(dir, "vault")],
    // (a temp folder each root's own: Node's compile cache, kept there, is empty for the first launch and never shared)
    env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(dir, "userData"), VAULTITE_LOCAL: path.join(dir, "local"), TMPDIR: path.join(dir, "t") },
  })
  try {
    const win = await app.firstWindow()
    const window = performance.now() - t0
    await win.waitForSelector("[role=tree]", { timeout: 120000 })
    const ready = performance.now() - t0
    // The page's clock starts at its navigation (timeOrigin, wall time); first paint is on that clock.
    const [origin, fcp] = await win.evaluate(() => [performance.timeOrigin, performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0])
    // CPU time each process spent until then, less swayed by a busy machine than wall time: the page's renderer, the
    // rest of Electron (its main process, GPU, network), and the vault's server (a child of the main process).
    const [metrics, pid] = await app.evaluate(({ app }) => [app.getAppMetrics(), process.pid] as const)
    const cpu = (tab: boolean) => 1000 * metrics.filter((m) => (m.type === "Tab") === tab).reduce((n, m) => n + m.cpu.cumulativeCPUUsage!, 0)
    return { window, page: origin - epoch, paint: origin - epoch + fcp, ready, renderer: cpu(true), app: cpu(false), server: serverCpu(pid) }
  } finally {
    await app.close()
  }
}

// (Chromium won't run as root without its sandbox, and the app keeps the sandbox on)
if (process.platform === "linux" && process.getuid?.() === 0) { console.error("desktop: Electron doesn't run as root: run this as another user"); process.exit(1) }
const runs = ROOTS.map(() => [] as Launch[])
try {
  ROOTS.forEach((_, i) => { makeVault(path.join(tmp, String(i), "vault"), SCALE); fs.mkdirSync(path.join(tmp, String(i), "t")) })
  for (let n = 0; n < LAUNCHES; n++) {
    for (const [i, root] of ROOTS.entries()) runs[i].push(await launch(root, path.join(tmp, String(i))))
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

const KEYS = ["window", "page", "paint", "ready", "renderer", "app", "server"] as const
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(0) }
const round = (l: Launch) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, +v.toFixed(0)])) as Launch
const results = ROOTS.map((root, i) => ({
  root, scale: SCALE, launches: LAUNCHES, date: new Date().toISOString(), first: round(runs[i][0]),
  again: Object.fromEntries(KEYS.map((k) => [k, median(runs[i].slice(1).map((r) => r[k]))])) as Launch,
  best: Object.fromEntries(KEYS.map((k) => [k, +Math.min(...runs[i].slice(1).map((r) => r[k])).toFixed(0)])) as Launch,
  runs: runs[i].map(round),
}))
const ratio = (a: number, b: number) => ` (${(a / b).toFixed(2)}x)`
for (const r of results) {
  const b = results[0] === r ? null : results[0]
  console.log(r.root)
  for (const k of ["first", "again", "best"] as const) {
    const x = r[k], y = b?.[k]
    const part = (name: string, key: keyof Launch) => `${name} ${x[key]}ms${y ? ratio(y[key], x[key]) : ""}`
    const label = { first: "first launch (empty caches)", again: "launch again (median)      ", best: "launch again (best)        " }[k]
    console.log(`  ${label}: ` +
      [part("window", "window"), part("page", "page"), part("first paint", "paint"), part("ready", "ready"),
        `cpu: ${part("renderer", "renderer")}`, part("electron", "app"), part("server", "server")].join(", "))
  }
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
