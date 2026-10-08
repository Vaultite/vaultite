// One shell on two devices: the last one to send its size wins (a phone shrinks it), and the other takes it back when
// it's used again (clicked, typed in, its window focused), so the program redraws for it. Runs a shell on the server's machine
// (the server and this script on the same one): throwaway server only.
//   node web/qa/termsize.mjs <base url>
import { readFileSync, rmSync } from "node:fs"
import { qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const sid = `qa${Date.now().toString(36)}s`

const open = async (viewport, touch) => {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#view/terminal%2F${sid}`)
  return page
}
// The shell's size as the shell sees it: a background loop writes it to a file, so reading it touches no device.
const file = `/tmp/${sid}.size`
const size = () => { try { const [rows, cols] = readFileSync(file, "utf8").trim().split(" "); return cols ? `${cols}x${rows}` : "" } catch { return "" } }
const becomes = async (want) => { await until(async () => size() === want, 5000); return size() }

const desk = await open({ width: 1280, height: 800 }, false)
await until(async () => /%|\$|❯/.test(await terminalText(desk)), 8000)
await desk.locator(".xterm").click()
await desk.keyboard.type(`(while true; do stty size > ${file}.tmp </dev/tty && mv ${file}.tmp ${file}; sleep 0.2; done) &`)
await desk.keyboard.press("Enter")
await until(async () => !!size(), 8000)
const mine = size()
check("desktop: the shell has its size", /^\d+x\d+$/.test(mine), mine)

const phone = await open({ width: 390, height: 700 }, true)
await until(async () => size() !== mine, 8000)
const shrunk = size()
check("phone joins: the shell takes the phone's size", /^\d+x\d+$/.test(shrunk) && shrunk !== mine, [mine, shrunk])
await wait(1000)
check("desktop untouched: stays the phone's", size() === shrunk, size())

await desk.locator(".xterm").click()
check("desktop clicked: its size again", (await becomes(mine)) === mine, size())

await phone.evaluate(() => window.dispatchEvent(new Event("focus")))
check("phone's window focused: the phone's size", (await becomes(shrunk)) === shrunk, size())
await desk.evaluate(() => window.dispatchEvent(new Event("focus")))
check("desktop's window focused: its size again", (await becomes(mine)) === mine, size())

await phone.evaluate(() => window.dispatchEvent(new Event("focus")))
await becomes(shrunk)
await desk.keyboard.press("Enter")
check("desktop typed in: its size again", (await becomes(mine)) === mine, size())

await desk.keyboard.type("kill %1; exit"); await desk.keyboard.press("Enter"); await wait(300)
rmSync(file, { force: true })
await done()
