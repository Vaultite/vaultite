// A blank tab's page (components/NewTab.tsx, newtab.json: core/newtab.ts), followed live, edited from its menu and by
// drag, on a phone too. WRITES .vaultite/newtab.json, plugins.json and a note: throwaway only.
//   node web/qa/newtab.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/newtab-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const file = path.join(VAULT, ".vaultite/newtab.json")
const before = existsSync(file) ? readFileSync(file, "utf8") : null
const saved = () => { try { return JSON.parse(readFileSync(file, "utf8")) } catch { return {} } }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Pages plugins wrote (the user's files): one opened here, one changed just now; and a note.
const [opened0, changed0] = readdirSync(path.join(VAULT, "Dashboards")).filter((f) => f.endsWith(".md"))
const note = path.join(VAULT, "Notes/Changed lately.md")
try {
  rmSync(file, { force: true })
  writeFileSync(note, "Written just now.\n")
  utimesSync(path.join(VAULT, "Dashboards", changed0), new Date(), new Date(Date.now() + 60_000))
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  const sections = () => page.$$eval("[data-pane] [data-newtab-section]", (els) => els.map((e) => e.getAttribute("data-newtab-section")))
  const buttons = () => page.$$eval("[data-pane] [data-newtab-action]", (els) => els.map((e) => e.getAttribute("data-newtab-action")))
  // Opened here: a page, then the note (each stays in view long enough to count: core/scope.ts).
  for (const p of [`Dashboards/${opened0}`, "Notes/Changed lately.md"]) {
    await page.goto("about:blank")
    await page.goto(`${B.replace(/\/$/, "")}/#file/${encodeURIComponent(p)}`)
    await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
    await wait(2500)
  }
  await page.click("[aria-label='New tab']")
  await until(async () => (await buttons()).length)
  const secs = (await sections()).filter((s) => s !== "mcp:connect") // (Connections leads until an AI app is connected)
  check("default: the buttons first, the recent files after; no terminals until shown", secs[0] === "core:actions" && secs.includes("core:changed") && !secs.includes("terminal:sessions"), secs)
  check("default: New note, Open a file, the command palette", same(await buttons(), ["file:new", "switcher:open", "palette:open"]), await buttons())
  const changed = await until(async () => {
    const rows = await page.$$eval("[data-pane] [data-newtab-section='core:changed'] [data-recent]", (els) => els.map((e) => e.getAttribute("data-recent")))
    return rows.includes(`Dashboards/${changed0}`) && rows
  })
  // (the note is opened here, so it's under Recently opened instead)
  check("recently changed: the user's files, a page a plugin wrote too", !!changed, changed)
  const opened = await page.$$eval("[data-pane] [data-newtab-section='core:opened'] [data-recent]", (els) => els.map((e) => e.getAttribute("data-recent")))
  check("recently opened here: the note", opened.includes("Notes/Changed lately.md"), opened)
  check("default: a button is drawn as its command (label, shortcut)", /New note/.test(await page.textContent("[data-pane] [data-newtab-action='file:new']")) &&
    /⌘O|Ctrl/.test(await page.textContent("[data-pane] [data-newtab-action='switcher:open']")))
  await page.screenshot({ path: path.join(OUT, "default.png") })

  // Written by hand (as an AI would): followed live.
  writeFileSync(file, JSON.stringify({ sections: ["terminal:sessions", "core:actions", "core:changed"], actions: ["terminal:open", "file:new", "palette:open"] }, null, 2) + "\n")
  check("newtab.json followed live: sections in its order", await until(async () => same(await sections(), ["terminal:sessions", "core:actions", "core:changed"])), await sections())
  check("newtab.json followed live: its buttons", same(await buttons(), ["terminal:open", "file:new", "palette:open"]), await buttons())
  check("a plugin's section has its heading", /Terminals/.test(await page.textContent("[data-pane] [data-newtab-section='terminal:sessions']")))
  await page.screenshot({ path: path.join(OUT, "custom.png") })

  // The right-click menu on a button: move it, remove it (newtab.json's `actions` only).
  await page.click("[data-pane] [data-newtab-action='terminal:open']", { button: "right" })
  await page.click("[role=menu] >> text=Move down")
  check("menu: a button moved down", await until(() => same(saved().actions, ["file:new", "terminal:open", "palette:open"])), saved())
  await page.click("[data-pane] [data-newtab-action='palette:open']", { button: "right" })
  await page.click("[role=menu] >> text=/^Remove /")
  check("menu: a button removed; sections untouched", await until(() => same(saved().actions, ["file:new", "terminal:open"])) && saved().sections[0] === "terminal:sessions", saved())
  // On a section: hide it.
  await page.click("[data-pane] [data-newtab-section='terminal:sessions'] >> text=Terminals", { button: "right" })
  await page.click("[role=menu] >> text=Hide Terminals")
  check("menu: a section hidden", await until(async () => !(await sections()).includes("terminal:sessions")) && !saved().sections.includes("terminal:sessions"), saved())
  // The buttons' items only on the buttons: not on another section, nor anywhere once the buttons are hidden.
  const menuItems = () => page.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim()))
  const closeMenus = async () => { for (let i = 0; i < 3 && await page.$("[role=menu]"); i++) { await page.keyboard.press("Escape"); await wait(100) } }
  await page.click("[data-pane] [data-newtab-section='core:changed'] [data-panel-handle]", { button: "right" })
  let items = await menuItems()
  check("menu on another section: its own items and Sections, no Buttons", items.some((t) => /^Hide /.test(t)) && items.includes("Sections") && !items.includes("Buttons"), items)
  await closeMenus()
  await page.click("[data-pane] [data-newtab-section='core:actions'] [data-panel-handle]", { button: "right" })
  items = await menuItems()
  check("menu on the buttons: Buttons there", items.includes("Buttons") && items.includes("Hide Buttons"), items)
  await page.click("[role=menu] >> text=Hide Buttons")
  await until(() => saved().sections && !saved().sections.includes("core:actions"))
  await page.click("[data-pane] [data-newtab-section='core:changed'] [data-panel-handle]", { button: "right", position: { x: 300, y: 4 } })
  items = await menuItems()
  check("buttons hidden: no Buttons in the menu anywhere", items.includes("Sections") && !items.includes("Buttons"), items)
  await closeMenus()
  // Shown again from Sections ▸ More ▸ (at the end).
  const fromMore = async (name) => {
    await page.hover("[role=menu] >> text=Sections")
    await page.locator("[role=menu] button", { hasText: /^More$/ }).last().hover()
    await page.locator("[role=menu]").last().locator("[role=menuitemcheckbox]", { hasText: name }).first().click()
  }
  await page.click("[data-pane] [data-newtab-section='core:changed'] [data-panel-handle]", { button: "right" })
  await fromMore("Buttons")
  check("menu: Sections ▸ shows the buttons again", await until(async () => (await sections()).includes("core:actions")), await sections())
  await closeMenus()
  // Sections ▸ More ▸: a hidden one shown again (at the end).
  await page.click("[data-pane] [data-newtab-section='core:actions']", { button: "right", position: { x: 300, y: 2 } })
  await fromMore("Terminals")
  check("menu: Sections ▸ shows one again, at the end", await until(() => saved().sections?.at(-1) === "terminal:sessions"), saved())
  // (Escape closes the submenu, then the menu.)
  for (let i = 0; i < 3 && await page.$("[role=menu]"); i++) { await page.keyboard.press("Escape"); await wait(100) }
  await page.screenshot({ path: path.join(OUT, "menu-after.png") })
  // Reset, then Undo.
  await page.click("[data-pane] [data-newtab-action='file:new']", { button: "right" })
  await page.click("[role=menu] >> text=Reset new tab")
  check("menu: Reset removes both keys (the default again)", await until(() => !("sections" in saved()) && !("actions" in saved())) && await until(async () => same(await buttons(), ["file:new", "switcher:open", "palette:open"])), saved())
  await page.click("text=Undo")
  check("Reset: Undo brings the page back", await until(() => same(saved().actions, ["file:new", "terminal:open"])), saved())

  // Dragging: a section by its title, a button by itself (core/drag.ts: press, move 5px, drop where they make way).
  writeFileSync(file, JSON.stringify({ sections: ["core:actions", "core:changed"], actions: ["file:new", "switcher:open", "palette:open"] }, null, 2) + "\n")
  await until(async () => same(await sections(), ["core:actions", "core:changed"]))
  const drag = async (from, to, below) => {
    const a = await page.locator(from).first().boundingBox(), b = await page.locator(to).first().boundingBox()
    await page.mouse.move(a.x + 20, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 26, a.y + a.height / 2 + 6, { steps: 3 })
    await page.mouse.move(b.x + 20, below ? b.y + b.height + 2 : b.y + 2, { steps: 8 })
    await wait(100)
    const way = !!(await page.$("[data-pane] [data-drop-preview]"))
    await page.mouse.up()
    return way
  }
  check("a section has its title, the buttons too", /Buttons/.test(await page.textContent("[data-pane] [data-newtab-section='core:actions'] [data-panel-handle]")))
  const way = await drag("[data-pane] [data-newtab-section='core:changed'] [data-panel-handle]", "[data-pane] [data-newtab-section='core:actions']", false)
  check("drag: the sections make way", way)
  check("drag: a section dragged by its title above another", await until(() => same(saved().sections, ["core:changed", "core:actions"])), saved())
  await drag("[data-pane] [data-newtab-action='palette:open']", "[data-pane] [data-newtab-action='file:new']", false)
  check("drag: a button dragged above another; nothing ran", await until(() => same(saved().actions, ["palette:open", "file:new", "switcher:open"])) && !(await page.$("[role=dialog][aria-label*='ommand']")), saved())
  // A sidebar panel as a section (Sections ▸ More ▸, after the line), drawn as in the sidebar.
  await page.click("[data-pane] [data-newtab-section='core:actions'] [data-panel-handle]", { button: "right" })
  await fromMore("Recent files")
  check("a sidebar panel shown as a section", await until(() => saved().sections?.at(-1) === "recent:recent") && await until(() => page.$("[data-pane] [data-newtab-section='recent:recent'] [data-recent-panel]")), saved())
  for (let i = 0; i < 3 && await page.$("[role=menu]"); i++) { await page.keyboard.press("Escape"); await wait(100) }
  await drag("[data-pane] [data-newtab-section='recent:recent'] [data-panel-handle]", "[data-pane] [data-newtab-section='core:changed']", false)
  check("drag: a panel's section by its own heading", await until(() => saved().sections?.[0] === "recent:recent"), saved())
  // A panel that's one button (the search field) drags by itself; the drag opens nothing.
  writeFileSync(file, JSON.stringify({ ...saved(), sections: [...saved().sections, "search:search"] }, null, 2) + "\n")
  await until(() => page.$("[data-pane] [data-newtab-section='search:search'] [data-sidebar-search]"))
  await drag("[data-pane] [data-newtab-section='search:search'] [data-sidebar-search]", "[data-pane] [data-newtab-section='recent:recent']", false)
  check("drag: the search field's section by itself; nothing opened", await until(() => saved().sections?.[0] === "search:search") && !(await page.$("[role=dialog]")), saved())
  await page.screenshot({ path: path.join(OUT, "dragged.png") })

  // A button runs its command.
  await page.click("[data-pane] [data-newtab-action='file:new']")
  check("a button runs its command (New note opens a note)", await until(async () => !(await buttons()).length), await buttons())
  await page.close()

  // `opens`: the switcher. In the web app (no web tabs) it's the plain switcher whose pick opens in a new tab, without the
  // web's rows; Escape leaves no tab. A view that can't show here (a web page) is a blank tab's page.
  writeFileSync(file, JSON.stringify({ opens: "switcher" }, null, 2) + "\n")
  const lp = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  await lp.goto(`${B.replace(/\/$/, "")}/#file/${encodeURIComponent("Notes/Changed lately.md")}`)
  await lp.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
  const SEARCH = '[role="dialog"][aria-label="Search"]'
  const tabs = () => lp.locator("[role=tab]").count(), t0 = await tabs()
  await lp.click("[aria-label='New tab']")
  check("opens switcher: + opens the switcher, no tab yet", !!(await until(() => lp.$(SEARCH), 8000)) && await tabs() === t0)
  check("… on the web app it's the plain switcher (no web tabs here)", (await lp.getAttribute(`${SEARCH} input`, "placeholder")) === "Find or create a note…")
  await lp.keyboard.press("Escape")
  check("… Escape: nothing opened, no blank tab left", await until(async () => !(await lp.$(SEARCH)), 4000) && await tabs() === t0)
  await lp.click("[aria-label='New tab']")
  await until(() => lp.$(SEARCH), 8000)
  await lp.keyboard.type("example.com")
  const opts = () => lp.$$eval("#palette-results [role=option]", (els) => els.map((e) => e.textContent.trim()))
  await wait(500)
  check("… no web rows on the web app (no web tabs to open them in)", !(await opts()).some((t) => /^(Open example|Search the web)/.test(t)), await opts())
  await lp.fill(`${SEARCH} input`, "Changed lately")
  await until(async () => (await opts())[0]?.startsWith("Changed lately"))
  await lp.keyboard.press("Enter")
  check("… a pick opens in a new tab", await until(async () => !(await lp.$(SEARCH)) && await tabs() === t0 + 1), await tabs())
  writeFileSync(file, JSON.stringify({ opens: "view:web" }, null, 2) + "\n")
  await wait(1500)
  await lp.click("[aria-label='New tab']")
  check("opens view:web where web pages can't show: a blank tab's page", await until(() => lp.$("[data-pane] [data-newtab-action]")) && !(await lp.$("[data-web-elsewhere]")))
  // Settings > Appearance: the choice, here without a web page.
  await lp.goto("about:blank")
  await lp.goto(`${B.replace(/\/$/, "")}/#settings`)
  await lp.locator('[data-settings-nav="appearance"]').click()
  const choice = await until(async () => { const t = await lp.$$eval("[data-settings-row='new-tabs'] [role=radio]", (els) => els.map((e) => e.textContent.trim())); return t.length && t })
  check("Settings: New tabs open, Page or Quick switcher here", JSON.stringify(choice) === JSON.stringify(["Page", "Quick switcher"]), choice)
  await lp.click("[data-settings-row='new-tabs'] [role=radio] >> text=Quick switcher")
  check("… choosing writes `opens` only", await until(() => saved().opens === "switcher" && Object.keys(saved()).length === 1), saved())
  await lp.click("[data-settings-row='new-tabs'] [role=radio] >> text=Page")
  check("… Page is the default: the key goes", await until(() => !("opens" in saved())), saved())
  await lp.close()

  // The phone: the same page, a size up, Pinned's tiles first (a phone-only section).
  rmSync(file, { force: true })
  const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
  await phone.goto(B)
  await phone.waitForSelector("[data-bar='new']", { timeout: 30000 })
  await phone.click("[data-bar='new']")
  const ph = await until(async () => { const s = (await phone.$$eval("[data-newtab-section]", (els) => els.map((e) => e.getAttribute("data-newtab-section")))).filter((x) => x !== "mcp:connect"); return s.length ? s : null })
  check("phone: Pinned's tiles, then the buttons", ph?.[0] === "pages:tiles" && ph?.[1] === "core:actions", ph)
  await phone.screenshot({ path: path.join(OUT, "phone.png") })
  // Held (a right-click) on the pinned tiles: their section's items, not the buttons'.
  await phone.click("[data-newtab-section='pages:tiles'] [data-panel-handle]", { button: "right" })
  const held = await until(async () => { const t = await phone.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim())); return t.length ? t : null })
  check("phone: held on the tiles, no Buttons in the menu", !!held?.includes("Sections") && !held.includes("Buttons"), held)
  await phone.keyboard.press("Escape")
  writeFileSync(file, JSON.stringify({ opens: "switcher" }, null, 2) + "\n")
  await wait(1500)
  await phone.click("[data-bar='new']")
  check("phone: + with opens switcher opens the switcher", !!(await until(() => phone.$('[role="dialog"][aria-label="Search"]'), 8000)))
  await phone.close()
  rmSync(file, { force: true })

  // A first visit's + tapped before the vault arrives (its tab already blank): the new tab stays, not filled with home.
  const early = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
  await early.route(/\/api\/state/, async (r) => { await wait(2000); await r.continue() })
  await early.goto(B)
  await early.waitForSelector("[data-bar='new']", { timeout: 30000 })
  await early.click("[data-bar='new']")
  await wait(3500)
  check("phone: + before the vault arrives keeps its new tab", await early.evaluate(() => location.hash) === "#new" && !!(await early.$("[data-newtab-section]")), await early.evaluate(() => location.hash))
  await early.close()
} finally {
  if (before === null) rmSync(file, { force: true }); else writeFileSync(file, before)
  rmSync(note, { force: true })
  await browser.close()
}
console.log(`\nshots in ${OUT}`)
await done()
