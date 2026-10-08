// Notes as files: a note read on a phone (390px) and on a desktop, in a tab on both, light and dark, with screenshots;
// its [[links]] followed: to the other note and to the person, and Back returns to the note. No sideways overflow on
// the phone; the note's sheet address (#<tab>/file/<path>) opens the note on a phone (in a sheet).
// Read-only (no writes to the vault):  node web/qa/notes.mjs <base url> [out dir]
// Needs a note that links to another note and to a person (found in the vault by subjects.mjs: "take" links to "idea").
import { SHOTS, qa } from "./lib/qa.mjs"
import { subjects } from "./subjects.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const enc = encodeURIComponent // ids are vault paths ("Notes/Idea"), encoded in the hash
const v = await subjects(B)
const { note: take, idea, person, ideaText, personText } = v.need(v.linked, "a note that links to another note and to a person")
const hashOf = (page) => page.evaluate(() => decodeURIComponent(location.hash))
const link = (page, scope, text) => page.locator(`${scope} .cm-wikilink`, { hasText: text }).first()
/** Live preview shows the line under the cursor as typed, [[links]] included, and opening a note puts the cursor in it:
 *  let go of the keyboard so every link is drawn. */
const unfocus = (page) => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
for (const [w, h, tag, mobile] of [[390, 844, "390", true], [1440, 900, "desktop", false]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: scheme })
    const page = watch(await ctx.newPage())
    const shot = (name) => page.screenshot({ path: `${OUT}notes-${tag}-${scheme}-${name}.png` })
    const k = `${tag} ${scheme}:`
    const scope = "main"
    const tap = (l) => (mobile ? l.tap() : l.click())
    if (mobile) {
      await page.goto(`${B}#view/files/file/${enc(`${take.id}.md`)}`); await page.waitForTimeout(1500)
      check(`${k} the note's sheet address opens the note (a sheet)`, await page.evaluate(() => !!document.querySelector("dialog")?.open) && (await page.locator("dialog .cm-wikilink").count()) > 0)
    }
    await page.goto(`${B}#file/${enc(`${take.id}.md`)}`); await page.waitForTimeout(1500)
    if (!mobile) await unfocus(page)
    if (mobile) check(`${k} the note opens in a tab, named in the header`, !(await page.evaluate(() => !!document.querySelector("dialog")?.open)) && (await page.locator("[data-phone-title]").innerText()) === take.id.split("/").pop(), await page.locator("[data-phone-title]").innerText())
    check(`${k} its links are drawn`, await link(page, scope, personText).count() > 0 && await link(page, scope, ideaText).count() > 0,
      await page.locator(`${scope} .cm-wikilink`).allInnerTexts())
    if (mobile) {
      const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth }))
      check(`${k} no sideways scroll`, o.doc <= o.win, o)
    }
    await shot("note")
    if (scheme !== "light") { await ctx.close(); continue }
    // The other note, then Back.
    await tap(link(page, scope, ideaText)); await page.waitForTimeout(1000)
    check(`${k} the note link opens ${idea.id}`, (await hashOf(page)).includes(idea.id), await hashOf(page))
    await page.goBack(); await page.waitForTimeout(800)
    check(`${k} Back returns to the note`, (await hashOf(page)).includes(take.id), await hashOf(page))
    if (!mobile) await unfocus(page)
    // The person, then Back.
    await tap(link(page, scope, personText)); await page.waitForTimeout(1000)
    check(`${k} the person link opens ${person.id}`, (await hashOf(page)).includes(person.id), await hashOf(page))
    await shot("person")
    await page.goBack(); await page.waitForTimeout(800)
    check(`${k} Back returns to the note again`, (await hashOf(page)).includes(take.id), await hashOf(page))
    await ctx.close()
  }
}
await done()
