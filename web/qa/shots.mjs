// Screenshots of People (list + a profile) and Projects at phone and desktop size, plus the phone's drawer, its bar's menu,
// its header's … menu and its tab list.
//   node web/qa/shots.mjs <base url> [out dir] [person name] [log id]
// The person defaults to the vault's first person with a timeline (else its first person).
import { SHOTS, qa } from "./lib/qa.mjs"
import { pageHash, subjects } from "./subjects.mjs"
const { args: [B, OUT = SHOTS, name, log = ""], browser, errs, watch } = await qa(import.meta.url)
const v = name ? null : await subjects(B)
const enc = encodeURIComponent
const person = `file/${enc(`${name ? `People/${name}` : v.need(v.timeline[0] ?? v.people[0], "a person").id}.md`)}`
const people = await pageHash(B, "People"), projects = await pageHash(B, "Projects")
for (const [w, h, tag, mobile] of [[390, 844, "390", true], [1440, 900, "desktop", false]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: scheme })
    const page = watch(await ctx.newPage())
    // [name, address, also its bottom]; dark: only the person and Projects
    const routes = [["people", people, false], ["person", person, true], ["projects", projects, false], ...(log ? [["log", `file/${enc(`${log}.md`)}`, true]] : [])]
      .filter(([r]) => scheme === "light" || r === "person" || r === "projects")
    for (const [r, hash, end] of routes) {
      await page.goto(`${B}#${hash}`); await page.waitForTimeout(1200)
      const name = `${OUT}${tag}-${scheme}-${r}`
      await page.screenshot({ path: `${name}.png`, fullPage: true })
      if (end) { // a file: also its bottom (a computer's pane scrolls, not the window)
        await page.evaluate(() => { const el = document.getElementById("main-scroll"); (el && getComputedStyle(el).overflowY === "auto" ? el : window).scrollTo(0, 1e9) })
        await page.waitForTimeout(300)
        await page.screenshot({ path: `${name}-end.png` })
      }
    }
    if (mobile && scheme === "light") {
      await page.goto(`${B}#${people}`); await page.waitForTimeout(800)
      await page.locator("[data-phone-header] button[aria-label='Open sidebar']").tap(); await page.waitForTimeout(500)
      await page.screenshot({ path: `${OUT}${tag}-drawer.png` })
      await page.keyboard.press("Escape"); await page.waitForTimeout(400)
      await page.locator("[data-bar=menu]").tap(); await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}${tag}-bar-menu.png` })
      await page.locator("[aria-label='Close menu']").tap(); await page.waitForTimeout(200)
      await page.locator("[data-phone-header] button[aria-label=More]").tap(); await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}${tag}-header-menu.png` })
      await page.keyboard.press("Escape"); await page.waitForTimeout(200)
      await page.locator("[data-tabs-button]").tap(); await page.waitForTimeout(700)
      await page.screenshot({ path: `${OUT}${tag}-tabs.png` })
    }
    await ctx.close()
  }
}
await browser.close()
console.log(errs.length ? errs : "no page errors")
