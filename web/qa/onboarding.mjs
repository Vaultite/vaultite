// The desktop first run (web/src/components/Onboarding.tsx, electron/setup.ts, main.ts's setup:*, then
// components/Welcome.tsx in the vault's window) on a made-up home folder (VAULTITE_SETUP_HOME: iCloud Drive, an Obsidian
// vault, Claude Code and its config): the first launch shows one page, the vault, with page dots; a new vault in iCloud
// Drive opens, its window going on with the welcome card (the look, AI as found here, on a Mac the two permissions once
// agents are used, Allow turning Claude Code's computer use on for the vault, then done); it starts from Standard, its
// Start here written (with AI used, what the agent can do: core/start.ts), pinned and opened in one tab
// (core/desktopapp.ts), vau installed (it runs without Node and serves MCP); a relaunch shows neither,
// the menu shows setup again; an Obsidian vault opened changes none of its files; Manage vaults connects to another
// machine's server, opened in a window with no bridge; "Try the playground" opens the sandbox, and the next launch shows
// setup again; Manage vaults offers the playground too. Screenshots, light and dark. WRITES: temp folders only (its own
// userData, home, vaults and server).
//   node web/qa/onboarding.mjs [<shots dir>]
import { _electron } from "playwright-core"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"
const { check, watch, done } = await qa(import.meta.url, { chrome: false })

const MAC = process.platform === "darwin"
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
fs.chmodSync(put(path.join(HOME, ".local/bin/claude"), "#!/bin/sh\n"), 0o755)
const claudeJson = () => JSON.parse(fs.readFileSync(CLAUDE_JSON, "utf8"))
const tree = (dir) => Object.fromEntries((fs.readdirSync(dir, { recursive: true })).sort().filter((f) => !f.startsWith(".vaultite") && fs.statSync(path.join(dir, f)).isFile()).map((f) => [f.split(path.sep).join("/"), fs.readFileSync(path.join(dir, f), "latin1")]))
const obsidianBefore = tree(OBSIDIAN)

// ---------- another machine: a server of its own on a sandbox ----------
const OTHER = path.join(TMP, "other")
spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", OTHER], { stdio: "ignore" })
const otherPort = await freePort()
const other = testServer({ stdio: "ignore",
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
  // (macOS' own prompts are the user's: never from a test)
  await a.evaluate(({ systemPreferences, desktopCapturer }) => { systemPreferences.isTrustedAccessibilityClient = () => false; desktopCapturer.getSources = async () => [] })
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
  const size = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((x) => x.getTitle() === "Set up Vaultite")?.getContentSize())
  check("a small fixed window", size?.[0] === 560 && size?.[1] === 520, size)
  check("no other window opens with it", app.windows().length === 1, app.windows().map((x) => x.url()))
  check("one page, the vault: Create a vault by default, called Vault, in iCloud Drive", await w.isChecked("[data-choice=new] input") && await w.inputValue("[data-vault-name]") === "Vault"
    && await w.getAttribute("[data-place=icloud]", "aria-checked") === "true")
  check("page dots, the first of four, no numbered steps", (await w.getAttribute("[data-dots]", "data-dots")) === "1/4" && !(await w.$("[data-steps]")))
  check("it fits: nothing scrolls", await w.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight))
  await shoot(app, w, "1-welcome")
  await w.click("[data-choice=open]")
  await w.waitForSelector("[data-obsidian=Garden]")
  check("Open a folder lists Obsidian's vaults by name, the path only on hover, the first picked", (await w.textContent("[data-obsidian=Garden]")).trim() === "Garden"
    && (await w.getAttribute("[data-obsidian=Garden]", "data-tip")) === "~/Documents/Garden" && (await w.getAttribute("[data-obsidian=Garden]", "aria-checked")) === "true"
    && (await w.textContent("[data-next]")) === "Open vault")
  await shoot(app, w, "2-open-folder")
  await w.click("[data-choice=new]")
  await w.fill("[data-vault-name]", "Lighthouse")
  const vaultWin = app.waitForEvent("window", { timeout: 60000 })
  await w.keyboard.press("Enter")
  const VAULT = path.join(ICLOUD, "Lighthouse")
  const vw = await vaultWin
  check("Enter makes the vault and opens it", fs.existsSync(path.join(VAULT, ".vaultite")))
  watch(vw, { label: "vault", console: true })
  await vw.waitForSelector("[data-tab-id]", { timeout: 60000 })
  check("its window is the vault's", new URL(vw.url()).hostname === "127.0.0.1")
  check("the setup window closes", await until(() => !app.windows().some((x) => x.url().endsWith("onboarding.html")), 15000))
  check("setup is remembered as done, outside the vault", !!JSON.parse(fs.readFileSync(path.join(TMP, "userData/setup.json"), "utf8")).done && !fs.readdirSync(VAULT, { recursive: true }).some((f) => /setup\.json$/.test(f)))

  // The welcome card goes on over the vault: the look, AI, (permissions), done.
  check("the welcome card goes on over it, on the second dot", !!(await until(() => vw.$("[data-welcome=first-run]"), 15000)) && (await vw.getAttribute("[data-dots]", "data-dots")) === "2/4")
  await until(() => vw.locator("[data-welcome] [data-layout-pick]").count(), 8000)
  check("its look page: the three layouts, no Back (the vault is made)", await vw.locator("[data-welcome] [data-layout-pick]").count() === 3 && !(await vw.$("[data-welcome-back]")))
  await shoot(app, vw, "3-look")
  await vw.click("[data-welcome-next]")
  await vw.waitForSelector("[data-welcome-ai]", { timeout: 15000 })
  const found = (await vw.getAttribute("[data-welcome-ai]", "data-welcome-ai")) === "found"
  await shoot(app, vw, `4-ai-${found ? "found" : "none"}`)
  if (found) {
    await vw.click("[data-welcome-use]")
    if (MAC) {
      await vw.waitForSelector("[data-welcome-permissions] [data-permission=screen]", { timeout: 15000 })
      check("Use them, on a Mac: Accessibility and Screen recording, nothing else", JSON.stringify(await vw.$$eval("[data-permission]", (l) => l.map((e) => e.dataset.permission))) === '["accessibility","screen"]')
      check("...still the AI dot", (await vw.getAttribute("[data-dots]", "data-dots")) === "3/4")
      await shoot(app, vw, "5-permissions")
      check("nothing outside the vault changes before Allow", JSON.stringify(claudeJson().projects ?? {}) === "{}")
      await vw.click("[data-act=accessibility]")
      check("Allow… opens its exact pane", await until(() => app.evaluate(() => globalThis.opened.some((u) => u.endsWith("?Privacy_Accessibility"))), 5000))
      const after = await until(() => { const j = claudeJson(); return j.projects?.[fs.realpathSync(VAULT)] ? j : null }, 5000)
      check("...and turns Claude Code's computer use on for this vault, its other settings kept", JSON.stringify(after?.projects?.[fs.realpathSync(VAULT)]?.enabledMcpServers) === '["computer-use"]'
        && after.numStartups === 4 && after.mcpServers.other.command === "other", after)
      await vw.click("[data-welcome-next]")
    }
  } else await vw.click("[data-welcome-next]")
  await vw.waitForSelector("[data-welcome-body=done]", { timeout: 15000 })
  check("then done, on the last dot", (await vw.getAttribute("[data-dots]", "data-dots")) === "4/4")
  await shoot(app, vw, "6-done")
  await vw.keyboard.press("ControlOrMeta+o")
  check("pressing its key ends it", await until(async () => !(await vw.$("[data-welcome]")), 5000))
  await vw.keyboard.press("Escape")

  // (Standard is the app's defaults: no plugins.json at all)
  const pjFile = path.join(VAULT, ".vaultite/plugins.json"), pj = fs.existsSync(pjFile) ? JSON.parse(fs.readFileSync(pjFile, "utf8")) : {}, pages = JSON.parse(fs.readFileSync(path.join(VAULT, ".vaultite/pages.json"), "utf8"))
  check("it starts from Standard: a terminal, no plugin another bundle turns on", !(pj.enabled ?? []).includes("people") && !(pj.enabled ?? []).includes("today") && !(pj.disabled ?? []).includes("terminal"), pj)
  // (and the pages of agents Use them switched on: Codex's)
  check("Start here is written and the first pin", fs.existsSync(path.join(VAULT, "Start here.md")) && pages.pinned[0] === "Start here.md"
    && pages.pinned.slice(1).every((p) => /^Dashboards\/(Codex|OpenCode)\.md$/.test(p)), pages)
  // (Use them: Start here says to ask Claude Code, its page and the pointers for agents come; else no word of AI)
  check("Start here opens in a tab, its text drawn", await until(() => vw.evaluate((found) => decodeURIComponent(location.hash).includes("Start here")
    && (found ? /@claude what can I do/ : /Find your way/).test(document.querySelector("[data-pane]")?.textContent ?? ""), found), 20000), await vw.evaluate(() => location.hash))
  const startText = fs.readFileSync(path.join(VAULT, "Start here.md"), "utf8")
  check(found ? "...saying what Claude Code can do, Settings > AI for the apps" : "...with no word of AI", found ? startText.includes("Settings > AI connects") && !startText.includes("Connections")
    : !/\b(AI|Claude|claude|Codex)\b|Connections/.test(startText), startText)
  check(found ? "Claude Code's page and the pointers for agents come with Use them" : "no agent's page or pointers without AI",
    ["Dashboards/Claude.md", "CLAUDE.md", "AGENTS.md"].every((f) => fs.existsSync(path.join(VAULT, f)) === found), fs.readdirSync(VAULT, { recursive: true }))
  // (the window's first tab shows the first pin, and the desktop asks for Start here too: one tab, not two)
  const startTabs = () => vw.evaluate(() => [...document.querySelectorAll("[data-tab-id]")].map((t) => t.textContent.trim()))
  check("...once: one tab shows it", (await startTabs()).filter((t) => /^Start here/.test(t)).length === 1, await startTabs())
  await vw.screenshot({ path: path.join(SHOTS, "7-vault.png") })
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
  check("the vault menu has Open the playground", await until(() => vw.$("[role=menu] >> text=Open the playground"), 3000))
  await vw.keyboard.press("Escape")
  await app.close()

  // ---------- 2. a relaunch, then the menu: an Obsidian vault ----------
  app = await launch("userData")
  const vw2 = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1")), 60000)
  await vw2.waitForSelector("[data-tab-id]", { timeout: 60000 })
  await wait(1500)
  check("a relaunch shows neither setup nor the card again", !app.windows().some((x) => x.url().endsWith("onboarding.html")) && !(await vw2.$("[data-welcome]")))
  await menuItem(app, "Set up Vaultite")
  w = await setupOf(app)
  check("the menu's Set up Vaultite shows it again", !!w)
  watch(w, { label: "setup 2", console: true })
  await w.waitForSelector("[data-choice=open]")
  await w.click("[data-choice=open]")
  await w.click("[data-obsidian=Garden]")
  const claudeBefore = fs.readFileSync(CLAUDE_JSON, "utf8")
  await w.click("[data-next]")
  const gw = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1") && x !== vw2 && !x.isClosed()), 60000)
  await gw?.waitForSelector("[data-tab-id]", { timeout: 60000 })
  check("an opened folder gets the welcome card too", !!(await until(() => gw.$("[data-welcome=first-run]"), 15000)))
  await gw.keyboard.press("Escape")
  check("Esc ends it", await until(async () => !(await gw.$("[data-welcome]")), 4000))
  await wait(1500)
  check("nothing outside the vault changed", fs.readFileSync(CLAUDE_JSON, "utf8") === claudeBefore)
  const obsidianAfter = tree(OBSIDIAN)
  const touched = Object.keys({ ...obsidianBefore, ...obsidianAfter }).filter((f) => obsidianBefore[f] !== obsidianAfter[f])
  check("the Obsidian vault: none of its files changed, nothing added outside .vaultite/", !touched.length, touched)
  const gp = JSON.parse(fs.readFileSync(path.join(OBSIDIAN, ".vaultite/pages.json"), "utf8"))
  const gpFile = path.join(OBSIDIAN, ".vaultite/plugins.json")
  check("it starts from Standard too, nothing pinned", JSON.stringify(gp.pinned) === "[]"
    && !((fs.existsSync(gpFile) ? JSON.parse(fs.readFileSync(gpFile, "utf8")) : {}).enabled ?? []).includes("people"), gp)
  const rows = await gw.evaluate(() => [...document.querySelectorAll("[role=tree] [role=treeitem]")].map((e) => e.textContent.trim()))
  check("the file tree shows its notes", rows.some((t) => /Welcome/.test(t)) && !rows.some((t) => /vaultite|^Dashboards$/.test(t)), rows)
  await gw.screenshot({ path: path.join(SHOTS, "8-own-folder.png") })
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
  await mgr.screenshot({ path: path.join(SHOTS, "10-connect.png") })
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

  // ---------- 5. Manage vaults with no vault yet: the playground offered ----------
  fs.mkdirSync(path.join(TMP, "userData-done"), { recursive: true })
  fs.writeFileSync(path.join(TMP, "userData-done/setup.json"), JSON.stringify({ done: new Date().toISOString() }))
  app = await launch("userData-done")
  const mgr2 = await until(() => app.windows().find((x) => x.url().endsWith("vaults.html")), 15000)
  await mgr2?.waitForSelector("text=Open folder as vault")
  check("set up before, no vaults: the manager", !!mgr2)
  check("Manage vaults lists no vault, and offers the playground", !(await mgr2.$("nav[aria-label=Vaults] button[data-tip]")) && !!(await mgr2.$("[data-playground]")))
  await mgr2.click("[data-playground]")
  const box2 = await until(() => app.windows().find((x) => x.url().startsWith("http://127.0.0.1")), 60000)
  check("its Open opens the playground", !!box2 && fs.existsSync(path.join(TMP, "userData-done/Sandbox/.vaultite/sandbox.json")))
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
