// The Tabs panel and the tab bar turned off (appearance `tabBar`). With the panel in the left sidebar: it lists the open
// tabs, the shown one marked; a click on a row shows its tab; its X closes it; its New tab row (and a double-click under
// the list) opens a tab at the list's end, with ⌘T still beside the shown one, as a blank tab or the switcher (a phone's
// drawer has the row too); then with tabBar false (written to
// appearance.json, followed live) each pane's bar shows only the tab on screen and how many it has, and the panel still
// switches; a split lists each pane under its number; with paneTitles false too, a note's own bar is its pane's title
// row. Writes sidebars.json, appearance.json, hotkeys.json, newtab.json and a few notes (put back): throwaway server only.
//   node web/qa/tabspanel.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/tabspanel-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const keep = (f) => { const p = path.join(VAULT, ".vaultite", f); return { p, was: existsSync(p) ? readFileSync(p, "utf8") : null } }
const sidebars = keep("sidebars.json"), look = keep("appearance.json"), hotkeys = keep("hotkeys.json"), newtab = keep("newtab.json")
// (the web app gives ⌘T no keys, the browser's: these show its row's keycaps)
writeFileSync(hotkeys.p, JSON.stringify({ ...JSON.parse(hotkeys.was ?? "{}"), "tab:new": ["Mod+Shift+Y"] }) + "\n")
const spare = [1, 2, 3, 4].map((i) => `Notes/New tab row ${i}.md`)
for (const p of spare) writeFileSync(path.join(VAULT, p), `# New tab row ${p.slice(-4, -3)}\n`)
const lookNow = () => JSON.parse(look.was ?? "{}")
writeFileSync(sidebars.p, JSON.stringify({ left: ["tabs:tabs", "pages:pages", "files:files"], right: [], collapsed: [] }) + "\n")
writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true, paneTitles: true }) + "\n")
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
  const selected = () => page.$eval("[data-tab-bar] [role=tab][aria-selected=true]", (e) => e.textContent.trim()).catch(() => null)
  check("the shown tab is marked", r?.filter((x) => x.on).length === 1 && r.find((x) => x.on).label === await selected(), [r, await selected()])

  const pick = r.find((x) => !x.on)
  await page.click(`[data-open-tab="${pick.id}"]`)
  check("a click on a row shows its tab", !!await until(async () => (await selected()) === pick.label, 3000), await selected())

  const n = r.length
  await page.hover(`[data-open-tab="${r[1].id}"]`)
  await page.click(`[data-open-tab="${r[1].id}"] button[aria-label^=Close]`); await wait(300)
  check("its X closes the tab", (await rows()).length === n - 1 && (await barTabs()).length === n - 1, [await rows(), await barTabs()])
  await page.screenshot({ path: `${OUT}panel.png` })

  // The New tab row ends the tabs: a tab row's size and indent, its keys on hover; the heading has no + of its own.
  const NEW = "[data-tabs-panel] [data-new-tab-row]"
  const ids = () => page.$$eval("[data-open-tabs] [data-open-tab]", (els) => els.map((e) => e.dataset.openTab))
  const geo = () => page.evaluate(() => {
    const tabs = [...document.querySelectorAll("[data-open-tabs] [data-open-tab]")], row = document.querySelector("[data-tabs-panel] [data-new-tab-row]")
    const r = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), h: Math.round(b.height) } }
    return { last: r(tabs.at(-1)), row: row && { ...r(row), label: row.textContent, after: !!(tabs.at(-1).compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) } }
  })
  const fill = (p) => page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, p).then(() => wait(500))
  let g = await geo()
  check("a New tab row ends the tabs, a tab row's size and indent", g.row?.label.startsWith("New tab") && g.row.after && g.row.h === g.last.h && g.row.left === g.last.left && g.row.top > g.last.top, g)
  check("… the heading has no + of its own", !(await page.$("[data-tabs-panel] [data-heading=Tabs] button[aria-label='New tab']")))
  await page.hover(NEW); await wait(400)
  const caps = await page.$eval(NEW, (e) => { const k = e.querySelector("kbd")?.parentElement; return k ? { text: k.textContent, opacity: getComputedStyle(k).opacity } : null })
  check("… its keys show on hover", caps?.opacity === "1" && caps.text.length > 1, caps)
  await page.screenshot({ path: `${OUT}new-tab-row.png` })

  // A click: a blank tab at the end, in the row's place, though the first tab is the one on screen.
  let before = await ids()
  await page.click(`[data-open-tab="${before[0]}"]`); await wait(300)
  await page.click(NEW)
  let after = await until(async () => { const x = await ids(); return x.length === before.length + 1 ? x : null }, 3000)
  check("a click opens a blank tab at the list's end", after?.slice(0, -1).join() === before.join() && (await rows()).at(-1)?.on && await page.evaluate(() => location.hash) === "#new", [before, after])
  const was = g.row.top
  await wait(500) // (the new row grows in)
  g = await geo()
  check("… in the row's place", g.last.top === was && g.row.top > was, [was, g])
  await fill(spare[0])

  // ⌘T (tab:new, its keys here) still opens it beside the tab on screen.
  before = await ids()
  await page.click(`[data-open-tab="${before[0]}"]`); await wait(300)
  await page.keyboard.press("ControlOrMeta+Shift+KeyY")
  after = await until(async () => { const x = await ids(); return x.length === before.length + 1 ? x : null }, 3000)
  check("⌘T still opens one beside the tab on screen", after?.[0] === before[0] && after[1] !== before[1] && (await rows())[1]?.on, [before, after])
  await fill(spare[1])

  // A double-click under the list (Tabs the sidebar's last panel: the room under it) opens one at the end too.
  writeFileSync(sidebars.p, JSON.stringify({ left: ["pages:pages", "tabs:tabs"], right: [], collapsed: [] }) + "\n")
  await until(() => page.evaluate(() => [...document.querySelectorAll("[data-sidebar-body=left] > [data-panel]")].at(-1)?.dataset.panel === "tabs:tabs"), 8000)
  await wait(300)
  before = await ids()
  await page.click(`[data-open-tab="${before[0]}"]`); await wait(300)
  const under = await page.evaluate(() => {
    const body = document.querySelector("[data-sidebar-body=left]").getBoundingClientRect(), row = document.querySelector("[data-tabs-panel] [data-new-tab-row]").getBoundingClientRect()
    const x = Math.round(body.left + 40), y = Math.round(Math.min(body.bottom - 12, row.bottom + 80))
    const at = document.elementFromPoint(x, y)
    return { x, y, at: at?.matches("[data-sidebar-body], [data-panel], [data-panel-scroll]") ?? false }
  })
  await page.mouse.dblclick(under.x, under.y)
  after = await until(async () => { const x = await ids(); return x.length === before.length + 1 ? x : null }, 3000)
  check("a double-click under the list opens a tab at its end", under.at && after?.slice(0, -1).join() === before.join() && (await rows()).at(-1)?.on, [under, before, after])
  await fill(spare[2])

  // newtab.json `opens: switcher`: the row opens the switcher (no tab yet), whose pick opens at the list's end.
  writeFileSync(newtab.p, JSON.stringify({ opens: "switcher" }) + "\n"); await wait(1500)
  before = await ids()
  await page.click(`[data-open-tab="${before[0]}"]`); await wait(300)
  await page.click(NEW)
  const SEARCH = '[role="dialog"][aria-label="Search"]'
  check("opens switcher: the row opens the switcher, no tab yet", !!(await until(() => page.$(SEARCH), 8000)) && (await ids()).length === before.length)
  await page.fill(`${SEARCH} input`, "New tab row 4")
  await until(async () => (await page.$$eval("#palette-results [role=option]", (els) => els.map((e) => e.textContent.trim())))[0]?.startsWith("New tab row 4"))
  await page.keyboard.press("Enter")
  after = await until(async () => { const x = await ids(); return x.length === before.length + 1 ? x : null }, 4000)
  const end = (await rows()).at(-1)
  check("… its pick opens at the list's end", after?.slice(0, -1).join() === before.join() && end?.on && end.label.startsWith("New tab row 4"), [before, after, end])
  rmSync(newtab.p, { force: true })
  writeFileSync(sidebars.p, JSON.stringify({ left: ["tabs:tabs", "pages:pages", "files:files"], right: [], collapsed: [] }) + "\n")
  await until(() => page.evaluate(() => document.querySelector("[data-sidebar-body=left] > [data-panel]")?.dataset.panel === "tabs:tabs"), 8000)

  // A phone's drawer has the row too (no hover there: always drawn), and a tap opens a tab.
  const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
  await phone.goto(B)
  await phone.locator("[data-phone-header] button[aria-label='Open sidebar']").tap({ timeout: 30000 }); await wait(700)
  const prow = phone.locator("[data-phone-drawer] [data-new-tab-row]")
  check("phone: the drawer's Tabs ends in the New tab row", await prow.isVisible(), await prow.count())
  await phone.screenshot({ path: `${OUT}phone-drawer.png` })
  await prow.tap(); await wait(1200)
  check("phone: a tap opens a new tab", await phone.evaluate(() => location.hash) === "#new" && !(await phone.locator("[data-phone-drawer] [data-new-tab-row]").isVisible()), await phone.evaluate(() => location.hash))
  await phone.close()

  // The bar off, live.
  writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: false, paneTitles: true }) + "\n")
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

  // Nor pane titles: a note's bar is its pane's title row.
  writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: false, paneTitles: false }) + "\n")
  const bare = await until(async () => (await page.$$("[data-bare][data-merged]")).length === 2, 8000)
  // Both show notes, whose bar is then the pane's title row: no strip over it, clear of the sidebars' toggles.
  const tops = await page.$$eval("[data-group]", (els) => {
    const toggles = [...document.querySelectorAll("[data-sidebar-toggle]")].map((t) => t.getBoundingClientRect())
    return els.map((s) => {
      const strip = s.querySelector("[data-bare]").getBoundingClientRect(), bar = [...s.querySelectorAll("[data-view-bar]")].map((b) => b.getBoundingClientRect()).find((r) => r.width)
      const covered = [...s.querySelectorAll("[data-view-bar] button")].some((b) => { const r = b.getBoundingClientRect()
        return toggles.some((t) => t.width && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top) })
      return { strip: strip.height, top: bar ? Math.round(bar.top - s.getBoundingClientRect().top) : null, covered }
    })
  })
  check("paneTitles false: a note's bar is its pane's title row, no strip or title", bare && tops.every((t) => t.strip === 0 && t.top === 0 && !t.covered) && !(await page.$("[data-pane-title]")), tops)
  await page.screenshot({ path: `${OUT}bare.png` })

  // Back on.
  writeFileSync(look.p, JSON.stringify({ ...lookNow(), tabBar: true }) + "\n")
  check("tabBar true again: the tabs come back", !!(await until(async () => (await page.$$("[data-tab-bar] [role=tab]")).length > 0, 8000)))
} finally {
  await browser.close()
  for (const f of [sidebars, look, hotkeys, newtab]) if (f.was === null) rmSync(f.p, { force: true }); else writeFileSync(f.p, f.was)
  for (const p of spare) rmSync(path.join(VAULT, p), { force: true })
}
await done()
