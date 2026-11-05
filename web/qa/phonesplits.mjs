// A phone's tab list with a split tab (components/TabSwitcher.tsx) at 390px: one card with its panes side by side, a
// pane tapped shows that pane, its page of pane cards (swap by dragging, swipe or X to close, a menu to take one out, +
// for a new pane), the card menu's Open in split, Swap panes, Separate panes, and the header's menu. WRITES Qa splits/.
//   node web/qa/phonesplits.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/var/tmp/phonesplits-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const NAMES = ["Alpha", "Bravo", "Charlie", "Delta"]
for (const n of NAMES) await api("POST", "file", { path: `Qa splits/${n}.md`, text: `# ${n}\n\n${n} text, a line of it.\n` })
const F = (n) => `file:Qa splits/${n}.md`
const tabs = {
  tabs: [
    { id: "ts", focus: "pa", root: { id: "ss", dir: "row", sizes: [0.5, 0.5], kids: [{ id: "pa", to: F("Alpha") }, { id: "pb", to: F("Bravo") }] } },
    { id: "tc", focus: "pc", root: { id: "pc", to: F("Charlie") } },
    { id: "td", focus: "pd", root: { id: "pd", to: F("Delta") } },
  ], active: "ts",
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await ctx.addInitScript((t) => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); localStorage.setItem("vaultite.tabs", t); sessionStorage.setItem("qa", "1") } }, JSON.stringify(tabs))
const P = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const cdp = await ctx.newCDPSession(P)

/** The tabs as kept: each tab's panes by name, and which tab and pane are on screen. */
const state = () => P.evaluate(() => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs")), leaves = (n) => (n.kids ? n.kids.flatMap(leaves) : [n])
  const name = (to) => to === "new" ? "new" : to.replace(/^file:Qa splits\//, "").replace(/\.md$/, "")
  const t = w.tabs.find((x) => x.id === w.active)
  return { tabs: w.tabs.map((x) => leaves(x.root).map((p) => name(p.to)).join("+")), shown: leaves(t.root).find((p) => p.id === t.focus) && name(leaves(t.root).find((p) => p.id === t.focus).to) }
})
const list = () => P.locator("dialog[open]")
const openList = async () => { await P.locator("[data-tabs-button]").tap(); await P.waitForSelector("dialog[open] [data-tab-row]"); await wait(500) }
const closeList = async () => { await list().getByRole("button", { name: "Done" }).click().catch(() => P.keyboard.press("Escape")); await wait(600) }
const splitCard = () => P.locator("dialog[open] [data-tab-row]", { has: P.locator("[data-mini-pane]") }).first()
/** A card's menu (held: its contextmenu), then the item named `label`. */
async function cardMenu(card, label) {
  await card.dispatchEvent("contextmenu", { bubbles: true })
  await wait(300)
  const items = (await P.locator("[role=menu] [role=menuitem], [role=menu] button").allInnerTexts()).map((t) => t.trim())
  const it = P.locator("[role=menu] [role=menuitem], [role=menu] button", { hasText: new RegExp(`^${label}$`) }).first()
  if (!(await it.count())) { await P.keyboard.press("Escape"); return items }
  await it.click(); await wait(500)
  return items
}
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })

try {
  await P.goto(`${B}#file/${encodeURIComponent("Qa splits/Alpha.md")}`)
  await P.waitForSelector("[data-phone-bar]", { timeout: 30000 })
  await wait(800)

  // ---------- the split's card: its panes side by side ----------
  await openList()
  const minis = await splitCard().locator("[data-mini-pane]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.miniPane, x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } }))
  const cardBox = await splitCard().boundingBox()
  check("split card: its two panes side by side, half the picture each", minis.length === 2 && minis[0].x < minis[1].x && minis.every((m) => m.w > cardBox.width * 0.4 && m.w < cardBox.width * 0.5 && m.h > 100), [minis, cardBox])
  check("split card: says it holds 2 panes", (await splitCard().locator("[data-card-panes]").getAttribute("aria-label")) === "Show 2 panes", await splitCard().locator("[data-card-panes]").getAttribute("aria-label"))
  await P.screenshot({ path: `${OUT}list-split.png` })
  // Tapped on its right half: that pane shows.
  const right = await splitCard().locator("[data-mini-pane='pb']").boundingBox()
  await P.touchscreen.tap(right.x + right.width / 2, right.y + right.height / 2)
  check("tapping a pane's picture shows that pane", !!(await until(async () => !(await list().count()) && (await state()).shown === "Bravo", 4000)), await state())

  // ---------- the split's page ----------
  await openList()
  await splitCard().locator("[data-card-panes]").tap(); await wait(500)
  const paneNames = () => list().locator("[data-tabs-grid] [data-tab-row] [data-tab-card] > button[aria-current], [data-tabs-grid] [data-tab-row] [data-tab-card] > button:first-of-type").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")))
  check("the panes' page: All tabs back, the split's name, a card for each pane", (await list().locator("[data-split-head]").count()) === 1 && (await list().locator("[data-group-back]").innerText()).includes("All tabs")
    && JSON.stringify(await paneNames()) === JSON.stringify(["Alpha", "Bravo"]), await paneNames())
  check("...the pane on screen ringed", (await list().locator("[data-tab-row='pb'] button[aria-current]").count()) === 1)
  check("...its header still counts the tabs (3), not the panes", (await list().locator("[data-tabs-count]").innerText()).trim() === "3", await list().locator("[data-tabs-count]").innerText())
  await P.screenshot({ path: `${OUT}split-page.png` })
  // Dragged onto the other: the two swap.
  const a = await list().locator("[data-tab-row='pa'] [data-tab-card]").boundingBox(), b = await list().locator("[data-tab-row='pb'] [data-tab-card]").boundingBox()
  await touch("touchStart", a.x + a.width / 2, a.y + a.height / 2)
  await wait(450)
  for (let i = 1; i <= 12; i++) { await touch("touchMove", a.x + a.width / 2 + ((b.x - a.x) * i) / 12, a.y + a.height / 2); await wait(20) }
  await wait(250)
  const hint = await P.locator("[data-drag-hint]").innerText().catch(() => "")
  await touch("touchEnd", 0, 0); await wait(600)
  check("dragging a pane onto the other: 'Swap', and they swap", hint === "Swap" && (await state()).tabs[0] === "Bravo+Alpha", [hint, await state()])
  // Its menu: Move to new tab.
  const items = await cardMenu(list().locator("[data-tab-row='pa']"), "Move to new tab")
  check("a pane card's menu: Move to new tab, Close pane", items.includes("Move to new tab") && items.includes("Close pane"), items)
  check("Move to new tab: a tab of its own, the split's page back to all tabs, the tab shown kept",
    !!(await until(async () => { const s = await state(); return s.tabs.join() === "Bravo,Alpha,Charlie,Delta" && s.shown === "Bravo" }, 3000)) && !(await list().locator("[data-split-head]").count()), [await state(), await list().locator("[data-split-head]").count()])

  // ---------- the card menu: Open in split, Swap panes, Separate panes ----------
  const charlie = list().locator("[data-tab-row='tc']")
  const its = await cardMenu(charlie, "Open in split")
  check("another tab's menu has Open in split; it joins the tab on screen", its.includes("Open in split") && !!(await until(async () => (await state()).tabs.join() === "Bravo+Charlie,Alpha,Delta", 3000)), [its, await state()])
  check("...the list stays open, the split's card shows both", (await list().count()) === 1 && (await splitCard().locator("[data-mini-pane]").count()) === 2)
  const its2 = await cardMenu(splitCard(), "Swap panes")
  check("a split's menu: Show panes, Swap panes, Separate panes", ["Show panes", "Swap panes", "Separate panes"].every((x) => its2.includes(x)) && (await state()).tabs[0] === "Charlie+Bravo", [its2, await state()])
  await cardMenu(splitCard(), "Separate panes")
  check("Separate panes: each pane a tab, in order, the shown tab kept", !!(await until(async () => (await state()).tabs.join() === "Charlie,Bravo,Alpha,Delta", 3000)) && ["Charlie", "Bravo"].includes((await state()).shown), await state())

  // ---------- the panes' page: + and closing ----------
  await cardMenu(list().locator("[data-tab-row]", { has: P.locator("button[aria-label='Alpha']") }), "Open in split")
  await until(async () => (await state()).tabs.length === 3, 3000)
  await splitCard().locator("[data-card-panes]").tap(); await wait(500)
  check("the panes' + is New pane", (await P.locator("[data-tabs-new]").getAttribute("aria-label")) === "New pane")
  await P.locator("[data-tabs-new]").tap()
  const splitOf = async () => (await state()).tabs.find((t) => t.includes("+")) ?? ""
  check("New pane: a blank pane in the split, shown", !!(await until(async () => !(await list().count()) && /\+new$/.test(await splitOf()) && (await state()).shown === "new", 4000)), await state())
  check("...three dots in the header", (await P.locator("[data-pane-dots] button").count()) === 3)
  const dots = await P.locator("[data-pane-dots]").boundingBox()
  check("...centred on the screen, whatever the title and buttons", Math.abs(dots.x + dots.width / 2 - 195) < 1.5, dots)
  // The header's menu: the split's own items.
  await P.locator("[data-phone-header] button[aria-label=More]").tap(); await wait(300)
  const head = (await P.locator("[role=menu] [role=menuitem], [role=menu] button").allInnerTexts()).map((t) => t.trim())
  check("header menu of a split: Move to new tab, Separate panes, Close pane, Close tab", ["Move to new tab", "Separate panes", "Close pane", "Close tab"].every((x) => head.includes(x)), head)
  await P.locator("[role=menu] button, [role=menu] [role=menuitem]", { hasText: /^Close pane$/ }).first().click(); await wait(500)
  check("Close pane: the blank pane goes", (await splitOf()) === "Bravo+Alpha", await state())
  // Swiped away on the panes' page: that pane closes.
  await openList()
  await splitCard().locator("[data-card-panes]").tap(); await wait(500)
  const first = await list().locator("[data-tabs-grid] [data-tab-row] [data-tab-card]").first().boundingBox()
  const y = first.y + first.height / 2, x0 = first.x + first.width * 0.6
  await touch("touchStart", x0, y); await touch("touchMove", x0 - 12, y)
  for (let i = 1; i <= 8; i++) await touch("touchMove", x0 - 12 - (150 * i) / 8, y)
  await touch("touchEnd", 0, 0); await wait(700)
  check("a pane's card swiped away closes the pane; one left, the page goes back to all tabs", !(await splitOf()) && (await state()).tabs.length === 3 && !(await list().locator("[data-split-head]").count()), [await state()])
  check("no sideways scroll", await P.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
} catch (e) {
  check(String(e?.stack ?? e), false)
} finally {
  await browser.close()
  await api("DELETE", "file?path=Qa%20splits").catch(() => {})
}
await done()
