// The phone's tab list, a card lifted and moved (components/TabSwitcher.tsx): the others make room without flicker, and
// it makes, joins or leaves a tab group. Writes only this browser's localStorage, so any server.
//   node web/qa/tablift.mjs <base url>
import { mkdirSync } from "node:fs"
import { qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/flick/"], browser, check, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const P = await ctx.newPage(), ui = app(P)
await P.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return
  sessionStorage.setItem("seeded", "1")
  const tabs = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, root: { id: `p${id}`, to: `file:Qa groups/${id.toUpperCase()}.md` }, focus: `p${id}` }))
  localStorage.setItem("vaultite.tabs", JSON.stringify({ tabs, active: "a" }))
})
await P.goto(B); await P.locator("[data-tabs-button]").waitFor(); await ui.idle()
await P.click("[data-tabs-button]"); await P.locator("dialog[open] [data-tab-row]").first().waitFor(); await ui.idle()
const cdp = await ctx.newCDPSession(P)
const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [p] : [] })
const frame = () => P.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
await P.evaluate(() => { window.qaHeld = 0; addEventListener("contextmenu", () => { window.qaHeld++ }, true) })
const press = async (at) => { const n = await P.evaluate(() => window.qaHeld); await touch("touchStart", at); await P.waitForFunction((n) => window.qaHeld > n, n) }
const hint = () => P.$eval("[data-drag-hint]", (e) => e.innerText).catch(() => null)
const rest = (at, done) => until(async () => { await touch("touchMove", { x: at.x + 1, y: at.y }); await touch("touchMove", at); return done() }, 3000, 50)
const ids = () => P.$$eval("dialog[open] [data-tab-row]", (els) => els.map((e) => e.dataset.tabRow))
const order = async () => (await ids()).join("")
const box = async (id, fx = 0.5) => { const r = await P.locator(`dialog[open] [data-tab-row="${id}"]`).boundingBox(); return { x: r.x + r.width * fx, y: r.y + r.height / 2 } }
async function run(name, id, toId, fx) {
  const from = await box(id), to = await box(toId, fx)
  const seen = [await order()]
  await press(from)
  const N = 60
  for (let i = 1; i <= N; i++) {
    await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / N, y: from.y + ((to.y - from.y) * i) / N }); await frame()
    const o = await order(); if (o !== seen.at(-1)) seen.push(o)
  }
  for (let i = 0; i < 20; i++) { await touch("touchMove", { x: to.x + (i % 2), y: to.y }); await frame(); const o = await order(); if (o !== seen.at(-1)) seen.push(o) }
  await touch("touchEnd"); await ui.idle()
  const back = seen.some((o, k) => seen.indexOf(o) !== k)
  check(`${name}: no order comes back (${seen.join(" > ")})`, !back, seen)
}
const o = async (k) => (await ids())[k]
// Moving steadily across the next card (never resting): the cards make room once the finger is a little past its middle.
{
  const a = await box(await o(0)), to = await box(await o(1), 0.9), start = await order()
  await press(a)
  let at = -1
  for (let i = 1; i <= 30; i++) {
    await touch("touchMove", { x: a.x + ((to.x - a.x) * i) / 30, y: a.y }); await frame()
    if (at < 0 && (await order()) !== start) at = i
  }
  check(`moving across: the cards make room mid-move (step ${at} of 30)`, at > 0 && at < 27, at)
  await touch("touchEnd"); await ui.idle()
}
await run("4th to 1st", await o(3), await o(0), 0.1)
check("...landed 1st", (await order())[0] === "d", await order())
await run("1st to 5th", await o(0), await o(4), 0.9)
await run("6th to 2nd", await o(5), await o(1), 0.1)
await run("2nd to 6th", await o(1), await o(5), 0.9)
await run("5th to 3rd (left)", await o(4), await o(2), 0.1)
// Let go in the empty space after the last card (beside it on its row, then below the grid): it goes last.
async function toEnd(name, id, where) {
  // Scrolled to the end, so the last card and the space after it are on screen (and the 5th card, held).
  await P.evaluate(() => { const sc = document.querySelector("dialog[open] [data-tab-row]").closest(".overflow-y-auto"); sc.scrollTop = sc.scrollHeight })
  await ui.idle()
  const from = await box(id), r = await P.locator("dialog[open] [data-tab-row]").last().boundingBox()
  const bar = (await P.locator("dialog[open] [data-sheet-bar]").boundingBox()).y
  const to = where === "beside" ? { x: r.x + r.width * 1.5 + 12, y: r.y + r.height / 2 } : { x: r.x + r.width / 2, y: Math.min(r.y + r.height + 40, bar - 8) }
  await press(from)
  for (let i = 1; i <= 30; i++) { await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 30, y: from.y + ((to.y - from.y) * i) / 30 }); await frame() }
  await rest(to, async () => (await ids()).at(-1) === id)
  await touch("touchEnd"); await ui.idle()
  check(name, (await ids()).at(-1) === id, await ids())
}
// Seven cards, so the last row has room beside its card.
await P.locator("[data-tabs-new]").tap(); await P.locator("dialog[open]").waitFor({ state: "detached" }); await ui.idle(); await P.click("[data-tabs-button]")
check("seven cards", await until(async () => (await ids()).length === 7), await ids())
await toEnd("dropped beside the last card: it goes last", await o(4), "beside")
await toEnd("dropped below the grid: it goes last", await o(4), "below")
check("still seven cards", (await ids()).length === 7, await ids())
// Tab groups: held over a card's middle, the two group (one card for both); a card dropped on a group's card joins it;
// in the group opened, one dropped on + leaves it.
async function hold(from, to, says) {
  await press(from)
  for (let i = 1; i <= 30; i++) { await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 30, y: from.y + ((to.y - from.y) * i) / 30 }); await frame() }
  await rest(to, async () => (await hint()) === says)
  await touch("touchEnd"); await ui.idle()
}
const groupCards = () => P.$$eval("dialog[open] [data-group-card] > div > button:not([aria-label^='Close'])", (els) => els.map((e) => e.getAttribute("aria-label")))
const centre = async (sel) => { const r = await P.locator(sel).first().boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
await P.evaluate(() => { document.querySelector("dialog[open] [data-tab-row]").closest(".overflow-y-auto").scrollTop = 0 }); await ui.idle()
await hold(await box(await o(1)), await box(await o(0)), "Group")
check("held on another card's middle: the two make a group, one card", (await ids()).length === 5 && (await groupCards()).length === 1 && / 2 tabs$/.test((await groupCards())[0]), [await ids(), await groupCards()])
await P.evaluate(() => { document.querySelector("dialog[open] [data-tab-row]").closest(".overflow-y-auto").scrollTop = 0 }); await ui.idle()
await hold(await box(await o(0)), await centre("dialog[open] [data-group-card]"), "Add to group")
check("dropped on a group's card: it joins the group", (await ids()).length === 4 && / 3 tabs$/.test((await groupCards())[0] ?? ""), [await ids(), await groupCards()])
await P.locator("dialog[open] [data-group-card] button[aria-label$=' tabs']").first().click(); await ui.idle()
check("a group's card opens its tabs", (await ids()).length === 3, await ids())
await hold(await box(await o(0)), await centre("[data-tabs-new]"), "Remove from group")
check("in the group, dropped on +: it leaves the group", (await ids()).length === 2, await ids())
// Its name, top right: tapped, it's a field there; typed and Enter, the group has that name.
await P.locator("dialog[open] [data-group-title]").click(); await ui.idle()
const focused = await P.evaluate(() => document.activeElement?.getAttribute("aria-label"))
await P.keyboard.type("Trip"); await P.keyboard.press("Enter"); await ui.idle()
check("in the group, its name tapped: renamed there", focused === "Group name" && (await P.locator("dialog[open] [data-group-title]").innerText()).trim() === "Trip", [focused, await P.locator("dialog[open] [data-group-head]").innerText()])
await P.screenshot({ path: `${OUT}group-renamed.png` })
await P.locator("dialog[open] [data-group-head] button").first().click(); await ui.idle()
check("back to all tabs: the one that left is a card again", (await ids()).length === 5 && /^Trip, 2 tabs$/.test((await groupCards())[0] ?? ""), [await ids(), await groupCards()])
// Into a group and back is going to another page: the group at its top, All tabs where it was left, every time (the
// list kept its old height and offset, so a second visit showed the group's cards scrolled out of sight).
{
  const list = () => P.evaluate(() => { const sc = document.querySelector("dialog[open] [data-tabs-grid]").closest(".overflow-y-auto"); const c = document.querySelector("dialog[open] [data-tab-row] [data-tab-card]")?.getBoundingClientRect(); return { top: Math.round(sc.scrollTop), card: c ? Math.round(c.top) : null, h: sc.clientHeight } })
  await P.evaluate(() => { const sc = document.querySelector("dialog[open] [data-tabs-grid]").closest(".overflow-y-auto"); sc.scrollTop = sc.scrollHeight }); await ui.idle()
  const left = await list(), seen = []
  for (let i = 0; i < 2; i++) {
    await P.locator("dialog[open] [data-group-card] button[aria-label$=' tabs']").first().dispatchEvent("click"); await ui.idle()
    const inGroup = await list()
    await P.locator("dialog[open] [data-group-back]").dispatchEvent("click"); await ui.idle()
    seen.push({ inGroup, back: await list() })
  }
  check("a group opened (twice): at its top, its first card in sight; back, All tabs where it was", left.top > 0 && seen.every((v) => v.inGroup.top === 0 && v.inGroup.card > 0 && v.inGroup.card < v.inGroup.h && Math.abs(v.back.top - left.top) <= 1), { left, seen })
  await P.evaluate(() => { document.querySelector("dialog[open] [data-tabs-grid]").closest(".overflow-y-auto").scrollTop = 0 }); await ui.idle()
}
// Held on All tabs, a group's card is carried out to all tabs (spring-loaded), still under the finger: let go on a card's
// edge it goes there, on its group's card it stays in, on All tabs before it springs it leaves (the last: the group goes).
async function glide(from, to) {
  for (let i = 1; i <= 20; i++) { await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 20, y: from.y + ((to.y - from.y) * i) / 20 }); await frame() }
}
const springs = async () => !(await P.locator("dialog[open] [data-group-head]").count())
const shown = () => P.evaluate(() => ({ lit: !!document.querySelector("dialog[open] [data-group-head]")?.className.includes("ring-2"), hint: document.querySelector("[data-drag-hint]")?.innerText ?? null }))
const openGroup = async () => { await P.locator("dialog[open] [data-group-card] > div > button:not([aria-label^='Close'])").first().click(); await ui.idle() }
const carryOut = async (shot) => {
  const from = await box(await o(0)), back = await centre("dialog[open] [data-group-back]")
  await press(from)
  await glide(from, back)
  let before
  await rest(back, async () => (before = await shown()).hint === "Remove from group")
  if (shot) await P.screenshot({ path: `${OUT}carry-hover.png` })
  await rest(back, springs)
  return { before, back }
}
await openGroup()
{
  const { before, back } = await carryOut(true)
  check("in the group, held on All tabs: it lights, the card says Remove from group", before.lit && before.hint === "Remove from group", before)
  const sprung = { head: await P.locator("dialog[open] [data-group-head]").count(), ghost: await P.locator("[data-drag-ghost]").count(), group: await groupCards() }
  await P.screenshot({ path: `${OUT}carry-sprung.png` })
  check("...after a moment, all tabs, the card still held, its group a tab less", !sprung.head && sprung.ghost === 1 && /^Trip, 1 tab$/.test(sprung.group[0] ?? ""), sprung)
  await glide(back, await centre("dialog[open] [data-group-card]")); await ui.idle()
  await touch("touchEnd"); await ui.idle()
  check("...let go on its group's card: it stays in the group", /^Trip, 2 tabs$/.test((await groupCards())[0] ?? "") && (await ids()).length === 5, [await ids(), await groupCards()])
}
await openGroup()
{
  const moving = await o(0)
  const { back } = await carryOut(false)
  // (all tabs now: the group's card, then the one carried out, then the rest)
  const third = (await ids())[2]
  const edge = await box(third, 0.9)
  await glide(back, edge)
  await rest(edge, async () => { const now = await ids(); return now[2] === moving && now[1] === third })
  await P.screenshot({ path: `${OUT}carry-placed.png` })
  await touch("touchEnd"); await ui.idle()
  check("...carried out and let go on a card's edge: it's there, out of the group", (await ids())[2] === moving && (await ids())[1] === third && (await ids()).length === 6 && /^Trip, 1 tab$/.test((await groupCards())[0] ?? ""), [moving, third, await ids(), await groupCards()])
}
await openGroup()
{
  const from = await box(await o(0)), back = await centre("dialog[open] [data-group-back]")
  await press(from)
  await glide(from, back)
  await rest(back, async () => (await hint()) === "Remove from group")
  await touch("touchEnd"); await ui.idle()
  check("the last tab let go on All tabs at once: out, and the group's gone", (await ids()).length === 7 && !(await groupCards()).length && !(await P.locator("dialog[open] [data-group-head]").count()), [await ids(), await groupCards()])
}
await done()
