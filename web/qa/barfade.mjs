// Fade the file bar (appearance `fileBarFade`): always, the bar above a note is out of sight until the pointer is at its
// pane's top (beside it too, or just under it), and back out once it leaves; typing, it fades after two keys and is back when the pointer moves.
// Glass's transparency (`translucency`) sets index.css's --glass-level. WRITES appearance.json and a note: throwaway
// server only.
//   node web/qa/barfade.mjs <base url>
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)
const saved = await api("GET", "config/appearance")
const setLook = (patch) => api("PUT", "config/appearance", { ...saved, theme: "light", animation: "natural", tabBar: true, ...patch })
const NOTE = "Notes/Qa bar fade.md"
await api("POST", "file", { path: NOTE, text: `# Qa bar fade\n\n${"A line to read.\n\n".repeat(40)}` })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage())
const bar = page.locator("[data-pane] [data-view-bar]").first()
const opacity = () => bar.evaluate((e) => Number(getComputedStyle(e).opacity))
const settled = async (want) => { await until(async () => (await opacity()) === want, 3000); return opacity() }

await setLook({ fileBarFade: "always" })
await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await bar.waitFor({ timeout: 60000 }); await wait(800)
const box = await bar.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 4 })
check("always: the bar is out of sight while the pointer is on the page", (await settled(0)) === 0, await opacity())
await page.mouse.move(box.x + box.width / 2, box.y + box.height + 6, { steps: 6 })
check("…the pointer just under it brings it", (await settled(1)) === 1, await opacity())
await page.mouse.move(box.x + 40, box.y + box.height / 2, { steps: 3 })
check("…over it, it stays", (await settled(1)) === 1, await opacity())
const pane = await page.locator("[data-pane]").first().boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 6 }); await settled(0)
await page.mouse.move(pane.x + 4, box.y + box.height / 2, { steps: 3 })
check("…left of Back, in the pane's margin, it comes", (await settled(1)) === 1, await opacity())
await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 6 }); await settled(0)
await page.mouse.move(pane.x + pane.width - 4, box.y + box.height / 2, { steps: 3 })
check("…right of its last button, it comes", (await settled(1)) === 1, await opacity())
await page.mouse.move(box.x + box.width / 2, box.y + 300, { steps: 6 })
check("…back on the page, it goes again", (await settled(0)) === 0, await opacity())
await page.mouse.wheel(0, 600); await wait(300)
check("…scrolling with the pointer on the page keeps it away", (await opacity()) === 0, await opacity())

await setLook({ fileBarFade: "off" }); await wait(800)
check("off: the bar's there", (await settled(1)) === 1, await opacity())
check("…and nothing marks the page", await page.evaluate(() => !("barFade" in document.documentElement.dataset)))

await setLook({ fileBarFade: "typing" }); await wait(800)
await page.locator("[data-pane] .cm-content").first().click()
await page.keyboard.type("ab", { delay: 60 })
check("typing: two keys fade it", (await settled(0)) === 0, await opacity())
await wait(600); await page.mouse.move(box.x + 200, box.y + 400, { steps: 8 })
check("…the pointer moved, it's back", (await settled(1)) === 1, await opacity())

const level = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--glass-level"))
// (the setting reaches the page over its live connection: a while on a busy machine)
await setLook({ fileBarFade: "off", translucency: 80 })
check("translucency 80: the glass level is 1.6", await until(async () => (await level()) === "1.6", 5000), await level())
await setLook({ fileBarFade: "off", translucency: 50 })
check("…50, the default: no level set", await until(async () => (await level()) === "", 5000), await level())

await setLook({})
await api("PUT", "config/appearance", saved)
await done()
