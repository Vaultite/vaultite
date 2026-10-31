// Settings' previews: hovering a row shows pictures of what it changes (after a wait, then at once to the next row),
// keyboard focus too, Esc closes; at the row's switch, gliding row to row; the ring follows the switch; a picture clicked sets it; still with reduced motion; on
// a touch screen, a button shows them under the row. WRITES appearance.json and editor.json: throwaway server only.
//   node web/qa/settingpreview.mjs <base url> [out dir]
import fs from "node:fs"
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = `${SHOTS}settingpreview/`], browser, check, watch, done } = await qa(import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const saved = await api("GET", "config/appearance")
const setLook = (patch) => api("PUT", "config/appearance", { ...saved, theme: "light", scheme: "default", animation: "natural", tabBar: true, translucent: false, translucentPages: false, ...patch })

async function open({ w = 1440, h = 900, dark = false, phone = false, reduced = false, hash = "settings" } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, colorScheme: dark ? "dark" : "light", reducedMotion: reduced ? "reduce" : "no-preference" })
  const page = watch(await ctx.newPage())
  await page.goto("about:blank"); await page.goto(`${B}#${hash}`)
  await page.locator(phone ? '[data-settings-nav="appearance"]' : '[data-settings-section="appearance"]').first().waitFor({ timeout: 60000 })
  await page.addStyleTag({ content: "[data-sonner-toaster] { display: none !important; }" })
  await wait(800)
  return page
}
const card = (page) => page.locator("[data-setting-preview]")
const row = (page, k) => page.locator(`[data-settings-row="${k}"]`)
/** The card and its row, shot together. */
async function shot(page, k, name) {
  const [a, b] = [await row(page, k).boundingBox(), await card(page).locator(".preview-card").boundingBox()]
  if (!a || !b) return
  const x = Math.min(a.x, b.x) - 12, y = Math.min(a.y, b.y) - 12
  await page.screenshot({ path: `${OUT}${name}.png`, clip: { x, y, width: Math.max(a.x + a.width, b.x + b.width) + 12 - x, height: Math.max(a.y + a.height, b.y + b.height) + 12 - y } })
}
const hover = async (page, k, where = "label") => {
  await row(page, k).scrollIntoViewIfNeeded()
  const box = await row(page, k).boundingBox()
  await page.mouse.move(box.x + (where === "label" ? 30 : box.width - 20), box.y + box.height / 2, { steps: 4 })
}
const away = (page) => page.mouse.move(5, 5)

const cfg = () => api("GET", "config/appearance")
const shown = (page) => card(page).count()
const cardFor = (page) => card(page).getAttribute("data-setting-preview").catch(() => null)
const current = (page) => card(page).locator("[data-current]").getAttribute("data-preview-pick").catch(() => null)
const loops = (page) => page.evaluate(() => document.querySelector("[data-setting-preview]")?.getAnimations({ subtree: true }).filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length ?? -1)

// ---------- hover: a wait, then warm; leaving closes; the card is a bridge ----------
await setLook({ fileIcons: true, typingFade: false })
{
  const page = await open()
  await hover(page, "file-icons"); await wait(150)
  check("hover: nothing at once (an intent delay)", (await shown(page)) === 0)
  await until(() => shown(page), 1500)
  check("…then the card, for its row", (await cardFor(page)) === "file-icons", await cardFor(page))
  check("a switch's card: Off and On, the current one marked", (await card(page).locator("[data-preview-pick]").count()) === 2 && (await current(page)) === "on", await current(page))
  const r = await row(page, "file-icons").boundingBox(), c = await card(page).locator(".preview-card").boundingBox()
  const sw = await row(page, "file-icons").getByRole("switch").boundingBox()
  check("it covers neither its row nor its switch", c.y >= r.y + r.height - 1 || c.y + c.height <= r.y + 1, { r, c })
  check("coming down the rows: above its row, out of the way", c.y + c.height <= r.y + 1, { r, c })
  check("…at its switch: the card's end just past the switch's", Math.abs(c.x + c.width - (sw.x + sw.width)) <= 16, { c, sw })
  check("it plays its row's description to a screen reader", await row(page, "file-icons").getByRole("switch").evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "").then((t) => /icons/.test(t)))
  await hover(page, "typing-fade"); await wait(60)
  check("warm: the next row's shows at once", (await cardFor(page)) === "typing-fade", await cardFor(page))
  check("…gliding over from where the last one was", /top/.test(await card(page).evaluate((e) => e.style.transition)), await card(page).evaluate((e) => e.style.transition))
  await wait(450)
  {
    const [cg, rg] = [await card(page).locator(".preview-card").boundingBox(), await row(page, "typing-fade").boundingBox()]
    check("…to its own row", Math.abs(cg.y + cg.height - rg.y) <= 8 || Math.abs(cg.y - (rg.y + rg.height)) <= 8, { cg, rg })
  }
  // (into the card: through the gap between them)
  const c2 = await card(page).locator(".preview-card").boundingBox()
  const r2 = await row(page, "typing-fade").boundingBox()
  await page.mouse.move(r2.x + 40, r2.y + 4, { steps: 2 }); await page.mouse.move(c2.x + 40, c2.y + c2.height / 2, { steps: 8 }); await wait(300)
  check("moving onto the card keeps it", (await cardFor(page)) === "typing-fade")
  await page.mouse.move(c2.x + c2.width + 300, c2.y + c2.height + 200, { steps: 4 }); await wait(400)
  check("leaving it closes it", (await shown(page)) === 0)
  // the ring follows the switch; a picture clicked sets it
  await hover(page, "file-icons", "switch"); await until(() => shown(page), 1500)
  const ring = () => card(page).locator("[data-preview-ring]").evaluate((e) => getComputedStyle(e).transform)
  const before = await ring()
  await row(page, "file-icons").getByRole("switch").click(); await wait(500)
  check("flipping the switch: the card stays and Off is marked", (await cardFor(page)) === "file-icons" && (await current(page)) === "off", await current(page))
  check("…its ring moved", (await ring()) !== before, [before, await ring()])
  check("…and nothing was applied by hovering (the click did)", (await cfg()).fileIcons === false)
  await card(page).locator('[data-preview-pick="on"]').click(); await wait(500)
  check("a picture clicked sets it", (await cfg()).fileIcons === true && (await row(page, "file-icons").getByRole("switch").getAttribute("aria-checked")) === "true")
  check("…and the card stays, On marked", (await current(page)) === "on")
  await page.keyboard.press("Escape"); await wait(300)
  check("Esc closes it (and it stays shut while the pointer's there)", (await shown(page)) === 0, await cardFor(page))
  // a choice of three: the option under the pointer, alone
  await page.mouse.move(5, 5); await wait(700)
  await row(page, "animation").scrollIntoViewIfNeeded()
  await row(page, "animation").getByRole("radio", { name: "Snappy" }).hover(); await until(() => shown(page), 1500)
  const names = () => card(page).locator("[data-preview-pick]").evaluateAll((els) => els.map((e) => e.getAttribute("data-preview-pick") + (e.hasAttribute("data-current") ? "*" : "")))
  check("Animations, Snappy hovered: its picture alone, not current", (await names()).join() === "snappy", await names())
  await row(page, "animation").getByRole("radio", { name: "Natural" }).hover(); await wait(150)
  check("…Natural hovered: its picture, marked current", (await names()).join() === "natural*", await names())
  check("nothing hovered set it", (await cfg()).animation === "natural")
  await shot(page, "animation", "animation-snappy-hover")
  // keyboard
  await page.mouse.move(5, 5); await wait(700)
  await row(page, "typing-fade").getByRole("switch").focus()
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab")
  await until(() => cardFor(page).then((k) => k === "typing-fade"), 1500)
  check("keyboard focus on a row's switch opens its card", (await cardFor(page)) === "typing-fade", await cardFor(page))
  check("…without taking the focus", await page.evaluate(() => document.activeElement?.closest("[data-settings-row]")?.getAttribute("data-settings-row")) === "typing-fade")
  await page.keyboard.press("Tab"); await wait(100)
  check("Tab to the next row's: its card at once", (await cardFor(page)) === "dim-panes", await cardFor(page))
  await page.keyboard.press("Escape"); await wait(150)
  check("Esc closes it, the focus stays", (await shown(page)) === 0 && await page.evaluate(() => !!document.activeElement?.closest('[data-settings-row="dim-panes"]')))
  // behaviours move; with Animations off, they're still
  await hover(page, "dim-panes"); await until(() => shown(page), 1500)
  check("behaviours play a calm loop", (await loops(page)) > 0, await loops(page))
  await page.mouse.move(5, 5); await wait(700)
  await setLook({ animation: "off" }); await wait(600)
  await hover(page, "dim-panes"); await until(() => shown(page), 1500)
  check("animations off: the pictures are still", (await loops(page)) === 0, await loops(page))
  await setLook({}); await page.context().close()
}
{
  const page = await open({ reduced: true })
  await hover(page, "dim-panes"); await until(() => shown(page), 1500)
  check("reduced motion: the pictures are still", (await loops(page)) === 0, await loops(page))
  check("no preview button where there's a pointer", !(await row(page, "dim-panes").locator("[data-preview-button]").isVisible()))
  await page.context().close()
}
// beside the column where there's room; over a sheet
{
  const page = await open({ w: 2400, h: 1000 })
  await hover(page, "tab-bar"); await until(() => shown(page), 1500)
  check("a wide pane: the card beside the column of rows", (await card(page).getAttribute("data-side")) === "right", await card(page).getAttribute("data-side"))
  {
    const [cw, sw] = [await card(page).locator(".preview-card").boundingBox(), await row(page, "tab-bar").getByRole("switch").boundingBox()]
    check("…level with its switch", Math.abs(cw.y + cw.height / 2 - (sw.y + sw.height / 2)) <= 2, { cw, sw })
  }
  await shot(page, "tab-bar", "beside-tab-bar")
  await page.mouse.move(5, 5); await wait(700)
  await page.evaluate(() => { location.hash = "settings/sidebars" }); await page.locator("[data-customize-sidebars]").waitFor(); await wait(600)
  await hover(page, "panel-dividers"); await until(() => shown(page), 1500)
  const c = await card(page).locator(".preview-card").boundingBox()
  check("in a sheet: the card shows over it", await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[data-setting-preview]"), [c.x + c.width / 2, c.y + c.height / 2]))
  await page.context().close()
}
// a touch screen: a button shows them under the row
{
  const page = await open({ w: 390, h: 844, phone: true })
  await page.locator('[data-settings-nav="appearance"]').first().click(); await page.locator('[data-settings-row="dim-panes"]').waitFor(); await wait(600)
  const r = row(page, "dim-panes")
  await r.scrollIntoViewIfNeeded()
  const btn = r.locator("[data-preview-button]")
  check("phone: rows with pictures have a button for them", await btn.isVisible())
  check("…rows without, none", !(await row(page, "quick-text-size").locator("[data-preview-button]").count()))
  await btn.tap(); await wait(400)
  check("tapped: the pictures under the row", await r.locator("[data-preview-inline]").isVisible() && (await r.locator("[data-preview-inline] [data-preview-pick]").count()) === 2)
  const tb = row(page, "tab-bar")
  await tb.scrollIntoViewIfNeeded(); await tb.locator("[data-preview-button]").tap(); await wait(300)
  check("…in words too where the row has no line saying it", /tabs/.test(await tb.locator("[data-preview-inline]").innerText()))
  await tb.locator("[data-preview-button]").tap(); await r.scrollIntoViewIfNeeded()
  check("…and no card", (await shown(page)) === 0)
  await r.screenshot({ path: `${OUT}phone-dim-panes.png` })
  const was = (await r.getByRole("switch").getAttribute("aria-checked")) === "true"
  await r.locator(`[data-preview-inline] [data-preview-pick="${was ? "off" : "on"}"]`).tap(); await wait(500)
  check("tapping a picture sets it", (await cfg()).dimPanes === !was && (await r.getByRole("switch").getAttribute("aria-checked")) === String(!was))
  await btn.tap(); await wait(300)
  check("tapped again: folded", !(await r.locator("[data-preview-inline]").count()))
  await page.context().close()
}

// ---------- every preview, light and dark ----------
// ---------- every preview, light and dark ----------
const ROWS = { appearance: ["animation", "file-icons", "typing-fade", "dim-panes", "tab-bar", "line-numbers"], editor: ["readable-line-length", "show-inline-title", "properties-in-document"] }
for (const dark of [false, true]) {
  await setLook({ theme: dark ? "dark" : "light" })
  const page = await open({ dark })
  for (const k of ROWS.appearance) {
    await away(page); await wait(700)
    await hover(page, k); await wait(900)
    await shot(page, k, `${k}-${dark ? "dark" : "light"}`)
  }
  await setLook({ theme: dark ? "dark" : "light", tabBar: false, translucent: true }); await wait(800)
  for (const k of ["pane-titles", "translucent-pages"]) {
    await away(page); await wait(700); await hover(page, k); await wait(900); await shot(page, k, `${k}-${dark ? "dark" : "light"}`)
  }
  await setLook({ theme: dark ? "dark" : "light", rails: false }); await wait(500)
  await page.locator('[data-settings-nav="editor"]').click(); await page.locator('[data-settings-section="editor"]').waitFor(); await wait(500)
  for (const k of ROWS.editor) {
    await away(page); await wait(700); await hover(page, k); await wait(900); await shot(page, k, `${k}-${dark ? "dark" : "light"}`)
  }
  await page.evaluate(() => { location.hash = "settings/sidebars" }); await page.locator("[data-customize-sidebars]").waitFor(); await wait(600)
  for (const k of ["rails", "peek-shade", "sidebar-scroll", "panel-dividers"]) {
    await away(page); await wait(700); await hover(page, k); await wait(900); await shot(page, k, `${k}-${dark ? "dark" : "light"}`)
  }
  await page.context().close()
}

await setLook({})
await done()
