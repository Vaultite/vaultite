// In-app items and tabs: ⌘- and middle-clicks open a new tab behind (core/links.ts, never the app inside itself), an
// inbox item's tab has Settle and Snooze (its hover: components/Tabs.ts, the Tabs panel's row, its file bar), and settled
// or snoozed it leaves its tabs: the one read shows the next, the rest close. Row buttons go Settle, Snooze, More (a
// phone's swipe the same from its edge; plugins/core/inbox). WRITES Inbox/, the inbox's events, sidebars.json (put
// back): throwaway server only.
//   node web/qa/inboxtabs.mjs <base url> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, fingers, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/inboxtabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const VAULT = (await api("GET", "vault")).path
const conf = path.join(VAULT, ".vaultite/sidebars.json")
let kept = null
try { kept = readFileSync(conf, "utf8") } catch { /* none */ }
const sidebars = (s) => writeFileSync(conf, JSON.stringify({ left: s, right: [], collapsed: [] }))
const enc = encodeURIComponent
const MOD = process.platform === "darwin" ? "Meta" : "Control"

await api("DELETE", "inbox/events")
for (const r of await api("GET", "inbox")) await api("DELETE", `inbox/${enc(r.id)}`).catch(() => {})
const T = ["Alpha report", "Beta report", "Gamma report", "Delta report"]
const second = () => Math.floor(Date.now() / 1000)
for (const t of T) { await api("POST", "inbox", { title: t, body: `About ${t}.`, from: "Qa" }); const s = second(); await until(() => second() > s, 2000, 20) }
const ids = Object.fromEntries((await api("GET", "inbox")).map((r) => [r.title, r.id]))
const info = (await api("POST", "inbox/events", { source: "browser", kind: "waiting", title: "Lighthouse needs you in the browser", body: "Sign in" })).event
sidebars(["inbox:inbox", "files:files"])

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ }), ui = app(page)
const chips = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => e.querySelector("[role=tab]")?.getAttribute("data-tip") ?? ""))
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
const labels = (loc) => loc.locator("button, [role=button]").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")).filter(Boolean))
await page.goto(`${B}#view/inbox`)
await page.waitForSelector("[data-inbox-view] [data-result]", { timeout: 15000 })
await ui.idle()
const n0 = (await chips()).length

// 1. Middle-click: a panel row, a page row (a button), a file and a folder in the tree: each a tab behind, no window.
const panelRow = (t) => page.locator(`[data-inbox-panel] [data-result="${ids[t]}"]`)
const pageRow = (t) => page.locator(`[data-inbox-view] [data-result="${ids[t]}"] [data-keyrow]`)
await panelRow("Alpha report").click({ button: "middle" }); await ui.idle()
check("middle-click on a panel row: a new tab", (await chips()).includes("Alpha report"), await chips())
check("behind: the inbox is still on screen", (await hash()).includes("view/inbox"), await hash())
await pageRow("Beta report").click({ button: "middle" }); await ui.idle()
check("middle-click on a page row: a new tab behind", (await chips()).includes("Beta report") && (await hash()).includes("view/inbox"), await chips())
const tree = page.locator("[data-sidebar-body] [role=treeitem]")
const file = tree.filter({ hasText: "Start here" }).first()
await file.click({ button: "middle" }); await ui.idle()
check("middle-click on a file in the tree: a new tab behind", (await chips()).includes("Start here") && (await hash()).includes("view/inbox"), await chips())
const folder = tree.filter({ hasText: "Notes" }).first()
const folderOpen = await folder.getAttribute("aria-expanded")
await folder.click({ button: "middle" }); await ui.idle()
check("middle-click on a folder: its page in a tab behind, not unfolded", (await chips()).includes("Notes") && (await folder.getAttribute("aria-expanded")) === folderOpen, await chips())
check("no window of the app opened", ctx.pages().length === 1, ctx.pages().length)
check("five tabs now", (await chips()).length === n0 + 4, await chips())
// ⌘-click on a list's row selects it (Finder's way), as before: nothing opens.
await pageRow("Gamma report").click({ modifiers: [MOD] }); await ui.idle()
check("⌘-click on an inbox row selects it", (await page.locator(`[data-inbox-view] [data-result="${ids["Gamma report"]}"][data-selected]`).count()) === 1)
await page.keyboard.press("Escape")

// 2. Row buttons: Settle, Snooze, More, on the panel's and the page's rows, results and messages alike.
await panelRow("Gamma report").hover(); await ui.idle()
check("panel result row: Settle, Snooze, More", JSON.stringify(await labels(panelRow("Gamma report"))) === JSON.stringify(["Settle", "Snooze", "More"]), await labels(panelRow("Gamma report")))
const pev = page.locator(`[data-inbox-panel] [data-event="${info.id}"]`)
await pev.hover(); await ui.idle()
const pevl = await labels(pev)
check("panel message row: Settle, then Snooze, More last", pevl[0] === "Settle" && pevl.at(-1) === "More" && (pevl.length === 2 || pevl[1] === "Snooze"), pevl)
const gev = page.locator(`[data-inbox-view] [data-event="${info.id}"]`)
await gev.hover(); await ui.idle()
const gevl = (await labels(gev)).filter((l) => !/^Lighthouse/.test(l))
check("page message row: Settle, Snooze, More", gevl[0] === "Settle" && gevl.at(-1) === "More", gevl)
const gres = page.locator(`[data-inbox-view] [data-result="${ids["Gamma report"]}"]`)
check("page result row: Settle, Snooze, More", JSON.stringify(await labels(gres)) === JSON.stringify(["Settle", "Snooze", "More"]), await labels(gres))

// 3. A tab showing an item: Settle and Snooze on hover, before its X; none on another file's tab.
const chip = (label) => page.locator("[data-tab-bar] [data-tab-id]", { has: page.locator(`[role=tab][data-tip="${label}"]`) })
await chip("Alpha report").hover(); await ui.idle()
const tb = chip("Alpha report").locator("[data-tab-buttons]")
check("an inbox item's tab: Settle and Snooze on hover", await tb.isVisible() && JSON.stringify(await labels(tb)) === JSON.stringify(["Settle", "Snooze"]), await labels(tb).catch(() => null))
await page.screenshot({ path: `${OUT}1-tab-hover.png` })
await chip("Start here").hover(); await ui.idle()
check("another file's tab: none", (await chip("Start here").locator("[data-tab-buttons]").count()) === 0)

// 4. Settled from the page while its tab is behind: that tab closes, the inbox stays.
await ui.sees(`${ids["Alpha report"]}.md`, () => page.locator(`[data-inbox-view] [data-result="${ids["Alpha report"]}"]`).getByRole("button", { name: "Settle" }).click())
check("settled, its tab behind closes", !(await chips()).includes("Alpha report") && (await hash()).includes("view/inbox"), await chips())

// (the tabs it opened besides the items' close: closing one goes on to a sibling first, as Chrome's do)
for (const l of ["Start here", "Notes"]) { await chip(l).hover(); await chip(l).locator("[data-tab-close]").click(); await ui.idle() }

// 5. Read in a tab of its own, settled from the file bar: the tab shows the next to review (Mail's); the last one
// snoozed from its tab's hover: the tab closes, back to the inbox it was opened from.
await pageRow("Beta report").click(); await page.locator(`article.file-view[data-path="${ids["Beta report"]}.md"]:visible`).waitFor(); await ui.idle()
check("a click opens it (its tab, already open behind)", (await hash()).includes("Beta report"), await hash())
const bar = page.locator("[data-pane] [data-inbox-bar]").filter({ visible: true })
check("its file bar: Settle and Snooze", JSON.stringify(await labels(bar.first())) === JSON.stringify(["Settle", "Snooze"]), await labels(bar.first()).catch(() => null))
await page.screenshot({ path: `${OUT}2-file-bar.png` })
const before = (await chips()).length
await ui.sees(`${ids["Beta report"]}.md`, () => bar.first().getByRole("button", { name: "Settle" }).click())
check("settled from its bar: the tab shows the next to review", /Gamma report|Delta report/.test(await hash()) && (await chips()).length === before, [await hash(), await chips()])
const shown = (await hash()).includes("Gamma") ? "Gamma report" : "Delta report", other = shown === "Gamma report" ? "Delta report" : "Gamma report"
await ui.sees(`${ids[other]}.md`, () => api("PUT", `inbox/${enc(ids[other])}`, { status: "done" }).catch(() => {}))
await until(async () => !(await api("GET", "inbox")).some((r) => r.title === other && r.status === "new"))
await page.locator(`[data-inbox-panel] [data-result="${ids[other]}"]`).waitFor({ state: "detached" }); await ui.idle()
await chip(shown).hover(); await ui.idle()
await ui.menu.open(chip(shown).locator("[data-tab-buttons]").getByRole("button", { name: "Snooze" }))
await ui.sees(`${ids[shown]}.md`, () => ui.menu.top().getByRole("menuitem").first().click())
check("the last one snoozed from its tab: the tab closes", !(await chips()).includes(shown), await chips())
check("back on the inbox it was opened from", (await hash()).includes("view/inbox"), await hash())
await ui.toast.wait(shown).then((t) => t.getByRole("button", { name: "Undo" }).click()).catch(() => {})
await until(async () => (await api("GET", "inbox")).find((r) => r.title === shown)?.snoozed == null, 4000)

// 6. The Tabs panel's rows: the same buttons on hover, before Close.
await ui.sees(".vaultite/sidebars.json", () => sidebars(["tabs:tabs", "inbox:inbox", "files:files"]))
await page.reload(); await page.locator(`[data-inbox-panel] [data-result="${ids[shown]}"]`).waitFor(); await ui.idle()
await page.locator(`[data-inbox-panel] [data-result="${ids[shown]}"]`).click({ button: "middle" }); await ui.idle()
const trow = page.locator("[data-open-tab]", { hasText: shown }).first()
await trow.hover(); await ui.idle()
const tl = await labels(trow.locator("[data-row-actions]"))
check("the Tabs panel's row: Settle, Snooze, then Close", tl[0] === "Settle" && tl[1] === "Snooze" && /^Close/.test(tl[2] ?? ""), tl)
await page.screenshot({ path: `${OUT}3-tabs-panel.png` })

// 7. A session settled in its sheet: the next one's sheet takes its place (T3 Code's, Mail's); the last, it closes.
const sess = (session, title) => api("POST", "inbox/sessions", { agent: "claude", session, state: "waiting", ask: "question", title, text: `${title}?` })
await sess("qa-tabs-1", "First question"); await sess("qa-tabs-2", "Second question")
const threadOf = async (s) => (await api("GET", "inbox/events")).events.find((e) => e.session === s)
const [t1, t2] = [await until(() => threadOf("qa-tabs-1")), await until(() => threadOf("qa-tabs-2"))]
await page.goto(`${B}#view/inbox`); await page.locator(`[data-inbox-view] [data-event="${t1.id}"] [data-keyrow]`).waitFor(); await ui.idle()
await page.locator(`[data-inbox-view] [data-event="${t1.id}"] [data-keyrow]`).click()
const sheetOf = (id) => page.locator(`[data-session-sheet="${id}"]`)
await until(() => sheetOf(t1.id).count())
await sheetOf(t1.id).locator("[data-session-done]").click()
check("a session settled in its sheet: the next one's sheet", !!(await until(() => sheetOf(t2.id).isVisible().catch(() => false))))
await sheetOf(t2.id).locator("[data-session-done]").click()
check("the last one settled: the sheet closes", !!(await until(async () => !(await page.locator("[data-session-sheet]").filter({ visible: true }).count()))))
await ctx.close()

// 8. A phone: the file's line has Settle and Snooze; a row's swipe shows More, Snooze, Settle (Settle at the edge).
sidebars(["inbox:inbox", "files:files"])
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await phone.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const ph = watch(await phone.newPage(), { label: "phone" }), phUi = app(ph)
await ph.goto(`${B}#file/${enc(`${ids[shown]}.md`)}`); await ph.locator("[data-inbox-bar]").filter({ visible: true }).first().waitFor(); await phUi.idle()
const line = ph.locator("[data-inbox-bar]").filter({ visible: true }).first()
check("phone: the file's line has Settle and Snooze", JSON.stringify(await labels(line).catch(() => null)) === JSON.stringify(["Settle", "Snooze"]), await labels(line).catch(() => null))
const box = await line.locator("button").first().boundingBox()
check("phone: 44px targets", box && box.height >= 43.5 && box.width >= 43.5, box)
await ph.screenshot({ path: `${OUT}4-phone-line.png` })
await ph.goto(`${B}#view/inbox`); await ph.locator(`[data-inbox-view] [data-result="${ids[shown]}"]`).waitFor(); await phUi.idle()
const { swipe } = await fingers(ph)
const prow = ph.locator(`[data-inbox-view] [data-result="${ids[shown]}"]`)
const pb = await prow.boundingBox()
await swipe(pb.x + pb.width - 30, pb.y + pb.height / 2, pb.x + pb.width - 260, pb.y + pb.height / 2 + 2); await phUi.idle()
const under = await ph.locator("[data-inbox-view] [data-swipe-under] button").evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().width > 10).map((b) => b.getAttribute("aria-label")))
check("phone: a swiped row shows More, Snooze, Settle", JSON.stringify(under) === JSON.stringify(["More", "Snooze", "Settle"]), under)
await ph.screenshot({ path: `${OUT}5-phone-swipe.png` })
check("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= 390))
await phone.close()

if (kept !== null) writeFileSync(conf, kept); else rmSync(conf, { force: true })
await done()
