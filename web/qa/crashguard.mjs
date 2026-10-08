// A tab that fails to draw fails alone (components/Guard.tsx): here the Plugins page's chunk throws as it runs, and its
// tab says so in its place (Try again, Close tab), with the sidebar still there and no "Vaultite stopped"; Close tab
// closes it. A chunk that didn't load (the server away a moment: here Settings' script is refused once, and the
// server's index.html too for a while) shows "Reconnecting to Vaultite…", then reloads once the server answers, and
// Settings draws. The crash screen's Reload with a new tab (index.html) starts the page on a new tab, the tabs it had
// still in its bar. Writes nothing to the vault but its tabs: a throwaway server.
//   node web/qa/crashguard.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/crashguard-shots/"], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const tabs = () => page.$$eval("[data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
const stopped = () => page.$("#vau-boot-error").then((e) => !!e)
const go = (hash) => page.evaluate((h) => { location.hash = h }, hash)

try {
  await page.goto(B); await wait(2500)

  // 1. A tab whose code throws: the error in its place, the rest goes on.
  await page.route(/\/assets\/Plugins-[^/]+\.js$/, (r) => r.fulfill({ contentType: "text/javascript", body: 'throw new Error("qa: the Plugins page broke")' }))
  await go("#plugins")
  const failed = await until(() => page.$('[data-guard-failed="This tab"]'), 8000)
  check("a tab that throws shows its error in its place", !!failed && /qa: the Plugins page broke/.test(await failed.textContent()), failed && await failed.textContent())
  await page.screenshot({ path: `${OUT}tab-failed.png` })
  check("...not Vaultite stopped", !(await stopped()))
  check("...the sidebar still there", (await page.$$("[data-panel]")).length > 0)
  const n = (await tabs()).length
  await page.getByRole("button", { name: "Close tab" }).click()
  check("Close tab closes it", !!(await until(async () => !(await page.$('[data-guard-failed="This tab"]')) && (await tabs()).length <= Math.max(1, n - 1), 8000)), await tabs())
  await page.unroute(/\/assets\/Plugins-[^/]+\.js$/)

  // 2. A chunk that didn't load while the server was away: reconnects, reloads, draws.
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

  // 3. The crash screen's Reload with a new tab: a new tab shown, the others still there.
  await go("#plugins"); await wait(1500)
  const had = (await tabs()).filter((t) => t !== "New tab")
  await page.evaluate(() => window.showBootError(new Error("qa: stopped"), "Vaultite stopped", { fresh: true }))
  const again = page.waitForEvent("load", { timeout: 15000 })
  await page.getByRole("button", { name: "Reload with a new tab" }).click()
  await again; await wait(2500)
  const active = await page.$eval("[data-tab-id] [role=tab][aria-selected=true], [data-tab-id][role=tab][aria-selected=true]", (e) => e.closest("[data-tab-id]").textContent.trim()).catch(() => null)
  check("Reload with a new tab: a new tab shown", active === "New tab", active)
  check("...the tabs it had still in its bar", (await tabs()).filter((t) => had.includes(t)).length === had.length, { had, now: await tabs() })
  check("...the address isn't the tab it had", !/plugins/.test(await page.evaluate(() => location.hash)), await page.evaluate(() => location.hash))
} catch (e) {
  check(String(e), false)
}
await done()
