// The finders' kept query (components/Palette.tsx, useFinderQuery): what's typed in ⌘O or ⌘P and left without picking
// shows in the next one opened. The other shortcut pressed over it goes on as typed (caret at its end); reopened after
// leaving, it's selected, so typing replaces it; a pick forgets it, and so do two minutes. Writes nothing.
//   node web/qa/finderquery.mjs <base url>
import { qa, until, wait } from "./lib/qa.mjs"

const { args: [arg], browser, check, watch, done } = await qa(import.meta.url)
const B = arg.endsWith("/") ? arg : `${arg}/`
const field = (p) => p.locator("[role=dialog] input[role=combobox]")
const state = (p) => field(p).evaluate((f) => ({ value: f.value, from: f.selectionStart, to: f.selectionEnd, label: f.closest("[aria-label]")?.getAttribute("aria-label") }))
const closed = (p) => until(async () => (await field(p).count()) === 0, 2000)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(B)
await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
await wait(1500)

// ⌘P by mistake, then ⌘O: the text goes along, to be typed on.
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
await page.keyboard.type("welcome")
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
let s = await state(page)
check("⌘O right after ⌘P has its text, the caret at the end", s.value === "welcome" && s.from === 7 && s.to === 7, s)
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
s = await state(page)
check("and back to ⌘P too", s.value === "welcome" && s.from === 7, s)

// Left with Esc, opened again: there, selected, so typing replaces it.
await page.keyboard.press("Escape")
check("Esc closes it", await closed(page))
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
s = await state(page)
check("opened again, the text is there and selected", s.value === "welcome" && s.from === 0 && s.to === 7, s)
await page.keyboard.type("x")
check("typing replaces it", (await field(page).inputValue()) === "x")

// A pick forgets it.
await page.keyboard.press("Backspace")
await page.keyboard.type("Open command palette")
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
await page.keyboard.press("Enter")
// (the command picked opens the palette again)
await until(() => field(page).count(), 2000)
check("after a pick, the next finder opens empty", (await field(page).inputValue()) === "")
await page.keyboard.press("Escape")
await closed(page)

// Two minutes on, it's gone.
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
await page.keyboard.type("welcome")
await page.mouse.click(10, 790)
check("a click off closes it", await closed(page))
await page.clock.install()
await page.clock.fastForward("02:30")
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
check("two minutes later, it opens empty", (await field(page).inputValue()) === "", await state(page))

await ctx.close()
await done()
