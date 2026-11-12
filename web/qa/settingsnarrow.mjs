// Settings in a pane too narrow for its menu beside a section (pages/Settings.tsx, components/RailLayout.tsx): the
// desktop app's first window, 1280×820 with both sidebars open. Each section the menu lists, Plugins and Get plugins too,
// opens in the menu's place with a way back; so do the sidebar's Plugins button, the palette, search, an old #get tab
// (pages/Setup.tsx) and core/apppages.ts' openSettings. A phone's Plugins stays its own page. What the menu's Plugins
// counts, and Share & sync (plugins/core/mcp/Connections.tsx) saying it's optional. The palette's way to where a
// setting is (core/switches.ts' placeOf, ⌘↩): Settings at its row, in place, not a sheet. Settings itself (its button,
// ⌘,) opens on its menu and search. Wide, the sidebar's two buttons are two places: each reopens on its own last
// section, and the one lit is the one showing. Writes nothing.
//   node web/qa/settingsnarrow.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { openPalette, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, OUT = "/tmp/settingsnarrow-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const page = watch(await ctx.newPage(), { label: "1280" })
const layout = () => page.locator("[data-settings] [data-rail-layout]").getAttribute("data-rail-layout")
const menu = page.locator("[data-settings] [data-settings-list]")
const back = page.locator("[data-settings] [data-settings-back]")
const shown = (id) => page.locator(`[data-settings] [data-settings-section="${id}"]`)
/** Whether `id` is shown in the menu's place: the section drawn, the menu gone, a way back above it. */
const inPlace = async (id) => !!(await until(async () => await shown(id).isVisible() && !(await menu.count()), 3000))
/** Back to the menu, by the way back above the section. */
async function toMenu() { await back.click(); await until(() => menu.isVisible(), 3000) }
async function rightSidebar(open) {
  const t = page.locator("[data-sidebar-toggle=right]")
  if ((await t.getAttribute("aria-expanded") === "true") !== open) await t.click()
  await until(async () => (await t.getAttribute("aria-expanded") === "true") === open, 3000)
  await wait(400)
}

try {
  await page.goto(`${B}#settings`)
  await until(() => page.locator("[data-settings]").count(), 8000); await wait(1000)
  await rightSidebar(true)
  check("both sidebars: Settings is narrow (its menu is the page)", await layout() === "narrow" && await menu.isVisible(), await layout())

  // Every section the menu lists opens in its place, and its way back is to the menu.
  const ids = await menu.locator("[data-settings-nav]").evaluateAll((els) => els.map((e) => e.getAttribute("data-settings-nav")))
  check("the menu lists Plugins and Get plugins", ids.includes("plugins") && ids.includes("get"), ids)
  const pluginsRow = (await menu.locator('[data-settings-nav="plugins"]').innerText()).replace(/\s+/g, " ").trim()
  check("Plugins says what its number counts", /^Plugins \d+ on$/.test(pluginsRow), pluginsRow)
  const broken = []
  for (const id of ids) {
    await menu.locator(`[data-settings-nav="${id}"]`).click()
    if (!(await inPlace(id)) || !(await back.isVisible())) { broken.push(id); await page.goto(`${B}#settings`); await wait(1500); continue }
    if (id === "plugins") await page.screenshot({ path: `${OUT}plugins.png` })
    if (id === "mcp:remote") {
      const says = await until(async () => await shown(id).locator("[data-cloud-sign-in]").count() && shown(id).innerText(), 6000)
      check("Share & sync, signed out: what it's for, and that the rest works without it", /phone/.test(says) && /everything else works the same/.test(says), says)
    }
    await toMenu()
  }
  check("each section opens in the menu's place, with a way back to it", !broken.length, broken)
  check("no sheet opened for a section", !(await page.locator("dialog[open]").count()))

  // Plugins: its list; a plugin's row, its page with a way back to Plugins.
  await menu.locator('[data-settings-nav="plugins"]').click()
  check("Plugins lists the plugins", await until(() => page.locator("[data-settings] [data-plugin-row]").count(), 4000) > 0)
  const row = page.locator("[data-settings] [data-plugin-row]").first(), pid = await row.getAttribute("data-plugin-row")
  await row.click()
  check("a plugin's row opens its page in place", await inPlace(`plugin:${pid}`), pid)
  const crumb = page.locator("[data-settings] [data-settings-crumb]")
  check("its page has one way back: to where it's listed", await crumb.isVisible() && !(await back.count()))
  await crumb.click()
  check("which goes back to that section", await until(async () => !(await shown(`plugin:${pid}`).count()) && await back.isVisible(), 3000))
  await toMenu()

  // The sidebar's Plugins button, from a note and from Settings' own menu.
  await page.locator("[data-app-page=setup]").click()
  check("the sidebar's Plugins button opens Plugins", await inPlace("plugins"))
  await toMenu()
  await page.goto(`${B}#Start%20here.md`); await wait(1500)
  await page.locator("[data-app-page=setup]").click()
  check("…from another tab too", await inPlace("plugins"))

  // The palette, and search's results.
  await palette(page, "Get plugins and layouts")
  check("the palette's Get plugins opens Get", await inPlace("get"))
  await toMenu()
  await page.locator("[data-settings-search] input").fill("plugin updates")
  await page.locator('[data-settings-result="plugin-updates"]').click()
  check("a search result opens its section in place", await inPlace("plugins"))
  const found = page.locator('[data-settings] [data-settings-row="plugin-updates"]')
  check("…scrolled to what it found", !!(await until(async () => { const r = await found.boundingBox(); return r && r.y >= 0 && r.y + r.height <= 820 }, 3000)))
  await page.screenshot({ path: `${OUT}found.png` })
  await toMenu()
  check("back, the search is as it was", await page.locator("[data-settings-search] input").inputValue() === "plugin updates")
  await page.locator("[data-settings-search] input").fill("")

  // Wider, the section shown is beside the menu; narrow again, in its place.
  await menu.locator('[data-settings-nav="get"]').click(); await inPlace("get")
  await rightSidebar(false)
  check("wide: the section beside the menu", await layout() === "wide" && await shown("get").isVisible() && !(await back.count()))
  const lit = () => page.locator("[data-app-page][aria-current=page]").getAttribute("data-app-page")
  check("Settings on Get plugins: the sidebar lights Plugins", await lit() === "setup", await lit())
  await page.locator("[data-app-page=settings]").click()
  const own = await until(async () => { const s = await page.locator("[data-settings] [data-settings-section]").first().getAttribute("data-settings-section"); return s && s !== "get" && s !== "plugins" && s }, 3000)
  check("Settings' button from Plugins: its own last section, not Plugins'", !!own, own)
  check("…and it's Settings that's lit", await lit() === "settings", await lit())
  await page.locator("[data-app-page=setup]").click()
  check("Plugins' button: back where Plugins was", !!(await until(() => shown("get").isVisible(), 3000)) && await lit() === "setup")
  await rightSidebar(true)
  check("narrow again: still that section, in place", await inPlace("get"))
  await toMenu()

  // An old tab or link at #get: Settings' section, in a narrow pane too.
  await page.goto("about:blank"); await page.goto(`${B}#get`)
  await until(() => page.locator("[data-settings]").count(), 8000); await wait(1000)
  await rightSidebar(true)
  check("#get shows Settings' Get plugins", await inPlace("get") && !(await page.locator("[data-setup] [data-setup-tab]").count()))

  // The palette's way to where a setting is (⌘↩ on it): Settings at its row, in the menu's place, not a sheet.
  const onScreen = async (el) => { const r = await el.boundingBox(); return !!r && r.y >= 0 && r.y + r.height <= 820 }
  async function whereItIs(name) {
    await openPalette(page); await page.waitForSelector("[role=dialog] input:focus"); await page.keyboard.type(name)
    await until(() => page.locator("[role=option]", { hasText: name }).count(), 3000)
    await page.keyboard.press("ControlOrMeta+Enter"); await wait(600)
  }
  if (await back.count()) await toMenu()
  await whereItIs("File icons")
  const icons = page.locator('[data-settings] [data-settings-row="file-icons"]')
  check("a setting's place: its section in Settings, in place", await inPlace("appearance") && !(await page.locator("dialog[open]").count()))
  check("…at its row", !!(await until(() => onScreen(icons), 3000)))
  await toMenu()
  await whereItIs("Notifications from pages")
  const notes = page.locator('[data-settings] [data-plugin-settings-sheet="web-viewer"] [data-setting]', { hasText: "Notifications from pages" })
  check("a plugin's setting's place: its page in Settings, in place", await inPlace("plugin:web-viewer") && !(await page.locator("dialog[open]").count()))
  check("…at its row", !!(await until(() => onScreen(notes.first()), 3000)))

  // Settings itself (the sidebar's button, ⌘,) with a section left open: its menu and its search, not that section.
  const search = page.locator("[data-settings] [data-settings-search] input")
  const atMenu = async () => !!(await until(async () => await menu.isVisible() && await search.isVisible() && !(await back.count()), 3000))
  await page.locator("aside").first().getByText("Start here", { exact: true }).first().click(); await wait(800)
  await page.locator("[data-app-page=settings]").click()
  check("Settings' button, a section left open: the menu, with its search", await atMenu())
  await menu.locator('[data-settings-nav="editor"]').click(); await inPlace("editor")
  await page.keyboard.press("ControlOrMeta+,")
  check("…and ⌘, from a section", await atMenu())
  await ctx.close()

  // A phone: Plugins is its own page.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const pp = watch(await phone.newPage(), { label: "390" })
  await pp.goto(`${B}#settings`); await until(() => pp.locator("[data-settings-list]").count(), 8000); await wait(800)
  await pp.locator('[data-settings-list] [data-settings-nav="plugins"]').click()
  check("a phone: Plugins is its own page", !!(await until(() => pp.locator('[data-setup="plugins"] [data-plugin-row]').count(), 4000)))
  await phone.close()
} finally {
  await done()
}
