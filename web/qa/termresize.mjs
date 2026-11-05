// A sidebar's edge dragged beside a terminal: the terminal keeps its size till it's let go (each size cleared its
// canvas: it blinked and rewrapped all along). Runs a shell: throwaway server only.
//   node web/qa/termresize.mjs <base url>
import { PROMPT, qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const sid = `qa${Date.now().toString(36)}r`

const page = watch(await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage())
await page.goto(`${B}#view/terminal%2F${sid}`)
await until(async () => PROMPT.test(await terminalText(page)), 8000)

const screen = () => page.evaluate(() => document.querySelector("[data-terminal] .xterm-screen")?.getBoundingClientRect().width ?? 0).then(Math.round)
const edge = page.getByRole("separator", { name: "Resize the sidebar" })
const box = await edge.boundingBox()
const x = box.x + box.width / 2, y = box.y + box.height / 2
const before = await screen()

// Dragged out 160px in small steps, as a hand does.
await page.mouse.move(x, y); await page.mouse.down()
const during = []
for (let i = 1; i <= 16; i++) { await page.mouse.move(x + i * 10, y); await wait(30); during.push(await screen()) }
await wait(300)
during.push(await screen())
check("while dragged: the terminal keeps its size", during.every((w) => w === before), { before, during })
const wide = await page.evaluate(() => document.querySelector("aside[data-side=left]")?.getBoundingClientRect().width)
await page.mouse.up()
await until(async () => (await screen()) !== before, 2000)
const after = await screen()
check("let go: the terminal fits the narrower pane", after < before, { before, after })
const kept = await page.evaluate(() => document.querySelector("aside[data-side=left]")?.getBoundingClientRect().width)
check("let go: the sidebar stays where it was left", Math.abs(kept - wide) < 1, { wide, kept })

// Escape mid-drag: back where it began, and the terminal at its size.
const b2 = await edge.boundingBox()
await page.mouse.move(b2.x + b2.width / 2, y); await page.mouse.down()
for (let i = 1; i <= 8; i++) { await page.mouse.move(b2.x + b2.width / 2 - i * 10, y); await wait(20) }
await page.keyboard.press("Escape")
await page.mouse.up()
await wait(500)
check("escape: the sidebar back as it was", Math.abs((await page.evaluate(() => document.querySelector("aside[data-side=left]")?.getBoundingClientRect().width)) - kept) < 1)
check("escape: the terminal at its size", (await screen()) === after, { after, now: await screen() })

await page.locator(".xterm").click()
await page.keyboard.type("exit"); await page.keyboard.press("Enter"); await wait(300)
await done()
