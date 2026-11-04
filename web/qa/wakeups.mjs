// Idle wakeups: an open window with one note and the sidebars, left alone, runs almost nothing (timer, frame and idle
// callbacks a minute, shown and hidden), and its server's main thread sleeps (Linux), with a comment thread in a note
// not open. WRITES that thread: throwaway server. Covers plugins/core/companion/Overlay.tsx, core/live.ts,
// core/schedule.ts, plugins/core/activity/plugin.ts.
//   node web/qa/wakeups.mjs <base url> [--print]
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const PRINT = process.argv.includes("--print")
const SECS = 20
// Callbacks a minute (one note; measured ~15 shown, mostly Dispatch's 5 s poll, ~3 hidden): a new poll shows here.
// The server's main-thread wakeups a minute, the window open (measured ~200; an always-on timer showed ~3000).
const LIMITS = { shown: 30, hidden: 30, server: 600 }

/** The server's main thread's context switches so far, where /proc tells (Linux), else null. */
function serverWakes() {
  try {
    const pid = execFileSync("lsof", [`-tiTCP:${new URL(B).port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]
    return [...fs.readFileSync(`/proc/${pid}/status`, "utf8").matchAll(/^(?:non)?voluntary_ctxt_switches:\s+(\d+)/gm)].reduce((a, m) => a + Number(m[1]), 0)
  } catch { return null }
}

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
// (a vault's threads in notes not open place nothing: the companion's overlay stays asleep)
check("a thread left in another note", await page.evaluate(() => new Promise((ok) => {
  const ws = new WebSocket(new URL("api/companion/live", location.href).href.replace(/^http/, "ws"))
  ws.onopen = () => ws.send(JSON.stringify({ t: "comment", path: "Notes/Lisbon trip.md", line: 1, text: "A thread elsewhere" }))
  ws.onmessage = (e) => { if (String(e.data).includes("A thread elsewhere")) { ws.close(); ok(true) } }
  setTimeout(() => ok(false), 8000)
})))
await page.locator("aside[data-side=left]").getByText("How this vault works").first().click()
check("the note opens", await until(() => page.evaluate(() => decodeURIComponent(location.hash).includes("How this vault works")), 8000))
await page.mouse.move(700, 450)
// (what opening it started settles: the playground's welcome toast and its announcement gone, or they're measured)
await until(() => page.evaluate(() => !document.querySelector("[data-sonner-toast], [data-announce] > p")), 20000)
await wait(5000)

async function measure(name) {
  await page.evaluate(() => { for (const k in window.__wakes) delete window.__wakes[k] })
  const s0 = serverWakes()
  await wait(SECS * 1000)
  const s1 = serverWakes()
  if (s0 !== null && s1 !== null) check(`${name}: the server woke ${Math.round((s1 - s0) * 60 / SECS)} times a minute (at most ${LIMITS.server})`, (s1 - s0) * 60 / SECS <= LIMITS.server)
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
