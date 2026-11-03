// One thing on top, and it has the keyboard: the palettes (⌘P, ⌘O, a choice's picker such as Animations…, the Ask box)
// replace each other rather than stack, so the one drawn on top is always the one typed into; closed, the keyboard goes
// back to where it was before the first. Over a sheet, a palette is on top of it and typed into; a sheet whose point is
// its filter (Hotkeys) takes typing at once. Read-only apart from the palette's recent commands: throwaway server.
//   node web/qa/onetop.mjs <base url>
import { openPalette, qa, until, wait } from "./lib/qa.mjs"

const { args: [arg], browser, check, watch, done } = await qa(import.meta.url)
const B = arg.endsWith("/") ? arg : `${arg}/`

/** The palette-like boxes open, which one has the keyboard, and whether that one is what's drawn on top (the point at
 *  its middle hits it). */
const state = (page) => page.evaluate(() => {
  const boxes = [...document.querySelectorAll("[data-overlay] > [role=dialog]")]
  const a = document.activeElement
  const typed = boxes.findIndex((b) => b.contains(a))
  const top = (b) => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 20)) }
  return { open: boxes.map((b) => b.getAttribute("aria-label")), typed, onTop: typed >= 0 && top(boxes[typed]), active: a?.tagName + (a?.getAttribute("aria-label") ? `:${a.getAttribute("aria-label")}` : "") }
})
const one = async (page, label) => {
  await until(async () => { const s = await state(page); return s.open.length === 1 && s.open[0] === label }, 2000)
  return state(page)
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage(), { label: "desktop" })
  await page.goto(B)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)

  // ⌘P, then ⌘O over it: the switcher takes its place.
  await openPalette(page)
  await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.press("ControlOrMeta+o")
  let s = await one(page, "Quick switcher")
  check("⌘O over ⌘P: one palette, the switcher, typed into and on top", s.open.length === 1 && s.typed === 0 && s.onTop, s)

  // A choice's picker (Animations…), then ⌘P: the command palette takes its place, typed into.
  await page.keyboard.press("Escape")
  await openPalette(page)
  await page.keyboard.type("Animations")
  await until(() => page.locator("[role=option]", { hasText: "Animations" }).count(), 3000)
  await page.keyboard.press("Enter")
  s = await one(page, "Animations")
  check("Animations… replaces the palette with its picker", s.open.length === 1 && s.typed === 0, s)
  await page.keyboard.press("ControlOrMeta+p")
  s = await one(page, "Command palette")
  check("⌘P over the picker: the command palette alone, typed into and on top", s.open.length === 1 && s.typed === 0 && s.onTop, s)
  await page.keyboard.type("zzq")
  check("what's typed goes in it", (await page.locator("[data-overlay] input").inputValue()).endsWith("zzq"))
  await page.keyboard.press("Escape")
  check("Esc closes it, and nothing is left open", await until(async () => (await state(page)).open.length === 0, 2000))

  // The Ask box (⌘J's), then ⌘P, and back.
  const ask = await page.evaluate(() => !!document.querySelector("body"))
  if (ask) {
    await openPalette(page)
    await page.waitForSelector("[role=dialog] input:focus")
    await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("Backspace")
    await page.keyboard.type("Ask an agent in the background")
    const listed = await until(() => page.locator("[role=option]", { hasText: "Ask an agent" }).count(), 2000)
    if (listed) {
      await page.keyboard.press("Enter")
      s = await one(page, "Ask an agent")
      check("the Ask box opens alone", s.open.length === 1 && s.typed === 0, s)
      await page.keyboard.press("ControlOrMeta+p")
      s = await one(page, "Command palette")
      check("⌘P over the Ask box: the command palette alone, typed into and on top", s.open.length === 1 && s.typed === 0 && s.onTop, s)
      await page.keyboard.press("Escape")
    } else { await page.keyboard.press("Escape"); console.log("(no agents here: the Ask box isn't offered, skipped)") }
  }

  // From a note's editor: a palette replaced by another, then closed, gives the keyboard back to the editor.
  await page.keyboard.press("ControlOrMeta+o")
  await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.type("Lisbon trip")
  await until(() => page.locator("[role=option]", { hasText: "Lisbon trip" }).count(), 3000)
  await page.keyboard.press("Enter")
  await page.waitForSelector(".cm-content[contenteditable=true]", { timeout: 8000 })
  await page.locator(".cm-content").first().click()
  await openPalette(page)
  await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.type("Animations")
  await until(() => page.locator("[role=option]", { hasText: "Animations" }).count(), 3000)
  await page.keyboard.press("Enter")
  await one(page, "Animations")
  // (as a person would: each a moment after the last, past what a closing one hands on for a moment, core/focus.ts)
  await wait(400)
  await page.keyboard.press("ControlOrMeta+p")
  await one(page, "Command palette")
  await wait(400)
  await page.keyboard.press("Escape")
  const back = await until(() => page.evaluate(() => !!document.activeElement?.closest(".cm-content")), 2000)
  check("Animations…, ⌘P over it, Esc: the keyboard is back in the note", back, await page.evaluate(() => document.activeElement?.className))

  // A sheet (Hotkeys): its filter takes typing; ⌘P over it is on top and typed into; closed, the filter has it again.
  await openPalette(page)
  await page.waitForSelector("[role=dialog] input:focus")
  await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("Backspace")
  await page.keyboard.type("Open hotkeys")
  await until(() => page.locator("[role=option]", { hasText: "hotkeys" }).count(), 3000)
  await page.keyboard.press("Enter")
  await page.waitForSelector("[data-hotkeys]")
  await wait(400)
  await page.keyboard.type("anim")
  const filter = page.locator("dialog[open] input").first()
  check("Hotkeys: typing goes in its filter", (await filter.inputValue()) === "anim", await filter.inputValue())
  await page.keyboard.press("ControlOrMeta+p")
  s = await one(page, "Command palette")
  check("⌘P over the sheet: on top and typed into", s.typed === 0 && s.onTop, s)
  await page.keyboard.press("Escape")
  await until(async () => (await state(page)).open.length === 0, 2000)
  await wait(300)
  check("closed, the keyboard is back in the sheet's filter", await page.evaluate(() => document.activeElement?.matches("dialog[open] input")))
} catch (e) {
  check("it ran to the end", false, String(e))
} finally {
  await done()
}
