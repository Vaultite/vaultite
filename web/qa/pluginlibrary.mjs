// The Plugins page as one library (pages/Plugins.tsx): sections by category, the AI apps together whatever their
// defaults (Muse; the coding agents one row, components/PluginGroup.tsx, its sheet each one's switch), each row a line
// on what it does, Vaultite's marked as theirs; the app's own (`alwaysOn`) parts and Vim (in Editor) aren't rows; the
// rail picks a category, a search looks in all of them and in the directory; a
// plugin's sheet names its category; Get plugins and Bundles are rows of the same menu. Screenshots, light and dark, wide and
// narrow. Reads only.
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
    check("AI apps: the outside agents, on by default or not", ["muse", "grok-bot"].every((id) => apps.includes(id)), apps)
    check("AI tools: what the app gives agents", ["dispatch", "token-count"].every((id) => tools.includes(id)) && !tools.includes("muse"), tools)
    const all = await page.locator("[data-plugin-row]").evaluateAll((els) => els.map((e) => e.dataset.pluginRow))
    check("the app's own parts aren't rows (Graph, Inbox, Page preview, MCP), nor Vim (in Editor)", !["graph", "inbox", "page-preview", "slides", "mcp", "files", "search", "vim"].some((id) => all.includes(id)), all)
    const group = page.locator('[data-plugin-category="ai-apps"] [data-plugin-group="coding-agents"]')
    check("the coding agents: one row, none of them a row of its own, saying which are on", await group.count() === 1 && !["claude-code", "codex", "cursor", "hermes"].some((id) => all.includes(id)) &&
      (await group.locator("..").locator("[data-plugin-group-on]").innerText()).includes("Claude Code"), all)
    await group.click()
    const agents = page.locator("dialog[open] [data-plugin-row]")
    check("...its sheet: each one with its own switch", await until(async () => (await agents.count()) === 6, 4000) &&
      (await page.locator("dialog[open] [role=switch]").count()) === 6, await agents.evaluateAll((els) => els.map((e) => e.dataset.pluginRow)))
    await page.screenshot({ path: `${OUT}plugins-coding-agents.png` })
    await page.keyboard.press("Escape"); await wait(500)
    await page.getByPlaceholder("Search plugins").fill("codex")
    check("a search finds an agent in its group's row", await until(async () => (await page.locator('[data-plugin-members~="codex"]').count()) === 1, 4000))
    await page.getByPlaceholder("Search plugins").fill("")
    check("every row says what it does", (await page.locator("[data-plugin-blurb]").count()) >= all.length - 2, [await page.locator("[data-plugin-blurb]").count(), all.length])
    check("Vaultite's plugins are marked as theirs", (await page.locator('[data-plugin-row="dispatch"]').locator("..").locator("[data-certified]").count()) === 1)
    check("the rail is there, the chips aren't", await page.locator("[data-plugins-rail]").isVisible() && !(await page.locator("[data-plugins-chips]").isVisible()))
    await page.locator('[data-plugins-rail] [data-plugins-cat="ai-apps"]').click()
    check("a category shows only its plugins", await until(async () => (await page.locator("[data-plugin-row]").count()) === apps.length, 4000))
    await page.screenshot({ path: `${OUT}plugins-ai-apps.png` })
    await page.locator("[data-plugins-rail] [data-plugins-installed]").click()
    await page.getByPlaceholder("Search plugins").fill("muse")
    check("a search finds a plugin by its description too", await until(async () => (await page.locator('[data-plugin-row="muse"]').count()) === 1, 4000))
    check("...and offers to search everywhere", await page.locator("[data-plugins-search-more]").count() === 1)
    await page.getByPlaceholder("Search plugins").fill("kanban")
    check("a search shows the directory's plugins that aren't installed", await until(async () =>
      (await page.locator('[data-plugins-not-installed] [data-browse-row="kanban"]').count()) === 1, 8000))
    await page.screenshot({ path: `${OUT}plugins-search-directory.png` })
    await page.locator("[data-plugins-search-more]").click()
    check("...Search everywhere opens Get plugins, lit in the menu", await until(() => page.locator("[data-plugin-browse]").count(), 4000) &&
      await page.locator("[data-plugins-rail] [data-plugins-get]").evaluate((e) => e.className.includes("font-medium")))
    await page.locator("[data-plugins-rail] [data-plugins-installed]").click()
    await until(() => page.locator("[data-plugin-row]").count(), 4000)
    await page.getByPlaceholder("Search plugins").fill("")
    await page.locator('[data-plugin-row="muse"]').click()
    await until(() => page.locator("dialog[open]").count(), 4000)
    check("its sheet names its category", (await page.locator("dialog[open]").getByText("AI apps", { exact: true }).count()) > 0)
    check("an opt-in plugin's preview draws its blocks while it's off", await until(async () => (await page.locator('dialog[open] [data-block="muse-runs"]').count()) === 1, 4000))
    await page.keyboard.press("Escape"); await wait(500)
    await page.locator("[data-plugins-rail] [data-plugins-bundles]").click()
    check("Bundles shows beside the menu", await until(() => page.locator("[data-rail-pane] [data-bundles-save]").count(), 6000) && await page.locator("[data-plugins-rail]").isVisible())
    await page.screenshot({ path: `${OUT}plugins-bundles.png` })
    await page.locator("[data-plugins-rail] [data-plugins-installed]").click()
    check("...back to the list", await until(() => page.locator("[data-plugin-row]").count(), 4000))
    await page.locator("[data-plugins-rail] [data-plugins-get]").click()
    check("Get plugins shows beside the menu", await until(() => page.locator("[data-plugin-browse]").count(), 6000))
    await page.screenshot({ path: `${OUT}plugins-get.png` })
    await page.locator("[data-plugins-rail] [data-plugins-installed]").click()
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
