// A tab that fails to draw fails alone; a chunk that didn't load reconnects and reloads; the crash screen's Reload.
// WRITES only its tabs: throwaway server.
//   node web/qa/crashguard.mjs <base url> [out dir]
// Paths: components/Guard.tsx
import { mkdirSync } from "node:fs"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/crashguard-shots/"], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const tabs = () => page.$$eval("[data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
const tabIds = () => page.$$eval("[data-tab-id]", (els) => els.map((e) => e.dataset.tabId))
const stopped = () => page.$("#vau-boot-error").then((e) => !!e)
const go = (hash) => page.evaluate((h) => { location.hash = h }, hash)

try {
  await page.goto(B); await wait(2500)

  await page.route(/\/assets\/Setup-[^/]+\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: 'throw new Error("qa: the Setup page broke")' }))
  await go("#plugins")
  const failed = await until(() => page.$('[data-guard-failed="This tab"]'), 8000)
  check("a tab that throws says so in its place, its error only behind Show details", !!failed && /couldn't be drawn/.test(await failed.textContent()) &&
    !/qa: the Setup page broke/.test(await failed.textContent()), failed && await failed.textContent())
  await page.getByRole("button", { name: "Show details" }).click()
  check("...Show details shows it", /qa: the Setup page broke/.test(await failed.textContent()), await failed.textContent())
  await page.screenshot({ path: `${OUT}tab-failed.png` })
  check("...not Vaultite stopped", !(await stopped()))
  check("...the sidebar still there", (await page.$$("[data-panel]")).length > 0)
  const n = (await tabs()).length
  await page.getByRole("button", { name: "Close tab" }).click()
  check("Close tab closes it", !!(await until(async () => !(await page.$('[data-guard-failed="This tab"]')) && (await tabs()).length <= Math.max(1, n - 1), 8000)), await tabs())
  await page.unroute(/\/assets\/Setup-[^/]+\.js$/)

  let refused = 0, away = true
  await page.route(/\/assets\/Settings-[^/]+\.js$/, (r) => (r.request().resourceType() === "script" && refused++ === 0 ? r.abort("connectionrefused") : r.continue()))
  await page.route((u) => u.pathname === "/" && !u.hash, (r) => (r.request().resourceType() === "fetch" && away ? r.abort("connectionrefused") : r.continue()))
  const reloaded = page.waitForEvent("load", { timeout: 20000 }).then(() => true, () => false)
  await go("#settings")
  check("...says it's reconnecting", !!(await until(() => page.$("[data-reconnecting], [data-guard-failed]").then(async (e) => e && /Reconnecting/.test(await e.textContent())), 4000)))
  check("...never Vaultite stopped while away", !(await stopped()))
  await page.screenshot({ path: `${OUT}reconnecting.png` })
  away = false
  check("the server back: it reloads", await reloaded)
  await wait(2500)
  check("...and Settings draws", !(await stopped()) && !(await page.$("[data-guard-failed]")) && (await tabs()).some((t) => /Settings/.test(t)), await tabs())
  await page.unrouteAll({ behavior: "ignoreErrors" })

  await go("#plugins")
  const kept = async () => (await apiAt(B.endsWith("/") ? B : `${B}/`)("POST", "ops/tabs.list", {})).tabs?.find((t) => t.active)?.panes?.find((p) => p.focused)?.to
  check("...the server keeps its tab at Plugins", await until(async () => (await kept()) === "plugins", 15000), await kept())
  const had = await tabIds()
  await page.evaluate(() => window.showBootError(new Error("qa: stopped"), "Vaultite stopped", { fresh: true }))
  const again = page.waitForEvent("load", { timeout: 15000 })
  await page.getByRole("button", { name: "Reload with a new tab" }).click()
  await again; await wait(2500)
  const active = await page.$eval("[data-tab-id] [role=tab][aria-selected=true], [data-tab-id][role=tab][aria-selected=true]", (e) => e.closest("[data-tab-id]").textContent.trim()).catch(() => null)
  check("Reload with a new tab: a new tab shown", active === "New tab", active)
  const now = await tabIds()
  check("...the tabs it had still in its bar", had.every((id) => now.includes(id)) && now.length === had.length + 1, { had, now })
  check("...the address isn't the tab it had", !/plugins/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash))
} catch (e) {
  check(String(e), false)
}
await done()
