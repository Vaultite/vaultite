// The desktop workspace around files: the tree's header (sort menu, auto-reveal, collapse / expand all), the tab bar
// (+ right after the last tab, right-click menu), the path bar (folders find themselves in the tree, click the name to
// rename, the view button), the status bar (view, word count), hover tooltips, the File icons setting, AGENTS.md being
// editable, and right-click never showing the browser's menu. WRITES (renames a note, makes and edits AGENTS.md): throwaway only.
//   node web/qa/workspace.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)

for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? "dark" : "light" })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true })
  const shot = (name) => page.screenshot({ path: `${OUT}workspace-${dark ? "dark" : "light"}-${name}.png` })
  const tree = page.locator("aside [role=tree]")
  const head = (label) => page.locator(`aside [aria-label="${label}"]`)
  await page.goto(B); await wait(1500)

  if (!dark) {
    // Tree header: five buttons.
    const labels = await page.locator("aside [role=tree]").locator("xpath=preceding-sibling::div[1]//button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
    check("tree header buttons", labels.join("|") === "New note|New folder|Change sort order|Auto-reveal current file|Collapse all"
      || labels.join("|") === "New note|New folder|Change sort order|Auto-reveal current file|Expand all", labels)
    // Tooltip on hover.
    await head("Auto-reveal current file").hover(); await wait(700)
    check("tooltip shows", (await page.locator("[role=tooltip]").innerText().catch(() => "")) === "Auto-reveal current file")
    await shot("tooltip")
    await head("New folder").hover(); await wait(80)
    check("tooltip warm: next shows at once", (await page.locator("[role=tooltip]").innerText().catch(() => "")) === "New folder")
    await page.mouse.move(700, 500); await wait(100)
    check("tooltip hides", !(await page.locator("[role=tooltip]").count()))
    // Collapse all -> Expand all -> Collapse all.
    await page.locator("aside [role=tree] button", { hasText: /^Notes$/ }).first().click(); await wait(200)
    if (await head("Collapse all").count()) { await head("Collapse all").click(); await wait(200) }
    check("collapsed: button says Expand all", await head("Expand all").count() === 1)
    await head("Expand all").click(); await wait(300)
    check("expanded: folders open", await tree.locator("[aria-expanded=true]").count() > 3)
    check("expanded: button says Collapse all", await head("Collapse all").count() === 1)
    await head("Collapse all").click(); await wait(200)
    check("collapse all closes every folder", await tree.locator("[aria-expanded=true]").count() === 0)
    // Sort menu.
    await head("Change sort order").click(); await wait(200)
    const items = await page.locator("[role=menu] [role=menuitemradio]").allInnerTexts()
    check("sort menu has six choices", items.length === 6, items)
    const sortWas = await page.locator("[role=menu] [aria-checked=true]").innerText()
    check("one sort order is checked", await page.locator("[role=menu] [aria-checked=true]").count() === 1, sortWas)
    check("sort menu has separators", await page.locator("[role=menu] [role=separator]").count() === 2)
    await shot("sort-menu")
    await page.locator("[role=menu] button", { hasText: "File name (Z to A)" }).click(); await wait(400)
    // (restored to what the vault had at the end of this block)
    const top = await tree.locator(":scope > li > div button[data-tip]").allInnerTexts()
    const folders = top.filter((_, i) => i < 5)
    check("Z to A reverses the list", folders.join() === [...folders].sort((a, b) => b.localeCompare(a)).join(), top.slice(0, 6))
    await head("Change sort order").click(); await wait(200)
    await page.locator("[role=menu] button", { hasText: sortWas }).click(); await wait(300)
    // Right-click: our menu on a file, nothing (and no browser menu) on empty space.
    const blocked = await page.evaluate(() => {
      const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 900, clientY: 800 })
      document.querySelector("main")?.dispatchEvent(ev)
      return ev.defaultPrevented
    })
    check("right-click on a page: the browser's menu is blocked", blocked)
    check("...and no menu shows", !(await page.locator("[role=menu]").count()))
    await page.locator("aside [role=tree] button", { hasText: /^Notes$/ }).first().click(); await wait(300)
    await tree.locator("li li button[data-tip]").first().click({ button: "right" }); await wait(200)
    check("right-click on a file: its menu", (await page.locator("[role=menu] button").allInnerTexts()).includes("Rename"))
    await page.keyboard.press("Escape"); await wait(100)
  }

  if (!dark) {
    // The main area scrolls by itself with room kept for its scrollbar: a short page and a long one line up exactly
    // (two core pages: dashboards are files, drawn full width).
    const edge = () => page.evaluate(() => { const r = document.querySelector("#main-scroll main").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] })
    await page.goto(`${B}#settings`); await wait(800)
    const short = await edge()
    await page.goto(`${B}#plugins`); await wait(1200)
    const long = await edge()
    const scrolls = await page.evaluate(() => { const m = document.getElementById("main-scroll"); return m.scrollHeight > m.clientHeight })
    check("a scrollbar appearing doesn't shift the page", JSON.stringify(short) === JSON.stringify(long), { short, long, scrolls })
    check("the window itself never scrolls (desktop)", await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
  }

  // Open a note: path bar, view button, status bar.
  await page.locator("aside [role=tree] button", { hasText: /^Notes$/ }).first().click().catch(() => {}); await wait(200)
  const noteRow = tree.locator("[data-tree-path^='Notes/']:not([data-tree-folder]) button[data-tip]").first()
  if (!(await noteRow.count())) { await page.locator("aside [role=tree] button", { hasText: /^Notes$/ }).first().click(); await wait(200) }
  const note = await noteRow.innerText()
  await noteRow.click(); await wait(1500)
  // The shown tab's (a pane keeps its last tabs drawn, hidden: data-kept, not data-pane)
  const bar = page.locator("#main-scroll nav[aria-label='File path']")
  check("path bar shows folder / name", (await bar.innerText()).replace(/\s+/g, " ").trim() === `Notes / ${note}`, await bar.innerText())
  // The main area's corner: the window's, less an open right sidebar (--right-sidebar, App.tsx: the status bar moves
  // beside it since 6630181).
  const sbox = await page.locator("[role=status]").last().boundingBox()
  const right = await page.evaluate(() => innerWidth - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--right-sidebar")) || 0))
  check("status bar sits in the corner, over the scrollbar", Math.round(sbox.x + sbox.width) === Math.round(right) && Math.round(sbox.y + sbox.height) === 900, { ...sbox, right })
  check("path bar stays on top while scrolling", await page.evaluate(async () => {
    const m = document.getElementById("main-scroll"); m.scrollTop = 400; await new Promise((r) => setTimeout(r, 100))
    const top = document.querySelector("#main-scroll nav[aria-label='File path']").getBoundingClientRect().top; m.scrollTop = 0; return top > 40 && top < 60
  }))
  check("status bar counts words", /[\d,]+ words?\s+[\d,]+ characters?/.test(await page.locator("[role=status]").last().innerText()), await page.locator("[role=status]").last().innerText())
  await shot("note")
  if (!dark) {
    const viewBtn = page.locator("article button[aria-label='Read'], article button[aria-label='Edit']").first()
    const before = await viewBtn.getAttribute("aria-label")
    await viewBtn.click(); await wait(300)
    check("view button switches reading/editing", (await viewBtn.getAttribute("aria-label")) !== before)
    await viewBtn.hover(); await wait(700)
    check("view tooltip says current view", /Current view: (reading|editing)/.test(await page.locator("[role=tooltip]").innerText().catch(() => "")))
    await shot("view-tooltip")
    await viewBtn.click(); await wait(300)
    // Status bar button: click or right-click lists the three views, above it; picking one switches.
    // The view button (the bar also has property chips: Provenance's origin, 321233a)
    const sb = page.locator("[role=status] button[aria-label^='Current view']")
    await sb.click(); await wait(200)
    const views = await page.locator("[role=menu] [role=menuitemradio]").allInnerTexts()
    check("status bar click: three views", views.join("|") === "Reading view|Live preview|Source mode", views)
    check("...the current one checked", await page.locator("[role=menu] [aria-checked=true]").innerText() === "Live preview")
    const mb = await page.locator("[role=menu]").boundingBox(), bb = await sb.boundingBox()
    check("...above the button", mb.y + mb.height <= bb.y, { menuBottom: mb.y + mb.height, button: bb.y })
    await shot("view-menu")
    await page.locator("[role=menu] button", { hasText: "Source mode" }).click(); await wait(300)
    check("picking Source mode switches", (await sb.getAttribute("data-tip")) === "Current view: source mode")
    await sb.click({ button: "right" }); await wait(200)
    check("right-click opens the same menu", await page.locator("[role=menu] [role=menuitemradio]").count() === 3)
    await page.locator("[role=menu] button", { hasText: "Live preview" }).click(); await wait(300)
    // Folder crumb: reveals and pulses the folder in the tree.
    await head("Collapse all").click().catch(() => {}); await wait(200)
    await bar.locator("button", { hasText: /^Notes$/ }).click(); await wait(600)
    check("folder crumb opens the folder in the tree", await tree.locator("[data-tree-path='Notes']").locator("xpath=ancestor::li[1]").getAttribute("aria-expanded") === "true")
    check("...and pulses it", await tree.locator("[data-tree-path='Notes'].reveal-flash").count() === 1)
    await shot("crumb-reveal")
    // Rename by clicking the name.
    await bar.locator("button", { hasText: note }).click(); await wait(200)
    await page.keyboard.type(`${note} renamed`); await page.keyboard.press("Enter"); await wait(1500)
    check("rename from the path bar", existsSync(`${VAULT}/Notes/${note} renamed.md`) && (await bar.innerText()).includes(`${note} renamed`))
    // Tabs: + right after the last tab.
    const plus = await page.locator("[data-tab-bar] button[aria-label='New tab']").boundingBox()
    const lastTab = await page.locator("[data-tab-bar] [role=tab]").last().boundingBox()
    check("+ sits right after the last tab", plus.x - (lastTab.x + lastTab.width) < 40, { plus: plus.x, tabEnd: lastTab.x + lastTab.width })
    // Tab menu.
    await page.locator("[data-tab-bar] [role=tab]").last().click({ button: "right" }); await wait(200)
    const tabItems = await page.locator("[role=menu] button").allInnerTexts()
    check("tab menu", ["Close", "Close others", "Close tabs to the right", "Close all", "Rename", "Reveal in file tree"].every((x) => tabItems.includes(x)), tabItems)
    await shot("tab-menu")
    await page.locator("[role=menu] button", { hasText: /^Rename$/ }).click(); await wait(300)
    check("tab menu Rename: the name becomes a field", await bar.locator("input[aria-label='File name']").count() === 1)
    await page.keyboard.press("Escape")
    await page.locator("[data-tab-bar] button[aria-label='New tab']").click(); await wait(300)
    await page.locator("[data-tab-bar] [role=tab]").first().click({ button: "right" }); await wait(200)
    await page.locator("[role=menu] button", { hasText: /^Close others$/ }).click(); await wait(300)
    check("Close others leaves one tab", await page.locator("[data-tab-bar] [role=tab]").count() === 1)
    // AGENTS.md (the user's own, made here: the app doesn't write one): robot icon, editable.
    writeFileSync(`${VAULT}/AGENTS.md`, "# Notes for AIs\n\nKeep it short.\n"); await wait(1500)
    await tree.locator("button", { hasText: /^AGENTS$/ }).click(); await wait(1500)
    check("AGENTS.md is editable", await page.locator(".cm-content[contenteditable=true]").count() > 0)
    check("AGENTS.md has the robot icon", await tree.locator("[data-tree-path='AGENTS.md'] svg.lucide-bot").count() === 1)
    await page.locator(".cm-line").last().click(); await page.keyboard.press("End"); await page.keyboard.type(" QA edit.")
    await wait(2000)
    check("typing in AGENTS.md saves", readFileSync(`${VAULT}/AGENTS.md`, "utf8").includes("QA edit."))
    // File icons off.
    await page.goto(`${B}#settings`); await wait(800)
    await page.locator("[aria-label='File icons']").click(); await wait(400)
    check("File icons off: none in the tree", await tree.locator("[data-tree-path='AGENTS.md'] svg.lucide-bot").count() === 0)
    check("...nor in the tabs", await page.locator("[data-tab-bar] [role=tab] svg").count() === 0)
    await shot("no-icons")
    await page.locator("[aria-label='File icons']").click(); await wait(400)
  }
  await ctx.close()
}
await done()
