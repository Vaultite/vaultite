// Setup's Plugins tab as one library (pages/Plugins.tsx): sections by category, the AI apps together, Filter and the
// search, a plugin's sheet; light and dark, wide and narrow. Reads only.
//   node web/qa/pluginlibrary.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { pluginsFilter, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, OUT = "/tmp/pluginlibrary-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const rows = (page, cat) => page.locator(`[data-plugin-category="${cat}"] [data-plugin-row]`).evaluateAll((els) => els.map((e) => e.dataset.pluginRow))
// Each section's rows, on (as its switch shows, or a group with any on) or off, in order.
const onOff = (page) => page.evaluate(() => [...document.querySelectorAll("[data-plugin-category]")].map((s) =>
  [...s.querySelectorAll("[data-plugin-row], [data-plugin-group]")].map((b) => {
    const sw = b.parentElement.querySelector("[role=switch]")
    return sw ? sw.getAttribute("aria-checked") === "true" : b.parentElement.querySelector("[data-plugin-group-on]")?.textContent !== "None on"
  })))
const onFirst = (lists) => lists.every((l) => l.every((on, i) => !i || l[i - 1] || !on))

for (const colorScheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme })
  const page = watch(await ctx.newPage(), { label: colorScheme })
  await page.goto(`${B}#plugins`)
  await until(() => page.locator('[data-plugin-category="ai-apps"]').count(), 10000)
  await wait(800)
  await page.screenshot({ path: `${OUT}plugins-${colorScheme}.png` })
  if (colorScheme === "light") {
    const tools = await rows(page, "agents")
    check("AI tools: what the app gives agents, on by default or not", ["ai-import", "token-count"].every((id) => tools.includes(id)) && !tools.includes("codex"), tools)
    const all = await page.locator("[data-plugin-row]").evaluateAll((els) => els.map((e) => e.dataset.pluginRow))
    check("the app's own parts aren't rows (Graph, Inbox, Page preview, MCP), nor Vim (in Editor)", !["graph", "inbox", "page-preview", "slides", "mcp", "files", "search", "vim"].some((id) => all.includes(id)), all)
    const group = page.locator('[data-plugin-category="ai-apps"] [data-plugin-group="coding-agents"]')
    check("the coding agents: one row, none of them a row of its own, saying which are on", await group.count() === 1 && !["claude-code", "codex", "cursor", "hermes"].some((id) => all.includes(id)) &&
      (await group.locator("..").locator("[data-plugin-group-on]").innerText()).includes("Claude Code"), all)
    await group.click()
    const agents = page.locator("dialog[open] [data-plugin-row]")
    // (the app's two, and Vaultite's own the vault installed)
    check("...its sheet: each one with its own switch", await until(async () => (await agents.count()) >= 2, 4000) &&
      (await page.locator("dialog[open] [role=switch]").count()) === await agents.count(), await agents.evaluateAll((els) => els.map((e) => e.dataset.pluginRow)))
    await page.screenshot({ path: `${OUT}plugins-coding-agents.png` })
    await page.keyboard.press("Escape"); await wait(500)
    await page.locator("[data-plugins-search] input").fill("codex")
    check("a search finds an agent in its group's row", await until(async () => (await page.locator('[data-plugin-members~="codex"]').count()) === 1, 4000))
    await page.locator("[data-plugins-search] input").fill("")
    check("every row says what it does", (await page.locator("[data-plugin-blurb]").count()) >= all.length - 2, [await page.locator("[data-plugin-blurb]").count(), all.length])
    const builtIn = page.locator('[data-plugin-row="token-count"]').locator("..")
    check("a built-in plugin: no source label, no mark", (await builtIn.locator("[data-certified], [data-plugin-by]").count()) === 0)
    check("each section: on ones first", onFirst(await onOff(page)), await onOff(page))
    check("no menu: Filter and the search above the list, no chips under them", await page.locator("[data-plugins-filter]").isVisible() &&
      await page.locator("[data-plugins-search] input").isVisible() && !(await page.locator("[data-rail]").count()) && !(await page.locator("[data-plugins-active]").count()))
    await pluginsFilter(page, "AI tools", { category: true })
    check("a category shows only its plugins", await until(async () => (await page.locator("[data-plugin-row]").count()) === tools.length, 4000))
    check("...one list, on ones first", onFirst(await onOff(page)), await onOff(page))
    await page.screenshot({ path: `${OUT}plugins-ai-tools.png` })
    await pluginsFilter(page, "Off")
    check("Off and a category: only that category's plugins that are off", await until(async () => { const l = await onOff(page); return l.length === 1 && l[0].length > 0 && l[0].every((on) => !on) }, 4000), await onOff(page))
    check("...both as chips, with the count", (await page.locator("[data-plugins-chip]").evaluateAll((els) => els.map((e) => e.dataset.pluginsChip))).join() === "status,category" &&
      /^\d+ plugins?$/.test(await page.locator("[data-plugins-count]").innerText()))
    await page.screenshot({ path: `${OUT}plugins-filtered.png` })
    await page.locator('[data-plugins-chip="category"]').click()
    check("Off alone: sections again, every row off", await until(async () => { const l = await onOff(page); return l.length > 1 && l.flat().every((on) => !on) }, 4000), await onOff(page))
    await pluginsFilter(page, "On")
    check("On: every row on", await until(async () => { const l = await onOff(page); return l.length > 0 && l.flat().every((on) => on) }, 4000), await onOff(page))
    await page.locator("[data-plugins-search] input").fill("codex")
    check("a search with On: the coding agents' row (one of them is on)", await until(async () => (await page.locator('[data-plugin-members~="codex"]').count()) === 1, 4000))
    await pluginsFilter(page, "Off")
    check("...with Off: not there", await until(async () => (await page.locator('[data-plugin-members~="codex"]').count()) === 0, 4000))
    await page.locator("[data-plugins-search] input").fill("")
    await page.locator("[data-plugins-clear]").click()
    check("Clear all: no chips, every section", await until(async () => !(await page.locator("[data-plugins-active]").count()) && (await onOff(page)).length > 1, 4000))
    await page.locator("[data-plugins-search] input").fill("exports")
    check("a search finds a plugin by its description too", await until(async () => (await page.locator('[data-plugin-row="ai-import"]').count()) === 1, 4000))
    check("...and offers to search everywhere", await page.locator("[data-plugins-search-more]").count() === 1)
    await page.locator("[data-plugins-search] input").fill("kanban")
    check("a search shows the directory's plugins that aren't installed", await until(async () =>
      (await page.locator('[data-plugins-not-installed] [data-browse-row="kanban"]').count()) === 1, 8000))
    await page.screenshot({ path: `${OUT}plugins-search-directory.png` })
    const before = ctx.pages().length
    await page.locator('[data-plugins-not-installed] [data-browse-row="kanban"] [data-browse-open]').click({ position: { x: 70, y: 14 } }) // (on its name)
    const kanban = page.locator('dialog[open] [data-browse-sheet="kanban"]')
    check("a directory plugin's name opens its sheet, not GitHub", await until(() => kanban.count(), 8000) && ctx.pages().length === before)
    check("...with Install and a small GitHub button", await kanban.locator('[data-browse-sheet-action="install"]').isVisible() && await kanban.locator("[data-browse-web]").isVisible())
    await page.screenshot({ path: `${OUT}plugins-get-sheet.png` })
    await page.keyboard.press("Escape"); await wait(500)
    await page.locator("[data-plugins-search-more]").click()
    check("...Search everywhere opens Get plugins, its tab lit", await until(() => page.locator("[data-plugin-browse]").count(), 4000) &&
      (await page.locator("[data-plugins-get]").getAttribute("aria-checked")) === "true")
    await page.locator("[data-plugins-installed]").click()
    await until(() => page.locator("[data-plugin-row]").count(), 4000)
    await page.locator("[data-plugins-search] input").fill("")
    await page.locator('[data-plugin-row="activity"]').click()
    await until(() => page.locator("dialog[open]").count(), 4000)
    check("its sheet names its category", (await page.locator("dialog[open]").getByText("System", { exact: true }).count()) > 0)
    check("an opt-in plugin's preview draws its blocks while it's off", await until(async () => (await page.locator('dialog[open] [data-block="activity"]').count()) >= 1, 4000))
    await page.keyboard.press("Escape"); await wait(500)
    // Plugins is a tab of Setup, beside Bundles: switching swaps the tab's address in place, adding no history.
    const depth = await page.evaluate(() => history.length)
    await page.locator("[data-setup-tab=bundles]").click()
    check("Setup: its Bundles tab, in the same tab", await until(() => page.locator("[data-setup=bundles] [data-bundles-save]").count(), 6000) &&
      (await page.evaluate(() => location.hash)) === "#bundles" && (await page.evaluate(() => history.length)) === depth && !(await page.locator("[data-settings]").count()))
    await page.screenshot({ path: `${OUT}setup-bundles.png` })
    await page.locator("[data-setup-tab=plugins]").click()
    check("...and back to Plugins", await until(() => page.locator("[data-plugin-row]").count(), 4000) && (await page.evaluate(() => location.hash)) === "#plugins")
    await page.locator("[data-plugins-get]").click()
    check("Get plugins shows beside the menu", await until(() => page.locator("[data-plugin-browse]").count(), 6000))
    await page.screenshot({ path: `${OUT}plugins-get.png` })
    await page.locator("[data-plugins-installed]").click()
    check("back to the list", await until(() => page.locator("[data-plugin-row]").count(), 4000))
  }
  await ctx.close()
}

const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = watch(await narrow.newPage(), { label: "phone" })
await pp.goto(`${B}#plugins`)
await until(() => pp.locator("[data-plugin-row]").count(), 10000)
check("phone: Filter, no menu", await pp.locator("[data-plugins-filter]").isVisible() && !(await pp.locator("[data-rail]").count()))
const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check("phone: nothing overflows", over <= 0, over)
await pp.screenshot({ path: `${OUT}plugins-phone.png` })
await done()
