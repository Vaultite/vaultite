// Phone navigation at iPhone size (real touches through CDP): the drawer by its button and the edge swipe, a note from
// its file tree, the bar's Back and Forward (core/motion.ts), a link in a note and Back to where it was scrolled, the
// bar's Search to a result, Settings and back, the tab list; on every screen nothing is wider than the phone and every
// target is 44px. WRITES Qa nav/ (two notes): throwaway server only.
//   node web/qa/phonenav.mjs <base url> <vault path> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, fingers, qa, until } from "./lib/qa.mjs"
const { args: [B, , OUT = "/tmp/phonenav-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const LONG = "Qa nav/Long walk.md", TARGET = "Qa nav/Harbour notes.md"
const paras = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} about the Lighthouse path, long enough to wrap across the phone's width twice over.`)
await api("POST", "file", { path: LONG, text: `# Long walk\n\n${paras.slice(0, 30).join("\n\n")}\n\nSee [[Harbour notes]] for the harbour.\n\n${paras.slice(30).join("\n\n")}\n` })
await api("POST", "file", { path: TARGET, text: "# Harbour notes\n\nAlice Park keeps the harbour's tide table.\n" })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const { swipe } = await fingers(page)
const shot = (n) => page.screenshot({ path: `${OUT}phonenav-${n}.png` })
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
// (not one kept drawn behind: a file tab left stays drawn, hidden)
const shown = (p) => page.locator(`#main-scroll article.file-view[data-path="${p}"]:not([data-kept] *)`).count().then((n) => n > 0)
const idle = () => until(() => page.evaluate(() => !document.documentElement.dataset.motion), 3000)
const drawer = () => page.evaluate(() => {
  const d = document.querySelector("[data-phone-drawer]")
  return d && d.getAttribute("aria-hidden") !== "true" ? Math.round(d.getBoundingClientRect().left) : null
})
const drawerOpen = () => until(async () => (await drawer()) === 0, 3000)
// (shut once it's no longer drawn: while it slides away its shade still takes taps)
const drawerShut = () => until(() => page.evaluate(() => !document.querySelector("[data-phone-drawer]")), 3000)
// (a phone scrolls the page itself, as Safari does)
/** Until what's at the middle of `sel` is it (no shade or sheet still sliding away over it). */
const tappable = (sel) => until(() => page.evaluate((sel) => {
  const e = document.querySelector(sel), r = e?.getBoundingClientRect()
  return !!r && !!e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
}, sel), 3000)
const scrollTop = () => page.evaluate(() => Math.round(document.scrollingElement.scrollTop))

/** What's wider than the phone: the page's own sideways scroll, and visible things reaching past its right edge. */
const overflow = () => page.evaluate(() => {
  const W = innerWidth, wide = []
  if (document.documentElement.scrollWidth > W) wide.push(`document ${document.documentElement.scrollWidth}`)
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect()
    if (!r.width || r.right <= W + 1 || r.left >= W) continue
    // (what an ancestor clips, a scroller's own rows, or what's slid out of sight doesn't show)
    let clipped = false
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p)
      if (s.overflowX !== "visible" && p.getBoundingClientRect().right <= W + 1) { clipped = true; break }
    }
    if (clipped || getComputedStyle(el).visibility === "hidden" || el.closest("[aria-hidden=true], [inert], [data-kept]")) continue
    wide.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).slice(0, 40)} ${Math.round(r.right)}`)
    if (wide.length > 4) break
  }
  return wide
})
/** Tap targets under 44px in `sel` (visible buttons, links, tree rows), as "label h×w". */
const small = (sel, { width = false } = {}) => page.evaluate(([sel, width]) => [...document.querySelectorAll(sel)].filter((e) => {
  const r = e.getBoundingClientRect(), s = getComputedStyle(e)
  if (!r.width || !r.height || s.visibility === "hidden" || e.closest("[aria-hidden=true]") || e.disabled) return false
  // (a hit area padded out past the box counts: the row it fills)
  return Math.round(r.height) < 44 || (width && Math.round(r.width) < 44)
}).map((e) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)} ${Math.round(e.getBoundingClientRect().height)}x${Math.round(e.getBoundingClientRect().width)}`), [sel, width])
/** The sizes of what `sel` matches, to tell when a screen's arrival (a new tab zooms in) has ended. */
const sizes = (sels) => page.evaluate((sels) => sels.flatMap((s) => [...document.querySelectorAll(s)].map((e) => { const r = e.getBoundingClientRect(); return `${r.width}x${r.height}` })).join(), sels)
const screen = async (name, targets = []) => {
  let last = ""
  await until(async () => { const now = await sizes(targets.map(([sel]) => sel)); const same = now === last; last = now; return same }, 3000, 120)
  check(`${name}: nothing wider than the phone`, !(await overflow()).length, await overflow())
  for (const [sel, opts] of targets) {
    const s = await small(sel, opts)
    check(`${name}: ${sel} 44px targets`, !s.length, s)
  }
}
const BAR = ["[data-phone-bar] button", { width: true }], HEAD = ["[data-phone-header] button", { width: true }]

try {
  await page.goto(B)
  await page.waitForSelector("[data-phone-header]", { timeout: 30000 })
  await page.waitForSelector("#main-scroll article, #main-scroll main", { timeout: 15000 })
  // A toast (the sandbox's) would sit over what's tapped.
  await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important }" })
  await idle()
  const start = await hash()
  await screen("start", [BAR, HEAD])
  await shot("1-start")

  // ---------- the drawer: the left edge swiped, then its button ----------
  await swipe(4, 420, 300, 425)
  check("the left edge swiped: the drawer opens", await drawerOpen(), await drawer())
  await swipe(320, 420, 20, 420)
  check("swiped back: it closes", await drawerShut(), await drawer())
  await tappable("[data-phone-header] button[aria-label='Open sidebar']")
  await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap()
  check("the header's button opens the drawer", await drawerOpen(), await drawer())
  await screen("drawer", [["[data-phone-drawer] [data-tree-path]"], ["[data-phone-drawer] nav[aria-label=App] a, [data-phone-drawer] nav[aria-label=App] button"]])
  await shot("2-drawer")

  // A note from its tree: its folder opened, then the note; the drawer closes.
  const folder = page.locator("[data-phone-drawer] [data-tree-path='Qa nav'][data-tree-folder]")
  await until(() => folder.count(), 5000)
  await folder.scrollIntoViewIfNeeded()
  if ((await folder.locator("[aria-expanded]").first().getAttribute("aria-expanded").catch(() => null)) !== "true") await folder.locator("button").first().tap()
  const row = page.locator(`[data-phone-drawer] [data-tree-path="${LONG}"]`)
  check("the folder opens in the drawer", !!(await until(() => row.count(), 3000)))
  await row.scrollIntoViewIfNeeded()
  await row.locator("button, a").first().tap()
  check("a note tapped in the drawer: it shows", !!(await until(() => shown(LONG), 4000)), await hash())
  check("...and the drawer closes", await drawerShut(), await drawer())
  await idle()
  check("...the header names it once its title scrolls away", !!(await until(async () => {
    await page.evaluate(() => document.scrollingElement.scrollTo({ top: 400 }))
    return (await page.locator("[data-phone-title]").innerText()).trim() === "Long walk"
  }, 3000)), await page.locator("[data-phone-title]").innerText())
  await screen("a note", [BAR, HEAD])
  await shot("3-note")

  // ---------- the bar's Back and Forward ----------
  await page.locator("[data-bar=back]").tap()
  check("Back: the page before", !!(await until(async () => (await hash()) === start && !(await shown(LONG)), 3000)), await hash())
  await idle()
  await page.locator("[data-bar=forward]").tap()
  check("Forward: the note again", !!(await until(() => shown(LONG), 3000)), await hash())
  await idle()

  // ---------- a link, then Back to where the note was scrolled ----------
  const link = page.locator(`#main-scroll article.file-view[data-path="${LONG}"]:not([data-kept] *) [data-wiki="Harbour notes"]`).first()
  await until(async () => { await page.evaluate(() => { const b = document.scrollingElement; b.scrollTop += innerHeight * 0.6 }); return link.isVisible() }, 5000)
  // (mid-screen, clear of the bar: a link under it is scrolled to by the tap itself, a place the test never measured)
  await link.evaluate((el) => el.scrollIntoView({ block: "center" }))
  check("...the link is clear to tap", !!(await until(() => link.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }), 3000)))
  const y = await scrollTop()
  check("the note scrolled down to its link", y > 300, y)
  // (where the link is on the screen: Back finds the place by its line, whose offset the editor may estimate otherwise)
  const linkTop = () => page.evaluate(() => Math.round(document.querySelector('#main-scroll article.file-view:not([data-kept] *) [data-wiki="Harbour notes"]')?.getBoundingClientRect().top ?? NaN))
  const seen = await linkTop()
  // (until the app has kept where it is: core/viewstate.ts)
  const kept = () => page.evaluate((key) => new Map(JSON.parse(localStorage.getItem("vaultite.places")).places).get(key)?.y, `file:${LONG}`)
  check("...the app keeps where it is", !!(await until(async () => (await kept()) === y, 5000)), { y, kept: await kept() })
  await link.tap()
  check("the link opens the linked note", !!(await until(() => shown(TARGET), 4000)), await hash())
  await idle()
  check("...at its top", (await scrollTop()) < 50, await scrollTop())
  await screen("the linked note", [BAR, HEAD])
  await page.locator("[data-bar=back]").tap()
  check("Back: the note the link was in", !!(await until(() => shown(LONG), 4000)), await hash())
  check("...where it was scrolled", !!(await until(async () => Math.abs((await linkTop()) - seen) <= 4, 3000)), { seen, now: await linkTop(), y, top: await scrollTop(), place: await page.evaluate((k) => new Map(JSON.parse(localStorage.getItem("vaultite.places")).places).get(k), `file:${LONG}`) })
  await idle()
  await page.locator("[data-bar=forward]").tap()
  check("Forward: the linked note again", !!(await until(() => shown(TARGET), 4000)), await hash())
  await idle()

  // ---------- the bar's Search, and a result ----------
  await page.locator("[data-bar=menu]").tap()
  await page.locator("#bar-menu [data-bar-menu=search]").tap()
  const field = page.locator("[role=dialog] input")
  await until(() => field.count(), 3000)
  await field.first().fill("tide table")
  const hit = page.locator(`[role=dialog] [role=option]`, { hasText: "Harbour notes" })
  check("Search: the note it finds is listed", !!(await until(() => hit.count(), 5000)), await page.locator("[role=dialog]").innerText().catch(() => ""))
  await screen("search", [["[role=dialog] [role=option]"]])
  await shot("4-search")
  // From the note before it, so the result shows something new.
  await page.keyboard.press("Escape")
  await until(async () => !(await page.locator("[role=dialog] input").count()), 2000)
  await page.locator("[data-bar=back]").tap()
  await until(() => shown(LONG), 4000); await idle()
  await page.locator("[data-bar=menu]").tap()
  await page.locator("#bar-menu [data-bar-menu=search]").tap()
  await until(() => field.count(), 3000)
  await field.first().fill("tide table")
  await until(() => hit.count(), 5000)
  await hit.first().tap()
  check("a result tapped: its note shows, the search closes", !!(await until(async () => (await shown(TARGET)) && !(await page.locator("[role=dialog] input").count()), 4000)), await hash())
  await idle()
  await page.locator("[data-bar=back]").tap()
  check("Back from the result: the note searched from", !!(await until(() => shown(LONG), 4000)), await hash())
  await idle()

  // ---------- Settings, and back ----------
  const before = await hash()
  await page.locator("[data-bar=menu]").tap()
  await page.locator("#bar-menu [data-bar-menu=settings]").tap()
  check("Settings opens", !!(await until(async () => /settings/i.test(await hash()) && await page.locator("#main-scroll").innerText().then((t) => /Appearance/i.test(t)), 4000)), await hash())
  await idle()
  await screen("settings", [BAR, HEAD, ["#main-scroll nav a, #main-scroll nav button, #main-scroll [role=switch]"]])
  await shot("5-settings")
  await page.locator("[data-bar=back]").tap()
  check("Back from Settings: the note before", !!(await until(async () => (await hash()) === before && (await shown(LONG)), 4000)), await hash())
  await idle()

  // ---------- the tab list ----------
  await page.locator("[data-tabs-button]").tap()
  await page.waitForSelector("[data-tab-row]")
  await idle()
  await screen("the tab list", [["dialog[open] [data-sheet-done]"]])
  await shot("6-tabs")
  await page.locator("dialog[open] [data-sheet-done]").tap()
  check("the tab list's Done: back on the note", !!(await until(async () => !(await page.locator("[data-tab-row]").count()) && (await shown(LONG)), 3000)), await hash())

  // ---------- the bar's new tab ----------
  await page.locator("[data-bar=new]").tap()
  check("the bar's +: a blank tab", !!(await until(async () => /^#new$/.test(await hash()), 3000)), await hash())
  await idle()
  await screen("a new tab", [BAR, HEAD])
  await page.locator("[data-bar=back]").tap()
  check("Back from a blank tab: the note it came from", !!(await until(() => shown(LONG), 3000)), await hash())
} catch (e) { check("ran to the end", false, String(e).slice(0, 400)) } finally {
  await ctx.close()
  await done()
}
