// The phone's tab list, a card lifted and moved (components/TabSwitcher.tsx): the others make room as it passes, and
// never flicker back and forth (a card gliding away under the finger mustn't count as under it), in every direction.
// Writes only this browser's tabs (localStorage), so any server; nothing in the vault.
//   node web/qa/tablift.mjs <base url>
import { mkdirSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/flick/"], browser, check, fails } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const P = await ctx.newPage()
await P.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return
  sessionStorage.setItem("seeded", "1")
  const tabs = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, to: `file:Qa groups/${id.toUpperCase()}.md` }))
  localStorage.setItem("vaultite.tabs", JSON.stringify({ root: { id: "g0", tabs, active: "a" }, focus: "g0" }))
})
await P.goto(B); await wait(2500)
await P.click("[data-tabs-button]"); await wait(1200)
const cdp = await ctx.newCDPSession(P)
const ids = () => P.$$eval("dialog[open] [data-tab-row]", (els) => els.map((e) => e.dataset.tabRow))
const order = async () => (await ids()).join("")
const box = async (id, fx = 0.5) => { const r = await P.locator(`dialog[open] [data-tab-row="${id}"]`).boundingBox(); return { x: r.x + r.width * fx, y: r.y + r.height / 2 } }
async function run(name, id, toId, fx) {
  const from = await box(id), to = await box(toId, fx)
  const seen = [await order()]
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] }); await wait(600)
  const N = 60
  for (let i = 1; i <= N; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / N, y: from.y + ((to.y - from.y) * i) / N }] }); await wait(16)
    const o = await order(); if (o !== seen.at(-1)) seen.push(o)
  }
  for (let i = 0; i < 20; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x + (i % 2), y: to.y }] }); await wait(16); const o = await order(); if (o !== seen.at(-1)) seen.push(o) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(700)
  const back = seen.some((o, k) => seen.indexOf(o) !== k)
  check(`${name}: no order comes back (${seen.join(" > ")})`, !back, seen)
}
const o = async (k) => (await ids())[k]
// Moving steadily across the next card (never resting): the cards make room once the finger is a little past its middle.
{
  const a = await box(await o(0)), to = await box(await o(1), 0.9), start = await order()
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [a] }); await wait(600)
  let at = -1
  for (let i = 1; i <= 30; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((to.x - a.x) * i) / 30, y: a.y }] }); await wait(16)
    if (at < 0 && (await order()) !== start) at = i
  }
  check(`moving across: the cards make room mid-move (step ${at} of 30)`, at > 0 && at < 27, at)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(600)
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
  await wait(200)
  const from = await box(id), r = await P.locator("dialog[open] [data-tab-row]").last().boundingBox()
  const bar = (await P.locator("dialog[open] [data-sheet-bar]").boundingBox()).y
  const to = where === "beside" ? { x: r.x + r.width * 1.5 + 12, y: r.y + r.height / 2 } : { x: r.x + r.width / 2, y: Math.min(r.y + r.height + 40, bar - 8) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] }); await wait(600)
  for (let i = 1; i <= 30; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 30, y: from.y + ((to.y - from.y) * i) / 30 }] }); await wait(16) }
  await wait(300)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(700)
  check(name, (await ids()).at(-1) === id, await ids())
}
// Seven cards, so the last row has room beside its card.
await P.locator("[data-tabs-new]").tap(); await wait(1200); await P.click("[data-tabs-button]"); await wait(1200)
check("seven cards", (await ids()).length === 7, await ids())
await toEnd("dropped beside the last card: it goes last", await o(4), "beside")
await toEnd("dropped below the grid: it goes last", await o(4), "below")
check("still seven cards", (await ids()).length === 7, await ids())
// (exits 0 even when a check fails: kept as it was)
console.log(fails.length ? `${fails.length} failed` : "all passed"); await browser.close()
