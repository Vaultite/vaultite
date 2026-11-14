// A phone's terminal holds still under its keyboard and through a dropped connection: node web/qa/termphone.mjs <base url> (runs a shell: throwaway server only). Paths: plugins/core/terminal/held.ts, plugins/core/terminal/live.ts
import { app } from "./lib/app.mjs"
import { PROMPT, qa, terminalText, until } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const sid = `qa${Date.now().toString(36)}p`

const KB = 320
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript((kb) => {
  const vv = window.visualViewport, h = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height").get
  Object.defineProperty(vv, "height", { get: () => h.call(vv) - (window.__kb ? kb : 0) })
  window.__keyboard = (on) => { window.__kb = on; vv.dispatchEvent(new Event("resize")) }
  window.__resizes = 0; window.__sockets = []
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (d) {
    if (String(d).includes('"t":"resize"')) window.__resizes++
    if (!window.__sockets.includes(this)) window.__sockets.push(this)
    return send.call(this, d)
  }
}, KB)
const page = watch(await ctx.newPage())
const { idle } = app(page)
await page.goto(`${B}#view/terminal%2F${sid}`)
await until(async () => PROMPT.test(await terminalText(page)), 15000)
await idle()

const resizes = () => page.evaluate(() => window.__resizes)
const keyboard = async (on) => { await page.evaluate((on) => window.__keyboard(on), on); await idle() }
const cursorInSight = () => page.evaluate(() => {
  const el = document.querySelector("[data-terminal]"), c = el.terminalCell(), keys = document.querySelector("[data-key-bar]")?.getBoundingClientRect()
  const ta = el.querySelector("[data-term-input]").getBoundingClientRect()
  return { top: Math.round(ta.top), bottom: Math.round(ta.top + c.height), keys: keys ? Math.round(keys.top) : null }
})

await page.locator("[data-term]").tap()
await page.locator("[data-terminal-held]").waitFor({ timeout: 3000 })
await keyboard(true)
const before = await resizes()
for (let i = 0; i < 3; i++) { await keyboard(false); await keyboard(true) }
check("the keyboard coming and going sends the shell no new size", (await resizes()) === before, { before, after: await resizes() })

await page.keyboard.type("seq 1 300"); await page.keyboard.press("Enter")
await until(async () => /^300$/m.test(await terminalText(page)), 5000)
await idle()
const at = await cursorInSight()
check("the cursor is above the keys", at.keys !== null && at.bottom <= at.keys + 1 && at.top >= 0, at)

await page.locator("[aria-label='Hide keyboard']").dispatchEvent("pointerup")
await keyboard(false)
await until(async () => !(await page.locator("[data-terminal-held]").count()), 3000)
await idle()
check("the keyboard gone: still no new size", (await resizes()) === before, { before, after: await resizes() })

await page.mouse.move(195, 300)
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -400)
const reading = await until(async () => { const s = await terminalText(page); return !/^300$/m.test(s) && s }, 3000)
check("scrolled back into the history", !!reading)
await page.evaluate(() => { for (const s of window.__sockets) s.close() })
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
await until(() => page.evaluate(() => window.__sockets.some((s) => s.readyState === 1)), 4000)
const back = await until(async () => (await terminalText(page)) === reading, 4000)
check("back: the same lines in sight", !!back, (await terminalText(page)).slice(-80))

await page.locator("[data-term]").tap()
await page.keyboard.type("exit"); await page.keyboard.press("Enter")
await idle()
await done()
