// A QA run on a Mac from a background job (a server's terminal, a tmux under launchd): macOS coalesces its Chrome's
// timers to ~70 ms, so pages animate at 15 fps and every motion check fails. Such a run goes again as an interactive job.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sleep } from "./test/lib.ts"

/** Whether a headless Chrome started from here has its timers held back (16 ms ones firing ~4x late). */
export async function throttled(): Promise<boolean> {
  const { chromium } = await import("playwright-core")
  const b = await chromium.launch({ executablePath: process.env.VAULTITE_CHROME || undefined, args: ["--mute-audio"] }).catch(() => null)
  if (!b) return false
  try {
    const page = await b.newPage()
    const mean = await page.evaluate(() => new Promise<number>((ok) => {
      const t0 = performance.now()
      let n = 0
      const f = () => (++n < 15 ? setTimeout(f, 16) : ok((performance.now() - t0) / 15))
      setTimeout(f, 16)
    }))
    return mean > 40
  } finally { await b.close() }
}

const xml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
/** Runs `node <args>` as a one-off interactive launchd job, its output streamed here; its exit code, or null when
 *  launchd won't take it (no GUI session: over ssh). */
export async function asInteractiveJob(args: string[]): Promise<number | null> {
  const uid = process.getuid?.() ?? 501, label = `app.vaultite.qa.${process.pid}`, target = `gui/${uid}/${label}`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vau-qa-job-")), plist = path.join(dir, "job.plist"), log = path.join(dir, "out.log")
  // (a value with control characters isn't a plist's: left out)
  const env = Object.entries({ ...process.env, VAULTITE_QA_JOB: "1" }).filter((e): e is [string, string] => typeof e[1] === "string" && !/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(e[1]))
  fs.writeFileSync(log, "")
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>${[process.execPath, ...args].map((a) => `<string>${xml(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${xml(process.cwd())}</string>
  <key>EnvironmentVariables</key><dict>${env.map(([k, v]) => `<key>${xml(k)}</key><string>${xml(v)}</string>`).join("")}</dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`)
  const done = () => { spawnSync("launchctl", ["bootout", target], { stdio: "ignore" }); fs.rmSync(dir, { recursive: true, force: true }) }
  if (spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { stdio: "ignore" }).status !== 0) { done(); return null }
  const stop = () => { done(); process.exit(130) }
  process.once("SIGINT", stop).once("SIGTERM", stop)
  const fd = fs.openSync(log, "r"), buf = Buffer.alloc(1 << 16)
  let at = 0, code: number | null = null
  const drain = () => { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, at)) > 0; at += n) process.stdout.write(buf.subarray(0, n)) }
  while (code === null) {
    await sleep(300)
    drain()
    const info = spawnSync("launchctl", ["print", target], { encoding: "utf8" }).stdout
    if (!/\bstate = running\b/.test(info)) { const m = /last exit code = (-?\d+)/.exec(info); if (m) code = Number(m[1]); else if (!info || /last terminating signal/.test(info)) code = 1 }
  }
  drain()
  fs.closeSync(fd)
  process.off("SIGINT", stop).off("SIGTERM", stop)
  done()
  return code
}
