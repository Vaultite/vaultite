// Set up Vaultite (web/src/components/Onboarding.tsx, electron/setup.ts, main.ts's setup:*) in the desktop app, on a
// made-up home folder (VAULTITE_SETUP_HOME: iCloud Drive, an Obsidian vault, Claude Code's config): the first launch
// shows one screen; a new vault in iCloud Drive starts from Minimal, its Start here written, pinned and opened, vau
// installed (it runs without Node and serves MCP), no AI app's config touched; a relaunch doesn't show it, the menu does;
// an Obsidian vault opened changes none of its files; Manage vaults connects to another machine's server, opened in a
// window with no bridge; "Try the playground first" opens the sandbox, and the next launch shows setup again. Screenshots,
// light and dark. WRITES: temp folders only (its own userData, home, vaults and server).
//   node web/qa/onboarding.mjs [<shots dir>]
import { _electron } from "playwright-core"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, qa, until, wait } from "./lib/qa.mjs"
const { check, watch, done } = await qa(import.meta.url, { chrome: false })

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-onboarding-"))
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : path.join(TMP, "shots")
fs.mkdirSync(SHOTS, { recursive: true })

// ---------- a made-up Mac ----------
const HOME = path.join(TMP, "home")
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p }
const ICLOUD = path.join(HOME, "Library/Mobile Documents/com~apple~CloudDocs")
fs.mkdirSync(ICLOUD, { recursive: true })
fs.mkdirSync(path.join(HOME, "Documents"), { recursive: true })
const OBSIDIAN = path.join(HOME, "Documents", "Garden")
const mine = { "Welcome.md": "My garden.\n", "Notes/Plain.md": "Just a thought.\n", "Daily/2026-10-01.md": "Rain.\n", ".obsidian/app.json": "{}" }
for (const [f, t] of Object.entries(mine)) put(path.join(OBSIDIAN, f), t)
put(path.join(HOME, "Library/Application Support/obsidian/obsidian.json"), JSON.stringify({ vaults: { a1: { path: OBSIDIAN, ts: 2, open: true } } }))
const CLAUDE_JSON = put(path.join(HOME, ".claude.json"), JSON.stringify({ numStartups: 4, mcpServers: { other: { type: "stdio", command: "other", args: [], env: {} } } }, null, 2))
const claudeBefore = fs.readFileSync(CLAUDE_JSON, "utf8")
const tree = (dir) => Object.fromEntries((fs.readdirSync(dir, { recursive: true })).sort().filter((f) => !f.startsWith(".vaultite") && fs.statSync(path.join(dir, f)).isFile()).map((f) => [f, fs.readFileSync(path.join(dir, f), "latin1")]))
const obsidianBefore = tree(OBSIDIAN)

// ---------- another machine: a server of its own on a sandbox ----------
const OTHER = path.join(TMP, "other")
spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", OTHER], { stdio: "ignore" })
const otherPort = await freePort()
const other = spawn(process.execPath, [path.join(ROOT, "server.ts")], { cwd: ROOT, stdio: "ignore",
  env: { ...process.env, PORT: String(otherPort), HOST: "127.0.0.1", VAULTITE_VAULT: OTHER, VAULTITE_LOCAL: path.join(TMP, "other-local") } })
const OTHER_URL = `http://127.0.0.1:${otherPort}`
await until(async () => (await fetch(`${OTHER_URL}/api/state`)).ok, 60000)

// ---------- the app ----------
const env = (userData) => ({ ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, userData),
  VAULTITE_LOCAL: path.join(TMP, "local"), VAULTITE_SETUP_HOME: HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? path.join(TMP, "claude") })
const apps = []
async function launch(userData) {
  const a = await _electron.launch({ executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT], env: env(userData) })
  apps.push(a)
  // Links leave for the browser: not in a test.
  await a.evaluate(({ shell }) => { globalThis.opened = []; shell.openExternal = async (u) => { globalThis.opened.push(u) } })
  return a
}
const setupOf = (a) => until(() => a.windows().find((w) => w.url().endsWith("onboarding.html")), 15000)
/** A picture of the window in light and dark. */
async function shoot(a, w, name) {
  for (const theme of ["light", "dark"]) {
    await w.emulateMedia({ colorScheme: theme })
    check(`${name}: drawn ${theme}`, await until(() => w.evaluate((t) => document.documentElement.classList.contains("dark") === (t === "dark"), theme), 3000))
    await wait(150)
    await w.screenshot({ path: path.join(SHOTS, `${name}-${theme}.png`) })
  }
  await w.emulateMedia({ colorScheme: "light" })
}
const menuItem = (app, label) => app.evaluate(({ Menu }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click()
}, label)

try {
  // ---------- 1. the first launch: a new vault ----------
  let app = await launch("userData")
  let w = await setupOf(app)
  check("the first launch shows Set up Vaultite", !!w)
  watch(w, { label: "setup", console: true })
  await w.waitForSelector("[data-next]")
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.getTitle() === "Set up Vaultite")?.getContentSize())
  check("a small fixed window", size?.[0] === 560 && size?.[1] === 600, size)
  check("no other window opens with it", app.windows().length === 1, app.windows().map((x) => x.url()))
  check("one screen: New vault by default, called Vault, in iCloud Drive", await w.isChecked("[data-choice=new] input") && await w.inputValue("[data-vault-name]") === "Vault"
    && await w.getAttribute("[data-place=icloud]", "aria-checked") === "true")
  check("it fits: nothing scrolls", await w.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight))
  await shoot(app, w, "1-welcome")
  await w.click("[data-choice=open]")
  await w.waitForSelector("[data-obsidian=Garden]")
  check("Open folder lists Obsidian's vaults, and waits for one", await w.isDisabled("[data-next]") && (await w.textContent("[data-next]")) === "Open vault")
  await w.click("[data-obsidian=Garden]")
  await shoot(app, w, "2-open-folder")
  await w.click("[data-choice=new]")
  await w.fill("[data-vault-name]", "Lighthouse")
  const vaultWin = app.waitForEvent("window", { timeout: 60000 })
  await w.keyboard.press("Enter")
  const vw = await vaultWin
  watch(vw, { label: "vault", console: true })
  await vw.waitForSelector("[data-tab-id]", { timeout: 60000 })
  const VAULT = path.join(ICLOUD, "Lighthouse")
  check("Enter makes the vault in iCloud Drive and opens it", fs.existsSync(path.join(VAULT, ".vaultite")) && new URL(vw.url()).hostname === "127.0.0.1")
  check("the setup window closes", await until(() => !app.windows().some((x) => x.url().endsWith("onboarding.html")), 15000))
  check("setup is remembered as done, outside the vault", !!JSON.parse(fs.readFileSync(path.join(TMP, "userData/setup.json"), "utf8")).done && !fs.readdirSync(VAULT, { recursive: true }).some((f) => /setup\.json$/.test(f)))
  const pj = JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/plugins.json"), "utf8")), pages = JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/pages.json"), "utf8"))
  check("it starts from Minimal: a terminal, no Life OS", pj.disabled.includes("people") && pj.disabled.includes("today") && !pj.disabled.includes("terminal"), pj)
  check("Start here is written and the only pin", fs.existsSync(path.join(VAULT, "Start here.md")) && JSON.stringify(pages.pinned) === '["Start here.md"]', pages)
  check("Start here opens in a tab, its text drawn", await until(() => vw.evaluate(() => decodeURIComponent(location.hash).includes("Start here") && /run claude/.test(document.querySelector("[data-pane]")?.textContent ?? "")), 20000),
    await vw.evaluate(() => location.hash))
  check("no AI app's config is touched", fs.readFileSync(CLAUDE_JSON, "utf8") === claudeBefore)
  await vw.screenshot({ path: path.join(SHOTS, "3-vault.png") })
  const VAU = path.join(HOME, ".local/bin/vau")
  check("vau is installed", await until(() => fs.existsSync(VAU), 15000))
  const help = spawnSync(VAU, ["--help"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME } })
  check("vau runs with the app's own Node (none on the PATH)", /vau: drive Vaultite/.test(help.stdout), help.stderr || help.stdout)
  await until(() => JSON.parse(fs.readFileSync(path.join(TMP, "userData/vaults.json"), "utf8")).vaults.some((v) => v.path === VAULT && v.open), 15000) // (what vau finds it by)
  const mcp = spawn(VAU, ["mcp"], { env: { PATH: "/usr/bin:/bin", HOME }, stdio: ["pipe", "pipe", "pipe"] })
  let said = "", errors = ""
  mcp.stdout.on("data", (b) => (said += b))
  mcp.stderr.on("data", (b) => (errors += b))
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "qa", version: "1" } } }) + "\n")
  mcp.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n")
  check("vau mcp serves the vault's tools", await until(() => /"write_file"/.test(said), 20000), errors || said.slice(-300))
  mcp.kill()
  await vw.click("nav[aria-label=App] button[aria-haspopup=menu]")
  check("the vault menu has Open the sandbox", await until(() => vw.$("[role=menu] >> text=Open the sandbox"), 3000))
  await vw.keyboard.press("Escape")
  await app.close()

  // ---------- 2. a relaunch, then the menu: an Obsidian vault ----------
  app = await launch("userData")
  const vw2 = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1")), 60000)
  await wait(1500)
  check("a relaunch doesn't show setup again", !app.windows().some((x) => x.url().endsWith("onboarding.html")))
  await menuItem(app, "Set up Vaultite")
  w = await setupOf(app)
  check("the menu's Set up Vaultite shows it again", !!w)
  watch(w, { label: "setup 2", console: true })
  await w.waitForSelector("[data-choice=open]")
  await w.click("[data-choice=open]")
  await w.click("[data-obsidian=Garden]")
  await w.click("[data-next]")
  const gw = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1") && x !== vw2 && !x.isClosed()), 60000)
  await gw?.waitForSelector("[data-tab-id]", { timeout: 60000 })
  await wait(1500)
  const obsidianAfter = tree(OBSIDIAN)
  const touched = Object.keys({ ...obsidianBefore, ...obsidianAfter }).filter((f) => obsidianBefore[f] !== obsidianAfter[f])
  check("the Obsidian vault: none of its files changed, nothing added outside .vaultite/", !touched.length, touched)
  const gp = JSON.parse(fs.readFileSync(path.join(OBSIDIAN, ".vaultite/pages.json"), "utf8"))
  check("it starts from Minimal too, nothing pinned, the plugins' pages out of its files", gp.install === false && JSON.stringify(gp.pinned) === "[]"
    && JSON.parse(fs.readFileSync(path.join(OBSIDIAN, ".vaultite/plugins.json"), "utf8")).disabled.includes("people"), gp)
  const rows = await gw.evaluate(() => [...document.querySelectorAll("[role=tree] [role=treeitem] > :first-child")].map((e) => e.textContent.trim()))
  check("the file tree shows its notes", rows.some((t) => /Welcome/.test(t)) && !rows.some((t) => /vaultite|^Dashboards$/.test(t)), rows)
  await gw.screenshot({ path: path.join(SHOTS, "4-own-folder.png") })
  await app.close()

  // ---------- 3. Manage vaults: another machine ----------
  app = await launch("userData")
  const vw3 = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1")), 60000)
  await vw3.waitForSelector("[data-tab-id]", { timeout: 60000 })
  await vw3.evaluate(() => window.vaultite.manageVaults())
  const mgr = await until(() => app.windows().find((x) => x.url().endsWith("vaults.html")), 15000)
  watch(mgr, { label: "manager", console: true })
  await mgr.waitForSelector("text=Connect to a server")
  await mgr.click("text=Connect to a server >> xpath=../.. >> button")
  await mgr.fill("[data-server]", "nothing.invalid")
  await mgr.keyboard.press("Enter")
  check("an address that doesn't answer says so, plainly", await until(() => mgr.$eval("[role=alert]", (e) => /^No machine has that name/.test(e.textContent)), 15000), await mgr.textContent("body"))
  await mgr.screenshot({ path: path.join(SHOTS, "5-connect.png") })
  await mgr.fill("[data-server]", OTHER_URL)
  await mgr.keyboard.press("Enter")
  const rw = await until(() => app.windows().find((x) => x.url().startsWith(OTHER_URL)), 30000)
  check("another machine's server opens in a window", !!rw)
  await rw?.waitForSelector("[data-tab-id]", { timeout: 60000 })
  check("its page gets no bridge into this machine", await rw?.evaluate(() => typeof window.vaultite === "undefined"))
  await app.close()
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, "userData/vaults.json"), "utf8"))
  check("it's kept in the list, like the iPhone's servers", saved.servers?.some((s) => s.url === OTHER_URL), saved.servers)

  // ---------- 4. look around first ----------
  app = await launch("userData-look")
  w = await setupOf(app)
  watch(w, { label: "setup 4", console: true })
  await w.waitForSelector("[data-look]")
  await w.click("[data-look]")
  const box = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1")), 60000)
  check("Try the playground first opens the sandbox", !!box && fs.existsSync(path.join(TMP, "userData-look/Sandbox/.vaultite/sandbox.json")))
  check("and the setup window closes", await until(() => !app.windows().some((x) => x.url().endsWith("onboarding.html")), 15000))
  await box?.waitForSelector("[data-tab-id]", { timeout: 60000 })
  const list = await box.evaluate(() => window.vaultite.vaults())
  check("the sandbox is the only vault", list.vaults.length === 1 && list.vaults[0].sandbox)
  await app.close()
  app = await launch("userData-look")
  w = await setupOf(app)
  check("the next launch shows setup again", !!w && !!(await until(() => w.$("[data-next]"), 15000)))
  await app.close()

  // ---------- 5. Manage vaults doesn't push the sandbox ----------
  fs.mkdirSync(path.join(TMP, "userData-done"), { recursive: true })
  fs.writeFileSync(path.join(TMP, "userData-done/setup.json"), JSON.stringify({ done: new Date().toISOString() }))
  app = await launch("userData-done")
  const mgr2 = await until(() => app.windows().find((x) => x.url().endsWith("vaults.html")), 15000)
  await mgr2?.waitForSelector("text=Open folder as vault")
  check("set up before, no vaults: the manager", !!mgr2)
  check("Manage vaults has no sandbox row", !(await mgr2.$("text=Try the sandbox")))
  await app.close()
} catch (e) {
  check(String(e?.stack ?? e), false)
} finally {
  for (const a of apps) await a.close().catch(() => {})
  other.kill()
  spawnSync("tmux", ["-L", `vaultite-${otherPort}`, "kill-server"], { stdio: "ignore" })
}
console.log(`\nshots in ${SHOTS}`)
if (process.argv[2]) fs.rmSync(TMP, { recursive: true, force: true })
await done()
