// The desktop app's browser tabs watched and driven from a plain browser (a phone, another Mac), as on an always-on Mac
// whose app is attached to its server (web/qa/attach.mjs): the list, frames, click or tap, typing, the wheel, Stop/Resume
// agents, Done for an ask and the tab's steps, on a computer and a phone; then from another machine's server (Machines).
// WRITES: the throwaway vault only.
//   node web/qa/browserlive.mjs <vault copy> [shots dir]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT, SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-live-"))
const RUN = path.join(TMP, "run")
fs.mkdirSync(RUN)
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer", "activity", "machines", "inbox"])] }))

// ---------- a page that says in its title what it got ----------
const site = http.createServer((_q, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>start</title><style>body{font:20px system-ui;margin:0}input{font-size:24px;position:fixed;top:20px;left:20px;width:60%}
button{position:fixed;top:80px;left:20px;font-size:24px;width:200px;height:60px}.tall{height:5000px;background:linear-gradient(#fff,#36c)}</style>
<input id="i" placeholder="type here"><button id="b">Click me</button><div class="tall"></div>
<script>let n=0;const t=()=>document.title=\`v=\${i.value} y=\${Math.round(scrollY)} clicks=\${n}\`;b.onclick=()=>{n++;t()};i.oninput=t;addEventListener("scroll",t);t()</script>`)
})
await new Promise((ok) => site.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${site.address().port}/`

// ---------- the always-on server, and the app attached to it; another machine's server, on a copy of the vault ----------
const PORT = 20000 + Math.floor(Math.random() * 20000)
const B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${PORT + 1}`
const machines = path.join(VAULT, ".vaultite/plugins/machines/data.json")
fs.mkdirSync(path.dirname(machines), { recursive: true })
fs.writeFileSync(machines, JSON.stringify({ machines: [{ id: "owner", label: "Owner", url: B }, { id: "laptop", label: "Laptop", url: F }] }))
const FVAULT = path.join(TMP, "laptop-vault")
fs.cpSync(VAULT, FVAULT, { recursive: true })
const server = testServer({ stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(TMP, "local"), HOST: "127.0.0.1", PORT: String(PORT), VAULTITE_DESKTOP: "", TMPDIR: RUN, XDG_RUNTIME_DIR: RUN, XDG_RUNTIME_DIR: RUN } })
let out = ""
server.stdout.on("data", (d) => { out += d })
server.stderr.on("data", (d) => { out += d })
await until(() => /vaultite: vault read/.test(out), 60000)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, TMPDIR: RUN, XDG_RUNTIME_DIR: RUN, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "app-local") },
})
const win = await app.firstWindow()
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const op = async (id, params) => {
  const r = await fetch(`${B}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status }
}
await until(async () => (await fetch(`${B}/api/machines/self`).then((r) => r.json())).desktop === true, 15000)
const { tab: TAB } = await op("open", { url: SITE, task: "live view" })
check("an agent's tab is open", typeof TAB === "number", TAB)
await op("navigate", { tab: TAB, to: SITE })
const tab = async () => (await (await fetch(`${B}/api/web-viewer/tabs?local=1`)).json()).tabs.find((t) => t.tab === TAB)
const ID = `${TAB}@owner`

async function run(label, viewport, mobile, base = B) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 })
  const page = watch(await ctx.newPage(), { label, console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(`${base}/#view/web-live`)
  const row = page.locator(`[data-web-live-tab="${ID}"]`)
  check(`${label}: the list shows the agent's tab`, await until(() => row.count(), 30000))
  if (await until(() => page.locator("[data-confirm]").count(), 3000)) await page.getByRole("button", { name: "Not now" }).click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-${label}-list.png` })
  await row.click()
  const frame = page.locator("[data-web-live-frame]")
  check(`${label}: its frames come`, await until(() => frame.isVisible(), 15000))
  await wait(1000)
  const box = await frame.boundingBox()
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y]
  const clicks = (t) => Number(/clicks=(\d+)/.exec(t)?.[1])
  const before = (await tab()).title
  // (the page's button: left 20, top 80, 200x60 of its viewport)
  const [bx, by] = at(0.23, 0.155)
  if (mobile) await page.touchscreen.tap(bx, by); else await page.mouse.click(bx, by)
  check(`${label}: a ${mobile ? "tap" : "click"} on the picture clicks the page`, await until(async () => clicks((await tab()).title) === clicks(before) + 1, 5000), [before, (await tab()).title])
  if (!mobile) {
    await page.mouse.click(...at(0.3, 0.05))
    await page.keyboard.type("xyz")
    await page.keyboard.press("Backspace")
    check(`${label}: typing goes into the page's field`, await until(async () => /v=\S*xy /.test((await tab()).title), 5000), (await tab()).title)
    await page.mouse.move(...at(0.5, 0.6))
    await page.mouse.wheel(0, 300)
    check(`${label}: the wheel scrolls it`, await until(async () => !/ y=0 /.test((await tab()).title), 5000), (await tab()).title)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-${label}-live.png` })
  if (base === B) {
    const busy = await fetch(`${B}/api/machines/desktop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "agent:busy" }) }).then((r) => r.json())
    check(`${label}: watched, the browser is busy (an update waits)`, busy.value?.busy === true, busy)
  }
  const was = (await tab()).paused
  await page.locator("[data-web-live-pause]").click()
  check(`${label}: Stop/Resume agents changes the engine's`, await until(async () => (await tab()).paused === !was, 5000), (await tab()).paused)
  if ((await tab()).asking) {
    await page.locator("[data-web-live-done]").click()
    check(`${label}: Done ends the ask`, await until(async () => (await tab()).asking === null, 5000), (await tab()).asking)
  }
  const steps = await page.locator("[data-web-live-steps]").getAttribute("data-web-live-steps")
  check(`${label}: the agent's steps in the tab show`, Number(steps) > 0, steps)
  await ctx.close()
}
await run("computer", { width: 1280, height: 800 }, false)
await op("ask", { tab: TAB, reason: "Solve the check, then Done" })
await run("phone", { width: 390, height: 844 }, true)

// Another machine (a laptop) with no browser of its own here: the owner's tabs listed, named, watched and driven through
// its server; an ask's Inbox row there opens the owner's tab.
const laptop = testServer({ stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, VAULTITE_VAULT: FVAULT, VAULTITE_LOCAL: path.join(TMP, "laptop-local"), HOST: "127.0.0.1", PORT: String(PORT + 1), VAULTITE_DESKTOP: "", TMPDIR: RUN, XDG_RUNTIME_DIR: RUN } })
let fout = ""
laptop.stdout.on("data", (d) => { fout += d })
laptop.stderr.on("data", (d) => { fout += d })
await until(() => /vaultite: vault read/.test(fout), 60000)
const listed = await until(async () => (await (await fetch(`${F}/api/web-viewer/tabs`)).json()).tabs?.find((t) => t.tab === TAB), 30000)
check("another machine lists the owner's tab, named as the owner's", listed?.machine === "owner" && listed.machineLabel === "Owner" && listed.appTab === "", listed)
await op("ask", { tab: TAB, reason: "Sign in, then Done" })
const asked = (await (await fetch(`${B}/api/inbox/events`)).json()).events.find((e) => e.source === "browser")
check("the ask's Inbox row names whose browser the tab is in", asked?.link === `view:web-live/${ID}`, asked)
const theirs = await until(async () => (await (await fetch(`${F}/api/inbox/events`)).json()).events.find((e) => e.source === "browser" && e.machine === "owner"), 30000)
check("… and it's on the other machine's Inbox, its link as it is", theirs?.link === `view:web-live/${ID}`, theirs)
await run("laptop", { width: 1280, height: 800 }, false, F)
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage(), { label: "laptop-link", console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
await op("ask", { tab: TAB, reason: "Solve the check, then Done" })
await page.goto(`${F}/#view/${encodeURIComponent(`web-live/${ID}`)}`)
check("the Inbox's link opens the owner's tab live there", await until(() => page.locator("[data-web-live-frame]").isVisible(), 15000))
check("… with the ask and Done", await until(() => page.locator("[data-web-live-done]").isVisible(), 5000))
await page.locator("[data-web-live-done]").click()
check("… whose Done ends it on the owner", await until(async () => (await tab()).asking === null, 5000), (await tab()).asking)
await ctx.close()
laptop.kill()

await app.close()
server.kill()
site.close()
try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* a server still writing its folder */ }
await done()
