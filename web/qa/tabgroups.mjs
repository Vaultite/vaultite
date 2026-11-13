// Tab groups (made, joined, folded, dragged, kept over a reload) and vertical tabs (the Tabs panel), vau tabs, a phone's
// cards. Writes the vault's appearance and sidebars (put back): throwaway server only.
//   node web/qa/tabgroups.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, palette, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B0, VAULT, OUT = "/tmp/tabgroups-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
mkdirSync(OUT, { recursive: true })

const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json")
const lookNow = () => JSON.parse(existsSync(look.p) ? readFileSync(look.p, "utf8") : "{}")
const theme = (t) => writeFileSync(look.p, JSON.stringify({ ...lookNow(), theme: t }) + "\n")
// The sandbox's dailies move with today: its newest is today's, always there.
const day = (() => { try { return readdirSync(path.join(VAULT, "Daily")).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f)).sort().at(-1)?.slice(0, -3) } catch { return undefined } })()
const notes = ["Start here.md", "Projects/Lighthouse.md", "Projects/Garden planner.md", "ME.md", `Daily/${day}.md`].filter((p) => existsSync(path.join(VAULT, p)))
if (notes.length < 5) { console.error("needs the sandbox vault (vau sandbox <folder>)"); process.exit(2) }
writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true, theme: "light" }) + "\n")

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } })
  const page = watch(await ctx.newPage()), ui = app(page)
  await page.goto(`${B}#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-tab-bar] [data-tab-id]")
  for (const p of notes) {
    await page.click("[data-tab-bar] button[aria-label='New tab']"); await ui.idle()
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, p); await ui.idle()
  }
  /** The bar as text: each tab's label, its group's name in brackets ("~" folded), a chip as <name>. */
  // (a chip's count is drawn always, hidden while it's open: not what it says)
  const bar = () => page.$$eval("[data-tab-bar] :is([data-tab-id], [data-group-chip])", (els) => els.map((e) => (e.dataset.groupChip ? `<${((e) => { const c = e.cloneNode(true); for (const x of c.querySelectorAll("[data-group-count][aria-hidden]")) x.remove(); return c.textContent.trim() })(e)}>` : e.textContent.trim())).join(" "))
  const tab = (label) => page.locator("[data-tab-bar] [data-tab-id]", { hasText: label }).first()
  const menu = async (loc, ...items) => { await ui.menu.context(loc); await ui.menu.pick(...items) }
  await until(async () => (await page.$$("[data-tab-bar] [data-tab-id]")).length === 5, 5000)

  // A new group from a tab's menu: its editor opens under its chip, the name field focused.
  await menu(tab("Lighthouse"), "Add tab to new group")
  const field = await until(() => page.$("[role=menu] [data-menu-field] input"), 3000)
  const focused = await page.evaluate(() => document.activeElement?.closest("[data-menu-field]") !== null)
  check("a new group opens its editor, its name field focused, the folder its tab is in suggested", !!field && focused && (await field.inputValue()) === "Projects", await field?.inputValue())
  const [chipBox, menuBox] = [await page.locator("[data-group-chip]").first().boundingBox(), await page.locator("[role=menu]").boundingBox()]
  check("  under its chip", Math.abs(menuBox.x - chipBox.x) <= 2 && menuBox.y >= chipBox.y + chipBox.height, [chipBox, menuBox])
  await page.keyboard.type("Lighthouse work"); await ui.idle()
  check("  the chip follows the name as it's typed", (await bar()).includes("<Lighthouse work>"), await bar())
  const bg = () => page.$eval("[data-group-chip] [data-group-name]", (e) => getComputedStyle(e).backgroundColor)
  const was = await bg()
  await page.locator("[role=menu] [data-menu-colors] [data-color='purple']").click(); await ui.idle()
  check("  a colour is one click, and the editor stays open with it ticked", (await bg()) !== was && await page.locator("[role=menu] [data-color='purple'][aria-checked=true]").count() === 1, [was, await bg()])
  await page.screenshot({ path: `${OUT}editor-light.png`, clip: { x: 0, y: 0, width: 1280, height: 360 } })
  // The keyboard through it, as through any menu: ↓ from the colours to its rows, ↑ from the first row back to them.
  const on = () => page.evaluate(() => document.activeElement?.getAttribute("data-color") ?? document.activeElement?.textContent?.trim())
  await page.keyboard.press("ArrowDown"); const down = await on()
  await page.keyboard.press("ArrowUp"); const up = await on()
  check("  ↓ from its colours to its first row, ↑ back to the colour it has", down === "New tab in group" && up === "purple", [down, up])
  await page.locator("[role=menu] [data-menu-field] input").focus()
  await page.keyboard.press("Tab"); const tab1 = await on()
  await page.keyboard.press("Tab"); const tab2 = await on()
  check("  Tab: the name, the colour it has (one stop for the row), its first row", tab1 === "purple" && tab2 === "New tab in group", [tab1, tab2])
  await page.locator("[role=menu] [data-menu-field] input").press("Enter"); await ui.idle()
  check("  Enter closes it, the name kept", !(await page.$("[role=menu]")) && (await bar()).includes("<Lighthouse work> Lighthouse"), await bar())
  // A long name: cut off in its chip (a browser's width), the tabs keeping their room; then back.
  const rename = async (name) => { await page.click("[data-group-chip]", { button: "right" }); const f = await until(() => page.$("[role=menu] [data-menu-field] input"), 3000); await f.fill(name); await f.press("Enter"); await ui.idle() }
  await rename("Everything about the Lighthouse launch and the people on it")
  const chipW = await page.$eval("[data-group-chip] [data-group-name]", (e) => Math.round(e.getBoundingClientRect().width))
  check("  a long name is cut off in its chip", chipW <= 160, chipW)
  await rename("Lighthouse work")
  await ui.menu.context(tab("ME"))
  const subOpen = page.locator("[role=menu]").nth(1)
  await ui.menu.top().getByRole("menuitem", { name: "Add tab to group", exact: true }).hover(); await subOpen.waitFor(); await ui.idle()
  const sub = await ui.menu.items()
  check("with a group to join: Add tab to group ▸, New group first, then the groups (no row of its own for a new one)",
    sub[0]?.trim() === "New group" && sub[1]?.trim() === "Lighthouse work" && await page.getByRole("menuitem", { name: "Add tab to new group", exact: true }).count() === 0, sub)
  await ui.menu.close()
  await menu(tab("ME"), "Add tab to group", "Lighthouse work")
  check("another tab joins it from its menu, at its end", (await bar()).includes("<Lighthouse work> Lighthouse ME"), await bar())
  // A new tab (⌘T) from a grouped tab is past its group, in none, whatever it opens (a link from it joins it).
  const fresh = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => { const i = els.findIndex((e) => e.querySelector("[aria-selected=true]"))
    return { prev: els[i - 1]?.textContent.trim(), at: els[i]?.textContent.trim(), grouped: !!els[i]?.dataset.inGroup } })
  const newtab = keep("newtab.json"), wasShown = await page.$eval("[data-tab-bar] [data-tab-id]:has([aria-selected=true])", (e) => e.dataset.tabId)
  for (const opens of [null, "switcher"]) {
    await ui.sees(".vaultite/newtab.json", () => writeFileSync(newtab.p, JSON.stringify({ opens }) + "\n"))
    await tab("Lighthouse").click(); await ui.idle()
    await command(page, "Open new tab", 0); await ui.idle()
    if (opens) { await page.keyboard.type("Lisbon trip"); await ui.idle(); await page.keyboard.press("Enter"); await ui.idle() }
    const f = await fresh()
    check(`a new tab (${opens ?? "blank"}) from a grouped tab goes past its group, in none`, f.prev === "ME" && f.at === (opens ? "Lisbon trip" : "New tab") && !f.grouped, [f, await bar()])
    await menu(page.locator("[data-tab-bar] [data-tab-id]:has([aria-selected=true])"), "Close")
  }
  if (newtab.was === null) rmSync(newtab.p); else writeFileSync(newtab.p, newtab.was)
  await page.click(`[data-tab-bar] [data-tab-id="${wasShown}"]`); await ui.idle()
  await menu(tab(day), "Add tab to group", "New group")
  await until(() => page.$("[role=menu] [data-menu-field] input"), 3000); await page.keyboard.press("Backspace"); await page.keyboard.press("Enter"); await ui.idle()
  const chips = await page.$$eval("[data-group-chip]", (els) => els.map((e) => ({ text: ((e) => { const c = e.cloneNode(true); for (const x of c.querySelectorAll("[data-group-count][aria-hidden]")) x.remove(); return c.textContent.trim() })(e), name: e.querySelector("[data-group-name]").getAttribute("aria-label"), bg: getComputedStyle(e.firstElementChild).backgroundColor })))
  check("a group without a name is a square of its colour, in the next colour", chips.length === 2 && chips[1].text === "" && chips[1].name === "Blue group" && chips[0].bg !== chips[1].bg, chips)
  // The chip is solid, its text readable on it.
  const ink = await page.$eval("[data-group-chip] [data-group-name]", (e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor])
  check("a named chip is solid, its text white or dark by its colour", ink[0] !== ink[1] && !/rgba?\([^)]*,\s*0(\.\d+)?\)$/.test(ink[1]), ink)
  // The group's line is one line, from under its chip to under its last tab.
  const lines = await page.$$eval("[data-group-chip][aria-expanded=true]", (chips) => chips.map((c) => {
    const id = c.dataset.groupChip, line = document.querySelectorAll(`[data-tab-row] > [data-group-line="${id}"]`), tabs = [...document.querySelectorAll(`[data-tab-bar] [data-in-group="${id}"]`)]
    const l = line[0]?.getBoundingClientRect()
    return { n: line.length, from: l && Math.round(l.left - c.querySelector("[data-group-name]").getBoundingClientRect().left), to: l && Math.round(l.right - tabs.at(-1).getBoundingClientRect().right) }
  }))
  check("the group's line is one line, from under its chip to under its last tab", lines.length === 2 && lines.every((x) => x.n === 1 && x.from === 0 && x.to === 0), lines)
  await page.mouse.move(640, 500); await page.screenshot({ path: `${OUT}bar-light.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })

  // Dragging a tab between two of the group's tabs: it joins; dragged past its end: it leaves.
  const drag = async (from, to, dx = 0) => {
    const a = await from.boundingBox(), b = await to.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 })
    await page.mouse.move(b.x + (dx === "end" ? b.width - 6 : dx), b.y + b.height / 2, { steps: 12 }); await ui.idle()
    await page.mouse.up(); await ui.idle()
  }
  const inGroup = (label) => page.$$eval("[data-tab-bar] [data-tab-id]", (els, l) => {
    const e = els.find((x) => x.textContent.trim() === l)
    return !!e?.dataset.lineOf
  }, label)
  await drag(tab("Start here"), tab("ME"), 2)
  check("a tab dragged between two of a group's tabs joins it", (await bar()).includes("<Lighthouse work> Lighthouse Start here ME") && await inGroup("Start here"), await bar())
  await drag(tab("Start here"), tab("Garden planner"), "end")
  check("dragged out past the group's end, it leaves", !(await inGroup("Start here")) && (await bar()).includes("<Lighthouse work> Lighthouse ME"), await bar())
  // Held over a group's last tab, a tab from outside joins its end: while dragged, the tabs make way and the group's
  // line runs under it. Just past that tab, it leaves the group where it is.
  const hold = async (from, x, y) => {
    const a = await from.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 })
    await page.mouse.move(x, y, { steps: 12 }); await ui.idle()
    return async () => { await page.mouse.up(); await ui.idle() }
  }
  const slid = (sel) => page.$$eval(sel, (els) => els.filter((e) => e.style.transform && !/\(0px\)/.test(e.style.transform)).length)
  let me = await tab("ME").boundingBox()
  let release = await hold(tab("Start here"), me.x + me.width * 0.85, me.y + me.height / 2)
  check("dragged over a group's last tab, the tabs make way, the group's line under it", await slid("[data-tab-bar] [data-slide]") > 0 && await inGroup("Start here"))
  check("  and no drop line: the tab itself shows where it goes", !(await page.$("[data-drop-line]")) && !!(await page.$("[data-tab-bar] [data-drop-preview]")))
  await page.screenshot({ path: `${OUT}bar-dragging.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  await release()
  check("dropped there, it joins the group's end", (await bar()).includes("<Lighthouse work> Lighthouse ME Start here Garden planner") && await inGroup("Start here"), await bar())
  const gp = await tab("Garden planner").boundingBox()
  release = await hold(tab("Start here"), gp.x + 3, gp.y + gp.height / 2)
  await release()
  check("dropped just past it, it leaves the group in place", (await bar()).includes("<Lighthouse work> Lighthouse ME Start here Garden planner") && !(await inGroup("Start here")), await bar())
  await drag(tab("Start here"), tab("Garden planner"), "end")

  // The chip folds the group, its tabs shrinking into it, a count showing; showing one of its tabs opens it.
  const lw0 = await page.$eval("[data-group-chip]:has-text('Lighthouse work')", (e) => e.dataset.groupChip)
  const inGroupSel = `[data-tab-bar] [data-tab-id][data-in-group="${lw0}"]`
  const widths = () => page.$$eval(inGroupSel, (els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
  // (how they fold and open, frame by frame: tabgroupmotion.mjs)
  await page.click("[data-group-chip]:has-text('Lighthouse work')"); await ui.idle()
  check("a click on the chip folds the group to it, with its count", (await bar()).includes("<Lighthouse work2>") && !(await bar()).includes(" ME"), await bar())
  await page.screenshot({ path: `${OUT}bar-folded.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  // A tab dropped on a folded group's chip goes into it, which stays folded.
  const lw = await page.locator("[data-group-chip]", { hasText: "Lighthouse work" }).boundingBox()
  release = await hold(tab("Garden planner"), lw.x + lw.width / 2, lw.y + lw.height / 2)
  const lit = await page.$eval("[data-group-chip] > span", (e) => !!e.style.boxShadow)
  await release()
  check("a tab dropped on a folded group's chip goes into it, which stays folded", lit && (await bar()).includes("<Lighthouse work3>") && !(await bar()).includes("Garden planner"), [lit, await bar()])
  await page.click("[data-group-chip]:has-text('Lighthouse work')"); await ui.idle()
  check("opened, its tabs are back at their width", (await widths()).length > 1 && (await widths()).every((w) => w > 40), await widths())
  await page.click("[data-group-chip]:has-text('Lighthouse work')"); await ui.idle()
  await palette(page, "Go to tab #2", 0); await ui.idle()
  const folded = await page.$$eval("[data-group-chip]", (els) => els.map((e) => e.getAttribute("aria-expanded")))
  check("showing a tab of a folded group opens it", folded[0] === "true" && (await bar()).includes("ME"), [folded, await bar()])
  await menu(tab("Garden planner"), "Remove from group")

  // The chip dragged moves the whole group.
  const chip = page.locator("[data-group-chip]", { hasText: "Lighthouse work" })
  await drag(chip, page.locator("[data-tab-bar] button[aria-label='New tab']"), -6)
  check("the chip dragged moves the whole group, its tabs in order", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())

  // Kept: a reload, and a closed tab reopening into its group.
  await page.reload(); await page.waitForSelector("[data-group-chip]"); await ui.idle()
  check("groups come back after a reload", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())
  await tab("ME").hover(); await tab("ME").locator("[data-tab-close]").click(); await ui.idle()
  await palette(page, "Reopen closed tab", 0); await ui.idle()
  check("a closed tab reopens into its group", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())

  // Agents: the window's tabs and groups, and grouping by name.
  const ops = async (id, body) => (await fetch(`${B}api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()
  await page.click("[data-pane-body]", { position: { x: 300, y: 300 } }).catch(() => {})
  const listed = await ops("tabs.list", {})
  const groups = listed?.groups ?? []
  check("vau tabs lists the groups, with their tabs", groups.length === 2 && groups.some((g) => g.name === "Lighthouse work" && g.tabs === 2), listed)
  const made = await ops("tabs.group", { tabs: ["Start here", "Projects/Garden planner.md"], name: "Reading", color: "green" })
  check("vau tabs group makes a group of tabs named by file", made?.group?.name === "Reading" && made.group.color === "green" && made.group.tabs?.length === 2, made)
  await until(async () => (await bar()).startsWith("<Reading>"), 5000); await ui.idle()
  check("and the bar shows it, where the first of them was", (await bar()).startsWith("<Reading> Garden planner Start here"), await bar())

  // Vertical tabs: one switch.
  await ui.sees(".vaultite/sidebars.json", () => palette(page, "Show tabs in the sidebar", 0))
  const sb = JSON.parse(readFileSync(sidebars.p, "utf8")), lk = lookNow()
  check("Show tabs in the sidebar: the tab bar off, the Tabs panel first in the left sidebar", lk.tabBar === false && sb.left[0] === "tabs:tabs", [lk.tabBar, sb.left])
  await page.waitForSelector("[data-tabs-panel] [data-group-row]")
  const rows = await page.$$eval("[data-tabs-panel] :is([data-open-tab], [data-group-row])", (els) => els.map((e) => (e.dataset.groupRow ? `[${((e) => { const c = e.cloneNode(true); for (const x of c.querySelectorAll("[data-group-count][aria-hidden]")) x.remove(); return c.textContent.trim() })(e)}]` : e.textContent.trim())))
  check("the panel shows each group as a row over its tabs", rows.join(" ").includes("[Reading] Garden planner Start here") && rows.join(" ").includes("[Lighthouse work] Lighthouse ME"), rows)
  // A group's name is a pill in its colour, as its chip on top, and its line hangs from it, unbroken down its tabs.
  const joins = await page.$eval("[data-tabs-panel] [data-slide^='group:']", (head) => {
    const id = head.dataset.slide.slice(6), pill = head.querySelector("[data-group-row] span[style]").getBoundingClientRect()
    const rail = head.parentElement.querySelector(`:scope > [data-group-line="${id}"]`).getBoundingClientRect(), last = [...head.parentElement.querySelectorAll(`[data-in-group="${id}"]`)].at(-1).getBoundingClientRect()
    return { pill: [Math.round(pill.top), Math.round(pill.bottom)], rail: Math.round(rail.top), railEnd: Math.round(rail.bottom), last: [Math.round(last.top), Math.round(last.bottom)], x: [Math.round(rail.left), Math.round(pill.left), Math.round(pill.right)] }
  })
  check("the group's line comes out of its chip (from under it) and runs down its tabs, ending by the last", joins.rail > joins.pill[0] && joins.rail < joins.pill[1] && joins.railEnd > joins.last[0] && joins.railEnd < joins.last[1] && joins.x[0] >= joins.x[1] + 2 && joins.x[0] < joins.x[2], joins)
  // Its tabs are set in from the line: their rows' highlight starts past it.
  const inset = await page.$eval("[data-tabs-panel] [data-slide^='group:']", (head) => {
    const rail = head.parentElement.querySelector(`:scope > [data-group-line="${head.dataset.slide.slice(6)}"]`).getBoundingClientRect(), row = head.nextElementSibling.querySelector("[data-open-tab]").getBoundingClientRect()
    return [Math.round(rail.right), Math.round(row.left)]
  })
  check("  its tabs' rows start past the line", inset[1] > inset[0], inset)
  // Its … opens the same editor.
  const headRow = page.locator("[data-tabs-panel] [data-group-row]").first()
  await headRow.hover(); await ui.menu.open(headRow.locator("[data-row-more]")); await ui.idle()
  check("a group's … in the panel opens its editor", await page.locator("[role=menu] [data-menu-colors]").count() === 1 && await page.locator("[role=menu] [data-menu-field] input").count() === 1)
  await page.screenshot({ path: `${OUT}vertical-editor.png`, clip: { x: 0, y: 0, width: 520, height: 420 } })
  await ui.menu.close()
  const row = (label) => page.locator("[data-tabs-panel] [data-open-tab]", { hasText: label }).first()
  const sh = await row("Start here").boundingBox()
  release = await hold(row("Lighthouse"), sh.x + sh.width / 2, sh.y + sh.height * 0.8)
  const moving = await page.locator("[data-tabs-panel] [data-slide] [data-open-tab]", { hasText: "Lighthouse" }).first().evaluate(async (e) => {
    await new Promise((r) => setTimeout(r, 400))
    const box = e.parentElement, set = box.dataset.lineOf, line = set && box.parentElement.querySelector(`:scope > [data-group-line="${set}"]`), r = box.getBoundingClientRect()
    return { moved: !!box.style.transform, rail: !!line && line.getBoundingClientRect().bottom > r.top + r.height / 2 }
  }, null, { timeout: 10_000 }).catch(() => null)
  check("in the panel too: dragged over a group's last row, the rows make way, the group's line beside it", moving?.moved && moving.rail, moving)
  await page.screenshot({ path: `${OUT}vertical-dragging.png`, clip: { x: 0, y: 0, width: 360, height: 400 } })
  await release()
  // A file from the tree held over the list: the rows make way where it would open. (The tree's last note, Start here, a
  // tab shows already: that tab makes its way there, as the drop moves it, rather than room for a new one.)
  const file = page.locator("aside [data-tree-path$='.md']").last()
  await file.scrollIntoViewIfNeeded()
  const name = (await file.getAttribute("data-tree-path")).split("/").pop().replace(/\.md$/, "")
  const fb = await file.boundingBox(), gp2 = await row("Garden planner").boundingBox()
  await page.mouse.move(fb.x + 40, fb.y + fb.height / 2); await page.mouse.down()
  await page.mouse.move(fb.x + 48, fb.y + fb.height / 2 + 4, { steps: 2 }); await page.mouse.move(gp2.x + 60, gp2.y + gp2.height * 0.3, { steps: 12 })
  // (measured as they are now: the sidebar may have scrolled a little under the pointer, near its top)
  const measure = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-tabs-panel] [data-slide]")], gp = rows.find((e) => e.textContent.trim() === "Garden planner")
    const top = gp.getBoundingClientRect().top, m = /translateY\((-?[\d.]+)px\)/.exec(gp.style.transform), made = m ? +m[1] : 0
    const e = rows.find((e) => Math.abs(e.getBoundingClientRect().top - (top - made)) <= 2)
    return { made, what: e && (e.dataset.slide === "incoming" ? "incoming" : e.textContent.trim()), h: e && Math.round(e.getBoundingClientRect().height) }
  })
  const shown = (await page.$$eval("[data-tabs-panel] [data-open-tab]", (els) => els.map((e) => e.textContent.trim()))).includes(name)
  const roomFor = (r) => r.made > 20 && r.h >= 24 && r.what === (shown ? name : "incoming")
  const room = await until(async () => { const r = await measure(); return roomFor(r) ? r : null }, 3000) ?? await measure()
  check("a file from the tree held over the list: the rows make way where it would open (its tab, if one shows it)", roomFor(room), [name, shown, room])
  await page.screenshot({ path: `${OUT}vertical-file.png`, clip: { x: 0, y: 0, width: 360, height: 400 } })
  await page.keyboard.press("Escape"); await page.mouse.up(); await ui.idle()
  const after = await page.$$eval("[data-tabs-panel] :is([data-open-tab], [data-group-row])", (els) => els.map((e) => (e.dataset.groupRow ? `[${((e) => { const c = e.cloneNode(true); for (const x of c.querySelectorAll("[data-group-count][aria-hidden]")) x.remove(); return c.textContent.trim() })(e)}]` : e.textContent.trim())).join(" "))
  check("  dropped, it joins that group's end", after.includes("[Reading] Garden planner Start here Lighthouse") && after.includes("[Lighthouse work] ME"), after)
  await page.mouse.move(900, 500); await page.screenshot({ path: `${OUT}vertical-light.png` })
  await page.click("[data-group-row]:has-text('Lighthouse work')")
  const panelRows = () => page.$$eval("[data-tabs-panel] [data-open-tab]", (els) => els.map((e) => e.textContent.trim()))
  check("a group's row folds it in the panel", !!(await until(async () => !(await panelRows()).includes("ME"), 3000)), await panelRows())
  await ui.sees(".vaultite/appearance.json", () => theme("dark"))
  check("the theme follows the vault's appearance", await page.evaluate(() => document.documentElement.classList.contains("dark")))
  await page.screenshot({ path: `${OUT}vertical-dark.png` })
  await ui.menu.context(page.locator("[data-tabs-panel]"), { position: { x: 60, y: 10 } })
  const back = ui.menu.top().getByRole("menuitem", { name: /Show tabs on top/ })
  check("the panel's menu offers Show tabs on top", await back.count() > 0)
  if (await back.count()) await ui.sees(".vaultite/sidebars.json", () => back.click())
  check("Show tabs on top: the tab bar back, the panel hidden", lookNow().tabBar === true && !JSON.parse(readFileSync(sidebars.p, "utf8")).left.includes("tabs:tabs"))
  await until(() => page.$("[data-tab-bar] [data-group-chip]"), 4000)
  await page.mouse.move(640, 500); await page.screenshot({ path: `${OUT}bar-dark.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  const saved = await page.evaluate(() => localStorage.getItem("vaultite.tabs"))
  await ctx.close()

  // A phone: the tab list, each group a card.
  for (const t of ["light", "dark"]) {
    theme(t)
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    // (the desktop's tabs, put in place before the app reads them)
    await phone.addInitScript((s) => { if (!sessionStorage.getItem("qa.seeded")) { localStorage.setItem("vaultite.tabs", s); sessionStorage.setItem("qa.seeded", "1") } }, saved)
    const pp = watch(await phone.newPage()), phoneUi = app(pp)
    await pp.goto(`${B}#file/${encodeURIComponent("ME.md")}`)
    await pp.waitForSelector("[data-phone-bar]"); await phoneUi.idle()
    await pp.evaluate(() => { location.hash = `${location.hash}/tabs` })
    const heads = await until(async () => { const h = await pp.$$eval("[data-group-card] button:not([aria-label^='Close '])", (els) => els.map((e) => e.getAttribute("aria-label"))); return h.length ? h : null }, 5000)
    if (t === "light") check("a phone's tab list shows each group as a card", heads?.length === 3 && heads.some((h) => h.startsWith("Lighthouse work,")), heads)
    await phoneUi.idle(); await pp.screenshot({ path: `${OUT}phone-${t}.png` })
    await phone.close()
  }
} finally {
  for (const f of [sidebars, look]) if (f.was === null) rmSync(f.p, { force: true }); else writeFileSync(f.p, f.was)
}
await done()
