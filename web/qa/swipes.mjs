// A phone's swipes (components/SwipeRow.tsx) with real touches at 390px: the drawer's headings and pins, Inbox rows,
// the new tab; a computer keeps its buttons. WRITES sidebars, newtab, pages.json (put back), the Inbox: throwaway.
//   node web/qa/swipes.mjs <base url> [shots dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { app } from "./lib/app.mjs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/swipes-shots/"], browser, check, watch, done: finish } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = async (method, p, body) => {
  const r = await fetch(new URL(`api/${p}`, B), { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text()
}
const conf = (name) => path.join(VAULT, `.vaultite/${name}.json`)
const kept = Object.fromEntries(["sidebars", "newtab", "pages"].map((n) => { try { return [n, readFileSync(conf(n), "utf8")] } catch { return [n, null] } }))
writeFileSync(conf("sidebars"), JSON.stringify({ left: ["buttons:buttons", "inbox:inbox", "pages:pages", "files:files"], right: [], collapsed: [] }))
writeFileSync(conf("newtab"), JSON.stringify({ sections: ["core:actions", "inbox:inbox"] }))
const pinned = JSON.parse(kept.pages ?? "{}").pinned ?? []
// Titles of their own each run (the Inbox numbers a title it has already).
const run = Date.now().toString(36)
const T = { redraw: `Swipe after a redraw ${run}`, newtab: `Swipe on a new tab ${run}`, open: `Swipe its open note ${run}`, fails: `Swipe and fail ${run}` }
for (const t of Object.values(T)) await api("POST", "inbox", { title: t, body: "Body.", from: "Qa" })
const status = async (title) => (await api("GET", "inbox")).find((r) => r.title === title)?.status

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = watch(await ctx.newPage()), ui = app(page)
  const cdp = await ctx.newCDPSession(page)
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
  const swipe = async (loc, dx) => {
    const b = await loc.boundingBox()
    const x0 = dx > 0 ? b.x + 30 : b.x + b.width - 30, y = b.y + b.height / 2
    await touch("touchStart", x0, y)
    for (let i = 1; i <= 12; i++) { await touch("touchMove", x0 + (dx * i) / 12, y + 2); await page.evaluate(() => new Promise(requestAnimationFrame)) }
    await touch("touchEnd"); await ui.idle()
  }
  const drawer = async () => { await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await ui.idle() }
  await page.goto(B); await page.waitForSelector("[data-phone-header]"); await ui.idle()
  await drawer()
  const D = "[data-phone-drawer]"

  // Files' heading: its buttons behind it.
  const files = page.locator(`${D} [data-panel-handle]`, { has: page.getByText("Files", { exact: true }) }).first()
  await swipe(files, 240)
  const sort = page.locator(`${D} [data-swipe-under] button[aria-label='Change sort order']`)
  check("Files' heading swiped: its buttons show", await sort.isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}heading.png` })
  await sort.tap().catch(() => {}); await ui.idle()
  check("and Change sort order opens its menu", await page.locator("[role=menu]").isVisible().catch(() => false))
  await page.mouse.click(380, 10); await ui.idle()

  // The Buttons panel: the new tab's buttons, and its heading's +.
  check("the Buttons panel lists the new tab's buttons", (await page.locator(`${D} [data-newtab-action='file:new']`).count()) === 1)
  if (!(await page.locator(D).isVisible().catch(() => false))) await drawer()
  await swipe(page.locator(`${D} [data-panel-handle][data-heading=Buttons]`), 200)
  check("Buttons' heading swiped: Add a button", await page.locator(`${D} [data-swipe-under] button[aria-label='Add a button']`).isVisible().catch(() => false))
  await page.locator(`${D} [data-panel-handle][data-heading=Buttons]`).tap(); await ui.idle()

  // A pinned page: Unpin.
  if (pinned.length) {
    const row = page.locator(`${D} [data-pin='${pinned[0]}']`)
    await swipe(row, 200)
    const unpin = page.locator(`${D} button[aria-label=Unpin]`)
    check("a pinned page swiped: Unpin", await unpin.isVisible().catch(() => false))
    await page.screenshot({ path: `${OUT}pinned.png` })
    await unpin.tap().catch(() => {})
    check("and it's unpinned", await until(() => !JSON.parse(readFileSync(conf("pages"), "utf8")).pinned.includes(pinned[0])))
  }

  // An Inbox row swiped open, then redrawn (a live change) before Settle.
  if (!(await page.locator(D).isVisible().catch(() => false))) await drawer()
  const res = page.locator(`${D} [data-result]`, { hasText: T.redraw }).first()
  await swipe(res, 200)
  await api("POST", "inbox", { title: "Arrives while it's open", body: "Body.", from: "Qa" })
  await page.locator(`${D} [data-result]`, { hasText: "Arrives while it's open" }).first().waitFor({ state: "attached" }); await ui.idle()
  const done = page.locator(`${D} button[aria-label=Settle]:not([data-tip])`).first()
  check("a swiped row stays open through a redraw", await done.isVisible().catch(() => false))
  // A press on Settle, a tap's length (short of a hold), mustn't close the row first (iOS then drops the click).
  const db = await done.boundingBox()
  await touch("touchStart", db.x + db.width / 2, db.y + db.height / 2); await wait(300)
  const open = await page.evaluate(() => [...document.querySelectorAll("[data-phone-drawer] [data-swipe-under]")].some((u) => u.getBoundingClientRect().width > 20))
  await touch("touchEnd"); await ui.idle()
  check("pressing Settle leaves it open until it acts", open)
  check("and Settle settles it", (await until(async () => (await status(T.redraw)) === "done")) === true, await status(T.redraw))

  // The new tab: the same headings and rows.
  await page.goto(`${B}#new`); await page.waitForSelector("[data-newtab-section]"); await ui.idle()
  if (await page.locator(D).isVisible().catch(() => false)) await page.mouse.click(380, 400)
  const P = "[data-newtab-section]"
  const head = page.locator(`${P} [data-panel-handle][data-heading=Buttons]`).first()
  check("the new tab draws the panels' heading", (await head.count()) === 1)
  await swipe(head, -200)
  check("its Buttons heading swiped: Add a button", await page.locator(`${P} [data-swipe-under] button[aria-label='Add a button']`).isVisible().catch(() => false))
  await head.tap(); await ui.idle()
  const nr = page.locator(`${P} [data-result]`, { hasText: T.newtab }).first()
  await swipe(nr, -200)
  const nd = page.locator(`${P} button[aria-label=Settle]:not([data-tip])`).first()
  check("an Inbox row on the new tab swiped: Settle", await nd.isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}newtab.png` })
  await nd.tap().catch(() => {})
  check("and Settle settles it", (await until(async () => (await status(T.newtab)) === "done")) === true)

  // Settle on a slow server, with the note open in a tab: the row goes at once, the tab closes; Undo opens it again.
  const pathOf = async (title) => `${(await api("GET", "inbox")).find((r) => r.title === title).id}.md`
  const note = await pathOf(T.open)
  let answer
  const slow = new Promise((r) => { answer = r }), settling = (r) => r.method() === "PUT" && r.url().includes("/api/inbox/")
  await page.route("**/api/inbox/**", async (r) => { if (settling(r.request())) await slow; await r.continue() })
  await page.goto(`${B}#file/${encodeURIComponent(note)}`); await page.waitForSelector("[data-phone-header]"); await ui.idle()
  await drawer()
  const or = page.locator(`${D} [data-result]`, { hasText: T.open }).first()
  await swipe(or, 200)
  const t0 = Date.now()
  await page.locator(`${D} button[aria-label=Settle]:not([data-tip])`).first().tap()
  const gone = await until(() => page.evaluate((t) => ![...document.querySelectorAll("[data-phone-drawer] [data-result]")]
    .some((el) => el.textContent.includes(t) && el.getBoundingClientRect().height > 4), T.open), 1200)
  check("Settle on a slow server: the row goes at once", gone && Date.now() - t0 < 1000, Date.now() - t0)
  answer()
  const shownNote = () => page.evaluate((p) => decodeURIComponent(location.hash).includes(p), note)
  check("and its note's tab closes", !!(await until(async () => !(await shownNote()), 4000)), await page.evaluate(() => location.hash))
  check("and it's done", (await until(async () => (await status(T.open)) === "done", 6000)) === true)
  if (await page.locator(D).isVisible().catch(() => false)) { await page.mouse.click(380, 400); await ui.idle() }
  await page.locator("[data-sonner-toast]", { hasText: T.open }).getByRole("button", { name: "Undo" }).click().catch(() => {})
  check("Undo opens the note again", !!(await until(shownNote, 6000)), [await page.evaluate(() => location.hash), await status(T.open)])
  await page.unrouteAll()

  // A Settle the server refuses: the row comes back, with why.
  await page.route("**/api/inbox/**", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"disk full"}' }) : r.continue())
  if (!(await page.locator(D).isVisible().catch(() => false))) await drawer()
  const fr = page.locator(`${D} [data-result]`, { hasText: T.fails }).first()
  await swipe(fr, 200)
  await page.locator(`${D} button[aria-label=Settle]:not([data-tip])`).first().tap()
  check("a refused Settle says why", !!(await until(() => page.locator("[data-sonner-toast]", { hasText: "disk full" }).count())))
  check("and its row comes back", !!(await until(async () => (await fr.boundingBox().catch(() => null))?.height > 20, 4000)))
  await page.unrouteAll()
  await ctx.close()
}
{
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } })), ui = app(page)
  await page.goto(B)
  const h = page.locator("[data-sidebar-body] [data-panel-handle][data-heading=Buttons]")
  await h.waitFor(); await ui.idle()
  await h.hover(); await ui.idle()
  check("a computer: the heading's buttons show on hover, in place", await h.locator("button[aria-label='Add a button']").isVisible().catch(() => false))
  check("a computer: no swipe box on headings", (await page.locator("[data-sidebar-body] [data-panel-handle] [data-swipe-under]").count()) === 0)
  await page.close()
}

for (const [n, t] of Object.entries(kept)) if (t !== null) writeFileSync(conf(n), t); else rmSync(conf(n), { force: true })
await finish()
