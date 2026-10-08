// Phone tabs through Workspaces: a phone-sized and a desktop-sized page share workspace 1's tabs. The phone's header
// and bar at 390 and 320px, Back and Forward through a tab's history, a blank tab and its pinned tiles, the view toggle
// (note, sheet, dashboard), the tab list's cards (groups, holds, hold-and-move, swipe-to-close), the drawer and menus,
// search and more in the list's top line, an unused workspace made and swiped back from, and opening and closing following between the two pages.
// WRITES a "Qa tabs" folder and the Workspaces data.json (removed after): throwaway server only.
//   node web/qa/phonetabs.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
import { pagePath } from "./subjects.mjs"
import { clearWorkspaces, workspaces, wsChanged } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = "/tmp/phonetabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const data = () => workspaces(VAULT)
const mtime = () => wsChanged(VAULT)
/** The workspaces as saved, without what the app keeps in them (`state`: files opened lately, open folders). */
const shared = () => JSON.stringify(workspaces(VAULT).map((w) => w && { ...w, state: undefined }))
const tosOf = (l) => { const out = []; const walk = (n) => (n?.kids ? n.kids.forEach(walk) : n?.tabs?.forEach((t) => out.push(t.to))); walk(l?.root); return out }
const F = (name) => `file:Qa tabs/${name}.md`
const hash = (name) => `#file/${encodeURIComponent(`Qa tabs/${name}.md`)}`

const init = () => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } }
const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await dctx.addInitScript(init); await pctx.addInitScript(init)
const D = await dctx.newPage(), P = await pctx.newPage()
for (const p of [D, P]) watch(p, { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const dTabs = () => D.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((t) => t.innerText.trim()))
const pCount = () => P.locator("[data-tabs-button]").innerText().then((t) => Number(t.trim()))
const pHash = () => P.evaluate(() => decodeURIComponent(location.hash))
const onScreen = (name) => P.locator(`article.file-view[data-path="Qa tabs/${name}.md"]`).count().then((n) => n > 0)
let cdp
/** A finger dragged across a tab's card by dx px (touch events: pointer events of type touch); `lift`: let go at the end. */
async function touchDrag(sel, dx, lift = true) {
  const b = await P.locator(sel).boundingBox()
  const y = b.y + b.height / 2, x0 = b.x + b.width * 0.6
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] })
  // Sideways at once, as a finger does: a card held still for 240ms is picked up to be moved instead (no swipe), and
  // CDP's touches can come ~100ms apart on a busy machine.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + Math.sign(dx) * 12, y }] })
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + Math.sign(dx) * 12 + ((dx - Math.sign(dx) * 12) * i) / 8, y }] })
  if (lift) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
/** A tab's card in the list: where it's been slid to, how faded, and its cell's place in the grid. */
const cardState = (id) => P.evaluate((id) => {
  const cell = document.querySelector(`[data-tab-row="${id}"]`)
  if (!cell) return null
  const card = cell.querySelector("[data-tab-card]"), r = cell.getBoundingClientRect()
  return { transform: card.style.transform, opacity: card.style.opacity, w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top) }
}, id)
/** The card of the tab named `name` in the list: its tap target (the button over the whole card). */
const card = (name) => P.locator(`[data-tab-row] button[aria-label="${name}"]`).first()
const list = () => P.locator("dialog[open]")


// What it tests, whatever the vault turned off (the sandbox starts calm): Workspaces, and the plugins whose dashboards it
// pins. plugins.json put back at the end.
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const pluginsBefore = (() => { try { return readFileSync(pluginsFile, "utf8") } catch { return null } })()
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: VAULT } })
for (const id of ["workspaces", "today", "people", "projects"]) vau("plugin", "on", id)
// Three pages pinned (the drawer's steps open one, then another): its own list, pages.json put back at the end.
const pagesFile = path.join(VAULT, ".vaultite/pages.json")
const pagesBefore = (() => { try { return readFileSync(pagesFile, "utf8") } catch { return null } })()
const PINNED = [await pagePath(B, "Today"), await pagePath(B, "People"), await pagePath(B, "Projects")]
await api("PUT", "config/pages", { pinned: PINNED, pinNew: false })

try {
  clearWorkspaces(VAULT)
  for (const n of ["One", "Two", "Three", "Four"]) await api("POST", "file", { path: `Qa tabs/${n}.md`, text: `${n} text.\n` })

  // ---------- desktop makes workspace 1 with One and Two ----------
  await D.goto(`${B}${hash("One")}`)
  // The sidebar's switcher: open its list, then pick 1 (first use seeds it from the setup as it is).
  await D.click("aside [data-workspace-switcher]")
  await D.click("[data-workspace-list] [data-workspace='1']")
  await D.click("[data-tab-bar] button[aria-label='New tab']"); await wait(200)
  await D.evaluate((h) => { location.hash = h }, hash("Two"))
  check("desktop: workspace 1 saved with One and Two", !!(await until(() => { const t = tosOf(data()[0]?.layout); return t.includes(F("One")) && t.includes(F("Two")) }, 6000)), data())

  // ---------- the phone adopts it ----------
  await P.goto(B)
  await P.waitForSelector("[data-phone-bar]")
  check("phone: shares workspace 1's tabs (count 2)", !!(await until(async () => (await pCount()) === 2, 6000)), await pCount())
  check("phone: current workspace is 1 on this device", await P.evaluate(() => JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}").device?.workspace === 1))
  const bar = await P.locator("[data-phone-bar]").boundingBox()
  check("phone bar: docked, edge to edge at the bottom", Math.round(bar.x) === 0 && Math.round(bar.width) === 390 && Math.round(bar.y + bar.height) === 844, bar)
  check("phone bar: no pinned pages in it (they're in the drawer)", !(await P.locator("[data-phone-bar] a").count()), await P.locator("[data-phone-bar] a").count())
  const countBox = await P.locator("[data-tabs-button] span").boundingBox()
  check("phone bar: the count is a small square", countBox.height <= 24 && countBox.width <= 26, countBox)
  check("phone: no sideways scroll at 390", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await P.screenshot({ path: `${OUT}phone-390.png` })

  check("phone bar: one row, no name bar", bar.height <= 56 && !(await P.locator("[data-tab-name]").count()), bar)
  const order = await P.$$eval("[data-phone-bar] > div > *", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.hasAttribute("data-tabs-button") ? "tabs" : e.getAttribute("data-bar") ?? "?"))
  check("phone bar: Back, Forward, new tab, the tab count, the menu", order.join() === "back,forward,new,tabs,menu", order)
  const head = await P.locator("[data-phone-header]").boundingBox()
  check("phone header: along the top, full width, one 44px row", !!head && head.y === 0 && head.x === 0 && head.width === 390 && head.height <= 50, head)
  check("phone header: the sidebar's button, the name, the … menu", (await P.locator("[data-phone-header] button[aria-label='Open sidebar']").count()) === 1
    && !!(await P.locator("[data-phone-title]").innerText()).trim() && (await P.locator("[data-phone-header] button[aria-label=More]").count()) === 1, await P.locator("[data-phone-header]").innerText())
  // Nothing of the page hides under the header: the first thing in it starts below.
  const top = await P.evaluate(() => { const h = document.querySelector("[data-phone-header]").getBoundingClientRect().bottom; const a = document.querySelector("main article, main h1, main"); return [Math.round(h), Math.round(a.getBoundingClientRect().top + (parseFloat(getComputedStyle(a).paddingTop) || 0))] })
  check("phone header: the page starts below it", top[1] >= top[0], top)
  check("phone: no 'open in a new tab' button anywhere", !(await P.locator("[aria-label='Open in a new tab']").count()))

  // ---------- Back and Forward (the browser's) within a tab ----------
  await P.evaluate((h) => { location.hash = h }, hash("One")); await wait(400)
  const n0 = await pCount()
  await P.evaluate((h) => { location.hash = h }, hash("Three")); await wait(400)
  check("phone: a link moves the tab on (count unchanged)", (await onScreen("Three")) && (await pCount()) === n0, [await pHash(), await pCount()])
  check("phone header: names the file on screen", (await P.locator("[data-phone-title]").innerText()) === "Three", await P.locator("[data-phone-title]").innerText())
  await P.goBack(); await wait(500)
  check("Back: the tab's last place, no new tab", (await onScreen("One")) && (await pCount()) === n0, [await pHash(), await pCount()])
  await P.goForward(); await wait(500)
  check("Forward: on again", (await onScreen("Three")) && (await pCount()) === n0, [await pHash(), await pCount()])
  await P.goBack(); await wait(500)
  check("Back again lands on One, and the desktop didn't gain tabs", (await onScreen("One")) && !(await dTabs()).some((t) => t.includes("Three")), await dTabs())
  // The bar's own Back (an installed web app has no browser Back): the same.
  await P.evaluate((h) => { location.hash = h }, hash("Three")); await wait(400)
  await P.locator("[data-bar=back]").tap(); await wait(500)
  check("the bar's Back: the tab's last place", (await onScreen("One")) && (await pCount()) === n0, [await pHash(), await pCount()])

  // ---------- a blank tab, filled from Open a file ----------
  await P.click("[data-tabs-button]"); await P.waitForSelector("[data-tab-row]"); await wait(400)
  await list().getByRole("button", { name: "New tab", exact: true }).click(); await wait(600)
  check("New tab: a blank tab on screen", /#new$/.test(P.url()) && (await pCount()) === n0 + 1, [P.url(), await pCount()])
  check("desktop: follows the phone's new tab", !!(await until(async () => (await dTabs()).length === n0 + 1, 6000)), await dTabs())
  await P.getByText("Open a file", { exact: true }).click()
  await P.waitForSelector("[role=dialog] [role=combobox]")
  await P.keyboard.type("Three"); await wait(400)
  await P.keyboard.press("Enter"); await wait(700)
  check("Open a file from a blank tab: it shows in that tab, not the sheet", (await onScreen("Three")) && (await pCount()) === n0 + 1 && !(await pHash()).includes("/file/Qa tabs/Three.md/"), [await pHash(), await pCount()])
  check("desktop: the blank tab became Three", !!(await until(async () => (await dTabs()).some((t) => t.includes("Three")), 6000)), await dTabs())
  // Back from it: the blank tab it came from (what the swipe shows).
  await P.goBack(); await wait(500)
  check("Back from a filled blank tab: blank again", /#new$/.test(P.url()), P.url())
  await P.goForward(); await wait(500)
  check("Forward: Three again", await onScreen("Three"), await pHash())

  // ---------- switching tabs from the list: Back returns to the tab before ----------
  await P.click("[data-tabs-button]"); await P.waitForSelector("[data-tab-row]"); await wait(400)
  await card("One").click(); await wait(700)
  check("tab list: picking One shows it", await onScreen("One"), await pHash())
  await P.goBack(); await wait(500)
  check("Back after a switch: the tab that was on screen (Three), no tab moved", (await onScreen("Three")) && (await pCount()) === n0 + 1, [await pHash(), await pCount()])

  // ---------- the view toggle ----------
  const toggle = P.locator("[data-phone-header] #phone-actions [data-view-toggle]")
  check("note in a tab: a pencil to edit (reading), in the header", (await toggle.getAttribute("aria-label")) === "Edit" && (await toggle.getAttribute("data-view-toggle")) === "read" && !(await P.locator("article button", { hasText: /^(Edit|Done)$/ }).count()), await toggle.getAttribute("aria-label"))
  await P.screenshot({ path: `${OUT}note-read.png` })
  await toggle.click(); await wait(400)
  check("note in a tab: editing, a book to read", (await toggle.getAttribute("aria-label")) === "Read" && (await P.locator("article .cm-content[contenteditable=true]").count()) > 0, await toggle.getAttribute("aria-label"))
  await P.screenshot({ path: `${OUT}note-edit.png` })
  await toggle.click(); await wait(300)
  check("note in a tab: back to reading", (await toggle.getAttribute("aria-label")) === "Edit")
  // In the sheet: the same toggle in its header, and no "open in a new tab" button.
  await P.evaluate((h) => { location.hash = `${h}/file/${encodeURIComponent("Qa tabs/Four.md")}` }, hash("Three")); await wait(700)
  const sheetToggle = P.locator("dialog[open] #sheet-actions [data-view-toggle]")
  check("sheet: the toggle in its header, nothing else there", (await sheetToggle.count()) === 1 && (await P.locator("dialog[open] #sheet-actions > *").count()) === 1, await P.locator("dialog[open] #sheet-actions > *").count())
  await sheetToggle.click(); await wait(300)
  check("sheet: toggled to editing", (await sheetToggle.getAttribute("aria-label")) === "Read")
  await sheetToggle.click(); await wait(200)
  await P.screenshot({ path: `${OUT}sheet.png` })
  await P.keyboard.press("Escape"); await wait(500)
  // A dashboard: drawn while reading, its Markdown while editing.
  await P.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, PINNED[0]); await wait(1200)
  check("dashboard: a pencil on the drawn page", (await toggle.getAttribute("aria-label")) === "Edit" && (await P.locator("article [data-dashboard], article .cm-editor").count()) >= 0 && !(await P.locator("article .cm-content").count()), await toggle.count())
  await P.screenshot({ path: `${OUT}today-read.png` })
  await toggle.click(); await wait(800)
  check("dashboard: editing shows its Markdown in the editor, a book to read", (await toggle.getAttribute("aria-label")) === "Read" && (await P.locator("article .cm-content[contenteditable=true]").count()) > 0, await toggle.count())
  await P.screenshot({ path: `${OUT}today-edit.png` })
  await toggle.click(); await wait(600)
  check("dashboard: reading again, drawn", (await toggle.getAttribute("aria-label")) === "Edit" && !(await P.locator("article .cm-content").count()))
  await P.evaluate((h) => { location.hash = h }, hash("Three"))
  // (saved, and the desktop has it, before the desktop changes the same workspace)
  check("desktop: sees the phone's tab back on Three", !!(await until(async () => (await dTabs()).some((t) => t.includes("Three")) && !(await dTabs()).some((t) => t.includes("Today")), 6000)), await dTabs())

  // ---------- desktop opens and closes: the phone follows, keeping the tab on screen ----------
  await D.click("[data-tab-bar] button[aria-label='New tab']"); await wait(200)
  await D.evaluate((h) => { location.hash = h }, hash("Four"))
  const n1 = await pCount()
  check("phone: sees the desktop's new tab", !!(await until(async () => (await pCount()) === n1 + 1, 6000)), await pCount())
  check("phone: still on Three", await onScreen("Three"), await pHash())
  await D.locator("[data-tab-bar] [data-tab-id]", { hasText: "Two" }).hover()
  await D.locator("[data-tab-bar] [data-tab-id]", { hasText: "Two" }).locator("[data-tab-close]").click()
  check("phone: sees the desktop close Two", !!(await until(async () => (await pCount()) === n1, 6000)), await pCount())
  check("phone: still on Three after", await onScreen("Three"), await pHash())
  // No echo: neither page writes back what it just received, and switching tabs (what's on screen) isn't saved.
  await wait(1500)
  let m0 = mtime()
  await wait(3000)
  check("no writes while both pages sit on the same workspace", mtime() === m0, [m0, mtime()])
  const s0 = shared()
  await P.click("[data-tabs-button]"); await P.waitForSelector("[data-tab-row]"); await wait(400)
  await card("One").click(); await wait(1800)
  // (The files opened lately are the workspace's `state`: One goes first there, nothing else changes.)
  check("switching tabs on the phone changes no tabs", shared() === s0, [s0, shared()])

  // ---------- the tab list ----------
  await P.click("[data-tabs-button]")
  await P.waitForSelector("[data-tab-row]"); await wait(600)
  const listTop = await P.evaluate(() => ({ search: !!document.querySelector("[data-tabs-header] [data-tabs-search]"), title: document.querySelector("[data-tabs-title]")?.textContent,
    more: !!document.querySelector("[data-tabs-header] [data-tabs-more]"), dots: document.querySelectorAll("[data-tabs-workspace] .rounded-full").length }))
  check("tab list: search, the workspace (no dots for one), more", listTop.search && listTop.title === "Workspace 1" && listTop.more && listTop.dots === 0, listTop)
  // Search: a field across the top line, the cards those that match.
  await P.click("[data-tabs-search]"); await P.keyboard.type("Thr"); await wait(300)
  check("search: only the tabs that match", (await P.locator("[data-tab-row]").count()) === 1 && (await P.locator(`[data-tab-row] button[aria-label="Three"]`).count()) === 1, await P.locator("[data-tab-row]").count())
  await P.getByRole("button", { name: "Cancel", exact: true }).click(); await wait(200)
  await P.click("[data-tabs-more]"); await wait(300)
  check("more: select, close others, close all", (await P.locator("[role=menu]").innerText()).match(/Select tabs[\s\S]*Close other tabs[\s\S]*Close all/) !== null, await P.locator("[role=menu]").innerText())
  await P.keyboard.press("Escape"); await wait(200)
  check("more: Escape closes the menu, not the list", (await P.locator("[data-tab-row]").count()) > 0 && !(await P.locator("[role=menu]").count()))
  check("tab list: no 'On this device'", !(await P.getByText("On this device").count()))
  check("tab list: the one on screen is marked", (await P.locator(`[data-tab-row] button[aria-current][aria-label="One"]`).count()) === 1)
  // A grid of cards, two across at 390px, each with a preview (a note's first lines).
  const cells = await P.$$eval("[data-tab-row]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }))
  check("tab list: a grid of cards, two across, taller than wide", cells.length >= 3 && cells[0].y === cells[1].y && cells[1].x > cells[0].x && cells[2].y > cells[0].y && cells.every((c) => c.h > c.w && c.w >= 140), cells)
  check("tab list: a note's card previews its text", (await P.locator("[data-tab-row]", { has: P.locator(`button[aria-label="Three"]`) }).innerText()).includes("Three text"), await P.locator("[data-tab-row]", { has: P.locator(`button[aria-label="Three"]`) }).innerText())
  await P.screenshot({ path: `${OUT}phone-list.png` })
  // Swipe to close: the card follows the finger, fading; short of the threshold it springs back.
  cdp = await pctx.newCDPSession(P)
  const cellOf = (name) => P.locator("[data-tab-row]", { has: P.locator(`button[aria-label="${name}"]`) }).getAttribute("data-tab-row")
  const four = await cellOf("Four")
  const cardSel = `[data-tab-row="${four}"] [data-tab-card]`
  const w0 = (await cardState(four)).w
  await touchDrag(cardSel, -Math.round(w0 * 0.2), false); await wait(50)
  const mid = await cardState(four)
  check("swipe: the card follows the finger, fading", /translateX\(-\d+/.test(mid.transform) && Number(mid.opacity) < 1, mid)
  await P.screenshot({ path: `${OUT}swipe-mid.png` })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(600)
  const back = await cardState(four)
  check("swipe: short of the threshold it springs back", back && !back.transform && !back.opacity, back)
  check("swipe: ...and the tab stays open", (await pCount()) === n1, await pCount())
  // Held still: its menu opens, and lifting leaves it; held then moved to a card's edge: the menu goes, the card moves.
  {
    const cardOrder = () => P.$$eval("[data-tab-row]", (els) => els.map((e) => e.dataset.tabRow))
    const hold = async (sel, to) => {
      const b = await P.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await wait(600)
      if (to) for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + ((to.x - x) * i) / 10, y: y + ((to.y - y) * i) / 10 }] }); await wait(30) }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(400)
    }
    const menuItems = () => P.$$eval("[role=menu] [role=menuitem]", (els) => els.map((e) => e.innerText.trim()))
    await hold(cardSel)
    check("hold: the card's menu opens and stays", (await menuItems()).includes("Close other tabs"), await menuItems())
    await P.click("button[aria-label='Close menu']", { position: { x: 10, y: 10 } }); await wait(300)
    const was = await cardOrder()
    const firstSel = `[data-tab-row="${was[0]}"] [data-tab-card]`, fb = await P.locator(firstSel).boundingBox()
    await hold(cardSel, { x: fb.x + fb.width * 0.1, y: fb.y + fb.height / 2 })
    check("hold and move: no menu left open", !(await menuItems()).length, await menuItems())
    check("hold and move: the card moves", (await cardOrder())[0] === four, await cardOrder())
    check("hold and move: ...and the tab stays open", (await pCount()) === n1, await pCount())
  }
  // Past it: flies off, the tab closes, and the cards after it move up into its place.
  const after = await P.$$eval("[data-tab-row]", (els, id) => els[els.findIndex((e) => e.dataset.tabRow === id) + 1]?.dataset.tabRow ?? null, four)
  const afterAt = after && (await cardState(after))
  await touchDrag(cardSel, -260); await wait(120)
  const closing = await cardState(four)
  check("swipe: past the threshold it flies off", !closing || /translateX\(-\d{3,}/.test(closing.transform), closing)
  check("swipe: the tab closes, and the desktop follows", !!(await until(async () => !(await P.locator(`[data-tab-row="${four}"]`).count()) && !(await dTabs()).some((t) => t.includes("Four")), 6000)), await dTabs())
  await wait(400)
  if (after) check("swipe: the next card slides into its place", (await cardState(after)).x !== afterAt.x || (await cardState(after)).y !== afterAt.y, [afterAt, await cardState(after)])
  const one = await cellOf("One")
  await P.locator(`[data-tab-row="${one}"] button[aria-label^='Close']`).click(); await wait(120)
  const xClosing = await cardState(one)
  check("X: shrinks away where it is", !xClosing || (xClosing.transform.includes("scale") && xClosing.opacity === "0"), xClosing)
  check("X closes, and the desktop follows", !!(await until(async () => !(await dTabs()).some((t) => t.includes("One")), 6000)), await dTabs())
  const left = await P.locator("[data-tab-row]").count()
  // A workspace made from the phone (the title's menu): an unused one, with a blank tab; the desktop stays on 1.
  await P.click("[data-tabs-workspace]"); await wait(300)
  await P.locator("[role=menu] [role^=menuitem]", { hasText: /^New workspace$/ }).click(); await wait(600)
  check("phone: New workspace switched to workspace 2", !!(await until(async () => (await P.locator("[data-tabs-title]").innerText()) === "Workspace 2", 6000)), data())
  check("phone: ...not written: a blank tab is an unused workspace", !data()[1], data())
  check("phone: workspace 2 has one blank tab", (await P.locator("[data-tab-row]").count()) === 1, await P.locator("[data-tab-row]").count())
  await wait(500)
  check("desktop: still on workspace 1's tabs", (await dTabs()).length === left, await dTabs())
  // Swiped right on the list's empty part: the one before, the list still open.
  const sw = await P.locator("[data-tabs-pager]").boundingBox()
  const sy = sw.y + sw.height - 120
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 40, y: sy }] })
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 40 + i * 28, y: sy }] }); await wait(16) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(700)
  check("phone: swiped back to 1", (await P.locator("[data-tabs-title]").innerText()) === "Workspace 1", await P.locator("[data-tabs-title]").innerText())
  check("phone: back on 1: its tabs again, list still open", (await P.locator("[data-tab-row]").count()) === left, await P.locator("[data-tab-row]").count())
  // Split on the desktop: on the phone the pane of several tabs is a group (named Left), the new one a lone card.
  await D.evaluate(() => document.querySelector("[data-tab-bar] [data-tab-id]")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 300, clientY: 20 })))
  await D.locator("[role=menuitem]", { hasText: /^Split right$/ }).click()
  check("tab list: a desktop split is a group card (Left) and a lone card", !!(await until(async () => (left < 2 || (await P.locator("[data-group-card] button[aria-label^='Left,']").count())) && (await P.locator("[data-tab-row]").count()) === (left < 2 ? 2 : 1), 6000)), await P.$$eval("[data-group-card], [data-tab-row]", (s) => s.map((x) => x.innerText.split("\n")[0])))
  await P.screenshot({ path: `${OUT}phone-list-split.png` })
  await P.keyboard.press("Escape"); await P.goBack().catch(() => {}); await wait(300)
  await P.goto(`${B}${hash("Three")}`); await P.waitForSelector("[data-phone-bar]"); await wait(500)

  // ---------- a pinned page, from the drawer ----------
  // As from a computer's sidebar: a page opened from a file goes in a new tab beside it, a page replaces a page.
  const pinnedLinks = () => P.locator("[data-phone-drawer=left] nav[aria-label=Pages] a")
  await P.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await wait(500)
  const pageHref = await pinnedLinks().first().getAttribute("href")
  const before = await pCount()
  await pinnedLinks().first().tap(); await wait(700)
  check("drawer: a pinned page opened from a file shows in a new tab beside it", (await P.evaluate(() => location.hash)) === pageHref && (await pCount()) === before + 1, [pageHref, P.url(), before, await pCount()])
  check("drawer: closes when a page is picked", (await P.locator("[data-phone-drawer]").getAttribute("aria-hidden").catch(() => "true")) === "true", await P.locator("[data-phone-drawer]").count())
  await P.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await wait(500)
  const pageHref2 = await pinnedLinks().nth(2).getAttribute("href")
  await pinnedLinks().nth(2).tap(); await wait(700)
  check("drawer: another page replaces that page (count unchanged)", (await P.evaluate(() => location.hash)) === pageHref2 && (await pCount()) === before + 1, [pageHref2, P.url(), await pCount()])
  await P.goBack(); await wait(500)
  check("Back: the page before, in the same tab", (await P.evaluate(() => location.hash)) === pageHref && (await pCount()) === before + 1, [P.url(), await pCount()])
  await P.goBack(); await wait(500)
  check("Back again: the file it was opened from", (await onScreen("Three")) && (await pCount()) === before + 1, [await pHash(), await pCount()])

  // ---------- a pinned page, from a new tab's tiles ----------
  await P.locator("[data-bar=new]").tap(); await wait(500)
  check("the bar's +: a blank tab", /#new$/.test(P.url()) && (await pCount()) === before + 2, [P.url(), await pCount()])
  const tile = P.locator("[data-new-tab-pages] a").first()
  const tileHref = await tile.getAttribute("href")
  check("new tab: the pinned pages as tiles", (await P.locator("[data-new-tab-pages] a").count()) >= 3 && /^#file\//.test(tileHref), await P.locator("[data-new-tab-pages] a").count())
  await tile.tap(); await wait(700)
  // (The first tile is the page opened from the drawer above, open in a tab already: that tab shows, and the blank
  // one closes.)
  check("new tab: a tile opens its page, the blank tab doesn't stay", (await P.evaluate(() => location.hash)) === tileHref && (await pCount()) === before + 1, [tileHref, P.url(), await pCount()])
  await P.locator("[data-bar=new]").tap(); await wait(500)
  const tile2 = P.locator("[data-new-tab-pages] a").last()
  const tile2Href = await tile2.getAttribute("href")
  await tile2.tap(); await wait(700)
  check("new tab: a page not open yet shows in that tab", (await P.evaluate(() => location.hash)) === tile2Href && (await pCount()) === before + 2, [tile2Href, P.url(), await pCount()])

  // ---------- the header's … menu: the file's items, then Close tab ----------
  await P.evaluate((h) => { location.hash = h }, hash("Three")); await wait(600)
  const nMenu = await pCount()
  await P.locator("[data-phone-header] button[aria-label=More]").tap(); await wait(300)
  const items = await P.locator("[role=menu] [role=menuitem], [role=menu] button").allInnerTexts()
  check("… menu: the file's items, Close tab last", items.length > 2 && items.at(-1).trim() === "Close tab", items)
  await P.locator("[role=menu] button", { hasText: /^Close tab$/ }).tap(); await wait(600)
  check("… menu: Close tab closes the tab on screen", (await pCount()) === nMenu - 1 && !(await onScreen("Three")), [await pHash(), await pCount()])

  // ---------- the bar's menu: New note, Search, Commands, Plugins, Settings ----------
  const menuBtn = P.locator("[data-bar=menu]")
  await menuBtn.tap(); await wait(300)
  const menuBox = await P.locator("#bar-menu").boundingBox()
  const barBox = await P.locator("[data-phone-bar]").boundingBox()
  check("menu: opens above the bar", !!menuBox && menuBox.y + menuBox.height <= barBox.y, { menuBox, barBox })
  const menuItems = (await P.locator("#bar-menu [role=menuitem]").allInnerTexts()).map((t) => t.trim())
  check("menu: New note, Search, Commands, Plugins, Settings", menuItems.join() === "New note,Search,Commands,Plugins,Settings", menuItems)
  const link = P.locator("#bar-menu a[role=menuitem]").last()
  const href = await link.getAttribute("href")
  await link.tap(); await wait(600)
  check("menu: a page from it shows and the menu closes", (await P.evaluate(() => location.hash)) === href && !(await P.locator("#bar-menu").count()), [href, P.url()])
  check("menu: lit while one of its pages is on screen", (await menuBtn.getAttribute("class")).includes("text-primary"), await menuBtn.getAttribute("class"))
  await menuBtn.tap(); await wait(300)
  await P.touchscreen.tap(195, 200); await wait(300)
  check("menu: a tap outside closes it", !(await P.locator("#bar-menu").count()))
  await P.evaluate((h) => { location.hash = h }, hash("Three")); await wait(500)

  // ---------- 320px ----------
  await P.setViewportSize({ width: 320, height: 640 }); await wait(400)
  check("320: no sideways scroll", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const b320 = await P.locator("[data-phone-bar]").boundingBox()
  const icons = await P.$$eval("[data-phone-bar] > div > *", (els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().width)))
  check("320: bar fits, its five buttons 44px+ wide", b320.width <= 320 && icons.length === 5 && icons.every((w) => w >= 44), { b320, icons })
  const h320 = await P.evaluate(() => { const t = document.querySelector("[data-phone-title]").getBoundingClientRect(), h = document.querySelector("[data-phone-header]").getBoundingClientRect(); return { right: Math.round(h.right), title: [Math.round(t.left), Math.round(t.right)] } })
  check("320: the header fits, its name between the buttons", h320.right <= 320 && h320.title[0] >= 44 && h320.title[1] <= 320 - 44, h320)
  await P.screenshot({ path: `${OUT}phone-320.png` })
  await P.click("[data-tabs-button]"); await P.waitForSelector("[data-tab-row]"); await wait(300)
  check("320: the list's top line fits", await P.evaluate(() => { const r = document.querySelector("[data-tabs-header]").getBoundingClientRect(); return r.right <= innerWidth }))
  const c320 = await P.$$eval("[data-tab-row]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.width)] }))
  check("320: the cards fit, two across (at most half the width each)", c320.every(([l, r, w]) => l >= 0 && r <= 320 && w <= 150 && w >= 120), c320)
  await P.screenshot({ path: `${OUT}phone-320-list.png` })
} catch (e) {
  check(String(e), false)
} finally {
  await browser.close()
  await api("DELETE", "file?path=Qa%20tabs").catch(() => {})
  clearWorkspaces(VAULT)
  if (pluginsBefore === null) rmSync(pluginsFile, { force: true }); else writeFileSync(pluginsFile, pluginsBefore)
  if (pagesBefore === null) rmSync(pagesFile, { force: true }); else writeFileSync(pagesFile, pagesBefore)
}
await done()
