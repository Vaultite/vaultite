// Sheets and files at iPhone 15 size (393x852 @3x, touch, Safari's user agent), by real taps: files open in tabs
// (from People, the tree, [[links]] and the map) and Back returns to the place and its scroll; a sheet (a colleague, a
// routine's day, a deep link) fits, locks the page and gives its scroll back, closes by Close, Done and its
// header's drag, and a [[link]] in it closes it; the map under a sheet stays; nothing wider than the screen. Needs a
// note that links to another note and to a person (subjects.mjs). Only taps, but it empties workspace 1 each pass:
//   node web/qa/sheets.mjs <base url> [out dir]
import { SHOTS, WEBGL, qa } from "./lib/qa.mjs"
import { pageHash, subjects } from "./subjects.mjs"
const { args: [B, OUT = SHOTS], browser, check, done } = await qa(import.meta.url, { chrome: { args: WEBGL } })
const get = async (p) => (await fetch(B + p)).json()
const enc = encodeURIComponent // ids are vault paths ("Notes/Idea"), encoded in the hash
const v = await subjects(B), state = v.state
const { note: take, idea, person, personText, ideaText } = v.need(v.linked, "a note that links to another note and to a person")
const file = (id) => `file/${enc(`${id}.md`)}` // a person or note id -> its file's detail path
const PEOPLE = `#${await pageHash(B, "People")}`, WORK = `#${await pageHash(B, "Work")}`
const name = (id) => id.split("/").pop() // what the file view shows as the title (the file name)
const personName = name(person.id)
// Links in the editor: [[wikilinks]] drawn by the live preview. The editor only draws lines near the screen, so scroll
// the sheet down until the link exists.
async function wiki(page, target, not) {
  let l = page.locator("dialog .cm-wikilink:not(.is-missing)", target ? { hasText: target } : {})
  if (not) l = l.filter({ hasNotText: not })
  for (let i = 0; i < 40 && !(await l.count()); i++) {
    await page.evaluate(() => document.querySelector("dialog .overflow-y-auto").scrollBy(0, 300)); await page.waitForTimeout(120)
  }
  return l.first()
}
/** The same in a tab: the page (the window, on a phone) scrolls down from where it is until the link is drawn. Only the
 *  tab on screen: a pane keeps the last tabs drawn but hidden (TabBody), so the note just left is in the page too. */
async function tabLink(page, target) {
  const l = page.locator("main .cm-wikilink:not(.is-missing)", { hasText: target }).filter({ visible: true })
  for (let i = 0; i < 40 && !(await l.count()); i++) { await page.evaluate(() => scrollBy(0, 300)); await page.waitForTimeout(120) }
  return l.first()
}
const IPHONE = {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
}

for (const scheme of ["light", "dark"]) {
  // Each pass on an empty workspace: tabs are saved in the vault and shared by every device on the same workspace, so
  // the light pass's tabs would otherwise be there when the dark one starts (a person's tab already open, no history).
  await fetch(`${B}api/workspaces/1`, { method: "DELETE" })
  const ctx = await browser.newContext({ ...IPHONE, colorScheme: scheme })
  const page = await ctx.newPage()
  const errs = []
  page.on("pageerror", (e) => errs.push(String(e)))
  page.on("console", (m) => m.type() === "error" && !/tiles\.openfreemap|Failed to load resource/.test(m.text()) && errs.push(m.text()))
  const s = scheme === "light" ? "" : `${scheme} `
  const shot = (n) => page.screenshot({ path: `${OUT}sheet-${scheme}-${n}.png` })
  const wait = (ms = 600) => page.waitForTimeout(ms)
  const st = () => page.evaluate(() => {
    const d = document.querySelector("dialog"), sc = d?.querySelector(".overflow-y-auto"), r = d?.getBoundingClientRect()
    const back = d?.querySelector("header button[aria-label^=Back]")
    return {
      hash: location.hash, open: !!d?.open, depth: history.state?.sheet ?? 0, title: d?.querySelector("#sheet-title")?.textContent ?? null,
      back: back ? back.textContent : null, top: sc ? Math.round(sc.scrollTop) : null,
      over: sc ? sc.scrollWidth - sc.clientWidth : 0, pageW: document.documentElement.scrollWidth,
      box: r && [Math.round(r.top), Math.round(r.bottom)], locked: document.documentElement.style.overflow === "hidden",
    }
  })
  const scrollSheet = (y) => page.evaluate((y) => document.querySelector("dialog .overflow-y-auto").scrollTo(0, y), y)
  const compactShown = () => page.waitForFunction(() => getComputedStyle(document.querySelector("dialog header [aria-hidden].truncate")).opacity === "1", null, { timeout: 1500 }).then(() => true, () => false)
  // Phones close a sheet from its bottom bar (Done); the header's X is for computers.
  const tapClose = () => page.locator("dialog [data-sheet-done]").tap()
  const fits = (x) => x.over <= 0 && x.pageW <= 393 && x.box[0] >= 0 && x.box[1] <= 852

  const fileHash = (id) => `#file/${enc(`${id}.md`)}`
  /** The phone's tab on screen: its address, the header's name, the open tabs, the window's scroll. */
  const tb = () => page.evaluate(() => ({
    hash: location.hash, sheet: !!document.querySelector("dialog")?.open, title: document.querySelector("[data-phone-title]")?.textContent ?? null,
    tabs: Number(document.querySelector("[data-tabs-button]")?.innerText), y: Math.round(scrollY), pageW: document.documentElement.scrollWidth,
    locked: document.documentElement.style.overflow === "hidden",
  }))
  const inTab = (t) => !t.sheet && !t.locked && t.pageW <= 393

  // A. People list: a person opens in a tab beside the page, not a sheet; Back returns to the list where it was.
  await page.goto(`${B}${PEOPLE}`); await page.evaluate(() => localStorage.setItem("people.view", "list")); await page.reload(); await wait(1200)
  await page.evaluate(() => scrollTo(0, 700)); await wait(300)
  const y = await page.evaluate(() => scrollY)
  const row = await page.evaluate(() => { const b = [...document.querySelectorAll("main button")].find((e) => { const r = e.getBoundingClientRect(); return r.top > 200 && r.bottom < 600 && e.textContent.trim() }); b?.setAttribute("data-qa", "row"); return b?.textContent })
  const n0 = (await tb()).tabs
  await page.locator("[data-qa=row]").tap(); await wait()
  let t = await tb()
  check(`${s}A list opens the person in a tab beside it`, inTab(t) && /^#file\/People/.test(t.hash) && t.tabs === n0 + 1 && t.y === 0, { row, ...t })
  if (!s) await shot("profile")
  await page.goBack(); await wait()
  t = await tb()
  check(`${s}A Back returns to the list`, inTab(t) && t.hash === PEOPLE, t)
  check(`${s}A ...where it was scrolled`, t.y === y, { y, now: t.y })

  // B. Files -> note in a tab, read down, person wikilink -> their file in the tab (at the top) -> Back to the same
  // spot -> note link -> the idea -> system back -> Forward.
  await page.goto(`${B}#view/files`); await wait(1000)
  if (!(await page.locator(`main [role=tree] button:has-text("${name(take.id)}")`).count())) {
    await page.locator(`main [role=tree] [data-tree-path="${take.id.split("/").slice(0, -1).join("/")}"] > button`).first().tap(); await wait(300)
  }
  await page.locator(`main [role=tree] button:has-text("${name(take.id)}")`).first().tap(); await wait(1200)
  t = await tb()
  check(`${s}B note opens in a tab, named in the header`, inTab(t) && t.hash === fileHash(take.id) && t.title === name(take.id), t)
  if (!s) await shot("note")
  await page.evaluate(() => scrollTo(0, 500)); await wait(300)
  const scrolled = await page.evaluate(() => scrollY)
  const head = await page.locator("[data-phone-header]").boundingBox()
  check(`${s}B the header stays at the top as it scrolls`, head.y === 0 && (await page.locator("[data-phone-title]").innerText()) === name(take.id), head)
  if (!s) await shot("note-scrolled")
  const link = await tabLink(page, personText)
  await link.scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, -120)); await wait(200)
  const readAt = (await tb()).y
  await link.tap(); await wait(1200)
  t = await tb()
  check(`${s}B wikilink opens the person in the tab, at the top`, inTab(t) && t.hash === fileHash(person.id) && t.y === 0 && t.title === personName, t)
  if (!s) await shot("person-from-note")
  await page.locator("[data-bar=back]").tap(); await wait(900)
  t = await tb()
  check(`${s}B Back returns to the note`, inTab(t) && t.hash === fileHash(take.id), t)
  check(`${s}B ...at the reading position`, Math.abs(t.y - readAt) <= 2, { readAt, now: t.y, scrolled })
  await page.evaluate(() => scrollTo(0, 0)); await wait(200)
  const noteLink = await tabLink(page, ideaText)
  await noteLink.scrollIntoViewIfNeeded(); await wait(200)
  const readAt2 = (await tb()).y
  await noteLink.tap(); await wait(1200)
  t = await tb()
  check(`${s}B note link opens the idea at the top`, inTab(t) && t.title === name(idea.id) && t.y === 0, t)
  await page.goBack(); await wait(900) // system back (Safari edge swipe) behaves like Back
  t = await tb()
  check(`${s}B history back = Back`, inTab(t) && t.hash === fileHash(take.id), t)
  check(`${s}B ...at the reading position`, Math.abs(t.y - readAt2) <= 2, { readAt2, now: t.y })
  await page.goForward(); await wait(900)
  check(`${s}B Forward: the idea again`, (await tb()).title === name(idea.id), await tb())

  // C. Deep links to a file (the bottom history entry is a sheet): the sheet shows it; Close really closes; a [[link]]
  // in it closes the sheet and opens the file in a tab.
  await page.goto(`${B}#view/files/${file(take.id)}`); await wait(1500)
  let x = await st()
  check(`${s}C deep link: a sheet, no Back`, x.open && x.title === name(take.id) && x.back === null && fits(x), x)
  check(`${s}C no compact title at the top`, await compactShown() === false, "shown")
  await scrollSheet(500); await wait(300)
  // (A short note can't scroll its title away: then there's nothing to check.)
  const sheetScrolled = await page.evaluate(() => document.querySelector("dialog .overflow-y-auto").scrollTop)
  if (sheetScrolled > 120) check(`${s}C compact title once the title scrolls away`, await compactShown(), "hidden")
  else console.log(`skip ${s}C compact title (the note scrolls ${sheetScrolled}px)`)
  if (!s) await shot("note-sheet")
  await tapClose(); await wait(800)
  x = await st()
  check(`${s}C deep link: Close closes`, !x.open && x.hash === "#view/files" && !x.locked, x)
  await page.goto(`${B}#view/files/${file(take.id)}`); await wait(1500)
  await (await wiki(page, personText)).tap(); await wait(1200)
  t = await tb()
  check(`${s}C deep link: a [[link]] closes the sheet, the file in a tab`, inTab(t) && t.hash === fileHash(person.id), t)
  await page.goBack(); await wait(900)
  x = await st()
  check(`${s}C ...Back: the tab under it, no sheet`, !x.open && x.hash === "#view/files", x)

  // D. A person's file as a sheet over a scrolled page (#<page>/file/<path>): the page behind is locked and stays where
  // it was; Linked mentions (only if the sheet shows them again) open the note in a tab; Done closes it.
  await page.goto(`${B}${PEOPLE}`); await wait(1000)
  await page.evaluate(() => scrollTo(0, 400)); await wait(300)
  const yd = await page.evaluate(() => scrollY)
  await page.evaluate((f) => { location.hash = `${location.hash}/${f}` }, file(person.id)); await wait(1200)
  x = await st()
  check(`${s}D profile sheet over the page`, x.open && x.title === personName && x.top === 0 && x.locked && fits(x), x)
  const mention = page.locator("dialog footer button", { hasText: name(take.id) }).first()
  if (await mention.count()) {
    await mention.tap(); await wait(1200)
    t = await tb()
    check(`${s}D mention opens the note in a tab`, inTab(t) && t.hash === fileHash(take.id), t)
    await page.goBack(); await wait(900)
    await page.evaluate((f) => { location.hash = `${location.hash}/${f}` }, file(person.id)); await wait(1200)
  } else console.log(`skip ${s}D mentions (no linked mentions in the sheet)`)
  // Done (the sheet fills a phone's screen: no backdrop) closes everything
  await tapClose(); await wait(700)
  x = await st()
  check(`${s}D Done closes, the page where it was`, !x.open && x.hash === PEOPLE && !x.locked && (await page.evaluate(() => scrollY)) === yd, { ...x, yd, now: await page.evaluate(() => scrollY) })

  // E. Drag the sheet header down closes it; a tap on the sheet's bottom edge doesn't.
  await page.evaluate((h) => { location.hash = h }, `${PEOPLE}/${file(person.id)}`); await wait(800)
  const box = await page.locator("dialog").boundingBox()
  await page.touchscreen.tap(196, box.y + box.height - 4); await wait(400)
  check(`${s}E bottom edge tap keeps it open`, (await st()).open, "closed")
  const cdp = await ctx.newCDPSession(page)
  const p0 = { x: 150, y: box.y + 30 }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p0] })
  for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p0.x, y: p0.y + i * 25 }] }); await wait(16) }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(700)
  x = await st()
  check(`${s}E header drag closes`, !x.open && x.hash === PEOPLE, x)

  // F. Work: a colleague (not a file: a sheet) -> a log from it (a file: the sheet closes, the log in a tab).
  const colleague = (await get("api/work").catch(() => null))?.colleagues?.[0]?.name
  if (colleague) {
    await page.goto(`${B}${WORK}`); await wait(1000)
    await page.locator("main button", { hasText: colleague }).last().tap(); await wait(800)
    x = await st()
    check(`${s}F colleague opens a sheet`, x.open && x.title === colleague && x.locked && fits(x), x)
    if (!s) await shot("colleague")
    const entry = page.locator("dialog .hairline > button").first()
    if (await entry.count()) {
      await entry.tap(); await wait(1000)
      t = await tb()
      check(`${s}F a log from it: the sheet closes, the log in a tab`, inTab(t) && /^#file\/Logs/.test(t.hash), t)
      await page.goBack(); await wait(700)
      check(`${s}F Back: Work, no sheet`, !(await st()).open, await st())
    } else {
      await tapClose(); await wait(700)
      check(`${s}F closed`, !(await st()).open, await st())
    }
  }

  // G. People map: a pin opens the person in a tab; a sheet over the map (a file's) doesn't let a swipe in it
  // move the map; By place rows open people in tabs.
  await page.evaluate(() => localStorage.setItem("people.view", "map"))
  await page.goto(`${B}${PEOPLE}`); await page.reload()
  const mapOk = await page.waitForSelector(".pm-pin", { timeout: 15000 }).then(() => true, () => false)
  if (mapOk) {
    await wait(2000)
    const mapHash = await page.evaluate(() => location.hash)
    const pin = page.locator(".pm-pin:has(.pm-bubble:not(.pm-group))").first()
    const center = () => page.evaluate(() => [...document.querySelectorAll(".pm-pin")].map((e) => e.style.transform).join("|"))
    if (await pin.count()) {
      await pin.tap(); await wait(900)
      t = await tb()
      check(`${s}G pin opens the person in a tab`, inTab(t) && /^#file\/People/.test(t.hash), t)
      if (!s) await shot("profile-from-map")
      await page.goBack(); await wait(1500)
      check(`${s}G Back: the map`, (await tb()).hash === mapHash, await tb())
    }
    await page.evaluate((f) => { location.hash = `${location.hash}/${f}` }, file(person.id)); await wait(1200)
    x = await st()
    check(`${s}G a profile sheet over the map`, x.open && fits(x), x)
    const before = await center()
    const sb = await page.locator("dialog").boundingBox()
    const q = { x: 200, y: sb.y + sb.height / 2 }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [q] })
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: q.x - i * 20, y: q.y - i * 20 }] }); await wait(16) }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(500)
    check(`${s}G map stays put under the sheet`, before === (await center()), "moved")
    await tapClose(); await wait(700)
    check(`${s}G closed`, !(await st()).open, await st())
    const placeRow = page.locator("main section button:has(.rounded-full)").filter({ hasText: /\w/ }).first()
    await placeRow.scrollIntoViewIfNeeded(); await wait(200)
    await placeRow.tap(); await wait(800)
    t = await tb()
    check(`${s}G by-place row opens the person in a tab`, inTab(t) && /^#file\/People/.test(t.hash), t)
  } else console.log(`skip ${s}G map (the map didn't load)`)
  await page.evaluate(() => localStorage.setItem("people.view", "list"))

  // H. Every note, in a tab and in a sheet: no sideways overflow (long URLs, tables, code).
  for (const n of state.notes) {
    await page.goto(`${B}${fileHash(n.id)}`); await wait(1000)
    await page.evaluate(() => scrollTo(0, 99999)); await wait(150)
    t = await tb()
    check(`${s}H note ${n.id} fits in a tab`, inTab(t), t)
    await page.goto(`${B}#view/files/${file(n.id)}`); await wait(1000)
    await scrollSheet(99999); await wait(150)
    x = await st()
    check(`${s}H note ${n.id} fits in a sheet`, fits(x), x)
  }
  check(`${s}errors`, !errs.length, errs)
  await ctx.close()
}
await done()
