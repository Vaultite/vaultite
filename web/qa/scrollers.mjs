// Scrollers as stacking contexts (index.css): on a phone (both drawers, a few pages, a sheet) and a desktop window, every
// element that scrolls must be a stacking context, or what's positioned inside it is drawn by iOS WebKit above its
// scroll indicator (the sidebar's sticky headings chopped it). Fails (exit 1) on a scroller with a positioned
// descendant that isn't one; lists `fixed` elements inside a scroller (stacked within it now: check they still sit
// on top). Reads only (opens tabs on this device), but run it against a throwaway server:
//   node web/qa/scrollers.mjs <base>   (or QA_BASE)
import { chromium } from "playwright-core"
import { pageHash } from "./subjects.mjs"
const B = process.env.QA_BASE ?? process.argv[2]
if (!B) { console.error("usage: node web/qa/scrollers.mjs <base url of a throwaway server>"); process.exit(2) }
const today = await pageHash(B, "Today")
const routes = ["", today, await pageHash(B, "People"), await pageHash(B, "Health"), await pageHash(B, "Learning"), "view/files", "plugins", "settings", "bundles"]
const browser = await chromium.launch({ executablePath: (await import("./lib/qa.mjs")).CHROME })
const bad = new Map(), fixed = new Map(), errs = []

/** In the page: scrollers that aren't stacking contexts but hold something positioned, and fixed elements in a scroller. */
const audit = () => {
  const name = (e) => {
    const cls = typeof e.className === "string" ? e.className.split(/\s+/).filter((c) => /overflow|scroll|sticky|fixed/.test(c)).join(".") : ""
    const data = [...e.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}${a.value ? `=${a.value}` : ""}]`).slice(0, 3).join("")
    return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${data}${cls ? `.${cls}` : ""}`
  }
  const scrolls = (s) => /auto|scroll/.test(s.overflowX + s.overflowY)
  const stacking = (e, s) => e === document.documentElement || s.isolation === "isolate" || (s.position !== "static" && s.zIndex !== "auto") ||
    s.position === "fixed" || s.position === "sticky" || s.transform !== "none" || s.filter !== "none" || s.backdropFilter !== "none" ||
    s.perspective !== "none" || s.clipPath !== "none" || s.maskImage !== "none" || Number(s.opacity) < 1 || s.mixBlendMode !== "normal" ||
    /paint|layout|strict|content/.test(s.contain) || /size/.test(s.containerType) || /transform|opacity|filter/.test(s.willChange)
  const out = { bad: [], fixed: [] }
  for (const e of document.querySelectorAll("body *")) {
    const s = getComputedStyle(e)
    if (s.display === "none") continue
    if (scrolls(s) && !stacking(e, s)) {
      const inner = [...e.querySelectorAll("*")].find((d) => getComputedStyle(d).position !== "static")
      if (inner) out.bad.push(`${name(e)} holds ${name(inner)}`)
    }
    if (s.position === "fixed") {
      let p = e.parentElement
      while (p && p !== document.body && !scrolls(getComputedStyle(p))) p = p.parentElement
      if (p && p !== document.body) out.fixed.push(`${name(e)} in ${name(p)}`)
    }
  }
  return out
}
const take = (where, r) => {
  for (const b of r.bad) bad.set(b, bad.get(b) ?? where)
  for (const f of r.fixed) fixed.set(f, fixed.get(f) ?? where)
}

for (const phone of [true, false]) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errs.push(String(e)))
  for (const r of routes) {
    await page.goto(`${B}#${r}`); await page.waitForTimeout(900)
    take(`${phone ? "phone" : "desktop"} #${r}`, await page.evaluate(audit))
  }
  if (phone) {
    for (const label of ["Open sidebar", "Open right sidebar"]) {
      const b = page.locator(`[data-phone-header] button[aria-label='${label}']`)
      if (!(await b.count())) continue
      await b.tap(); await page.waitForTimeout(600)
      take(`phone drawer (${label})`, await page.evaluate(audit))
      await page.goto(`${B}#${today}`); await page.waitForTimeout(700)
    }
  }
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify({ notStacking: Object.fromEntries(bad), fixedInScroller: Object.fromEntries(fixed), errors: errs.slice(0, 5) }, null, 1))
process.exit(bad.size ? 1 : 0)
