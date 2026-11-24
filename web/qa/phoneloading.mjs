// A phone on a slow or lost connection: its first screen, a note opened, a write. WRITES Qa loading/: throwaway server only.

//   node web/qa/phoneloading.mjs <base url> [out dir]
// Paths: components/FileView.tsx, components/Pending.tsx, components/VaultLoading.tsx, core/reading.ts, core/connection.ts, core/live.ts, core/http.ts, core/data.ts
import { mkdirSync } from "node:fs"
import { apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { routeSocket } from "./lib/sockets.mjs"
const { args: [B, OUT = "/tmp/phoneloading-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const run = Date.now().toString(36)
const note = (name) => `Qa loading/${name} ${run}.md`
const SLOW = note("Slow"), OFF = note("Offline"), HUB = note("Hub")
const body = "The keeper's log for the Lighthouse, kept by Alice Park."
for (const p of [SLOW, OFF]) await api("POST", "file", { path: p, text: `# ${p.split("/")[1].slice(0, -3)}\n\n${body}\n` })
await api("POST", "file", { path: HUB, text: `# Hub\n\n- [[${SLOW.slice(0, -3)}|Slow one]]\n- [[${OFF.slice(0, -3)}|Offline one]]\n` })

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const ctx = await browser.newContext(PHONE)
await ctx.addInitScript(() => {
  const WS = window.WebSocket
  window.__qaSockets = []
  window.WebSocket = class extends WS { constructor(...a) { super(...a); window.__qaSockets.push(this) } }
})
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket|ERR_INTERNET_DISCONNECTED/ })
const { idle, toast } = app(page)
const shot = (n) => page.screenshot({ path: `${OUT}phoneloading-${n}.png` })
const shown = (p) => page.locator(`article.file-view[data-path="${p}"]:not([data-opening])`).filter({ hasText: body })
async function hub() {
  await page.goto("about:blank")
  await page.goto(`${B}#file/${encodeURIComponent(HUB)}`)
  await page.getByText("Slow one", { exact: true }).first().waitFor({ timeout: 20_000 })
  await idle()
}

await hub()
let release
const held = new Promise((r) => { release = r })
await page.route((u) => u.pathname.endsWith("/api/file") && u.searchParams.get("path") === SLOW, async (route) => { await held; await route.continue().catch(() => {}) })
await page.getByText("Slow one", { exact: true }).first().tap()
const skeleton = page.locator(`article[data-opening][data-path="${SLOW}"] .skeleton`).first()
check("a slow read shows the note's skeleton, not a blank", await skeleton.waitFor({ timeout: 5000 }).then(() => true, () => false))
const slowLine = page.locator("[data-read-slow]")
check("then says it's still loading, with Try again", await slowLine.filter({ hasText: "Still loading" }).getByRole("button", { name: "Try again" })
  .waitFor({ timeout: 10_000 }).then(() => true, () => false))
await shot("slow")
release()
check("the note shows once the read comes", await shown(SLOW).waitFor({ timeout: 15_000 }).then(() => true, () => false))
await page.unroute(() => true)

await hub()
await ctx.setOffline(true)
await page.evaluate(() => { for (const s of window.__qaSockets) s.close() })
await page.getByText("Offline one", { exact: true }).first().tap()
const failed = page.locator(`[data-read-failed]`)
await failed.waitFor({ timeout: 10_000 }).catch(() => {})
const said = await failed.innerText().catch(() => "")
check("offline, a note says it couldn't open and why", /Couldn't open this note: the server didn't answer/.test(said), said)
check("not that it isn't in the vault", !(await page.getByText("isn't in the vault any more").count()))
await shot("offline-open")
const told = await toast.wait(/Can't connect to Vaultite|You're offline/, { timeout: 20_000 }).then(() => true, () => false)
check("after a grace, the app says it can't connect, with Try now", told && await page.locator("[data-sonner-toast]").getByRole("button", { name: "Try now" }).count() > 0)
await shot("offline-toast")

await ctx.setOffline(false)
check("back online, Reconnected takes its place", await toast.wait("Reconnected", { timeout: 40_000 }).then(() => true, () => false)
  && !(await page.locator("[data-sonner-toast]").filter({ hasText: /Can't connect|You're offline/ }).count()))
check("and the note opens by itself", await shown(OFF).waitFor({ timeout: 15_000 }).then(() => true, () => false))
await shot("reconnected")

await ctx.close()

const IGNORE = /favicon|Failed to load resource|WebSocket|502|ERR_INTERNET_DISCONNECTED|the state's chunks/
const STATE = /\/api\/state\b/
const textOf = (loc) => loc.innerText().then((t) => t.replace(/\s+/g, " ").trim(), () => "")
const header = (page) => page.locator("[data-phone-header]")

async function phone() {
  const ctx = await browser.newContext(PHONE)
  const s = { ctx, down: false, events: null, asked: 0 }
  await routeSocket(ctx, /\/api\/events/, (ws) => {
    if (s.down) return ws.close()
    s.events = ws
    ws.connectToServer()
  })
  await ctx.route(/\/api\//, (r) => { if (STATE.test(r.request().url())) s.asked++; return s.down ? r.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad Gateway</body></html>" }) : r.fallback() })
  s.page = watch(await ctx.newPage(), { console: true, ignore: IGNORE })
  s.ui = app(s.page)
  return s
}

{
  const { ctx, page } = await phone()
  let release
  const held = new Promise((r) => { release = r })
  await page.route(STATE, async (r) => { await held; await r.fallback().catch(() => {}) })
  await page.goto(B)
  const loading = page.locator("[data-vault-loading]")
  check("slow: the first screen says it's reading the vault", await loading.filter({ hasText: "Reading the vault…" }).waitFor({ timeout: 20_000 }).then(() => true, () => false))
  const delay = await loading.evaluate((el) => [el.classList.contains("loading-in"), el.style.animationDelay]).catch(() => [])
  check("slow: it fades in after half a second, so a fast start shows nothing (QA's Reduce motion drops the fade itself)", delay[0] && delay[1] === "500ms", delay)
  const slow = loading.locator("[data-read-slow]")
  check("slow: then that it's still loading, with Try again", await slow.filter({ hasText: "Still loading…" }).getByRole("button", { name: "Try again" })
    .waitFor({ timeout: 10_000 }).then(() => true, () => false))
  await page.screenshot({ path: `${OUT}cold-start-slow.png` })
  release()
  check("slow: the vault shows once its state comes", await header(page).waitFor({ timeout: 20_000 }).then(() => true, () => false) && await loading.count() === 0)
  await ctx.close()
}

{
  const s = await phone(), { page, ui } = s
  s.down = true
  await page.goto(B)
  const failed = page.locator("[data-read-failed]")
  await failed.waitFor({ timeout: 20_000 }).catch(() => {})
  const text = await textOf(failed)
  check("unreachable: it says it can't load the vault, why, and that it keeps trying",
    text.includes("Couldn't load the vault: the server didn't answer. Trying again once the connection's back."), text)
  check("unreachable: no status text reaches the page", !(await page.getByText(/Bad Gateway|Error 502/).count()))
  const button = failed.getByRole("button", { name: "Try again" })
  check("unreachable: Try again, a 44px target", ((await button.boundingBox())?.height ?? 0) >= 43.5)
  const before = s.asked
  await button.tap()
  check("unreachable: Try again asks again, then says why it failed",
    await until(() => s.asked > before, 5_000) && await failed.waitFor({ timeout: 15_000 }).then(() => true, () => false), { before, after: s.asked })
  check("unreachable: after a grace, the app says it can't connect, with Try now", await ui.toast.wait("Can't connect to Vaultite", { timeout: 25_000 }).then(() => true, () => false))
  await page.screenshot({ path: `${OUT}cold-start-unreachable.png` })
  s.down = false
  check("unreachable: the server back, the vault shows by itself", await header(page).waitFor({ timeout: 45_000 }).then(() => true, () => false) && await failed.count() === 0)
  await page.screenshot({ path: `${OUT}cold-start-recovered.png` })

  let answer, sent = 0
  await page.route(/\/api\/qa\/held$/, async (r) => { sent++; await new Promise((ok) => { answer = ok }); await r.fulfill({ json: { ok: true } }).catch(() => {}) })
  const write = () => page.evaluate(() => {
    const v = globalThis.__vaultite.modules["@vaultite"]
    const w = globalThis.__qaWrite = { started: Date.now() }
    void v.optimistic((st) => ({ ...st, qaMark: 1 }), () => v.post("qa/held", {}), "Couldn't save it")
      .then(() => { w.ok = Date.now() }, (e) => { w.failed = Date.now(); w.message = e.message })
  })
  const got = () => page.evaluate(() => ({ ...globalThis.__qaWrite, now: Date.now(), mark: globalThis.__vaultite.modules["@vaultite"].getStore()?.qaMark }))
  await write()
  await until(async () => answer && (await got()).now - (await got()).started > 12_000, 20_000)
  answer()
  await until(async () => (await got()).ok || (await got()).failed, 5_000)
  const live = await got()
  check("write: a slow one on a live connection runs to its end, past the connection check", !!live.ok && !live.failed, live)

  answer = null
  sent = 0
  await write()
  check("write: its change shows at once", (await got()).mark === 1)
  s.down = true
  s.events?.close()
  await until(async () => (await got()).failed, 45_000)
  const lost = await got()
  const took = (lost.failed - lost.started) / 1000
  check("write: on a lost connection it gives up in seconds, as the server not answering", !!lost.failed && took < 30 && /didn't answer/.test(lost.message), { took, ...lost })
  check("write: and its change is taken back at once", lost.mark === undefined, lost)
  check("write: saying what failed and why", await ui.toast.wait("Couldn't save it: the server didn't answer", { timeout: 5_000 }).then(() => true, () => false))
  await page.screenshot({ path: `${OUT}write-gave-up.png` })
  s.down = false
  check("write: never sent again once the connection's back, as the server may have done it",
    await ui.toast.wait("Reconnected", { timeout: 40_000 }).then(() => true, () => false) && sent === 1, { sent })
  answer?.()
  await s.ctx.close()
}

await done()
