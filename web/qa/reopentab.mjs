// Reopen closed tab (core/workspace.ts reopenTab): what closed comes back as it was, what closed together together.
// A pane back in its split at its size, a split tab whole, Close others undone by one ⌘⇧T, a tab group with its name,
// its toast's Undo, Search tabs' and the phone's Recently closed. Writes workspaces (set aside, put back): throwaway only.
//   node web/qa/reopentab.mjs <base url> <vault path>
import { readdirSync } from "node:fs"
import path from "node:path"
import { command, qa, until, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const notes = readdirSync(path.join(VAULT, "Daily")).filter((f) => f.endsWith(".md")).sort().slice(0, 5).map((f) => `Daily/${f}`)
if (notes.length < 5) { console.error("the vault needs five notes in Daily/ (vau sandbox makes them)"); process.exit(2) }
const [a, b, c, d, e] = notes
const putBackWorkspaces = setAsideWorkspaces(B)

const pane = (id, f) => ({ id, to: `file:${f}` })
const layout = { tabs: [
  { id: "ta", root: pane("pa", a), focus: "pa" },
  { id: "tx", root: { id: "s0", dir: "row", sizes: [0.3, 0.7], kids: [pane("pb", b), pane("pc", c)] }, focus: "pc" },
  { id: "td", root: pane("pd", d), focus: "pd", group: "g1" },
  { id: "te", root: pane("pe", e), focus: "pe" },
], groups: [{ id: "g1", name: "Trip", color: "teal" }], active: "ta" }
/** The tabs as saved: each tab's panes ("a" or "[b .30|c .70]"), its group's name, the one shown starred. */
const short = (to) => path.basename(to, ".md")
const desc = (n) => (n.kids ? `[${n.kids.map((k, i) => `${desc(k)} ${n.sizes[i].toFixed(2)}`).join("|")}]` : notes.find((f) => `file:${f}` === n.to) ? "abcde"[notes.findIndex((f) => `file:${f}` === n.to)] : short(n.to))

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(B)
  await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
  const seed = async () => {
    await page.evaluate((l) => { localStorage.setItem("vaultite.tabs", JSON.stringify(l)); localStorage.removeItem("vaultite.tabs.closed") }, layout)
    await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(a)}`)
    await page.waitForSelector("[data-tab-id='tx']", { timeout: 30000 })
    await wait(500)
  }
  await seed()
  const tabs = () => page.evaluate(() => {
    const l = JSON.parse(localStorage.getItem("vaultite.tabs.workspace") ?? localStorage.getItem("vaultite.tabs"))
    return l
  }).then((l) => l.tabs.map((t) => desc(t.root) + (t.group ? `(${l.groups?.find((g) => g.id === t.group)?.name ?? "?"})` : "") + (t.id === l.active ? "*" : "")).join(","))
  const is = (want) => until(async () => (await tabs()) === want, 4000).then(() => true, () => false)
  check("the tabs as saved", await is("a*,[b 0.30|c 0.70],d(Trip),e"), await tabs())

  // A pane of a split: back where it sat, at its size, focused.
  await page.click("[data-tab-strip] [data-tab-id='tx']")
  await command(page, "Close pane")
  check("a split's pane closed: the split closes up", await is("a,b*,d(Trip),e"), await tabs())
  await command(page, "Reopen closed tab")
  check("⌘⇧T: the pane back in its split, at its size", await is("a,[b 0.30|c 0.70]*,d(Trip),e"), await tabs())

  // The split tab itself: back whole, where it was.
  await command(page, "Close current tab")
  check("the split tab closed", await is("a,d(Trip)*,e") || await is("a*,d(Trip),e"), await tabs())
  await command(page, "Reopen closed tab")
  check("⌘⇧T: the split tab back whole, in its place, shown", await is("a,[b 0.30|c 0.70]*,d(Trip),e"), await tabs())

  // A tab group's only tab: its group comes back with it.
  await page.click("[data-tab-strip] [data-tab-id='td']")
  await command(page, "Close current tab")
  check("a group's last tab closed: the group goes", !(await tabs()).includes("Trip"), await tabs())
  await command(page, "Reopen closed tab")
  check("⌘⇧T: the tab back in its group, named as it was", await is("a,[b 0.30|c 0.70],d(Trip)*,e"), await tabs())

  // Close others: one ⌘⇧T brings them all back, the tab on screen staying.
  await page.click("[data-tab-strip] [data-tab-id='ta']")
  await command(page, "Close all other tabs")
  check("others closed", await is("a*"), await tabs())
  const toast = page.locator("[data-sonner-toast]", { hasText: "Closed 3 tabs" }).first()
  const shows = (n) => until(async () => (await toast.count()) === n, 4000).then(() => true, () => false)
  // (in a browser ⌘⇧T is the browser's own: the toast names no keys)
  check("others closed: a toast says so, with Undo", await shows(1) && await toast.getByRole("button", { name: "Undo" }).count() === 1
    && !/Reopen with/.test(await toast.innerText()), await toast.innerText().catch(() => ""))
  await command(page, "Reopen closed tab")
  check("⌘⇧T once: every tab closed with them back where it was, the split and the group too", await is("a*,[b 0.30|c 0.70],d(Trip),e"), await tabs())
  check("… and the toast goes, they're back", await shows(0))
  check("… and nothing left to reopen", !(await command(page, "Reopen closed tab")) || await is("a*,[b 0.30|c 0.70],d(Trip),e"), await tabs())
  await command(page, "Close all other tabs")
  await shows(1)
  await toast.getByRole("button", { name: "Undo" }).click()
  check("the toast's Undo: every tab back where it was", await is("a*,[b 0.30|c 0.70],d(Trip),e"), await tabs())

  // Search tabs: what closed together is one row, reopened together.
  await command(page, "Close all other tabs")
  await command(page, "Search tabs…")
  const row = page.locator("[role=option]", { hasText: "3 tabs" }).first()
  await row.waitFor({ timeout: 4000 }).catch(() => {})
  check("search tabs: the three closed together are one row, saying so", await row.count() > 0,
    await page.locator("[role=option]").allInnerTexts().catch(() => []))
  if (await row.count()) await row.click()
  check("search tabs: picked, all three back where they were", await is("a*,[b 0.30|c 0.70],d(Trip),e"), await tabs())
  await page.keyboard.press("Escape")

  // A pop-out window closed: ⌘⇧T opens it again, with its tabs.
  const windows = () => page.evaluate(() => (JSON.parse(localStorage.getItem("vaultite.tabs.workspace") ?? localStorage.getItem("vaultite.tabs")).windows ?? []).map((w) => w.tabs.length))
  await page.click("[data-tab-strip] [data-tab-id='te']")
  const popped = ctx.waitForEvent("page")
  await command(page, "Move current tab to new window")
  const win = await popped
  await win.waitForLoadState()
  check("a tab moved to a window of its own", await until(async () => (await windows()).join() === "1" && !(await tabs()).includes("e"), 4000).then(() => true, () => false), [await windows(), await tabs()])
  await win.close()
  check("its window closed: it's gone", await until(async () => !(await windows()).length, 4000).then(() => true, () => false), await windows())
  const again = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null)
  await command(page, "Reopen closed tab")
  const back = await again
  check("⌘⇧T: the window opens again, its tab in it", !!back && /[?&]popout=/.test(back.url()) && await until(async () => (await windows()).join() === "1", 4000).then(() => true, () => false),
    [back?.url(), await windows()])
  await back?.close()
  await ctx.close()

  // The phone: the tab list's menu has Recently closed.
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const P = watch(await pctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await P.goto(B)
  await P.waitForSelector("[data-tabs-button]", { timeout: 30000 })
  await P.evaluate((l) => { localStorage.setItem("vaultite.tabs", JSON.stringify({ ...l, groups: undefined, tabs: l.tabs.filter((t) => t.id !== "tx").map((t) => ({ ...t, group: undefined })) })); localStorage.removeItem("vaultite.tabs.closed") }, layout)
  await P.goto("about:blank"); await P.goto(`${B}#file/${encodeURIComponent(a)}`)
  await P.waitForSelector("[data-tabs-button]", { timeout: 30000 })
  await wait(800)
  const count = () => P.locator("[data-tabs-button]").innerText().then((t) => Number(t.trim()))
  check("phone: three tabs", await until(async () => (await count()) === 3, 4000).then(() => true, () => false), await count())
  await P.click("[data-tabs-button]")
  await P.click("[data-tabs-more]")
  await P.getByRole("menuitem", { name: /Close other tabs/ }).click()
  check("phone: others closed", await until(async () => (await count()) === 1, 4000).then(() => true, () => false), await count())
  await P.click("[data-tabs-more]")
  await P.getByRole("menuitem", { name: /Recently closed/ }).click()
  const item = P.getByRole("menuitem", { name: /and 1 more/ })
  check("phone: Recently closed lists the two closed together as one", await item.count() > 0, await P.getByRole("menuitem").allInnerTexts())
  if (await item.count()) await item.first().click()
  check("phone: picked, both back", await until(async () => (await count()) === 3, 4000).then(() => true, () => false), await count())
  await pctx.close()
} finally {
  putBackWorkspaces()
}
await done()
