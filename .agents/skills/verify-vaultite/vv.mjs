import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runtimeDir } from "../../../core/runtime.ts"
import { PROTOCOL } from "../../../plugins/core/terminal/termd/protocol.ts"
import { MOVED } from "../../../core/migrations.ts"
import { officialPlugins } from "../../../tools/qa_plugins.ts"
import { quietGrants } from "../../../tools/qa_grants.ts"
import { gitEnv } from "../../../core/gitenv.ts"
import { app } from "../../../web/qa/lib/app.mjs"

const ROOT = fileURLToPath(new URL("../../../", import.meta.url))
const HOME = process.env.VV_HOME ?? path.join(os.tmpdir(), "verify-vaultite")
const STATE = path.join(HOME, "state.json")
const [cmd = "help", ...rest] = process.argv.slice(2)

const started = []
const kill = (pid) => { try { process.kill(pid); return true } catch { return false } }
const die = (why) => {
  for (const pid of started) kill(-pid)
  console.error(`vv ${cmd}: ${why}`); process.exit(1)
}
const flag = (name) => { const i = rest.indexOf(`--${name}`); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, v === undefined || v.startsWith("--") ? 1 : 2); return v === undefined || v.startsWith("--") ? true : v }
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")) } catch { return die(`no instance (${STATE}): vv up first`) } }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const freePort = () => new Promise((done) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)) }) })
const vau = (base, args) => execFileSync(process.execPath, [path.join(ROOT, "bin/vau"), ...(base ? ["--url", base] : []), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] })
// (QA's Chromium, not web/qa/lib/qa.mjs's import: that isolates a test run, which this isn't)
const chromePath = async () => process.env.VAULTITE_CHROME ?? (await import("playwright-core")).chromium.executablePath()

async function until(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    if (await fn().catch(() => false)) return
    if (Date.now() > end) die(`${what} didn't happen within ${ms / 1000} s`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function up() {
  if (fs.existsSync(STATE) && alive(state().server)) die(`one runs already (${state().base}): vv down first`)
  const run = new Date().toISOString().replace(/[:.]/g, "-"), dir = path.join(HOME, "runs", run)
  const vault = path.join(dir, "vault"), local = path.join(dir, "local"), evidence = path.join(HOME, "evidence", run)
  fs.mkdirSync(local, { recursive: true }); fs.mkdirSync(evidence, { recursive: true })
  vau(null, ["sandbox", vault])
  quietGrants(vault)
  const port = await freePort(), base = `http://127.0.0.1:${port}/`
  if (!fs.existsSync(path.join(ROOT, "web/dist/index.html"))) die("no web/dist: npm run build first")
  const log = fs.openSync(path.join(dir, "server.log"), "a")
  const server = spawn(process.execPath, [path.join(ROOT, "server.ts")], { cwd: ROOT, detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, VAULTITE_VAULT: vault, VAULTITE_LOCAL: local, PORT: String(port), HOST: "127.0.0.1", VAULTITE_URL: base.slice(0, -1) } })
  server.unref(); started.push(server.pid)
  await until(async () => (await fetch(`${base}api/state`)).ok, 60_000, "the server answering")
  await ownPlugins(vault, base)
  const cdp = await freePort()
  const chrome = spawn(await chromePath(), ["--headless=new", `--remote-debugging-port=${cdp}`, `--user-data-dir=${path.join(dir, "chrome")}`, "--mute-audio",
    "--no-first-run", "--no-default-browser-check", ...(process.platform === "linux" ? ["--no-sandbox"] : []), "--window-size=1280,800", "about:blank"],
  { detached: true, stdio: "ignore" })
  chrome.unref(); started.push(chrome.pid)
  await until(async () => (await fetch(`http://127.0.0.1:${cdp}/json/version`)).ok, 30_000, "Chromium answering")
  fs.writeFileSync(STATE, JSON.stringify({ base, port, server: server.pid, chrome: chrome.pid, cdp, dir, vault, local, evidence, motion: !!flag("motion") }, null, 2))
  await withPage(async (page, ui) => { await page.goto(base); await page.locator("[data-pane]").first().waitFor({ timeout: 30_000 }); await ui.idle() })
  console.log(`up: ${base} on ${vault}\nevidence: ${evidence}`)
}

async function ownPlugins(vault, base) {
  const on = JSON.parse(fs.readFileSync(path.join(vault, ".vaultite/plugins.json"), "utf8")).enabled ?? []
  const from = officialPlugins()
  for (const id of Object.keys(MOVED).filter((id) => on.includes(id) && fs.existsSync(path.join(from, id, "manifest.json")))) {
    for (const [op, body] of [["plugin.install", { source: path.join(from, id) }], ["plugin.enable", { id }]]) {
      const r = await fetch(`${base}api/ops/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!r.ok) die(`${op} ${id}: ${(await r.text()).slice(0, 200)}`)
    }
  }
}

const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } }
const SHOWN = "[data-pane], [data-phone-header]"

async function viewport(name) {
  const s = state(), size = SIZES[name] ?? die(`a viewport is one of ${Object.keys(SIZES).join(", ")}`)
  fs.writeFileSync(STATE, JSON.stringify({ ...s, size: name }, null, 2))
  await withPage(async (page) => {
    const cdp = await page.context().newCDPSession(page)
    const { windowId } = await cdp.send("Browser.getWindowForTarget")
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: size })
    await page.locator(SHOWN).first().waitFor()
    console.log(`${name}: ${size.width}x${size.height}`)
  })
}

async function withPage(fn) {
  const s = state()
  const { chromium } = await import("playwright-core")
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${s.cdp}`)
  const ctx = browser.contexts()[0] ?? await browser.newContext()
  const page = ctx.pages()[0] ?? await ctx.newPage()
  await page.setViewportSize(SIZES[s.size ?? "desktop"])
  if (!s.motion) await page.emulateMedia({ reducedMotion: "reduce" })
  const ui = app(page)
  try { return await fn(page, ui, s) } finally { await ui.idle().catch(() => {}) }
}

async function doctor() {
  const s = state(), bad = []
  if (!alive(s.server)) bad.push(`server ${s.server} gone`)
  const st = await fetch(`${s.base}api/state`).then((r) => r.ok, () => false)
  if (!st) bad.push(`${s.base} doesn't answer`)
  if (!fs.existsSync(path.join(s.vault, ".vaultite/sandbox.json"))) bad.push(`${s.vault} isn't a sandbox`)
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", env: gitEnv() }).trim()
  const commit = st ? JSON.parse(vau(s.base, ["version", "--json"])).commit ?? "" : ""
  if (st && (!commit || commit !== head)) bad.push(`it runs ${commit.slice(0, 8) || "an unknown commit"}, the checkout is at ${head.slice(0, 8)}: vv down, vv up`)
  if (!(await fetch(`http://127.0.0.1:${s.cdp}/json/version`).then((r) => r.ok, () => false))) bad.push(`Chromium on ${s.cdp} doesn't answer`)
  else await withPage(async (page) => { if (!page.url().startsWith(s.base)) bad.push(`the page shows ${page.url()}, not ${s.base}`) })
  console.log(bad.length ? `not ok:\n- ${bad.join("\n- ")}` : `ok: ${s.base} (${head.slice(0, 8)}), vault ${s.vault}, evidence ${s.evidence}`)
  process.exit(bad.length ? 1 : 0)
}

function target(page, to = "") {
  const role = flag(`${to}role`), name = flag(`${to}name`), label = flag(`${to}label`), text = flag(`${to}text`), sel = flag(`${to}sel`)
  if (role) return page.getByRole(role, name ? { name, exact: true } : {}).first()
  if (label) return page.getByLabel(label, { exact: true }).first()
  if (text) return page.getByText(text, { exact: true }).first()
  if (sel) return page.locator(sel).first()
  return die(`say what: --${to}role <role> [--${to}name <name>], --${to}label, --${to}text or --${to}sel <css>`)
}

const SPOTS = { center: [0.5, 0.5], left: [0.08, 0.5], right: [0.92, 0.5], top: [0.5, 0.08], bottom: [0.5, 0.92] }
async function drag(page) {
  const spot = SPOTS[flag("at") ?? "center"] ?? die(`--at is one of ${Object.keys(SPOTS).join(", ")}`)
  const from = target(page), to = target(page, "to-")
  await from.scrollIntoViewIfNeeded()
  const a = await from.boundingBox(), b = await to.boundingBox()
  if (!a || !b) die(`${a ? "the drop target" : "what to drag"} isn't on screen`)
  await page.mouse.move(a.x + Math.min(60, a.width / 2), a.y + a.height / 2); await page.mouse.down()
  await page.mouse.move(a.x + Math.min(60, a.width / 2) + 8, a.y + a.height / 2 + 4, { steps: 2 })
  await page.mouse.move(b.x + b.width * spot[0], b.y + b.height * spot[1], { steps: 10 })
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  await page.mouse.up()
}

async function down() {
  const s = state()
  for (const pid of [s.chrome, s.server]) if (!kill(-pid)) kill(pid)
  const termd = path.join(runtimeDir(), `vaultite-termd${PROTOCOL}-vaultite-${s.port}.sock.pid`)
  if (fs.existsSync(termd)) kill(Number(fs.readFileSync(termd, "utf8")))
  fs.rmSync(s.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  fs.rmSync(STATE, { force: true })
  console.log(`down: evidence kept in ${s.evidence}`)
}

const shotName = (n) => path.join(state().evidence, `${n.replace(/[^\w.-]+/g, "-")}`)

switch (cmd) {
  case "up": await up(); break
  case "doctor": await doctor(); break
  case "down": await down(); break
  case "open": await withPage(async (page, ui, s) => { await page.goto(`${s.base}${rest[0] ?? ""}`); await page.locator(SHOWN).first().waitFor(); await ui.idle(); console.log(page.url()) }); break
  case "click": await withPage(async (page) => { const right = flag("right"); await target(page).click(right ? { button: "right" } : {}) }); break
  case "viewport": await viewport(rest[0]); break
  case "drag": await withPage(drag); break
  case "type": await withPage((page) => page.keyboard.type(rest.join(" "))); break
  case "press": await withPage((page) => page.keyboard.press(rest[0] ?? die("which key: Enter, Escape, ControlOrMeta+p..."))); break
  case "menu": await withPage(async (_page, ui) => { if (!(await ui.menu.isOpen())) die("no menu open"); await ui.menu.pick(...rest) }); break
  case "idle": await withPage(async (_page, ui) => ui.idle()); break
  case "aria": await withPage(async (page) => {
    const sel = flag("sel"), out = flag("out")
    const snap = await page.locator(sel ?? "body").first().ariaSnapshot()
    if (out) fs.writeFileSync(`${shotName(out)}.aria.txt`, snap)
    console.log(snap)
  }); break
  case "shot": await withPage(async (page) => { const f = `${shotName(rest[0] ?? "shot")}.png`; await page.screenshot({ path: f }); console.log(f) }); break
  case "eval": await withPage(async (page) => console.log(JSON.stringify(await page.evaluate(rest.join(" ")), null, 2))); break
  case "vau": try { process.stdout.write(vau(state().base, rest)) } catch (e) { process.stdout.write(e.stdout ?? ""); process.stderr.write(e.stderr ?? String(e)); process.exit(e.status ?? 1) } break
  default:
    console.log(`up [--motion] | doctor | open [#hash] | click --role R [--name N] | --label L | --text T | --sel CSS [--right]
drag <what> --to-role R [--to-name N] | --to-sel CSS ... [--at center|left|right|top|bottom]
type <text> | press <key> | menu <item> [<subitem>...] | idle | aria [--sel CSS] [--out name] | shot <name> | eval <js>
viewport desktop|phone | vau <args> | down     (state: ${STATE})`)
}
process.exit(0)
