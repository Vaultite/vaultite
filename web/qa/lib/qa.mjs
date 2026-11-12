// What every QA script shares: its arguments (read from its own usage line), Chrome, the checks and the exit code.
//   const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
import { forgetMachines, worksIn } from "../../../tools/test/isolate.ts" // (first: a run of its own, kept off the user's vaults)
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hold } from "../../../tools/qa_slots.ts"
import { quietGrants } from "../../../tools/qa_grants.ts"
import { MARK, carrying, endAll } from "../../../tools/test/leftovers.ts"
import { TEST_HEADER, refuseOwnVault, sharedTmp, testRunId } from "../../../core/testrun.ts"

// (servers and apps under test, from every checkout and copy: Node's compile cache in the shared temp folder is never
// pruned, and filled a Linux /tmp's quota till Xvfb couldn't start)
process.env.NODE_DISABLE_COMPILE_CACHE ??= "1"
/** Playwright's Chromium, else Google Chrome (Chromium on Linux), VAULTITE_CHROME picks one. Not the installed Chrome
 *  first: a headless one left running is the one macOS brings forward, so opening Chrome shows no window. */
export const CHROME = [process.env.VAULTITE_CHROME, bundled(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]
  .find((p) => p && fs.existsSync(p)) ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
function bundled() { try { return createRequire(import.meta.url)("playwright-core").chromium.executablePath() } catch { return undefined } }
export const SHOTS = fileURLToPath(new URL("../shots/", import.meta.url))
export const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
/** Chrome's flags for WebGL (the map) when headless. */
export const WEBGL = ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"]

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** A Mac's display kept awake for `seconds` (a window on a sleeping display draws no frames), till the script exits. */
export function keepAwake(seconds) {
  if (process.platform !== "darwin") return
  const awake = spawn("caffeinate", ["-u", "-d", "-t", String(seconds)], { stdio: "ignore" })
  process.on("exit", () => awake.kill())
}
/** Reduce motion, unless a script tests motion (`qa(url, { motion: true })`): Chromium's switch for it reaches no page. */
let moving = false
function still(browser) {
  if (moving) return browser
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser)
  browser.newContext = (o = {}) => newContext({ reducedMotion: "reduce", ...o })
  browser.newPage = (o = {}) => newPage({ reducedMotion: "reduce", ...o })
  return browser
}
async function stillDesktop() {
  const { _electron } = await import("playwright-core")
  const launchApp = _electron.launch.bind(_electron)
  _electron.launch = async (o) => {
    const app = await launchApp(o)
    if (moving) return app
    const still = (p) => p.emulateMedia({ reducedMotion: "reduce" }).catch(() => {})
    app.windows().forEach(still)
    app.on("window", still)
    return app
  }
}
// (imported when used: boot.mjs, the smoke test, says it's skipped rather than failing where there's no Chrome)
export const launch = async (opts) => {
  await hold()
  return still(await (await import("playwright-core")).chromium.launch({ executablePath: CHROME, ...opts, args: [...(opts?.args ?? []), "--mute-audio"] }))
}
/** Playwright's WebKit (`npx playwright install webkit`), for what only iOS's engine draws (-webkit-touch-callout). */
export const webkitLaunch = async (opts) => { await hold(); return still(await (await import("playwright-core")).webkit.launch(opts)) }

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

/** The script's arguments as its head comment's usage line names them (tools/qa.ts reads it too). No default base url
 *  (QA_BASE gives one): on the live server a fresh browser joins its workspace and attaches to the user's terminals. */
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

/** The desktop app a script drives: this checkout run by Electron, or with VAULTITE_QA_SHELL=dev the packaged Vaultite
 *  Dev shell running it (its own identity; built for this worktree once: npm run app:dev -- --headless, then --stop). */
export async function desktopApp() {
  if (process.env.VAULTITE_QA_SHELL !== "dev") return { executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT], env: {} }
  const [{ devApp }, { fingerprint }] = await Promise.all([import("../../../electron/devinstance.ts"), import("../../../electron/shell/print.mjs")])
  const dev = devApp(ROOT), shell = dev.shellFor(fingerprint(ROOT))
  if (!shell) throw new Error(`no ${dev.name} shell for this worktree: npm run app:dev -- --headless builds one (then --stop)`)
  return { executablePath: dev.exe(shell), args: [], env: { VAULTITE_CODE_ROOT: ROOT } }
}

/** Whether the user's own app runs here, hearing their keys (electron/helper.ts' lock, taken only by a packaged app that
 *  isn't scripted): a script that drives the helper, dictation or the voice then waits for VAULTITE_QA_LIVE=1. */
export function userApp() {
  return new Promise((done) => {
    const c = net.connect(path.join(sharedTmp(), "vaultite-helper.sock"))
    c.once("connect", () => { c.destroy(); done(true) })
    c.once("error", () => done(false))
  })
}
export const LIVE_OK = process.env.VAULTITE_QA_LIVE === "1"

/** One run: its arguments, Chrome (`chrome: false` for none), its checks and its pages' errors; `done()` ends it, exit 1
 *  on any failure (noErrors() checks earlier, before a cleanup that could add some). `live`: it drives the helper,
 *  dictation or the voice, so it's skipped where the user's app runs unless VAULTITE_QA_LIVE=1. `motion`: it moves. */
export async function qa(script, { chrome = {}, live = false, motion = false } = {}) {
  const argv = args(script)
  moving = motion
  await stillDesktop()
  // (what it starts carries this, its desktop app's keepers too, which outlive the app by design: ended with the script)
  process.env[MARK] ??= `${path.basename(fileURLToPath(script), ".mjs")}-${process.pid}-${Date.now()}`
  if (live && !LIVE_OK && await userApp()) { console.log("skipped: the user's Vaultite app runs here (VAULTITE_QA_LIVE=1 runs it anyway)"); process.exit(0) }
  // (never the user's own: their vault, or their server, which refuses a test run's call; a copy forgets its machines)
  for (const a of argv) {
    if (typeof a !== "string") continue
    if (/^https?:\/\//.test(a)) {
      const r = await fetch(`${a.replace(/\/?$/, "/")}api/ops`, { headers: { [TEST_HEADER]: testRunId() || "test" }, signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (r?.status === 403 && /test run/.test((await r.json().catch(() => ({}))).error ?? "")) { console.error(`${a} is the user's own server: QA runs on a throwaway one (vau sandbox)`); process.exit(1) }
    } else if (fs.existsSync(path.join(a, ".vaultite"))) {
      const why = refuseOwnVault(a, path.basename(fileURLToPath(script)))
      if (why) { console.error(why); process.exit(1) }
      forgetMachines(a)
      worksIn(a)
    }
  }
  // (a sandbox given, run by hand: its plugins' writes answered, as tools/qa.ts' vaults are, or their ask covers the page)
  for (const a of argv) if (typeof a === "string" && fs.existsSync(path.join(a, ".vaultite/sandbox.json"))) quietGrants(a)
  await hold()
  const browser = chrome ? await launch(chrome) : null
  // (a throw ends the run with Chrome closed: left open, it holds the runner's pipe and the run hangs to its timeout)
  const crash = async (e) => { console.error(e); await Promise.race([browser?.close(), wait(5000)]).catch(() => {}); await endAll(carrying(process.env[MARK])); process.exit(1) }
  process.on("uncaughtException", crash).on("unhandledRejection", crash)
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
    await endAll(carrying(process.env[MARK]))
    console.log(fails.length ? `\n${fails.length} failed` : "\nall passed")
    process.exit(fails.length ? 1 : 0)
  }
  /** Ends it as skipped (tools/qa.ts lists it so), when what it covers isn't here. */
  const skip = async (why) => { await browser?.close(); await endAll(carrying(process.env[MARK])); console.log(`skipped: ${why}`); process.exit(0) }
  return { args: argv, browser, check, fails, errs, watch, noErrors, done, skip }
}

export const apiAt = (base, headers = {}) => async (method, p, body) => {
  const r = await fetch(`${base}api/${p}`, { method, headers: { "Content-Type": "application/json", ...headers }, body: body == null ? undefined : JSON.stringify(body) })
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text()
}

/** Whether a window of the desktop app on `origin` hears its server, once one does: a page's live socket connects after
 *  its first state, so what drives a window (POST /api/ui, ops/ui.open) as one draws can find none (409, nothing sent). */
export const windowHeard = (origin, ms = 15_000) => until(async () => ((await fetch(`${origin}/api/ui`).then((r) => r.json(), () => null))?.windows ?? 0) > 0, ms)

/** POST /api/ui (open, command, notify) to the desktop app on `origin`, once a window of it hears (windowHeard). */
export const uiAt = (origin) => async (body) => {
  await windowHeard(origin)
  return fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

/** New tabs' view, from Settings (.vaultite/editor.json; null: the default again). */
export const viewsAt = (base) => (mode) => apiAt(base)("POST", "ops/settings.set", { name: "editor", values: mode
  ? { defaultView: mode === "read" ? "reading" : "editing", editingMode: mode === "source" ? "source" : "live" } : { defaultView: null, editingMode: null } })

/** Opens the command palette: ⌘P, or Ctrl+P off a Mac, where a focused terminal keeps Ctrl+letters for its shell
 *  (plugins/core/terminal/Terminal.tsx), so it's left first, as a user there clicks out of it. */
export async function openPalette(page) {
  if (!MAC) await page.evaluate(() => { const a = document.activeElement; if (a instanceof HTMLElement && a.closest("[data-term]")) a.blur() })
  await page.keyboard.press("ControlOrMeta+p")
}

/** Runs a command from the command palette (⌘P), once it lists it, then waits `settle` ms for it. */
export async function palette(page, name, settle = 800) {
  await openPalette(page); await until(() => page.locator("[role=option]").count(), 3000)
  await page.keyboard.type(name); await until(() => page.locator("[role=option]", { hasText: name }).count(), 3000)
  await page.keyboard.press("Enter"); await wait(settle)
}

/** Runs a command from the palette if it's listed (else closes the palette): whether it was. It waits for the field, not
 *  rows: a query left unpicked comes back selected (Palette.tsx), and may list none until typing replaces it. */
export async function command(page, name, settle = 300) {
  await openPalette(page); await page.waitForSelector("[role=dialog] input:focus"); await page.keyboard.type(name)
  const hit = await until(() => page.locator("[role=option]", { hasText: name }).count(), 1500)
  await page.keyboard.press(hit ? "Enter" : "Escape"); await wait(settle)
  return hit > 0
}

/** Picks a choice in the Plugins page's Filter menu (pages/Plugins.tsx): a status, source or (Get plugins) order by its
 *  label ("On", "In this vault", "New"), or a category's (`{ category: true }`: through its submenu), then closes it. */
export async function pluginsFilter(page, label, { category = false } = {}) {
  await page.locator("[data-plugins-filter]").click()
  if (category) await page.getByRole("menuitem", { name: /^Category/ }).click()
  await page.locator("[role=menu]").last().getByRole("menuitemcheckbox", { name: new RegExp(`^${label}(\\s*\\d+)?$`) }).click()
  await page.locator('[aria-label="Close menu"]').click()
}

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

/** This machine's tailnet name and owner's login, from Tailscale ({} without it): a login through Serve only counts
 *  on the machine's own name (core/owner.ts). */
export function tailnet() {
  for (const bin of ["tailscale", "/usr/local/bin/tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    let st
    try { st = JSON.parse(execFileSync(bin, ["status", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) } catch { continue }
    const name = String(st.Self?.DNSName ?? "").replace(/\.$/, "")
    return name ? { name, owner: st.User?.[String(st.Self?.UserID)]?.LoginName ?? "" } : {}
  }
  return {}
}

/** A shell's prompt on screen: zsh's %, bash's $ (# as root, at a line's end), a themed ❯. */
export const PROMPT = /%|\$|❯|#\s*$/m
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
/** Find in terminal's keys: ⌘F on a Mac, Ctrl+Shift+F elsewhere (Ctrl+F is the shell's there). */
export const TERMINAL_FIND_KEY = MAC ? "Meta+F" : "Control+Shift+F"
/** Selects the word after the cursor: ⌥⇧→ on a Mac, Ctrl+Shift+→ elsewhere. */
export const SELECT_WORD = MAC ? "Shift+Alt+ArrowRight" : "Shift+Control+ArrowRight"
