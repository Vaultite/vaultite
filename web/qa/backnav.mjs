// Back from what a page opened (a person's tab beside People, a sheet) and adding to a timeline, desktop and phone.
// WRITES timeline lines and tabs: throwaway server only.
//   node web/qa/backnav.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync } from "node:fs"
import { BACK_KEY, qa, until, wait } from "./lib/qa.mjs"
import { pagePath, subjects } from "./subjects.mjs"
const { args: [B, VAULT, OUT = "/tmp/backnav-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const enc = encodeURIComponent
const v = await subjects(B)
const withTl = v.need(v.timeline[0], "a person with a timeline")
const without = v.people.find((p) => !/^#{1,6}\s+timeline\s*$/im.test(p.text))
const PEOPLE = await pagePath(B, "People")
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const read = (p) => readFileSync(`${VAULT}/${p}`, "utf8")

/** Scroll the page down to its drawn timeline: the editor draws only what's near the screen, so on a long page (a
 *  person's profile, with its check-ins) the timeline isn't there until it's scrolled near. */
const toTimeline = async (page) => {
  for (let i = 0; i < 40 && !(await page.locator(".file-timeline").count()); i++) {
    await page.evaluate(() => { const s = document.querySelector("#main-scroll") ?? document.scrollingElement; s.scrollTop += s.clientHeight * 0.8 })
    await wait(150)
  }
}
const open = async (w, h, mobile = false) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile })
  const page = watch(await ctx.newPage(), { console: true })
  return { ctx, page }
}

// ---------- desktop: Back from a file opened from a page ----------
{
  const { ctx, page } = await open(1440, 700)
  await page.goto(`${B}#file/${enc(PEOPLE)}`); await wait(2500)
  const tabs = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane] [role=tab]")].map((t) => ({ name: t.innerText.trim(), on: t.getAttribute("aria-selected") === "true" })))
  const active = async () => (await tabs()).find((t) => t.on)?.name
  const scrollTop = () => page.evaluate(() => document.getElementById("main-scroll")?.scrollTop ?? 0)
  // A person the page lists on its first screen, low enough to stay in sight once it's scrolled (clicking one out of
  // sight would scroll the page itself), whose tab isn't open yet.
  const SCROLL = 150
  const [name, nth] = await (async () => {
    const box = await page.locator("#main-scroll").boundingBox()
    for (const p of v.people) {
      const all = await page.locator("#main-scroll").getByText(p.name, { exact: true }).all()
      for (let i = 0; i < all.length; i++) {
        const b = await all[i].boundingBox()
        if (b && b.y >= box.y + SCROLL + 40 && b.y + b.height <= box.y + box.height - 20) return [p.name, i]
      }
    }
    return [null, 0]
  })()
  const person = v.need(v.people.find((p) => p.name === name), "a person on the People page's first screen")
  for (let i = 0; i < 5 && (await tabs()).some((t) => t.name === person.name); i++) {
    await page.locator("[role=tab]", { hasText: person.name }).first().click({ button: "middle" }); await wait(300)
  }
  if ((await active()) !== "People") { await page.locator("[role=tab]", { hasText: "People" }).first().click(); await wait(500) }
  await page.evaluate((top) => document.getElementById("main-scroll").scrollTo({ top }), SCROLL)
  // (until the app has kept where it is: core/viewstate.ts)
  const kept = () => page.evaluate((key) => { try { return new Map(JSON.parse(localStorage.getItem("vaultite.places")).places).get(key)?.y } catch { return undefined } }, `file:${PEOPLE}`)
  check("People scrolls, and where is kept", await until(async () => { const t = await scrollTop(); return t > 0 && (await kept()) === t }), { now: await scrollTop(), kept: await kept() })
  const y = await scrollTop()
  const row = () => page.locator("#main-scroll").getByText(person.name, { exact: true }).nth(nth)
  await row().click(); await wait(1000)
  check("a person opened from People goes in a tab beside it", (await active()) === person.name && (await tabs()).some((t) => t.name === "People"), await tabs())
  const back = page.locator("#main-scroll [aria-label='Navigate back']")
  check("...and its Back can go somewhere", await back.isEnabled())
  await back.click(); await wait(800)
  check("Back closes it and shows People", (await active()) === "People" && !(await tabs()).some((t) => t.name === person.name), await tabs())
  // (restored as People draws again: up to 1.5 s on a loaded machine)
  check("...where it was scrolled", !!(await until(async () => (await scrollTop()) === y, 4000)), { y, now: await scrollTop() })
  check("...and the address follows", await page.evaluate(() => location.hash) === `#file/${enc(PEOPLE)}`, await page.evaluate(() => location.hash))
  // Open already (left by switching tabs): the same.
  await row().click(); await wait(800)
  await page.locator("[role=tab]", { hasText: "People" }).first().click(); await wait(500)
  await row().click(); await wait(800)
  check("a person's tab open already shows", (await active()) === person.name && (await tabs()).filter((t) => t.name === person.name).length === 1, await tabs())
  await page.keyboard.press(BACK_KEY); await wait(800)
  check("Back's keys from it close it and shows People", (await active()) === "People" && !(await tabs()).some((t) => t.name === person.name), await tabs())

  // A sheet open: Back closes it first, the tab stays.
  await page.evaluate(() => { location.hash = `${location.hash}/plugin-settings/page-preview` }); await wait(800)
  check("a sheet is open", await page.locator("dialog[open]").count() > 0)
  await page.keyboard.press(BACK_KEY); await wait(800)
  check("Back closes the sheet, the tab stays", !(await page.locator("dialog[open]").count()) && (await active()) === "People", await tabs())

  // The path bar's folder: in the file tree, opened and in sight.
  await page.goto(`${B}#file/${enc(withTl.path)}`); await wait(2000)
  const folder = withTl.path.split("/").slice(0, -1).join("/")
  await page.locator("nav[aria-label='File path'] button", { hasText: folder.split("/").pop() }).first().click(); await wait(1500)
  const seen = await page.evaluate((f) => {
    const row = [...document.querySelectorAll(`[data-tree-path="${CSS.escape(f)}"]`)].find((e) => e.offsetParent)
    if (!row) return null
    const r = row.getBoundingClientRect()
    let top = 0, bottom = innerHeight
    for (let p = row.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowY === "visible") continue
      const b = p.getBoundingClientRect(); top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom)
    }
    return { open: row.closest("[role=treeitem]")?.getAttribute("aria-expanded"), inSight: r.top >= top && r.bottom <= bottom }
  }, folder)
  check("the path bar's folder opens in the file tree, in sight", seen?.open === "true" && seen.inSight, seen)
  await page.screenshot({ path: `${OUT}folder.png` })
  // (with no Files panel the tree opened as a tab: back to the person)
  await page.goto(`${B}#file/${enc(withTl.path)}`); await page.reload(); await wait(2500)

  // ---------- desktop: Add on a drawn timeline ----------
  await toTimeline(page)
  const tl = page.locator(".file-timeline")
  await tl.locator("button", { hasText: "Add" }).first().scrollIntoViewIfNeeded()
  await tl.locator("button", { hasText: "Add" }).first().click(); await wait(300)
  check("Add opens the form, today filled in", await tl.locator("form input[type=date]").inputValue() === today)
  await tl.locator("[role=radio]", { hasText: "Text" }).click()
  await tl.locator("input[aria-label=Minutes]").fill("5")
  await tl.locator("input[aria-label=Text]").fill("Added from the timeline on a computer")
  await page.screenshot({ path: `${OUT}timeline-form.png` })
  await page.keyboard.press("Enter"); await wait(1500)
  check("the line is in the file, first", read(withTl.path).includes(`\n- ${today} · text · 5 min · Added from the timeline on a computer\n`), read(withTl.path).split("## Timeline")[1]?.slice(0, 200))
  check("...drawn, and the form closed", (await tl.innerText()).includes("Added from the timeline on a computer") && !(await tl.locator("form").count()))
  await tl.locator("button", { hasText: "Add" }).first().click(); await wait(300)
  await page.keyboard.press("Escape"); await wait(300)
  check("Escape closes the form", !(await tl.locator("form").count()))

  if (without) {
    await page.goto(`${B}#file/${enc(without.path)}`); await wait(2000)
    const add = page.locator("button", { hasText: "Add to timeline" })
    check("a person without a timeline has Add to timeline", await add.count() === 1)
    await add.click(); await wait(300)
    await page.keyboard.press("Enter"); await wait(1500)
    check("...which makes the timeline with the line", read(without.path).endsWith(`## Timeline\n\n- ${today} · call\n`), read(without.path).slice(-80))
    check("...drawn, its button gone", await page.locator(".file-timeline").count() === 1 && !(await add.count()))
  }
  await ctx.close()
}

// ---------- phone: Add on a drawn timeline ----------
{
  const { ctx, page } = await open(390, 844, true)
  await page.goto(`${B}#file/${enc(withTl.path)}`); await wait(2500)
  await toTimeline(page)
  const tl = page.locator(".file-timeline")
  const add = tl.locator("button", { hasText: "Add" }).first()
  await add.scrollIntoViewIfNeeded()
  const box = await add.boundingBox()
  check("phone: Add is a 44px target", box && box.height >= 44, box)
  await add.tap(); await wait(300)
  await tl.locator("[role=radio]", { hasText: "Note" }).tap()
  check("phone: a note needs its text", await tl.locator("button[type=submit]").isDisabled())
  await tl.locator("input[aria-label=Text]").fill("Added from the timeline on a phone")
  await page.screenshot({ path: `${OUT}timeline-phone.png` })
  await tl.locator("button[type=submit]").tap(); await wait(1500)
  check("phone: the line is in the file", read(withTl.path).includes(`- ${today} · note · Added from the timeline on a phone\n`), read(withTl.path).split("## Timeline")[1]?.slice(0, 200))
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  check("phone: nothing wider than the screen", !over)
  await ctx.close()
}

await done()
