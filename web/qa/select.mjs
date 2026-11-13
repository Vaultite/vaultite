// Selecting several things (core/select.ts) on a desktop and with real touches on a phone, and the Inbox's swipes.
// Writes Qa select/, Inbox/, pinned pages and sidebars.json (put back): throwaway server only.
//   node web/qa/select.mjs <base url> [shots dir]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { apiAt, fingers, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, OUT = "/tmp/select-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const VAULT = (await (await fetch(new URL("api/vault", B))).json()).path
const api = apiAt(B.endsWith("/") ? B : `${B}/`)
const exists = async (p) => (await fetch(new URL(`api/file?path=${encodeURIComponent(p)}`, B))).ok
const DIR = "Qa select"
for (const f of ["A", "B", "C"]) await api("POST", "file", { path: `${DIR}/${f}.md`, text: `# ${f}\n` })
await api("POST", "file", { path: `${DIR}/Into/Keep.md`, text: "# Keep\n" })
const sidebarsFile = path.join(VAULT, ".vaultite/sidebars.json")
const sidebars = readFileSync(sidebarsFile, "utf8")

// ---------- desktop
{
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } })), ui = app(page)
  const row = (p) => page.locator(`aside [data-tree-path="${p}"]`).first()
  const picked = () => page.evaluate(() => [...document.querySelectorAll("aside [role=tree] [data-selected]")].map((r) => r.dataset.treePath))
  const menu = () => page.locator("[role=menu] button, [role=menu] [role=menuitem], [role=menu] p, [role=menu] div").allInnerTexts().then((t) => t.join("|"))
  await page.goto(`${B}#file/${encodeURIComponent(`${DIR}/A.md`)}`); await row(DIR).waitFor(); await ui.idle()
  if (!(await row(`${DIR}/A.md`).count())) { await row(DIR).locator("> button[data-keyrow]").click(); await ui.idle() }
  await row(`${DIR}/A.md`).locator("> button[data-keyrow]").click(); await ui.idle()
  await row(`${DIR}/C.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  let got = await picked()
  check("⌘-click picks it, with the open file", got.length === 2 && got.includes(`${DIR}/A.md`) && got.includes(`${DIR}/C.md`), got)
  check("⌘-click didn't open a tab", (await page.locator("[role=tablist] [role=tab]").count()) === 1, await page.locator("[role=tablist] [role=tab]").allInnerTexts())
  await row(`${DIR}/B.md`).locator("> button[data-keyrow]").click({ modifiers: ["Shift"] }); await ui.idle()
  got = await picked()
  check("⇧-click: the run from the last picked", got.length === 2 && got.includes(`${DIR}/B.md`) && got.includes(`${DIR}/C.md`), got)
  await page.keyboard.press("Escape"); await ui.idle()
  check("Esc lets go", (await picked()).length === 0, await picked())
  // Pin both from the selection's menu.
  await row(`${DIR}/A.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] })
  await row(`${DIR}/B.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  got = await picked()
  check("⌘-click twice: those two", got.length === 2 && got.includes(`${DIR}/B.md`), got)
  await ui.menu.context(row(`${DIR}/B.md`))
  const m = await menu()
  check("its menu: how many, Move to…, Pin, Delete", /2 items selected/.test(m) && /Move to…/.test(m) && /\bPin\b/.test(m) && /Delete/.test(m), m)
  await page.screenshot({ path: `${OUT}desktop-menu.png` })
  await page.locator("[role=menu] button", { hasText: /^Pin$/ }).first().click(); await ui.idle()
  const pins = await until(async () => { const s = await api("GET", "state"); const p = s.pinned ?? []; return p.includes(`${DIR}/A.md`) && p.includes(`${DIR}/B.md`) ? p : null })
  check("Pin pinned both", !!pins, pins)
  check("the selection is let go after", (await picked()).length === 0, await picked())
  // Pinned's rows: select both, Unpin.
  const pin = (p) => page.locator(`aside [data-pin="${p}"]`).first()
  await pin(`${DIR}/A.md`).click({ modifiers: ["ControlOrMeta"] }); await pin(`${DIR}/B.md`).click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  check("Pinned: two picked", (await page.locator("aside [data-pin][data-selected]").count()) === 2, await page.locator("aside [data-pin][data-selected]").count())
  await ui.menu.context(pin(`${DIR}/A.md`))
  check("Pinned's menu: 2 pages selected, Unpin", /2 pages selected/.test(await menu()) && /Unpin/.test(await menu()), await menu())
  await page.locator("[role=menu] button", { hasText: /^Unpin$/ }).first().click(); await ui.idle()
  const unpinned = await until(async () => { const p = (await api("GET", "state")).pinned ?? []; return !p.includes(`${DIR}/A.md`) && !p.includes(`${DIR}/B.md`) })
  check("Unpin unpinned both", !!unpinned)
  // Drag both onto a folder.
  await row(`${DIR}/A.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] })
  await row(`${DIR}/B.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  const from = await row(`${DIR}/A.md`).boundingBox(), to = await row(`${DIR}/Into`).boundingBox()
  await page.mouse.move(from.x + 40, from.y + from.height / 2); await page.mouse.down()
  await page.mouse.move(from.x + 48, from.y + from.height / 2 + 4, { steps: 2 })
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 10 }); await page.locator("[data-drag-ghost]").waitFor(); await ui.idle()
  const ghost = await page.evaluate(() => document.querySelector("[data-drag-ghost]")?.textContent ?? null)
  check("the ghost says how many", /2 items/.test(ghost ?? ""), ghost)
  await page.mouse.up(); await ui.idle()
  const moved = await until(async () => (await exists(`${DIR}/Into/A.md`)) && (await exists(`${DIR}/Into/B.md`)))
  check("dropped on a folder: both moved", !!moved)
  // Delete both: one toast.
  if (!(await row(`${DIR}/Into/A.md`).count())) { await row(`${DIR}/Into`).locator("> button[data-keyrow]").click(); await ui.idle() }
  await row(`${DIR}/Into/A.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] })
  await row(`${DIR}/Into/B.md`).locator("> button[data-keyrow]").click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  await ui.menu.context(row(`${DIR}/Into/A.md`))
  await page.locator("[role=menu] button", { hasText: /^Delete$/ }).first().click(); await ui.idle()
  const gone = await until(async () => !(await exists(`${DIR}/Into/A.md`)) && !(await exists(`${DIR}/Into/B.md`)))
  check("Delete: both to the trash", !!gone)
  const toast = await page.locator("[data-sonner-toast]").allInnerTexts()
  check("one toast for both, with Undo", toast.some((t) => /Moved 2 items to trash/.test(t) && /Undo/.test(t)), toast)
  // Tabs: ⌘-click two, close both.
  await row(`${DIR}/C.md`).locator("> button[data-keyrow]").click({ button: "middle" }); await ui.idle()
  await row(`${DIR}/Into/Keep.md`).locator("> button[data-keyrow]").click({ button: "middle" }); await ui.idle()
  const tabs = page.locator("[data-tab-bar] [data-tab-id]")
  const n = await tabs.count()
  await tabs.nth(n - 1).click({ modifiers: ["ControlOrMeta"] }); await tabs.nth(n - 2).click({ modifiers: ["ControlOrMeta"] }); await ui.idle()
  const tabPicks = await page.locator("[data-tab-bar] [data-tab-id][data-selected]").count()
  check("tabs: ⌘-click picks (with the one shown)", tabPicks >= 2, tabPicks)
  await ui.menu.context(tabs.nth(n - 1))
  const tm = await menu()
  check(`tabs' menu: Close ${tabPicks} tabs`, new RegExp(`Close ${tabPicks} tabs`).test(tm), tm)
  await page.locator("[role=menu] button", { hasText: new RegExp(`^Close ${tabPicks} tabs$`) }).first().click(); await ui.idle()
  check("closed them", (await tabs.count()) === Math.max(1, n - tabPicks), { before: n, after: await tabs.count() })
  // The keyboard: ⇧↓ adds the next row, ⌘A every row, Esc lets go.
  await row(`${DIR}/C.md`).locator("> button[data-keyrow]").focus()
  await page.keyboard.press("Shift+ArrowDown"); await ui.idle()
  check("⇧↓: this row and the next", (await picked()).length === 2, await picked())
  await page.keyboard.press("ControlOrMeta+a"); await ui.idle()
  const all = (await picked()).length
  check("⌘A: every row in sight", all > 3, all)
  await page.keyboard.press("Escape"); await ui.idle()
  check("Esc lets go (the keyboard stays in the list)", (await picked()).length === 0 && await page.evaluate(() => !!document.activeElement?.closest("[role=tree]")), await picked())
  await page.close()
}

// ---------- a phone
{
  writeFileSync(sidebarsFile, JSON.stringify({ left: ["inbox:inbox", "pages:pages", "files:files"], right: [], collapsed: [] }))
  for (const t of ["Swipe me done", "Swipe me in the drawer"]) await api("POST", "inbox", { title: t, body: "Body.", from: "Qa" })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = watch(await ctx.newPage()), ui = app(page)
  const { touch, swipe } = await fingers(page)
  const hold = async (loc) => {
    const b = await loc.boundingBox(); const x = b.x + Math.min(60, b.width / 2), y = b.y + b.height / 2
    await touch("touchStart", x, y); await until(() => page.locator("[role=menu]").count(), 3000); await touch("touchEnd", x, y); await ui.idle()
  }
  const status = async (title) => (await api("GET", "inbox")).find((r) => r.title === title)?.status
  await page.goto(`${B}#view/inbox`)
  const res = page.locator("[data-inbox-view] [data-result]", { hasText: "Swipe me done" }).first()
  await res.waitFor(); await ui.idle()
  const b = await res.boundingBox()
  await swipe(b.x + b.width - 30, b.y + b.height / 2, b.x + b.width - 200, b.y + b.height / 2 + 3); await ui.idle()
  const done = page.locator("[data-inbox-view] button[aria-label=Settle]:not([data-tip])").first()
  check("the Inbox page: a result swiped left shows Settle", await done.isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}phone-page-swipe.png` })
  await done.tap().catch(() => {}); await ui.idle()
  check("Settle marks it done", (await until(async () => (await status("Swipe me done")) === "done")) === true, await status("Swipe me done"))
  // The drawer's Inbox panel: swiped right (away from the drawer's edge).
  await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await ui.idle()
  const pr = page.locator("[data-phone-drawer] [data-result]").first()
  check("the drawer shows the Inbox panel's result", (await pr.count()) > 0)
  if (await pr.count()) {
    const r = await pr.boundingBox()
    await swipe(r.x + 20, r.y + r.height / 2, r.x + 200, r.y + r.height / 2 + 3); await ui.idle()
    const d2 = page.locator("[data-phone-drawer] button[aria-label=Settle]:not([data-tip])").first()
    check("the drawer: a row swiped right shows Settle", await d2.isVisible().catch(() => false))
    await page.screenshot({ path: `${OUT}phone-drawer-swipe.png` })
    await d2.tap().catch(() => {}); await ui.idle()
    check("and Settle marks it done", (await until(async () => (await status("Swipe me in the drawer")) === "done")) === true)
  }
  // The tree in the drawer: hold a row, Select, tap another (two files in sight, above the toasts).
  const files = page.locator("[data-phone-drawer] [role=tree] [data-tree-path]:not([data-tree-folder])")
  const t1 = files.nth(0), t2 = files.nth(1)
  await hold(t1)
  const sel = page.locator("[role=menu] button", { hasText: /^Select$/ }).first()
  check("a held row's menu has Select", (await sel.count()) > 0, await page.locator("[role=menu] button").allInnerTexts())
  await sel.tap(); await ui.idle()
  await t2.locator("> button[data-keyrow]").tap(); await ui.idle()
  const bar = await page.locator("[data-selection-bar]").innerText().catch(() => "")
  check("the bar: 2 items selected", /2 items selected/.test(bar), bar)
  await page.screenshot({ path: `${OUT}phone-select.png` })
  await page.locator("[data-selection-bar] button[aria-label=Actions]").tap(); await ui.idle()
  const acts = await page.locator("[role=menu] button").allInnerTexts()
  check("its Actions: Move to…, Delete", acts.some((t) => /Move to/.test(t)) && acts.some((t) => /Delete/.test(t)), acts)
  await page.mouse.click(5, 5); await ui.idle()
  await page.locator("[data-selection-bar] button", { hasText: "Done" }).tap(); await ui.idle()
  check("Done ends it", !(await page.locator("[data-selection-bar]").count()))
  await ctx.close()
}

writeFileSync(sidebarsFile, sidebars)
await done()
