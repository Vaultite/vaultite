// Touch interaction check at iPhone size: tap ticks, tap-on-done/long-press open the sheet, back/swipe/Done
// close it, sheet scrolls; the header (the name stays at the top while the page scrolls), a pinned page from the
// drawer, the bar's menu, a person from the People page and [[links]] in a note opening in tabs (a link in a sheet
// closes the sheet first). Prints ok / FAIL per check and exits 1 on any failure. It TICKS A ROUTINE (writes a daily
// note), so run it against a throwaway server on a copy of the vault:
//   cp -R <vault> /tmp/v && VAULTITE_VAULT=/tmp/v PORT=8799 npm start, then QA_BASE=http://127.0.0.1:8799/ node web/qa/touch.mjs
// Its subjects come from the vault (subjects.mjs): two routines you tick by hand, the latest workout log,
// the first person with a timeline, and a note that links to another note and to a person.
import { SHOTS, qa } from "./lib/qa.mjs"
import { pageHash, subjects } from "./subjects.mjs"
const { browser, check, done } = await qa(import.meta.url)
const B = process.env.QA_BASE ?? "http://127.0.0.1:8799/"
let v = await subjects(B)
const today = `#${await pageHash(B, "Today")}`, health = `#${await pageHash(B, "Health")}`, people = `#${await pageHash(B, "People")}`
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const errs = []; page.on("pageerror", (e) => errs.push(String(e)))
const out = {}
const sheetOpen = () => page.evaluate(() => { const d = document.querySelector("dialog"); return !!d && d.open })
const shot = (n) => page.screenshot({ path: `${SHOTS}t-${n}.png` })

// Past days to poke at: Tuesday and Wednesday of last week (the grid is paged back one week first).
const pad = (n) => String(n).padStart(2, "0"), iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date(), mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - 7)
const TUE = iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 1)), WED = iso(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 2))
// Routines ticked by hand (not auto), on that weekday ("days" counts from Monday = 0), not ticked that day yet.
const free = (date, wd, not) => v.state.routines.find((r) => !r.archived && !r.auto && r.days.includes(wd) && r !== not
  && !v.state.checks.some((c) => c.routine === r.id && c.date === date))
// What it needs: one routine free on Tuesday and another free on Wednesday. A vault without them (the sample's only
// hand-ticked routine is ticked most days): made for the run, removed at the end.
const enough = () => { const t = free(TUE, "1"); return !!t && !!free(WED, "2", t) }
const made = []
for (const name of ["Qa touch one", "Qa touch two"]) {
  if (enough()) break
  const path = `${v.state.routines[0]?.id?.replace(/\/[^/]*$/, "") ?? "Routines"}/${name}.md`
  await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, text: "---\ntype: routine\nsort: 9\n---\n" }) })
  made.push(path); v = await subjects(B)
}
const tueRoutine = v.need(free(TUE, "1"), `a routine to tick by hand, not ticked on ${TUE}`).name
const wedRoutine = v.need(free(WED, "2", v.state.routines.find((r) => r.name === tueRoutine)), `a second routine to tick by hand, not ticked on ${WED}`).name
const workout = v.need(v.state.logs.find((l) => l.area === "workouts"), "a workout log").title
  .replace(/[^\p{L}\p{N}\s'-]/gu, "").trim() // the app leaves emoji out of titles
const person = v.need(v.timeline[0], "a person with a timeline").name
v.need(v.linked, "a note that links to another note and to a person")
await page.goto(B + today); await page.waitForTimeout(1500)
await page.locator('button[aria-label="Previous week"]').tap(); await page.waitForTimeout(300)
// 1. tap an empty, past cell (last Tuesday, a routine not ticked then) -> should toggle, not open sheet
const cells = page.locator(`button[aria-label^=${JSON.stringify(`${tueRoutine}, ${TUE}`)}]`)
out.cellFound = await cells.count()
await cells.first().tap(); await page.waitForTimeout(500)
out.afterTapPressed = await cells.first().getAttribute("aria-pressed"); out.sheetAfterTapEmpty = await sheetOpen()
// 2. tap the now-done cell -> opens sheet
await cells.first().tap(); await page.waitForTimeout(600)
out.sheetAfterTapDone = await sheetOpen(); out.hashDone = await page.evaluate(() => location.hash)
await shot("routine-day")
// 3. back button closes the sheet
await page.goBack(); await page.waitForTimeout(600)
out.sheetAfterBack = await sheetOpen(); out.hashAfterBack = await page.evaluate(() => location.hash)
// 4. long-press an empty cell (Wed) -> opens sheet, does not tick
const wed = page.locator(`button[aria-label^=${JSON.stringify(`${wedRoutine}, ${WED}`)}]`).first()
const b = await wed.boundingBox()
const cdp = await ctx.newCDPSession(page)
const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] })
await page.waitForTimeout(700)
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
await page.waitForTimeout(600)
out.sheetAfterLongPress = await sheetOpen(); out.wedPressed = await wed.getAttribute("aria-pressed")
// 5. swipe down on the sheet to close
if (await sheetOpen()) {
  const box = await page.locator("dialog").boundingBox()
  const s = { x: box.x + box.width / 2, y: box.y + 20 }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [s] })
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: s.x, y: s.y + i * 30 }] }); await page.waitForTimeout(16) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await page.waitForTimeout(700)
  out.sheetAfterSwipe = await sheetOpen()
}
// 6. health: open a workout row. A log is a file: on a phone it opens in a tab (Back returns), like a computer's.
await page.goto(B + health); await page.waitForTimeout(1500)
const healthHash = await page.evaluate(() => location.hash)
await page.locator("main button", { hasText: workout }).first().tap(); await page.waitForTimeout(900)
out.gymTab = await page.evaluate(() => [decodeURIComponent(location.hash), !!document.querySelector("dialog[open]"), document.querySelector("[data-phone-title]")?.textContent])
await shot("gym")
await page.goBack(); await page.waitForTimeout(700)
out.gymBack = await page.evaluate(() => location.hash)
// A sheet that isn't a file (a routine's day) scrolls inside, locks the page, and Done (its bottom bar: no backdrop, it fills the screen) closes it.
await page.goto(B + today); await page.waitForTimeout(1500)
await page.locator('button[aria-label="Previous week"]').tap(); await page.waitForTimeout(300)
await cells.first().tap(); await page.waitForTimeout(700)
out.daySheet = await sheetOpen()
out.dialogBox = await page.locator("dialog").boundingBox()
out.locked = await page.evaluate(() => document.documentElement.style.overflow === "hidden")
await shot("day-sheet")
await page.locator("dialog [data-sheet-done]").tap(); await page.waitForTimeout(600)
out.sheetAfterBackdrop = await sheetOpen()
// 7. the header while the page scrolls: it stays at the top, naming the page (the old compact title bar's job)
await page.goto(B + health); await page.waitForTimeout(1500)
await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(500)
out.scrolled = await page.evaluate(() => {
  const h = document.querySelector("[data-phone-header]"), r = h?.getBoundingClientRect()
  return { y: scrollY, top: r && Math.round(r.top), height: r && Math.round(r.height), title: document.querySelector("[data-phone-title]")?.textContent, opacity: h && getComputedStyle(h).opacity }
})
await shot("scrolled")
// 8. a pinned page from the drawer (the header's button): it shows, at the top, and the drawer closes
await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await page.waitForTimeout(500)
const drawerPages = page.locator("[data-phone-drawer=left] nav[aria-label=Pages] a")
out.drawerPages = await drawerPages.count()
await shot("drawer")
const lastPage = await drawerPages.last().getAttribute("href")
await drawerPages.last().tap(); await page.waitForTimeout(800)
out.tabHash = [lastPage, await page.evaluate(() => location.hash)]; out.scrollAfterTab = await page.evaluate(() => scrollY)
out.drawerClosed = await page.evaluate(() => document.querySelector("[data-phone-drawer]")?.getAttribute("aria-hidden") !== "false")
// 9. the bar's menu (New note, Commands, Plugins, Settings): opens above the bar, a page navigates and closes it, a
// tap outside closes it
const menuOpen = () => page.locator("#bar-menu").isVisible()
await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(300)
out.menuOpen = await menuOpen()
out.menuAbove = await page.evaluate(() => document.querySelector("#bar-menu").getBoundingClientRect().bottom <= document.querySelector("[data-phone-bar]").getBoundingClientRect().top)
const menuPage = page.locator("#bar-menu a[role=menuitem]").last()
const menuHref = await menuPage.getAttribute("href").catch(() => null)
if (menuHref) { await menuPage.tap(); await page.waitForTimeout(600) }
out.menuHash = [menuHref, await page.evaluate(() => location.hash)]; out.menuClosedAfterNav = !(await menuOpen())
await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(300)
await page.touchscreen.tap(195, 200); await page.waitForTimeout(300)
out.menuClosedAfterBackdrop = !(await menuOpen()); out.hashAfterBackdrop = await page.evaluate(() => location.hash)
// 10. a person from the People page opens their file in a tab beside it, with the profile and the timeline
await page.goto(B + people); await page.waitForTimeout(1200)
const peopleHash = await page.evaluate(() => location.hash)
const tabsBefore = Number(await page.locator("[data-tabs-button]").innerText())
await page.locator("main button", { hasText: person }).first().tap(); await page.waitForTimeout(900)
out.profile = await page.evaluate(() => [decodeURIComponent(location.hash), !!document.querySelector("dialog[open]"), document.querySelector("[data-phone-title]")?.textContent])
out.profileTabs = [tabsBefore, Number(await page.locator("[data-tabs-button]").innerText())]
out.profileHasTimeline = await page.locator("main :text('Timeline')").count()
await shot("profile")
await page.goBack(); await page.waitForTimeout(600)
out.profileBack = await page.evaluate(() => location.hash)
// 11. A note in a tab: a person wikilink opens their file in the same tab (a file replaces a file), Back returns to
// the note, a note wikilink opens that note. Then the note as a sheet (#<tab>/file/<path>): a link in it closes the
// sheet and opens the file in a tab. (Its links are .cm-wikilink.)
const noteHash = `#file/${encodeURIComponent(`${v.linked.note.id}.md`)}`
await page.goto(B + noteHash); await page.waitForTimeout(1500)
out.noteTab = await page.evaluate(() => [location.hash, !!document.querySelector("dialog[open]")])
await page.locator("main .cm-wikilink", { hasText: v.linked.personText }).first().tap(); await page.waitForTimeout(800)
out.wikiPerson = await page.evaluate(() => [decodeURIComponent(location.hash), !!document.querySelector("dialog[open]")])
await page.goBack(); await page.waitForTimeout(700)
out.backToNote = await page.evaluate(() => [location.hash, !!document.querySelector("dialog[open]")])
await page.locator("main .cm-wikilink", { hasText: v.linked.ideaText }).first().tap(); await page.waitForTimeout(800)
out.wikiNote = await page.evaluate(() => [decodeURIComponent(location.hash), !!document.querySelector("dialog[open]")])
await shot("note")
await page.goto(`${B}${today}/file/${encodeURIComponent(`${v.linked.note.id}.md`)}`); await page.waitForTimeout(1500)
out.noteSheet = await sheetOpen()
await page.locator("dialog .cm-wikilink", { hasText: v.linked.personText }).first().tap(); await page.waitForTimeout(1000)
out.sheetLink = await page.evaluate(() => [decodeURIComponent(location.hash), !!document.querySelector("dialog[open]")])
out.errs = errs
console.log(JSON.stringify(out, null, 1))
await browser.close()
for (const path of made) await fetch(`${B}api/file?path=${encodeURIComponent(path)}`, { method: "DELETE" })

const filePath = (p) => `#file/${p}`
check("a tap on an empty past cell ticks it, no sheet", out.cellFound > 0 && out.afterTapPressed === "true" && !out.sheetAfterTapEmpty, out)
check("a tap on a ticked cell opens its day's sheet", out.sheetAfterTapDone && /\/routine\//.test(out.hashDone), out.hashDone)
check("Back closes the sheet", !out.sheetAfterBack && !/\/routine\//.test(out.hashAfterBack), out.hashAfterBack)
check("a long press opens the sheet without ticking", out.sheetAfterLongPress && out.wedPressed !== "true", [out.sheetAfterLongPress, out.wedPressed])
check("a swipe down on the sheet closes it", out.sheetAfterSwipe === false, out.sheetAfterSwipe)
check("a workout opens its log in a tab, not a sheet", out.gymTab[0].startsWith(filePath("Logs/")) && !out.gymTab[1] && !!out.gymTab[2], out.gymTab)
check("Back from it: Health again", out.gymBack === healthHash, [out.gymBack, healthHash])
check("a day's sheet fits the screen and locks the page", out.daySheet && out.dialogBox && out.dialogBox.y >= 0 && out.dialogBox.y + out.dialogBox.height <= 845 && out.locked, [out.dialogBox, out.locked])
check("Done closes it", out.sheetAfterBackdrop === false)
check("scrolled: the header stays at the top, naming the page", out.scrolled.y > 0 && out.scrolled.top === 0 && out.scrolled.height <= 50 && out.scrolled.title === "Health" && out.scrolled.opacity === "1", out.scrolled)
check("drawer: lists the pinned pages", out.drawerPages === v.state.pinned.length && out.drawerPages > 0, { drawn: out.drawerPages, pinned: v.state.pinned })
check("drawer: a pinned page shows at its top, and the drawer closes", out.tabHash[0] === out.tabHash[1] && out.scrollAfterTab === 0 && out.drawerClosed, [out.tabHash, out.scrollAfterTab, out.drawerClosed])
check("the bar's menu opens above the bar", out.menuOpen && out.menuAbove, [out.menuOpen, out.menuAbove])
check("a page from the menu shows and the menu closes", !!out.menuHash[0] && out.menuHash[0] === out.menuHash[1] && out.menuClosedAfterNav, out.menuHash)
check("a tap outside closes the menu, staying put", out.menuClosedAfterBackdrop && out.hashAfterBackdrop === out.menuHash[1], [out.menuClosedAfterBackdrop, out.hashAfterBackdrop])
check("People: a person opens in a tab beside the page, with the timeline", out.profile[0].startsWith(filePath("People/")) && !out.profile[1] && out.profile[2] === person && out.profileTabs[1] === out.profileTabs[0] + 1 && out.profileHasTimeline > 0, [out.profile, out.profileTabs, out.profileHasTimeline])
check("Back from the person: People", out.profileBack === peopleHash, [out.profileBack, peopleHash])
check("a note opens in a tab", out.noteTab[0] === noteHash && !out.noteTab[1], out.noteTab)
check("a person [[link]] in it opens their file in the tab", out.wikiPerson[0].startsWith(filePath("People/")) && !out.wikiPerson[1], out.wikiPerson)
check("Back: the note again", out.backToNote[0] === noteHash && !out.backToNote[1], out.backToNote)
check("a note [[link]] opens that note in the tab", out.wikiNote[0].startsWith("#file/") && out.wikiNote[0] !== decodeURIComponent(noteHash) && !out.wikiNote[1], out.wikiNote)
check("a note's sheet address opens its sheet", out.noteSheet === true, out.noteSheet)
check("a [[link]] in a sheet: the sheet closes, the file shows in a tab", out.sheetLink[0].startsWith(filePath("People/")) && !out.sheetLink[1], out.sheetLink)
await done()
