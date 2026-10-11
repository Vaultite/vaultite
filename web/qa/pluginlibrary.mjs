// The Plugins page as one library (pages/Plugins.tsx): sections by category, the AI apps together whatever their
// defaults (Claude Code, Codex, Muse), each row a line on what it does; the rail picks a category, a search looks in
// all of them; a plugin's sheet names its category. Screenshots, light and dark, wide and narrow. Reads only.
//   node web/qa/pluginlibrary.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"

const { args: [B, OUT = "/tmp/pluginlibrary-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const rows = (page, cat) => page.locator(`[data-plugin-category="${cat}"] [data-plugin-row]`).evaluateAll((els) => els.map((e) => e.dataset.pluginRow))

for (const colorScheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme })
  const page = watch(await ctx.newPage(), { label: colorScheme })
  await page.goto(`${B}#plugins`)
  await until(() => page.locator('[data-plugin-category="ai-apps"]').count(), 10000)
  await wait(800)
  await page.screenshot({ path: `${OUT}plugins-${colorScheme}.png` })
  if (colorScheme === "light") {
    const apps = await rows(page, "ai-apps"), tools = await rows(page, "agents")
    check("AI apps: the outside agents, on by default or not", ["claude-code", "codex", "cursor", "muse"].every((id) => apps.includes(id)), apps)
    check("AI tools: what the app gives agents", ["mcp", "dispatch", "inbox"].every((id) => tools.includes(id)) && !tools.includes("codex"), tools)
    check("every row says what it does", (await page.locator("[data-plugin-blurb]").count()) > 40)
    check("the rail is there, the chips aren't", await page.locator("[data-plugins-rail]").isVisible() && !(await page.locator("[data-plugins-chips]").isVisible()))
    await page.locator('[data-plugins-rail] [data-plugins-cat="ai-apps"]').click()
    check("a category shows only its plugins", await until(async () => (await page.locator("[data-plugin-row]").count()) === apps.length, 4000))
    await page.screenshot({ path: `${OUT}plugins-ai-apps.png` })
    await page.locator('[data-plugins-rail] [data-plugins-cat="all"]').click()
    await page.getByPlaceholder("Search plugins").fill("muse")
    check("a search finds a plugin by its description too", await until(async () => (await page.locator('[data-plugin-row="muse"]').count()) === 1, 4000))
    await page.getByPlaceholder("Search plugins").fill("")
    await page.locator('[data-plugin-row="muse"]').click()
    await until(() => page.locator("dialog[open]").count(), 4000)
    check("its sheet names its category", (await page.locator("dialog[open]").getByText("AI apps", { exact: true }).count()) > 0)
    check("an opt-in plugin's preview draws its blocks while it's off", await until(async () => (await page.locator('dialog[open] [data-block="muse-runs"]').count()) === 1, 4000))
    await page.keyboard.press("Escape"); await wait(500)
    await page.locator("[data-plugins-get]").click()
    check("Get plugins opens with bundles first", await until(() => page.locator("[data-browse-bundles]").count(), 6000))
    await page.screenshot({ path: `${OUT}plugins-get.png` })
    await page.locator("[data-plugins-back]").click()
    check("back to the list", await until(() => page.locator("[data-plugin-row]").count(), 4000))
  }
  await ctx.close()
}

const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await narrow.newPage(), { label: "phone" })
await pp.goto(`${B}#plugins`)
await until(() => pp.locator("[data-plugin-row]").count(), 10000)
check("phone: chips, no rail", await pp.locator("[data-plugins-chips]").isVisible() && !(await pp.locator("[data-plugins-rail]").isVisible()))
const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check("phone: nothing overflows", over <= 0, over)
await pp.screenshot({ path: `${OUT}plugins-phone.png` })
await done()
