// The phone's tab groups (components/TabSwitcher.tsx, core/splits.ts): in the tab list, a card held and dropped on
// another's middle makes a group (a pane: Left and Right), one dropped on a group joins it, one dropped on + from a
// group's tabs leaves it, and one dropped at a card's edge in a group moves there; a group card shows its tabs'
// pictures, tapped it shows its tabs with All tabs to go back; the drag's picture is above the sheet and names the
// drop. Writes only this browser's tabs (localStorage), so any server; nothing in the vault.
//   node web/qa/tabgroups.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/tabgroups-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const P = watch(await ctx.newPage())
// Four blank-free tabs in one pane (made-up addresses: a missing file still has a card).
await P.addInitScript(() => {
  if (sessionStorage.getItem("seeded")) return
  sessionStorage.setItem("seeded", "1")
  const tabs = ["a", "b", "c", "d"].map((id) => ({ id, to: `file:Qa groups/${id.toUpperCase()}.md` }))
  localStorage.setItem("vaultite.tabs", JSON.stringify({ root: { id: "g0", tabs, active: "d" }, focus: "g0" }))
})
await P.goto(B); await wait(2500)
/** The panes as their tabs' ids, the focused one marked with its active tab: "ab | cd*d". */
const panes = () => P.evaluate(() => {
  const w = JSON.parse(localStorage.getItem("vaultite.tabs")), lv = (n) => (n.kids ? n.kids.flatMap(lv) : [n])
  return lv(w.root).map((g) => g.tabs.map((t) => t.id).join("") + (g.id === w.focus ? `*${g.active}` : "")).join(" | ")
})
const cards = () => P.$$eval("dialog[open] [data-tab-row], dialog[open] [data-group-card]", (els) => els.map((e) => e.dataset.tabRow ?? `group:${e.dataset.groupCard}`))
const cdp = await ctx.newCDPSession(P)
const at = async (sel, fx = 0.5) => { const r = await P.locator(sel).first().boundingBox(); return { x: r.x + r.width * fx, y: r.y + r.height / 2 } }
/** Hold a finger on `from`, move it to `to` and let go; what the drag's picture showed just before. */
async function holdMove(from, to) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] }); await wait(600)
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }] }); await wait(25) }
  await wait(500) // held a moment: over a card's middle, that groups
  const ghost = await P.evaluate(() => {
    const g = document.querySelector("dialog[open] [data-drag-ghost]")
    if (!g) return null
    const r = g.getBoundingClientRect(), top = document.elementFromPoint(r.x + 8, r.y + 8)
    return { text: g.innerText.replace(/\n/g, " "), seen: !!top?.closest("[data-drag-ghost]") || getComputedStyle(g).pointerEvents === "none" }
  })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(600)
  return ghost
}
const row = (id) => `dialog[open] [data-tab-row="${id}"]`

await P.click("[data-tabs-button]"); await wait(1200)
check("one pane: every tab a card", (await cards()).join() === "a,b,c,d", await cards())
const g1 = await holdMove(await at(row("a")), await at(row("c")))
check("dropped on a card's middle: the picture says Group, in the sheet", !!g1 && g1.text.includes("Group"), g1)
check("...the two make a pane beside theirs, the tab on screen kept", (await panes()) === "bd*d | ca", await panes())
check("...two groups show as group cards", (await cards()).every((c) => c.startsWith("group:")) && (await cards()).length === 2, await cards())
check("a group card shows its tabs' pictures", (await P.locator("dialog[open] [data-group-card]").first().locator("[data-tab-mini]").count()) === 2)
await P.screenshot({ path: `${OUT}groups.png` })
await P.locator("dialog[open] [data-group-card] button").first().click(); await wait(500)
check("tapped: the group's tabs, with All tabs", (await cards()).join() === "b,d" && (await P.locator("dialog[open] [data-group-head]").innerText()).includes("All tabs"), await cards())
const g2 = await holdMove(await at(row("b")), await at("[data-tabs-new]"))
check("dropped on +: Remove from group", !!g2 && g2.text.includes("Remove from group"), g2)
check("...it's a pane of its own", (await panes()) === "d*d | b | ca", await panes())
if (await P.locator("dialog[open] [data-group-head] button").count()) { await P.locator("dialog[open] [data-group-head] button").click(); await wait(400) }
check("All tabs: lone tabs are cards, groups group cards", (await cards()).filter((c) => !c.startsWith("group:")).join() === "d,b", await cards())
await holdMove(await at(row("b")), await at("dialog[open] [data-group-card]"))
check("dropped on a group: it joins it", (await panes()) === "d*d | cab", await panes())
await P.locator("dialog[open] [data-group-card] button").first().click(); await wait(500)
await holdMove(await at(row("b")), await at(row("c"), 0.1))
check("dropped at a card's left edge in a group: moved before it", (await panes()) === "d*d | bca", await panes())
await done()
