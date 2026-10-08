// The Tabs panel and the tab bar turned off (appearance `tabBar`). With the panel in the left sidebar: it lists the open
// tabs, the shown one marked; a click on a row shows its tab; its X closes it; then with tabBar false (written to
// appearance.json, followed live) each pane's bar shows only the tab on screen and how many it has, and the panel still
// switches; a split lists each pane under its number. Writes sidebars.json and appearance.json (put back): throwaway
// server only.
//   node web/qa/tabspanel.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/tabspanel-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json")
const lookNow = () => JSON.parse(look.was ?? "{}")
writeFileSync(sidebars.p, JSON.stringify({ left: ["tabs:tabs", "pages:pages", "files:files"], right: [], collapsed: [] }) + "\n")
writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true }) + "\n")
// Two made-up notes the served vault has (the sandbox's).
const notes = ["Notes/Lisbon trip.md", "Notes/How this vault works.md", "Start here.md"].filter((p) => existsSync(path.join(VAULT, p)))
if (notes.length < 3) { console.error("needs the sandbox vault (vau sandbox <folder>)"); process.exit(2) }

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}/#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-tabs-panel]")
  for (const p of notes) {
    await page.click("[data-tab-bar] button[aria-label='New tab']"); await wait(200)
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, p); await wait(400)
  }
  const rows = () => page.$$eval("[data-open-tabs] [data-open-tab]", (els) => els.map((e) => ({ id: e.dataset.openTab, label: e.textContent.trim(), on: e.className.includes("font-medium") })))
  const barTabs = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
  let r = await until(async () => { const x = await rows(); return x.length === (await barTabs()).length && x.length >= 2 ? x : null }, 6000)
  check("the panel lists the bar's tabs, in order", JSON.stringify(r?.map((x) => x.label)) === JSON.stringify(await barTabs()), [r, await barTabs()])
  check("the shown tab is marked", r?.filter((x) => x.on).length === 1 && r.at(-1).on, r)

  await page.click(`[data-open-tab="${r[0].id}"]`); await wait(300)
  const selected = () => page.$eval("[data-tab-bar] [role=tab][aria-selected=true]", (e) => e.textContent.trim()).catch(() => null)
  check("a click on a row shows its tab", (await selected()) === r[0].label, await selected())

  const n = r.length
  await page.hover(`[data-open-tab="${r[1].id}"]`)
  await page.click(`[data-open-tab="${r[1].id}"] button[aria-label^=Close]`); await wait(300)
  check("its X closes the tab", (await rows()).length === n - 1 && (await barTabs()).length === n - 1, [await rows(), await barTabs()])
  await page.screenshot({ path: `${OUT}panel.png` })

  // The bar off, live.
  writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: false }) + "\n")
  const off = await until(() => page.$("[data-tabs-hidden]"), 8000)
  check("tabBar false: the bar shows no tabs", !!off && (await page.$$("[data-tab-bar] [role=tab]")).length === 0)
  const title = () => page.$eval("[data-pane-title]", (e) => e.textContent.trim()).catch(() => null)
  r = await rows()
  check("its bar shows the tab on screen and how many", (await title())?.startsWith(r.find((x) => x.on).label) && (await title()).endsWith(`${r.length} tabs`), [await title(), r])
  check("the bar keeps its height", (await page.$eval("[data-tab-bar]", (e) => e.getBoundingClientRect().height)) === 40)
  const other = r.find((x) => !x.on)
  await page.click(`[data-open-tab="${other.id}"]`); await wait(300)
  check("the panel still switches tabs", (await title())?.startsWith(other.label), await title())
  await page.screenshot({ path: `${OUT}bar-off.png` })

  // A split: each pane under its number.
  await page.click(`[data-open-tab="${other.id}"]`, { button: "right" }); await wait(200)
  await page.click("[role=menu] >> text=Split right"); await wait(400)
  const heads = await page.$$eval("[data-tabs-pane]", (els) => els.length)
  check("a split lists each pane under its number", heads === 2 && (await page.$$("[data-pane-title]")).length === 2, heads)
  await page.screenshot({ path: `${OUT}split.png` })

  // Back on.
  writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true }) + "\n")
  check("tabBar true again: the tabs come back", !!(await until(async () => (await page.$$("[data-tab-bar] [role=tab]")).length > 0, 8000)))
} finally {
  await browser.close()
  for (const f of [sidebars, look]) if (f.was === null) rmSync(f.p, { force: true }); else writeFileSync(f.p, f.was)
}
await done()
