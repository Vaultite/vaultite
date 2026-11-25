// A phone's terminal holds still under its keyboard and through a dropped connection: node web/qa/termphone.mjs <base url> (runs a shell: throwaway server only). Paths: plugins/core/terminal/held.ts, plugins/core/terminal/live.ts, plugins/core/terminal/Terminal.tsx, web/src/core/keyboard.ts
import { app } from "./lib/app.mjs"
import { PROMPT, fingers, qa, terminalText, until } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const sid = `qa${Date.now().toString(36)}p`

const KB = 320
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await ctx.addInitScript((kb) => {
  const vv = window.visualViewport, h = Object.getOwnPropertyDescriptor(VisualViewport.prototype, "height").get
  Object.defineProperty(vv, "height", { get: () => h.call(vv) - (window.__kb ? kb : 0) })
  window.__keyboard = (on, quiet) => { window.__kb = on; if (!quiet) vv.dispatchEvent(new Event("resize")) }
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
const keyboard = async (on, quiet = false) => { await page.evaluate(([on, quiet]) => window.__keyboard(on, quiet), [on, quiet]); await idle() }
const keysOverKeyboard = () => page.evaluate(() => {
  const keys = document.querySelector("[aria-label='Terminal keys']")?.getBoundingClientRect(), vv = window.visualViewport
  return { keys: keys ? Math.round(keys.bottom) : null, keyboard: Math.round(vv.offsetTop + vv.height), up: !!window.__kb }
})
const inputAt = () => page.evaluate(() => {
  const el = document.querySelector("[data-terminal]"), ta = el.querySelector("[data-term-input]")
  return { input: Math.round(ta.getBoundingClientRect().top), top: Math.round(el.getBoundingClientRect().top) }
})
const panHeld = () => page.evaluate(() => {
  const at = document.querySelector("[data-term-screen]"), r = at.getBoundingClientRect(), x = r.left + 40, y = r.top + 40
  const touch = (dy) => new Touch({ identifier: 1, target: at, clientX: x, clientY: y + dy })
  const fire = (type, dy) => { const e = new TouchEvent(type, { touches: type === "touchend" ? [] : [touch(dy)], changedTouches: [touch(dy)], bubbles: true, cancelable: true }); at.dispatchEvent(e); return e.defaultPrevented }
  fire("touchstart", 0)
  const held = fire("touchmove", 5)
  fire("touchcancel", 5)
  return held
})
const cursorInSight = () => page.evaluate(() => {
  const el = document.querySelector("[data-terminal]"), c = el.terminalCell(), keys = document.querySelector("[data-key-bar]")?.getBoundingClientRect()
  const ta = el.querySelector("[data-term-input]").getBoundingClientRect()
  return { top: Math.round(ta.top), bottom: Math.round(ta.top + c.height), keys: keys ? Math.round(keys.top) : null }
})

await page.locator("[data-term]").tap()
await page.locator("[data-terminal-held]").waitFor({ timeout: 3000 })
const early = await inputAt()
check("before the keys are up, the input waits at the terminal's top, where iOS needn't pan to it", Math.abs(early.input - early.top) <= 1, early)
await keyboard(true)
const over = await keysOverKeyboard()
check("the key row sits right above the keyboard", over.keys !== null && Math.abs(over.keys - over.keyboard) <= 1, over)
check("a drag in the terminal with the keyboard up doesn't move the page", await panHeld())
const before = await resizes()
for (let i = 0; i < 3; i++) { await keyboard(false); await keyboard(true) }
check("the keyboard coming and going sends the shell no new size", (await resizes()) === before, { before, after: await resizes() })

await page.keyboard.type("seq 1 300"); await page.keyboard.press("Enter")
await until(async () => /^300$/m.test(await terminalText(page)), 5000)
await idle()
const at = await cursorInSight()
check("the cursor is above the keys", at.keys !== null && at.bottom <= at.keys + 1 && at.top >= 0, at)

await page.evaluate(() => { window.__keyboard(false); setTimeout(() => window.__keyboard(true, true), 300) })
const late = await until(async () => { const o = await keysOverKeyboard(); return o.up && o.keys !== null && Math.abs(o.keys - o.keyboard) <= 1 && o }, 2500)
check("a keyboard that slid up with no last event still gets the key row over it", !!late, await keysOverKeyboard())

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

const { swipe } = await fingers(page)
const drawer = () => page.evaluate(() => document.documentElement.dataset.drawer ?? null)
const right = await page.evaluate(() => !!document.querySelector("[role=dialog][aria-label='Right sidebar']"))
for (const [side, x0, x1] of [["left", 18, 300], ...(right ? [["right", 372, 90]] : [])]) {
  await swipe(x0, 600, x1, 604); await idle()
  check(`a sideways drag from the terminal's edge low on the screen opens the ${side} sidebar`, (await until(drawer, 3000)) === side, await drawer())
  await page.keyboard.press("Escape"); await until(async () => !(await drawer()), 3000); await idle()
}

await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return null } })
await page.locator("[data-term]").tap()
await page.keyboard.type("clear; printf '\\e]8;;https://example.com/tap-1\\e\\\\tap here\\e]8;;\\e\\\\\\n'"); await page.keyboard.press("Enter")
const spotOf = () => page.evaluate(() => {
  const el = document.querySelector("[data-terminal]"), c = el.terminalCell(), y = el.terminalText().split("\n").findIndex((l) => l.startsWith("tap here"))
  return y < 0 ? null : { x: c.x + 3.5 * c.width, y: c.y + (y + 0.5) * c.height }
})
await until(spotOf, 4000)
await page.evaluate(() => document.activeElement?.blur())
await page.locator("[aria-label='Terminal keys']").waitFor({ state: "detached" })
await idle()
const spot = await spotOf()
await page.touchscreen.tap(spot.x, spot.y)
check("a tap on a link opens it", !!(await until(() => page.evaluate(() => window.__opened.join(" ").includes("example.com/tap-1")), 3000)), await page.evaluate(() => window.__opened))
check("and the keyboard stays down", !(await page.evaluate(() => !!document.activeElement?.closest("[data-term]"))))

await page.locator("[data-term]").tap()
await page.keyboard.type("exit"); await page.keyboard.press("Enter")
await idle()
await done()
