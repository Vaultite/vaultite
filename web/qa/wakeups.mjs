// Idle wakeups: an open window with one note and the sidebars, left alone, runs almost nothing (timer, frame and idle
// callbacks a minute, shown and hidden). Reads only. Covers plugins/core/companion/Overlay.tsx, core/live.ts.
//   node web/qa/wakeups.mjs <base url> [--print]
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const PRINT = process.argv.includes("--print")
const SECS = 20
// Callbacks a minute (one note, read; measured ~4 shown, ~4 hidden): a new poll or loop shows here.
const LIMITS = { shown: 30, hidden: 30 }

const HOOK = () => {
  const tally = (window.__wakes = {})
  const where = () => (new Error().stack.split("\n")[3] ?? "?").trim().replace(/\?[^:)]*/, "").replace(/https?:\/\/[^/]+/, "")
  const wrap = (kind, orig) => function (fn, ...a) {
    if (typeof fn !== "function") return orig.call(this, fn, ...a)
    const k = `${kind} ${where()}`
    return orig.call(this, function (...b) { tally[k] = (tally[k] ?? 0) + 1; return fn.apply(this, b) }, ...a)
  }
  window.setTimeout = wrap("timeout", window.setTimeout)
  window.setInterval = wrap("interval", window.setInterval)
  window.requestAnimationFrame = wrap("frame", window.requestAnimationFrame)
  if (window.requestIdleCallback) window.requestIdleCallback = wrap("idle", window.requestIdleCallback)
}

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
await page.addInitScript(HOOK)
await page.goto(B)
await page.locator("aside[data-side=left]").getByText("How this vault works").first().click()
check("the note opens", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("How this vault works")), 8000))
await page.mouse.move(700, 450)
await wait(5000) // (what opening it started settles)

async function measure(name) {
  await page.evaluate(() => { for (const k in window.__wakes) delete window.__wakes[k] })
  await wait(SECS * 1000)
  const tally = await page.evaluate(() => window.__wakes)
  const n = Object.values(tally).reduce((a, b) => a + b, 0) * 60 / SECS
  if (PRINT) for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)} ${k}`)
  check(`${name}: ${Math.round(n)} callbacks a minute (at most ${LIMITS[name]})`, n <= LIMITS[name], tally)
}

await measure("shown")
// Hidden as the app sees it (another app in front): what checks visibility stops.
await page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true })
  Object.defineProperty(document, "hidden", { get: () => true, configurable: true })
  document.dispatchEvent(new Event("visibilitychange"))
})
await wait(2000)
await measure("hidden")
await done()
