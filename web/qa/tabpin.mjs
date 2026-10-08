// Pinned tabs and tabs by number (core/workspace.ts togglePinTab, selectTabAt): a pinned tab shows a
// pin where its X goes; what's opened from it (the quick switcher, a link) opens in a tab beside it; Close current tab
// and Close all other tabs leave it open; its menu unpins it. Go to tab #n and Go to last tab (⌘1–⌘9 in the desktop
// app). WRITES nothing.
//   node web/qa/tabpin.mjs <base url> <vault path>
import { readdirSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const [a, b, c] = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 3).map((f) => `Notes/${f}`)
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
await page.goto(B)
await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
const ws = () => page.evaluate(() => JSON.parse(localStorage.getItem("vaultite.tabs")))
const groupOf = (w) => (function walk(n) { return n.tabs ? n : walk(n.kids[0]) })(w.root)
const tabs = async () => { const g = groupOf(await ws()); return { tabs: g.tabs.map((t) => t.to.replace(/^file:/, "") + (t.pinned ? " (pinned)" : "")), active: g.tabs.find((t) => t.id === g.active)?.to.replace(/^file:/, "") } }
const hash = (f) => page.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)

await command(page, "Close all other tabs")
await hash(a); await until(async () => (await tabs()).active === a)
check("Toggle pin", await command(page, "Toggle pin") && same((await tabs()).tabs, [`${a} (pinned)`]), await tabs())
check("a pin where the X was", (await page.locator("[data-tab-pin]").count()) === 1 && !(await page.locator(`[data-tab-id] [data-tab-close]`).count()))

// A link followed (the address) and the quick switcher: beside it, not in it.
await hash(b)
check("a link from a pinned tab opens beside it", await until(async () => same(await tabs(), { tabs: [`${a} (pinned)`, b], active: b })), await tabs())
await page.click(`[data-tab-id] >> text=${path.basename(a, ".md")}`)
await page.keyboard.press("ControlOrMeta+O"); await page.waitForSelector('[role="dialog"][aria-label="Search"]')
await page.keyboard.type(path.basename(c, ".md")); await wait(400); await page.keyboard.press("Enter")
check("the quick switcher from a pinned tab opens beside it", await until(async () => same((await tabs()).tabs, [`${a} (pinned)`, c, b])), await tabs())

// By number.
await command(page, "Go to tab #3")
check("Go to tab #3", (await tabs()).active === b, await tabs())
await command(page, "Go to tab #1")
check("Go to tab #1", (await tabs()).active === a, await tabs())
await command(page, "Go to last tab")
check("Go to last tab", (await tabs()).active === b, await tabs())
check("no Go to tab #4 with three tabs", !(await command(page, "Go to tab #4")))

// Closing.
await command(page, "Close all other tabs")
check("Close all other tabs leaves the pinned one", same((await tabs()).tabs, [`${a} (pinned)`, b]), await tabs())
await page.click(`[data-tab-id] >> text=${path.basename(a, ".md")}`)
await command(page, "Close current tab")
check("Close current tab leaves a pinned tab open", same((await tabs()).tabs, [`${a} (pinned)`, b]), await tabs())
await page.click(`[data-tab-id] >> text=${path.basename(a, ".md")}`, { button: "right" })
await page.click("[role=menu] >> text=Unpin")
check("its menu unpins it", same((await tabs()).tabs, [a, b]), await tabs())
await command(page, "Close current tab")
check("then it closes", same((await tabs()).tabs, [b]), await tabs())
await done()
