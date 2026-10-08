// Cold start as the desktop app sees it: server.ts on a made-up vault, Chrome (headless, kept) until a dashboard draws.
// node tools/perf/load.ts [--scale 1] [--runs 5] [--root <checkout>]...   (several --root: A/B, taking turns)
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { chromium } from "playwright-core"
import { freePort, isolated, makeVault } from "./vault.ts"

const args = process.argv.slice(2)
const arg = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt }
const SCALE = Number(arg("scale", "1")), RUNS = Number(arg("runs", "5"))
const roots = args.flatMap((a, i) => (a === "--root" ? [path.resolve(args[i + 1])] : []))
if (!roots.length) roots.push(path.join(import.meta.dirname, "..", ".."))
const PORT = await freePort()
const BASE = `http://127.0.0.1:${PORT}/`
// Playwright's own Chromium first: a kept headless Google Chrome is the one macOS brings forward when Chrome is opened
const CHROME = [chromium.executablePath(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((p) => fs.existsSync(p)) ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-load-"))
type Run = { line: number; drawn: number }
type Browser = Awaited<ReturnType<typeof chromium.launchPersistentContext>>

/** One start: ms until the start line and until the dashboard is drawn, from spawning the server. */
async function start(root: string, i: number, browser: Browser): Promise<Run> {
  const dir = path.join(tmp, String(i))
  const t0 = performance.now()
  const child = spawn(process.execPath, ["server.ts"], {
    cwd: root, stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ...isolated(path.join(dir, "home")), VAULTITE_VAULT: path.join(dir, "vault"), VAULTITE_LOCAL: path.join(dir, "local"),
      PORT: String(PORT), HOST: "127.0.0.1" },
  })
  const page = await browser.newPage()
  try {
    await new Promise<void>((resolve, reject) => {
      let out = ""
      child.stdout!.on("data", (b: Buffer) => { out += b; if (/vaultite on http/.test(out)) resolve() })
      child.on("exit", () => reject(new Error("the server exited")))
    })
    const line = performance.now() - t0
    await page.goto(BASE)
    await page.waitForFunction(() => document.querySelector("h1") && document.querySelectorAll("h2").length >= 2, null, { timeout: 60_000, polling: 10 })
    return { line, drawn: performance.now() - t0 }
  } finally {
    await page.close()
    await new Promise<void>((r) => { child.once("exit", () => r()); child.kill() })
  }
}

const median = (xs: number[]) => Math.round([...xs].sort((a, b) => a - b)[xs.length >> 1])
try {
  roots.forEach((_, i) => makeVault(path.join(tmp, String(i), "vault"), SCALE))
  const browsers = await Promise.all(roots.map((_, i) =>
    chromium.launchPersistentContext(path.join(tmp, String(i), "profile"), { executablePath: CHROME, viewport: { width: 1280, height: 800 } })))
  for (let i = 0; i < roots.length; i++) await start(roots[i], i, browsers[i]) // first start: the vault's first read, a cold cache
  const runs: Run[][] = roots.map(() => [])
  for (let n = 0; n < RUNS; n++) for (let i = 0; i < roots.length; i++) runs[i].push(await start(roots[i], i, browsers[i]))
  await Promise.all(browsers.map((b) => b.close()))
  console.log(`scale ${SCALE}, ${RUNS} starts each, taking turns`)
  roots.forEach((root, i) => console.log(`${root}: start line ${median(runs[i].map((r) => r.line))} ms, dashboard drawn ` +
    `${median(runs[i].map((r) => r.drawn))} ms (runs: ${runs[i].map((r) => Math.round(r.drawn)).join(", ")})`))
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
