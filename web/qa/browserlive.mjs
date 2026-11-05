// The desktop app's browser tabs watched and driven from a plain browser (a phone, another Mac), as on an always-on Mac
// whose app is attached to its server (web/qa/attach.mjs): the list, frames, click or tap, typing, the wheel, Stop/Resume
// agents, Done for an ask and the tab's steps, on a computer and a phone (a pinch zooms, a tap zoomed in, a double tap,
// trackpad mode); then from another machine's server (Machines).
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
  // (the page's button: left 20, top 80, 200x60 of its viewport, an agent's 1280x800)
  const [bx, by] = at(0.09, 0.14)
  if (mobile) await page.touchscreen.tap(bx, by); else await page.mouse.click(bx, by)
  check(`${label}: a ${mobile ? "tap" : "click"} on the picture clicks the page`, await until(async () => clicks((await tab()).title) === clicks(before) + 1, 5000), [before, (await tab()).title])
  if (mobile) {
    // (real fingers, through CDP: Playwright's touchscreen only taps)
    const cdp = await ctx.newCDPSession(page)
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) })
    const gesture = async (from, to, steps = 10) => {
      await touch("touchStart", from)
      for (let i = 1; i <= steps; i++) { await touch("touchMove", from.map(([x, y], k) => [x + (to[k][0] - x) * i / steps, y + (to[k][1] - y) * i / steps])); await wait(20) }
      await touch("touchEnd", [])
    }
    const count = async () => clicks((await tab()).title)
    const area = await frame.locator("..").boundingBox()
    const [cx, cy] = [area.x + area.width / 2, area.y + area.height / 2]
    let was = await count()
    await page.touchscreen.tap(bx, by)
    await wait(120)
    await page.touchscreen.tap(bx, by)
    check(`${label}: a double tap is a double click`, await until(async () => (await count()) === was + 2, 5000), [was, (await tab()).title])
    await wait(400)
    await gesture([[bx - 20, by], [bx + 20, by]], [[bx - 70, by], [bx + 70, by]])
    const zoom = () => frame.getAttribute("data-web-live-zoom")
    check(`${label}: a pinch zooms the picture in`, await until(async () => (await zoom()) === "in", 3000), await zoom())
    const zbox = await frame.boundingBox()
    check(`${label}: … bigger than it fits, around the fingers`, zbox.width > box.width * 2.5, [box.width, zbox.width])
    const [zx, zy] = [zbox.x + zbox.width * 0.09, zbox.y + zbox.height * 0.14]
    was = await count()
    await page.touchscreen.tap(zx, zy)
    check(`${label}: zoomed in, a tap clicks where it is on the page`, await until(async () => (await count()) === was + 1, 5000), [zx, zy, (await tab()).title])
    const y0 = (await tab()).title
    await gesture([[cx, cy + 40]], [[cx, cy - 40]])
    await wait(300)
    check(`${label}: zoomed in, a drag pans the picture, the page staying`, (await tab()).title === y0 && (await frame.boundingBox()).y < zbox.y - 40, [y0, (await tab()).title])
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-${label}-zoomed.png` })
    await page.locator("[data-web-live-unzoom]").click()
    check(`${label}: Zoom to fit zooms out`, await until(async () => (await zoom()) === "fit", 3000), await zoom())
    await page.locator("[data-web-live-trackpad]").click()
    check(`${label}: trackpad mode draws a pointer`, await until(() => page.locator("[data-web-live-pointer]").isVisible(), 3000))
    // (the pointer starts mid-picture, and goes 1.5 times the finger's way)
    const fb = await frame.boundingBox()
    const [mx, my] = [((0.09 - 0.5) * fb.width) / 1.5, ((0.14 - 0.5) * fb.height) / 1.5]
    await gesture([[cx, cy]], [[cx + mx, cy + my]], 12)
    was = await count()
    await page.touchscreen.tap(cx + 20, cy + 20)
    check(`${label}: trackpad mode, a tap clicks where the pointer is`, await until(async () => (await count()) === was + 1, 5000), [was, (await tab()).title])
    await page.locator("[data-web-live-trackpad]").click()
    await cdp.detach()
  }
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
// (its output, if it doesn't come up: CI's run once found nothing on its port, with no word why)
check("(the other machine's server is up)", await until(() => /vaultite: vault read/.test(fout) || laptop.exitCode !== null, 60000) && laptop.exitCode === null,
  { exit: laptop.exitCode, port: PORT + 1, out: fout.slice(-2000) })
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
