// Tab groups and vertical tabs. A tab's menu makes a group (its name typed in place on its chip), another tab joins it
// from its menu, a dragged tab joins and leaves it, its chip folds it (a count shows) and drags the whole group, a tab
// shown in a folded group opens it; they come back after a reload and a closed tab reopens into its group. Then Show
// tabs in the sidebar (the palette): the tab bar off, the Tabs panel first in the left sidebar with each group a row
// over its tabs, and Show tabs on top puts it back. Agents: vau tabs (tabs.list, tabs.group). A phone's tab list shows
// the groups as sections. Screenshots light and dark. Writes the vault's appearance and sidebars (put back): throwaway
// server only.
//   node web/qa/tabgroups.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B0, VAULT, OUT = "/tmp/tabgroups-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)

const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json")
const lookNow = () => JSON.parse(existsSync(look.p) ? readFileSync(look.p, "utf8") : "{}")
const theme = (t) => writeFileSync(look.p, JSON.stringify({ ...lookNow(), theme: t }) + "\n")
const notes = ["Start here.md", "Projects/Lighthouse.md", "Projects/Garden planner.md", "ME.md", "Daily/2026-10-20.md"].filter((p) => existsSync(path.join(VAULT, p)))
if (notes.length < 5) { console.error("needs the sandbox vault (vau sandbox <folder>)"); process.exit(2) }
writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true, theme: "light" }) + "\n")

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("[data-tab-bar] [data-tab-id]")
  for (const p of notes) {
    await page.click("[data-tab-bar] button[aria-label='New tab']"); await wait(150)
    await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, p); await wait(350)
  }
  /** The bar as text: each tab's label, its group's name in brackets ("~" folded), a chip as <name>. */
  const bar = () => page.$$eval("[data-tab-bar]:not([data-tabs-hidden]) :is([data-tab-id], [data-set-chip])", (els) => els.map((e) => (e.dataset.setChip ? `<${e.textContent.trim()}>` : e.textContent.trim())).join(" "))
  const tab = (label) => page.locator("[data-tab-bar] [data-tab-id]", { hasText: label }).first()
  const menu = async (loc, ...items) => {
    await loc.click({ button: "right" }); await wait(200)
    for (const [i, it] of items.entries()) {
      const row = page.locator("[role=menu]").last().getByRole("menuitem", { name: it, exact: true })
      if (i < items.length - 1) await row.hover(); else await row.click()
      await wait(200)
    }
  }
  await until(async () => (await page.$$("[data-tab-bar] [data-tab-id]")).length === 5, 5000)

  // A new group from a tab's menu: its name typed on its chip.
  await menu(tab("Lighthouse"), "Add tab to new group")
  const field = await until(() => page.$("[data-set-chip] input"), 3000)
  check("a new group asks its name in place, the folder its tab is in suggested", !!field && (await field.inputValue()) === "Projects", await field?.inputValue())
  await page.keyboard.type("Lighthouse work"); await page.keyboard.press("Enter"); await wait(300)
  check("its chip shows the name before its tab", (await bar()).includes("<Lighthouse work> Lighthouse"), await bar())
  await menu(tab("ME"), "Add to group", "Lighthouse work"); await wait(200)
  check("another tab joins it from its menu, at its end", (await bar()).includes("<Lighthouse work> Lighthouse ME"), await bar())
  await menu(tab("2026-10-20"), "Add tab to new group")
  await until(() => page.$("[data-set-chip] input"), 3000); await page.keyboard.press("Backspace"); await page.keyboard.press("Enter"); await wait(300)
  const chips = await page.$$eval("[data-set-chip]", (els) => els.map((e) => ({ text: e.textContent.trim(), bg: getComputedStyle(e.firstElementChild).backgroundColor })))
  check("a group without a name is its colour's dot, in the next colour", chips.length === 2 && chips[1].text === "" && chips[0].bg !== chips[1].bg, chips)
  // The group's line is one line: under its chip at the same height as under its tabs.
  const lines = await page.$$eval("[data-set-chip] > span[aria-hidden], [data-tab-id] > span[aria-hidden]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
  check("the group's line under its chip is level with the one under its tabs", lines.length > 1 && new Set(lines).size === 1, lines)
  await page.mouse.move(640, 500); await page.screenshot({ path: `${OUT}bar-light.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })

  // Dragging a tab between two of the group's tabs: it joins; dragged past its end: it leaves.
  const drag = async (from, to, dx = 0) => {
    const a = await from.boundingBox(), b = await to.boundingBox()
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down()
    await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2, { steps: 3 })
    await page.mouse.move(b.x + (dx === "end" ? b.width - 6 : dx), b.y + b.height / 2, { steps: 12 }); await wait(150)
    await page.mouse.up(); await wait(350)
  }
  const inGroup = (label) => page.$$eval("[data-tab-bar] [data-tab-id]", (els, l) => {
    const e = els.find((x) => x.textContent.trim() === l)
    return !!e?.querySelector("span[aria-hidden].absolute")
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
    await page.mouse.move(x, y, { steps: 12 }); await wait(300)
    return async () => { await page.mouse.up(); await wait(350) }
  }
  const slid = (sel) => page.$$eval(sel, (els) => els.filter((e) => e.style.transform && !/\(0px\)/.test(e.style.transform)).length)
  let me = await tab("ME").boundingBox()
  let release = await hold(tab("Start here"), me.x + me.width * 0.85, me.y + me.height / 2)
  check("dragged over a group's last tab, the tabs make way, the group's line under it", await slid("[data-tab-bar] [data-slide]") > 0 && await inGroup("Start here"))
  check("  the tabs make way: the tab itself shows where it goes", !!(await page.$("[data-tab-bar] [data-drop-preview]")))
  await page.screenshot({ path: `${OUT}bar-dragging.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  await release()
  check("dropped there, it joins the group's end", (await bar()).includes("<Lighthouse work> Lighthouse ME Start here Garden planner") && await inGroup("Start here"), await bar())
  const gp = await tab("Garden planner").boundingBox()
  release = await hold(tab("Start here"), gp.x + 3, gp.y + gp.height / 2)
  await release()
  check("dropped just past it, it leaves the group in place", (await bar()).includes("<Lighthouse work> Lighthouse ME Start here Garden planner") && !(await inGroup("Start here")), await bar())
  await drag(tab("Start here"), tab("Garden planner"), "end")

  // The chip folds the group, a count showing; showing one of its tabs opens it.
  await page.click("[data-set-chip]:has-text('Lighthouse work')"); await wait(300)
  check("a click on the chip folds the group to it, with its count", (await bar()).includes("<Lighthouse work2>") && !(await bar()).includes(" ME"), await bar())
  await page.screenshot({ path: `${OUT}bar-folded.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  // A tab dropped on a folded group's chip goes into it, which stays folded.
  const lw = await page.locator("[data-set-chip]", { hasText: "Lighthouse work" }).boundingBox()
  release = await hold(tab("Garden planner"), lw.x + lw.width / 2, lw.y + lw.height / 2)
  const lit = await page.$eval("[data-set-chip] > span", (e) => !!e.style.boxShadow)
  await release()
  check("a tab dropped on a folded group's chip goes into it, which stays folded", lit && (await bar()).includes("<Lighthouse work3>") && !(await bar()).includes("Garden planner"), [lit, await bar()])
  await palette(page, "Go to tab #2", 400)
  const folded = await page.$$eval("[data-set-chip]", (els) => els.map((e) => e.getAttribute("aria-expanded")))
  check("showing a tab of a folded group opens it", folded[0] === "true" && (await bar()).includes("ME"), [folded, await bar()])
  await menu(tab("Garden planner"), "Remove from group")

  // The chip dragged moves the whole group.
  const chip = page.locator("[data-set-chip]", { hasText: "Lighthouse work" })
  await drag(chip, page.locator("[data-tab-bar] button[aria-label='New tab']"), -6)
  check("the chip dragged moves the whole group, its tabs in order", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())

  // Kept: a reload, and a closed tab reopening into its group.
  await page.reload(); await page.waitForSelector("[data-set-chip]"); await wait(400)
  check("groups come back after a reload", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())
  await tab("ME").hover(); await tab("ME").locator("[data-tab-close]").click(); await wait(300)
  await palette(page, "Reopen closed tab", 400)
  check("a closed tab reopens into its group", /<Lighthouse work> Lighthouse ME$/.test(await bar()), await bar())

  // Agents: the window's tabs and groups, and grouping by name.
  const ops = async (id, body) => (await fetch(`${B}api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()
  await page.click("[data-pane-body]", { position: { x: 300, y: 300 } }).catch(() => {})
  const listed = await ops("tabs.list", {})
  const groups = listed?.panes?.[0]?.groups ?? []
  check("vau tabs lists the groups, with their tabs", groups.length === 2 && groups.some((g) => g.name === "Lighthouse work" && g.tabs === 2), listed)
  const made = await ops("tabs.group", { tabs: ["Start here", "Projects/Garden planner.md"], name: "Reading", color: "green" })
  check("vau tabs group makes a group of tabs named by file", made?.group?.name === "Reading" && made.group.color === "green" && made.group.tabs?.length === 2, made)
  await wait(300)
  check("and the bar shows it, where the first of them was", (await bar()).startsWith("<Reading> Garden planner Start here"), await bar())

  // Vertical tabs: one switch.
  await palette(page, "Show tabs in the sidebar", 900)
  const sb = JSON.parse(readFileSync(sidebars.p, "utf8")), lk = lookNow()
  check("Show tabs in the sidebar: the tab bar off, the Tabs panel first in the left sidebar", lk.tabBar === false && sb.left[0] === "tabs:tabs", [lk.tabBar, sb.left])
  await page.waitForSelector("[data-tabs-panel] [data-set-row]")
  const rows = await page.$$eval("[data-tabs-panel] :is([data-open-tab], [data-set-row])", (els) => els.map((e) => (e.dataset.setRow ? `[${e.textContent.trim()}]` : e.textContent.trim())))
  check("the panel shows each group as a row over its tabs", rows.join(" ").includes("[Reading] Garden planner Start here") && rows.join(" ").includes("[Lighthouse work] Lighthouse ME"), rows)
  // A group's name is a pill in its colour, as its chip on top, and its line hangs from it, unbroken down its tabs.
  const joins = await page.$eval("[data-tabs-panel] [data-slide^='set:']", (head) => {
    const pill = head.querySelector("[data-set-row] span[style]").getBoundingClientRect(), rail = head.querySelector(":scope > span[aria-hidden]").getBoundingClientRect()
    const next = head.nextElementSibling.querySelector(":scope > span[aria-hidden]").getBoundingClientRect()
    return { pill: Math.round(pill.bottom), rail: Math.round(rail.top), railEnd: Math.round(rail.bottom), next: Math.round(next.top), x: [Math.round(rail.left), Math.round(pill.left), Math.round(pill.right)] }
  })
  check("the group's line starts where its pill ends and runs on into its tabs", Math.abs(joins.pill - joins.rail) <= 1 && joins.next <= joins.railEnd && joins.x[0] > joins.x[1] + 4 && joins.x[0] < joins.x[2], joins)
  const row = (label) => page.locator("[data-tabs-panel] [data-open-tab]", { hasText: label }).first()
  const sh = await row("Start here").boundingBox()
  release = await hold(row("Lighthouse"), sh.x + sh.width / 2, sh.y + sh.height * 0.8)
  const moving = await page.$eval("[data-tabs-panel] [data-slide] [data-open-tab]:is([aria-label='Lighthouse'])", (e) => ({ moved: !!e.parentElement.style.transform, rail: !!e.parentElement.querySelector(":scope > span[aria-hidden]") })).catch(() => null)
  check("in the panel too: dragged over a group's last row, the rows make way, the group's line beside it", moving?.moved && moving.rail, moving)
  await page.screenshot({ path: `${OUT}vertical-dragging.png`, clip: { x: 0, y: 0, width: 360, height: 400 } })
  await release()
  // A file from the tree held over the list: room opens where it would.
  const file = page.locator("aside [data-tree-path$='.md']").last()
  await file.scrollIntoViewIfNeeded()
  const fb = await file.boundingBox(), gp2 = await row("Garden planner").boundingBox()
  await page.mouse.move(fb.x + 40, fb.y + fb.height / 2); await page.mouse.down()
  await page.mouse.move(fb.x + 48, fb.y + fb.height / 2 + 4, { steps: 2 }); await page.mouse.move(gp2.x + 60, gp2.y + gp2.height * 0.3, { steps: 12 }); await wait(300)
  const room = await page.$eval("[data-tabs-panel] [data-slide='incoming']", (e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), y: Math.round(r.top) } }).catch(() => null)
  const gpNow = await row("Garden planner").boundingBox()
  check("a file from the tree held over the list: a row's room opens where it would open", !!room && room.h >= 24 && Math.abs(room.y - Math.round(gp2.y)) <= 2 && gpNow.y > gp2.y + 20, [room, gp2.y, gpNow.y])
  await page.screenshot({ path: `${OUT}vertical-file.png`, clip: { x: 0, y: 0, width: 360, height: 400 } })
  await page.keyboard.press("Escape"); await page.mouse.up(); await wait(300)
  const after = await page.$$eval("[data-tabs-panel] :is([data-open-tab], [data-set-row])", (els) => els.map((e) => (e.dataset.setRow ? `[${e.textContent.trim()}]` : e.textContent.trim())).join(" "))
  check("  dropped, it joins that group's end", after.includes("[Reading] Garden planner Start here Lighthouse") && after.includes("[Lighthouse work] ME"), after)
  check("no strip of titles above the panes (pane titles off)", !(await page.$("[data-pane-title]")))
  await page.mouse.move(900, 500); await page.screenshot({ path: `${OUT}vertical-light.png` })
  await page.click("[data-set-row]:has-text('Lighthouse work')"); await wait(300)
  check("a group's row folds it in the panel", !(await page.$$eval("[data-tabs-panel] [data-open-tab]", (els) => els.map((e) => e.textContent.trim()))).includes("ME"))
  theme("dark"); await until(() => page.evaluate(() => document.documentElement.classList.contains("dark")), 5000); await wait(300)
  await page.screenshot({ path: `${OUT}vertical-dark.png` })
  await page.locator("[data-tabs-panel]").click({ button: "right", position: { x: 60, y: 10 } }); await wait(200)
  const back = page.locator("[role=menu]").last().getByRole("menuitem", { name: /Show tabs on top/ })
  check("the panel's menu offers Show tabs on top", await back.count() > 0)
  if (await back.count()) { await back.click(); await wait(900) }
  check("Show tabs on top: the tab bar back, the panel hidden", lookNow().tabBar === true && !JSON.parse(readFileSync(sidebars.p, "utf8")).left.includes("tabs:tabs"))
  await until(() => page.$("[data-tab-bar] [data-set-chip]"), 4000)
  await page.mouse.move(640, 500); await page.screenshot({ path: `${OUT}bar-dark.png`, clip: { x: 0, y: 0, width: 1280, height: 120 } })
  const saved = await page.evaluate(() => localStorage.getItem("vaultite.tabs"))
  await ctx.close()

  // A phone: the tab list, each group a section.
  for (const t of ["light", "dark"]) {
    theme(t)
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    // (the desktop's tabs, put in place before the app reads them)
    await phone.addInitScript((s) => { if (!sessionStorage.getItem("qa.seeded")) { localStorage.setItem("vaultite.tabs", s); sessionStorage.setItem("qa.seeded", "1") } }, saved)
    const pp = watch(await phone.newPage())
    await pp.goto(`${B}#file/${encodeURIComponent("ME.md")}`)
    await pp.waitForSelector("[data-phone-bar]")
    await wait(600)
    await pp.evaluate(() => { location.hash = `${location.hash}/tabs` })
    const heads = await until(() => pp.$$eval("[data-set-head]", (els) => els.map((e) => e.textContent.trim())), 5000)
    if (t === "light") check("a phone's tab list shows each group as a section", heads?.length === 3 && heads.some((h) => h.startsWith("Lighthouse work")), heads)
    await wait(500); await pp.screenshot({ path: `${OUT}phone-${t}.png` })
    await phone.close()
  }
} finally {
  for (const f of [sidebars, look]) if (f.was === null) rmSync(f.p, { force: true }); else writeFileSync(f.p, f.was)
}
await done()
