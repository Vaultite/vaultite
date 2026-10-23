// The left sidebar's header items (Workspaces' numbers, the Inbox button): right-click the header, Header ▸ ticks
// which show (appearance.json `sidebarHeader`). WRITES appearance.json (put back): throwaway server only.
//   node web/qa/sidebarheader.mjs <base url>
import { apiAt, qa, until } from "./lib/qa.mjs"

const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const api = apiAt(B)
const look = await api("GET", "config/appearance")
await api("PATCH", "config/appearance", { sidebarHeader: null })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  await page.goto(B)
  const inbox = page.locator("aside [data-titlebar] [data-header-item='inbox:inbox']")
  check("the Inbox button is in the header", !!(await until(async () => (await inbox.count()) > 0, 15000)))
  const header = async () => (await api("GET", "config/appearance")).sidebarHeader
  await page.click("aside [data-titlebar]", { button: "right" })
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Header" }).hover()
  const item = page.locator("[role=menuitemcheckbox]", { hasText: "Inbox" })
  // (a submenu clicked as it opens misses: let it settle)
  await item.first().waitFor()
  await page.waitForTimeout(300)
  check("Header ▸ lists it, ticked", (await item.first().getAttribute("aria-checked")) === "true")
  await item.first().click()
  check("unticked: it's gone", !!(await until(async () => (await inbox.count()) === 0)))
  check("saved without it", !!(await until(async () => Array.isArray(await header()) && !(await header()).includes("inbox:inbox"))), await header())
  await page.keyboard.press("Escape")
  await page.reload()
  await page.locator("aside [data-titlebar]").waitFor()
  check("still hidden after a reload", (await inbox.count()) === 0)
  await page.click("aside [data-titlebar]", { button: "right" })
  await page.locator("[role=menu] [role=menuitem]", { hasText: "Header" }).hover()
  await item.first().waitFor()
  await page.waitForTimeout(300)
  await item.first().click()
  check("ticked again: it's back", !!(await until(async () => (await inbox.count()) > 0)))
  check("saved with it", !!(await until(async () => (await header())?.includes("inbox:inbox"))), await header())
} finally {
  await api("PATCH", "config/appearance", { sidebarHeader: look.sidebarHeader ?? null })
  await done()
}
