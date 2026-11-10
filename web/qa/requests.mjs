// The request budget: what the app asks its server for (HTTP requests, API bytes, live socket messages) per flow,
// as over the tailnet, against requests.json's limits; --ratchet lowers a limit a win beat (commit it), --print lists
// the routes, --trace each API call and socket message. WRITES: types into a note: throwaway server.
//   node web/qa/requests.mjs <base url> [--ratchet] [--print] [--trace]
// What moves it most, so verify runs it on them: vite.config.ts (what loads at start), web/src/api.ts, web/src/core/data.ts,
// web/src/core/live.ts; the nightly run has the rest.
import fs from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`
const flag = (f) => process.argv.includes(`--${f}`)
const RATCHET = flag("ratchet"), PRINT = flag("print"), TRACE = flag("trace")
const LIMITS = new URL("./requests.json", import.meta.url)
const IDLE = 30

/** A request's name: its route, with what's per-file left out. */
const routeOf = (u) => !u.pathname.startsWith("/api/") ? (u.pathname.startsWith("/assets/") ? "(assets)" : u.pathname)
  : u.pathname.slice(5).replace(/^(config\/plugin|file|raw|themes|icon)\/.+/, "$1/*")
const isApi = (k) => !/ (\/|\(assets\))/.test(k)

// (as a phone or another machine asks, through the tailnet's proxy: compressed answers with ETags)
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "X-Forwarded-For": "100.64.0.1" } })
const page = watch(await ctx.newPage())
let tally = {}, socket = 0
const add = (k, bytes) => { tally[k] ??= { n: 0, bytes: 0 }; tally[k].n++; tally[k].bytes += bytes }
// Through the DevTools protocol: only what reached the server (a cached asset never leaves the browser), bytes as sent.
const cdp = await ctx.newCDPSession(page)
await cdp.send("Network.enable")
const reqs = new Map()
cdp.on("Network.requestWillBeSent", (e) => {
  if (!e.request.url.startsWith(B)) return
  const k = `${e.request.method} ${routeOf(new URL(e.request.url))}`
  if (TRACE && isApi(k)) console.log(`  > ${e.request.method} ${e.request.url.slice(B.length)} ${(e.request.postData ?? "").slice(0, 200)}`)
  reqs.set(e.requestId, k)
})
cdp.on("Network.requestServedFromCache", (e) => reqs.delete(e.requestId))
cdp.on("Network.responseReceived", (e) => { if (e.response.fromDiskCache || e.response.fromServiceWorker) reqs.delete(e.requestId) })
cdp.on("Network.loadingFinished", (e) => { const k = reqs.get(e.requestId); if (k) { reqs.delete(e.requestId); add(k, e.encodedDataLength) } })
cdp.on("Network.webSocketFrameReceived", (e) => { if (TRACE) console.log(`  < ${e.response.payloadData.slice(0, 200)}`); socket++ })
cdp.on("Network.webSocketFrameSent", (e) => { if (TRACE) console.log(`  > ${e.response.payloadData.slice(0, 200)}`); socket++ })

const count = () => Object.values(tally).reduce((a, x) => a + x.n, 0)
/** Nothing asked for `ms` (at most 20 s). */
const quiet = async (ms = 2000) => {
  for (let last = -1, t = Date.now(); Date.now() - t < 20_000;) { const n = count(); if (n === last) return; last = n; await wait(ms) }
}
const results = {}
async function phase(name, act, settle = 2000) {
  if (TRACE) console.log(`${name}:`)
  tally = {}; socket = 0
  await act()
  await quiet(settle)
  const api = Object.entries(tally).filter(([k]) => isApi(k))
  results[name] = { requests: count(), api: api.reduce((a, [, x]) => a + x.n, 0), apiKB: +(api.reduce((a, [, x]) => a + x.bytes, 0) / 1024).toFixed(1),
    assets: tally["GET (assets)"]?.n ?? 0, socket, routes: tally }
}
const switcher = async (name, newTab = false) => {
  await page.keyboard.press("ControlOrMeta+o")
  await until(() => page.evaluate(() => !!document.querySelector("[role=dialog] input[role=combobox]")), 5000)
  await page.keyboard.type(name, { delay: 30 })
  await wait(600)
  await page.keyboard.press(newTab ? "ControlOrMeta+Enter" : "Enter")
}
const opened = (title) => until(() => page.evaluate((t) => [...document.querySelectorAll("[role=tab][aria-selected=true]")].some((e) => e.textContent.includes(t)), title), 10_000)

await phase("startup", async () => {
  await page.goto(B)
  await until(() => page.evaluate(() => document.querySelectorAll("[role=tab]").length > 0), 20_000)
})
await phase("reload", () => page.reload())
await phase("open", async () => { await switcher("How this vault works"); await opened("How this vault works") })
await until(() => page.evaluate(() => document.querySelectorAll(".cm-content .cm-line").length > 2), 10_000)
// (a vault that isn't the sandbox may ask to allow a plugin's own writes first: not now)
if (await page.$("dialog[data-confirm][open]")) { await page.keyboard.press("Escape"); await wait(300) }
await page.locator(".cm-content:visible").first().click()
await page.keyboard.press("ControlOrMeta+End")
await phase("typing", () => page.keyboard.type(" Words typed into the note, one key at a time.", { delay: 60 }), 2500)
await phase("open another", async () => { await switcher("Lisbon trip", true); await opened("Lisbon trip") })
const tab = (t) => page.locator("[role=tab]").filter({ hasText: t }).first()
await phase("switch tabs", async () => {
  for (let i = 0; i < 3; i++) {
    await tab("How this vault works").click(); await opened("How this vault works"); await wait(300)
    await tab("Lisbon trip").click(); await opened("Lisbon trip"); await wait(300)
  }
})
await phase("idle", () => wait(IDLE * 1000), 500)
await phase("outside change", async () => {
  await fetch(new URL("api/file", B), { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" },
    body: JSON.stringify({ path: `Notes/Outside ${Date.now()}.md`, text: "Written by someone else.\n" }) })
  await wait(1500)
}, 2500)
noErrors()

for (const [name, r] of Object.entries(results)) {
  console.log(`${name}: ${r.requests} requests (${r.api} to the API, ${r.apiKB} KB), ${r.socket} socket messages`)
  if (PRINT) for (const [k, x] of Object.entries(r.routes).sort((a, b) => b[1].n - a[1].n)) console.log(`    ${k.padEnd(44)} ${String(x.n).padStart(4)} ${(x.bytes / 1024).toFixed(1).padStart(8)} KB`)
}
// A limit is what the flow took when set, with room: a timer (a status bar chip's poll) lands in a flow or not.
// (startup's requests are mostly the build's chunks, cached after: its API calls are counted, and its files)
const limits = JSON.parse(fs.readFileSync(LIMITS, "utf8")), room = (k, v) => (k === "apiKB" ? Math.ceil(v * 1.25 + 1) : v + 2)
let lowered = false
for (const [name, lim] of Object.entries(limits)) {
  for (const [k, max] of Object.entries(lim)) {
    const got = results[name]?.[k]
    check(`${name}: ${k} at most ${max}`, got <= max, got)
    if (RATCHET && got !== undefined && room(k, got) < max) { lim[k] = room(k, got); lowered = true }
  }
}
if (lowered) { fs.writeFileSync(LIMITS, `${JSON.stringify(limits, null, 2)}\n`); console.log("requests.json: lowered, commit it") }
await done()
