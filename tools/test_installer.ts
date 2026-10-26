// Windows' installer end to end (ci.yml's windows-app): built under a test id and name, installed, run on a sandbox vault,
// uninstalled; screenshots and logs in <out>. After npm run build: `node tools/test_installer.ts [<out>] [--no-package]`
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { check, freePort, section, skip, sleep, summary, waitFor } from "./test/lib.ts"

const began = Date.now()
if (process.platform !== "win32") { console.log("test_installer: Windows only"); process.exit(0) }
const ROOT = path.join(import.meta.dirname, "..")
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? path.join(ROOT, "windows-out"))
fs.mkdirSync(OUT, { recursive: true })
const NAME = "Vaultite Test", ID = "app.vaultite.wintest", DIST = path.join(ROOT, "dist-test")
const INSTALLER = path.join(DIST, "Vaultite-Test-Setup.exe")
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-installer-"))
const ps = (script: string) => execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }).trim()
const reg = (key: string) => spawnSync("reg", ["query", key, "/ve"], { encoding: "utf8" }).stdout ?? ""

await section("package", () => {
  if (process.argv.includes("--no-package") && fs.existsSync(INSTALLER)) return
  const t = Date.now()
  // (package.json's build under a test id and name; its .md association too, so it never takes the user's Vaultite's)
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).build
  const config = path.join(tmp, "installer.json")
  fs.writeFileSync(config, JSON.stringify({ ...build, appId: ID, productName: NAME, extraMetadata: { productName: NAME, name: "vaultite-test" },
    directories: { output: DIST }, nsis: { ...build.nsis, artifactName: "Vaultite-Test-Setup.${ext}" },
    win: { ...build.win, fileAssociations: build.win.fileAssociations.map((f: object) => ({ ...f, name: "VaultiteTest.Markdown" })) } }))
  const r = spawnSync("npx", ["electron-builder", "--win", "nsis", "--publish", "never", "--projectDir", ".", "-c", config], { cwd: ROOT, stdio: "inherit", shell: true })
  check(`the installer is built (${((Date.now() - t) / 1000).toFixed(0)} s)`, r.status === 0 && fs.existsSync(INSTALLER), r.status)
  if (fs.existsSync(INSTALLER)) console.log(`installer: ${(fs.statSync(INSTALLER).size / 1e6).toFixed(0)} MB`)
})

// (a oneClick per-user install: %LOCALAPPDATA%\Programs\<its name>)
const programs = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "Programs")
const installedExe = () => {
  for (const d of fs.existsSync(programs) ? fs.readdirSync(programs) : []) {
    const exe = path.join(programs, d, `${NAME}.exe`)
    if (fs.existsSync(exe)) return exe
  }
  return null
}
let exe: string | null = null
await section("install", async () => {
  if (!fs.existsSync(INSTALLER)) throw new Error("no installer")
  const t = Date.now()
  const r = spawnSync(INSTALLER, ["/S"], { stdio: "inherit" })
  exe = await waitFor(installedExe, 60_000)
  check(`it installs silently for this user, no admin (${((Date.now() - t) / 1000).toFixed(0)} s)`, r.status === 0 && !!exe, { status: r.status,
    programs: fs.existsSync(programs) && Object.fromEntries(fs.readdirSync(programs).map((d) => [d, fs.readdirSync(path.join(programs, d)).slice(0, 30)])) })
  if (!exe) return
  console.log(`installed: ${exe}`)
  const dir = path.dirname(exe)
  check("it's in the Start menu", fs.existsSync(path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", `${NAME}.lnk`)))
  check("its uninstaller is there", fs.existsSync(path.join(dir, `Uninstall ${NAME}.exe`)))
  check("only Windows' native prebuilds ship (node-pty)", (() => {
    const pre = path.join(dir, "resources", "app", "node_modules", "node-pty", "prebuilds")
    const left = fs.existsSync(pre) ? fs.readdirSync(pre) : []
    return left.length === 1 && left[0] === `win32-${process.arch}`
  })(), fs.existsSync(path.join(dir, "resources", "app", "node_modules", "node-pty", "prebuilds")) && fs.readdirSync(path.join(dir, "resources", "app", "node_modules", "node-pty", "prebuilds")))
  check(".md files open with it (its file association)", /VaultiteTest\.Markdown/.test(reg("HKCU\\Software\\Classes\\.md")), reg("HKCU\\Software\\Classes\\.md"))
})

/** Chromium's DevTools protocol on the app's page: evaluate in it, capture it. */
async function cdp(port: number, page: string) {
  const targets = await waitFor(async () => {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json() as Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[]>).catch(() => [])
    return list.find((t) => t.type === "page" && t.url.startsWith(page)) ?? null
  }, 60_000)
  if (!targets) return null
  const ws = new WebSocket(targets.webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.once("open", ok); ws.once("error", fail) })
  let n = 0
  const call = (method: string, params: object = {}) => new Promise<any>((ok, fail) => {
    const id = ++n
    setTimeout(() => fail(new Error(`${method}: no answer`)), 30_000)
    const on = (d: Buffer) => { const m = JSON.parse(String(d)); if (m.id !== id) return; ws.off("message", on); if (m.error) fail(new Error(m.error.message)); else ok(m.result) }
    ws.on("message", on)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression: string) => (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value
  return { call, evaluate, close: () => ws.close() }
}

/** The whole screen as a PNG (the window as Windows draws it: its title bar's controls over the page). */
const screenshot = (file: string) => ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
  $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($bmp);
  $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${file.replace(/'/g, "''")}')`)

let app: ReturnType<typeof spawn> | null = null
let launched: { port: number; userData: string } | null = null
await section("launch", async () => {
  if (!exe) throw new Error("not installed")
  const vault = path.join(tmp, "vault"), userData = path.join(tmp, "userData")
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin", "vau"), "sandbox", vault], { encoding: "utf8" })
  if (made.status !== 0) throw new Error(`no sandbox: ${made.stderr || made.stdout}`)
  const port = await freePort(), debug = await freePort()
  launched = { port, userData }
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, "vaults.json"), JSON.stringify({ vaults: [{ path: vault, port, open: true, bounds: { x: 30, y: 20, width: 960, height: 680 } }] }))
  fs.writeFileSync(path.join(userData, "setup.json"), JSON.stringify({ done: new Date().toISOString() }))
  const t = Date.now()
  app = spawn(exe, [], { env: { ...process.env, VAULTITE_USER_DATA: userData, VAULTITE_DEBUG_PORT: String(debug), ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", fs.openSync(path.join(OUT, "app-stdout.log"), "w"), fs.openSync(path.join(OUT, "app-stderr.log"), "w")] })
  const state = await waitFor(() => fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.ok ? r.json() : null).catch(() => null), 120_000)
  check(`its server answers /api/state (${((Date.now() - t) / 1000).toFixed(0)} s)`, !!state)
  const page = await cdp(debug, `http://127.0.0.1:${port}/`)
  check("its window loads the vault", !!page)
  if (!page) return
  const drawn = await waitFor(() => page.evaluate(`!!document.querySelector("[data-titlebar]") && document.querySelectorAll("[role=tab]").length > 0`).then((x) => x || null), 60_000)
  check("the app draws (the sidebar's top row, tabs)", !!drawn)
  const html = await page.evaluate(`({ platform: document.documentElement.dataset.platform, error: document.body.innerText.includes("couldn't start") })`)
  check("the page knows it's Windows (data-platform=win32)", html?.platform === "win32", html)
  check("no start-up error screen", html && !html.error, html)
  await sleep(3000)
  const shot = await page.call("Page.captureScreenshot", { format: "png" })
  fs.writeFileSync(path.join(OUT, "page.png"), Buffer.from(shot.data, "base64"))
  const errors = await fetch(`http://127.0.0.1:${port}/api/errors`).then((r) => r.json()).catch(() => null)
  fs.writeFileSync(path.join(OUT, "errors.json"), JSON.stringify(errors, null, 2))
  try { screenshot(path.join(OUT, "screen.png")); check("a screenshot of the screen", fs.existsSync(path.join(OUT, "screen.png"))) } catch (e) { check("a screenshot of the screen", false, String(e)) }
  // Windows' controls are coloured as the page beside them: a pixel between them (left of minimize's dash) and one of
  // the tab bar's left of them, in the screenshot (screen pixels: the runner's display is at 100%).
  const at = await page.evaluate(`({ x: screenX, y: screenY, w: outerWidth, controls: getComputedStyle(document.documentElement).getPropertyValue("--window-controls") })`)
  check("the page keeps clear of the controls (--window-controls)", /^\d+px$/.test(at?.controls ?? ""), at)
  if (at && fs.existsSync(path.join(OUT, "screen.png"))) {
    const px = (file: string, x: number, y: number) => ps(`Add-Type -AssemblyName System.Drawing; $b=New-Object System.Drawing.Bitmap '${path.join(OUT, file).replace(/'/g, "''")}';
      $c=$b.GetPixel(${Math.round(x)},${Math.round(y)}); '{0},{1},{2}' -f $c.R,$c.G,$c.B`).split(",").map(Number)
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 6)
    const controls = px("screen.png", at.x + at.w - 138 + 6, at.y + 4), page = px("screen.png", at.x + at.w - 138 - 30, at.y + 4)
    // (the screen shows the window only where the runner's desktop is up: an Arm runner may show Windows' first-run screens)
    if (!near(page, px("page.png", at.w - 138 - 30, 4))) skip("the controls take the page's colour", "the window isn't on the screen")
    else check("the controls take the page's colour", near(controls, page), { controls, page })
  }
  page.close()
  check("vaultite:// links open it (registered at launch)", /Vaultite Test\.exe/i.test(reg("HKCU\\Software\\Classes\\vaultite\\shell\\open\\command")), reg("HKCU\\Software\\Classes\\vaultite\\shell\\open\\command"))
  for (const f of fs.existsSync(path.join(userData, "logs")) ? fs.readdirSync(path.join(userData, "logs")) : []) fs.copyFileSync(path.join(userData, "logs", f), path.join(OUT, f))
})

// An update installed over the running app (as electron-updater runs it) opens it again (--force-run): a new process
// with a window. (Explorer starts it, so without this test's variables: no debug port to reach it by.)
await section("update", async () => {
  if (!exe || !launched) throw new Error("not running")
  const t = Date.now()
  const windows = () => ps(`Get-Process -Name '${NAME}' -ErrorAction SilentlyContinue | ? { $_.MainWindowHandle -ne 0 } | % { $_.Id }`).split(/\s+/).filter(Boolean)
  const before = new Set(windows())
  const r = spawnSync(INSTALLER, ["/S", "--updated", "--force-run"], { stdio: "inherit" })
  const again = await waitFor(() => windows().find((id) => !before.has(id)) ?? null, 120_000)
  check(`installed over the running app, it opens again (${((Date.now() - t) / 1000).toFixed(0)} s)`, r.status === 0 && !!again, { status: r.status, before: [...before] })
})

// A first launch: Set up Vaultite's window (a home of its own, so it finds nothing of the runner's).
await section("set up", async () => {
  if (!exe) throw new Error("not installed")
  spawnSync("taskkill", ["/IM", `${NAME}.exe`, "/T", "/F"], { stdio: "ignore" })
  // (one still exiting holds the single-instance lock, and the new launch quits into it)
  await waitFor(() => (ps(`Get-Process -Name '${NAME}' -ErrorAction SilentlyContinue | % { $_.Id }`) ? null : true), 30_000)
  const userData = path.join(tmp, "userData-new"), home = path.join(tmp, "home"), debug = await freePort()
  fs.mkdirSync(path.join(home, "Documents"), { recursive: true })
  app = spawn(exe, [], { env: { ...process.env, VAULTITE_USER_DATA: userData, VAULTITE_SETUP_HOME: home, VAULTITE_DEBUG_PORT: String(debug) }, stdio: "ignore" })
  const page = await cdp(debug, "file:")
  check("a first launch shows Set up Vaultite", !!page && /onboarding\.html/.test(await page.evaluate("location.href")))
  if (!page) return
  const drawn = await waitFor(() => page.evaluate(`document.body.innerText.trim().length > 20`).then((x) => x || null), 30_000)
  check("its window draws", !!drawn)
  await sleep(1500)
  try { screenshot(path.join(OUT, "setup.png")) } catch (e) { console.log(`no screenshot: ${e}`) }
  page.close()
})

await section("uninstall", async () => {
  if (!exe) throw new Error("not installed")
  // (the app, its servers and their terminal keepers: everything running from where it's installed)
  spawnSync("taskkill", ["/IM", `${NAME}.exe`, "/T", "/F"], { stdio: "ignore" })
  await sleep(2000)
  const dir = path.dirname(exe)
  const r = spawnSync(path.join(dir, `Uninstall ${NAME}.exe`), ["/S"], { stdio: "inherit" })
  // (the uninstaller runs on as a copy of itself: done once its files and its registry entries are gone)
  const gone = await waitFor(() => (!fs.existsSync(exe!) && !/VaultiteTest\.Markdown/.test(reg("HKCU\\Software\\Classes\\.md"))) || null, 360_000)
  check("it uninstalls silently", r.status === 0 && !!gone, { status: r.status, left: fs.existsSync(dir) && fs.readdirSync(dir) })
  check("the uninstall takes its file association", !/VaultiteTest\.Markdown/.test(reg("HKCU\\Software\\Classes\\.md")), reg("HKCU\\Software\\Classes\\.md"))
  check("and its vaultite:// link", !reg("HKCU\\Software\\Classes\\vaultite\\shell\\open\\command").includes(NAME))
})

if (app && (app as ReturnType<typeof spawn>).exitCode === null) (app as ReturnType<typeof spawn>).kill()
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
process.exit(summary("installer", began))
