// People → Map at phone and desktop size, light and dark: screenshots, sideways overflow, page errors, and a
// horizontal swipe on the map that must pan the map, not scroll the page. Prints a report; reads only.
//   node web/qa/map.mjs <base url> [out dir]
import { SHOTS, WEBGL, qa } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser } = await qa(import.meta.url, { chrome: { args: WEBGL } })
const MAP = `${B}#file/${encodeURIComponent("Dashboards/People map.md")}` // People's Map tab
const report = []
for (const [w, h, tag, mobile] of [[390, 844, "390", true], [320, 640, "320", true], [1440, 900, "desktop", false]]) {
  for (const scheme of ["light", "dark"]) {
    if (tag === "320" && scheme === "dark") continue
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: scheme })
    const page = await ctx.newPage()
    const errs = []
    page.on("pageerror", (e) => errs.push(String(e)))
    page.on("console", (m) => m.type() === "error" && errs.push(m.text()))
    await page.goto(MAP)
    await page.waitForSelector(".pm-pin", { timeout: 15000 }).catch(() => errs.push("no pins"))
    await page.waitForTimeout(3500)
    const name = `${OUT}map-${tag}-${scheme}`
    await page.screenshot({ path: `${name}.png` })
    if (mobile) await page.screenshot({ path: `${name}-full.png`, fullPage: true })
    const info = await page.evaluate((w) => ({
      sw: document.documentElement.scrollWidth, pins: document.querySelectorAll(".pm-pin").length,
      over: [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width && (b.right > w + 1 || b.left < -1) && !el.closest(".maplibregl-map") && getComputedStyle(el).position !== "fixed" }).map((el) => el.tagName + "." + String(el.className).slice(0, 40)).slice(0, 5),
    }), w)
    if (mobile && scheme === "light") { // swipe left across the map
      const box = await page.locator(".pm-map").boundingBox()
      const cdp = await ctx.newCDPSession(page)
      const center0 = await page.evaluate(() => document.querySelector(".pm-pin")?.getBoundingClientRect().x)
      const y = box.y + box.height * 0.7, x0 = box.x + box.width * 0.8
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] })
      for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - i * 15, y }] }); await page.waitForTimeout(16) }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await page.waitForTimeout(800)
      info.swipe = { scrollX: await page.evaluate(() => scrollX), pinMovedPx: Math.round(center0 - await page.evaluate(() => document.querySelector(".pm-pin")?.getBoundingClientRect().x)) }
    }
    report.push({ name: `${tag}-${scheme}`, ...info, errs })
    await ctx.close()
  }
}
console.log(JSON.stringify(report, null, 1))

// Taps (390px): "Show" on a place, a group that shares a spot opens a list, a person opens their profile.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)))
  const out = {}
  await page.goto(MAP); await page.waitForSelector(".pm-pin", { timeout: 15000 }); await page.waitForTimeout(2000)
  // The first place (By place) whose view shows a group of people who share a spot (under 1.5 km apart, without you:
  // tapping it lists them); else the first place. Only pins inside the map's box count (markers off to the side stay in the page).
  const places = page.locator('button[aria-label^="Show "][aria-label$=" on the map"]')
  const at = Object.fromEntries((await (await fetch(`${B}api/state`)).json()).people.filter((p) => p.lat != null).map((p) => [p.name, p]))
  const km = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) * r / 2), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371 }
  const spot = (label) => { const ps = label.slice(label.indexOf(": ") + 2).split(", ").map((n) => at[n]); return ps.every(Boolean) && ps.every((p) => km(p, ps[0]) < 1.5) }
  const mark = async () => {
    const pins = await page.evaluate(() => {
      const m = document.querySelector(".pm-map").getBoundingClientRect()
      const inside = (e) => { const b = e.getBoundingClientRect(); return b.left >= m.left && b.right <= m.right && b.top >= m.top && b.bottom <= m.bottom }
      return [...document.querySelectorAll(".pm-pin")].map((e, i) => { e.removeAttribute("data-qa"); return { i, label: e.getAttribute("aria-label"), in: inside(e) && !e.matches(".pm-pin-me"), group: !!e.querySelector(".pm-group"), me: !!e.querySelector(".pm-me-badge") } })
    })
    const g = pins.find((p) => p.in && p.group && !p.me && spot(p.label)), one = pins.find((p) => p.in && !p.group)
    await page.evaluate(([g, one]) => { const all = document.querySelectorAll(".pm-pin"); if (g != null) all[g].setAttribute("data-qa", "group"); if (one != null) all[one].setAttribute("data-qa", "one") }, [g?.i, one?.i])
  }
  const group = page.locator(".pm-pin[data-qa=group]")
  for (let i = 0, n = await places.count(); i < n; i++) {
    const place = places.nth(i)
    out.place = (await place.getAttribute("aria-label")).replace(/^Show (.*) on the map$/, "$1")
    await place.scrollIntoViewIfNeeded(); await place.tap(); await page.waitForTimeout(2500); await mark()
    if (await group.count()) break
  }
  out.pinsShown = await page.locator(".pm-pin").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))
  if (await group.count()) {
    await group.first().tap(); await page.waitForTimeout(500)
    out.popupRows = await page.locator(".pm-popup .pm-row").allInnerTexts()
    // Nothing on the map draws over the popup: every pin under it, at the middle of where they overlap.
    out.pinsOverPopup = await page.evaluate(() => {
      const p = document.querySelector(".pm-popup .maplibregl-popup-content").getBoundingClientRect()
      return [...document.querySelectorAll(".maplibregl-marker")].filter((m) => {
        const b = m.getBoundingClientRect(), l = Math.max(b.left, p.left), r = Math.min(b.right, p.right), t = Math.max(b.top, p.top), d = Math.min(b.bottom, p.bottom)
        return l < r && t < d && !document.elementFromPoint((l + r) / 2, (t + d) / 2)?.closest(".pm-popup")
      }).map((m) => m.getAttribute("aria-label") ?? m.className)
    })
    await page.screenshot({ path: `${OUT}map-390-popup.png` })
    await page.locator(".pm-popup .pm-row-btn").first().tap(); await page.waitForTimeout(700)
    out.sheetAfterPopup = await page.evaluate(() => ({ open: document.querySelector("dialog")?.open, hash: location.hash }))
    await page.goBack(); await page.waitForTimeout(500)
  }
  await mark()
  const one = page.locator(".pm-pin[data-qa=one]")
  if (await one.count()) { await one.first().tap(); await page.waitForTimeout(700); out.sheetAfterPin = await page.evaluate(() => location.hash); await page.goBack() }
  out.errs = errs
  console.log("taps", JSON.stringify(out, null, 1))
  await ctx.close()
}
// Offline: tiles blocked -> the page shows "Map unavailable" and the list, no errors.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.route(/openfreemap\.org/, (r) => r.abort())
  const page = await ctx.newPage()
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)))
  await page.goto(MAP); await page.waitForTimeout(4000)
  console.log("offline", JSON.stringify({ unavailable: await page.locator("text=Map unavailable").count(), places: await page.locator("text=By place").count(), sw: await page.evaluate(() => document.documentElement.scrollWidth), errs }))
  await page.screenshot({ path: `${OUT}map-390-offline.png` })
  await ctx.close()
}
await browser.close()
