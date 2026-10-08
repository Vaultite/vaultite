// What every QA script shares: its arguments (read from its own usage line), Chrome, the checks and the exit code.
//   const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
import fs from "node:fs"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Playwright's own Chromium (`npx playwright-core install chromium`), else Google Chrome (or Chromium on Linux), else
 *  the Mac's path, which scripts check to skip; VAULTITE_CHROME picks one. Not the installed Chrome first: a headless one
 *  left running is the "Google Chrome" macOS brings forward, so opening Chrome shows no window. */
export const CHROME = [process.env.VAULTITE_CHROME, bundled(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]
  .find((p) => p && fs.existsSync(p)) ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
function bundled() { try { return createRequire(import.meta.url)("playwright-core").chromium.executablePath() } catch { return undefined } }
export const SHOTS = fileURLToPath(new URL("../shots/", import.meta.url))
export const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
/** Chrome's flags for WebGL (the map) when headless. */
export const WEBGL = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// (imported when used: boot.mjs, the smoke test, says it's skipped rather than failing where there's no Chrome)
export const launch = async (opts) => (await import("playwright-core")).chromium.launch({ executablePath: CHROME, ...opts })

/** `fn`'s first truthy value within `ms`, else its last; a throw counts as not yet (the page may be mid-render). */
export async function until(fn, ms = 5000, every = 100) {
  const end = Date.now() + ms
  for (;;) {
    let v
    try { v = await fn() } catch { v = undefined }
    if (v || Date.now() >= end) return v
    await wait(every)
  }
}

/** The script's arguments as its head comment's usage line names them (the line tools/qa.ts reads too): exits 2
 *  with that line when a required one is missing. A base url left out comes from QA_BASE; there's no default, as on
 *  the live server a fresh browser joins its workspace and attaches to the user's terminals. */
function args(script) {
  const file = fileURLToPath(script), name = path.basename(file, ".mjs")
  const head = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n")
  const line = new RegExp(`node \\S*\\b${name}\\.mjs[^\\n(]*`).exec(head)?.[0].trim() ?? ""
  const toks = line.match(/<[^>]+>|\[[^\]]+\]/g) ?? []
  const argv = process.argv.slice(2)
  if (/base/.test(toks[0] ?? "") && !argv[0] && process.env.QA_BASE) argv[0] = process.env.QA_BASE
  const optional = toks.findIndex((t) => t.startsWith("["))
  const required = optional < 0 ? toks.length : optional
  if (argv.length < required || argv.slice(0, required).some((a) => !a)) { console.error(`usage: ${line}`); process.exit(2) }
  return argv
}

/** One run: its arguments, Chrome (launched with `chrome`'s options; `chrome: false` for none), its checks and the
 *  errors of the pages it watches, checked by done() (or earlier by noErrors(), before cleanup that could add some).
 *  `done()` ends it: exit 1 on any failure. */
export async function qa(script, { chrome = {} } = {}) {
  const argv = args(script)
  const browser = chrome ? await launch(chrome) : null
  const fails = [], errs = []
  let watched = false, errorsChecked = false
  const check = (name, ok, got) => {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || got === undefined ? "" : `  (got ${JSON.stringify(got)?.slice(0, 600)})`}`)
    if (!ok) fails.push(name)
    return !!ok
  }
  /** Keeps the page's errors for done() (with `fail: false` only in `errs`, to list); with `console`, its console
   *  errors too, but those matching `ignore`. */
  const watch = (page, { label, console: con = false, ignore = /favicon|Failed to load resource/, fail = true } = {}) => {
    if (fail) watched = true
    const keep = (s) => errs.push(label ? `${label}: ${s}` : s)
    page.on("pageerror", (e) => keep(String(e)))
    if (con) page.on("console", (m) => { if (m.type() === "error" && !ignore?.test(m.text())) keep(m.text()) })
    return page
  }
  const noErrors = (name = "no page errors") => { errorsChecked = true; return check(name, !errs.length, errs.slice(0, 5)) }
  const done = async () => {
    if (watched && !errorsChecked) noErrors()
    await browser?.close()
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed")
    process.exit(fails.length ? 1 : 0)
  }
  return { args: argv, browser, check, fails, errs, watch, noErrors, done }
}

/** The app's API on `base`: JSON in, JSON (or text) out. */
export const apiAt = (base, headers = {}) => async (method, p, body) => {
  const r = await fetch(`${base}api/${p}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body == null ? undefined : JSON.stringify(body) })
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text()
}

/** Runs a command from the command palette (⌘P), then waits `settle` ms for it. */
export async function palette(page, name, settle = 800) {
  await page.keyboard.press("ControlOrMeta+p"); await wait(300)
  await page.keyboard.type(name); await wait(300)
  await page.keyboard.press("Enter"); await wait(settle)
}

/** Runs a command from the palette if it's listed (else closes the palette): whether it was. */
export async function command(page, name, settle = 300) {
  await page.keyboard.press("ControlOrMeta+P"); await page.waitForSelector("[role=option]"); await page.keyboard.type(name); await wait(150)
  const hit = await page.locator("[role=option]", { hasText: name }).count()
  await page.keyboard.press(hit ? "Enter" : "Escape"); await wait(settle)
  return hit > 0
}

/** Real touches through CDP: `touch(type, x, y)`, and `swipe` a finger from one point to another in steps. */
export async function fingers(page) {
  const cdp = await page.context().newCDPSession(page)
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await touch("touchStart", x0, y0)
    for (let i = 1; i <= steps; i++) { await touch("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await wait(16) }
    await touch("touchEnd")
  }
  return { cdp, touch, swipe }
}

/** What the page's terminals show, as text. */
export const terminalText = (page) => page.evaluate(() => [...document.querySelectorAll("[data-terminal]")].map((e) => e.terminalText?.() ?? "").join("\n"))

export const freePort = () => new Promise((resolve) => {
  const s = net.createServer()
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// Defaults that differ off a Mac (web/src/core/platform.ts), as Chrome on this computer gets them.
const MAC = process.platform === "darwin"
/** The keys of Switch to workspace n: ⌃n on a Mac, Alt+n elsewhere (Ctrl+n is the app's Mod there). */
export const workspaceKey = (n) => `${MAC ? "Control" : "Alt"}+${n}`
/** Navigate back's keys: ⌘⌥← on a Mac, Alt+← elsewhere (Ctrl+Alt+← switches desktops there). */
export const BACK_KEY = MAC ? "Meta+Alt+ArrowLeft" : "Alt+ArrowLeft"
/** A file's menu item showing it where it is. */
export const REVEAL = MAC ? "Reveal in Finder" : "Show in folder"
