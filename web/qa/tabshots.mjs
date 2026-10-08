// The iPhone app's tab pictures (core/tabShots.ts), with a stand-in shell: `window.Capacitor` whose Shell.snapshot
// answers a red picture (and records the rect asked for). Opening the tab list pictures the tab on screen and its card
// shows the picture; the rect is the page between the header and the bar; a tab that has moved on (another file in it)
// shows the drawn stand-in again; pictures outlast a reload (Cache API); a closed tab's picture goes; without the
// shell, no picture is asked for. Opens files and tabs only: run it against a throwaway server.
//   node web/qa/tabshots.mjs <base url>
import { qa, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, noErrors, done } = await qa(import.meta.url)

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await ctx.addInitScript(() => {
  if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") }
  window.__shots = []
  const red = (() => { const c = document.createElement("canvas"); c.width = 20; c.height = 30; const g = c.getContext("2d"); g.fillStyle = "#f00"; g.fillRect(0, 0, 20, 30); return c.toDataURL("image/jpeg") })
  window.Capacitor = {
    isNativePlatform: () => true,
    isPluginAvailable: (n) => n === "Shell",
    nativePromise: async (plugin, method, o) => {
      if (method === "snapshot") { window.__shots.push(o); return { url: red() } }
      if (method === "servers") return { servers: [] }
      return {}
    },
  }
})
const P = watch(await ctx.newPage(), { console: true, ignore: null })

const files = await fetch(`${B}api/state`).then((r) => r.json()).then((s) => s.files.files.filter((f) => f.path.startsWith("Notes/") && f.path.endsWith(".md")).map((f) => f.path))
const [a, b, c] = files
const H = (p) => `#file/${encodeURIComponent(p)}`
await P.goto(`${B}${H(a)}`)
await P.waitForSelector("[data-phone-bar]"); await wait(800)
await P.click("[data-bar=new]"); await wait(700)
await P.evaluate((h) => { location.hash = h }, H(b)); await wait(800)

const cards = () => P.evaluate(() => [...document.querySelectorAll("[data-tab-row]")].map((r) => ({ id: r.dataset.tabRow, img: !!r.querySelector("[data-tab-shot] img[src^=blob]"), current: !!r.querySelector("[aria-current]") })))
const settle = () => wait(700)

// Open the list: the tab on screen (b) is pictured.
await P.click("[data-tabs-button]"); await settle()
let cs = await cards()
const rect = await P.evaluate(() => window.__shots.at(-1))
check("a picture was asked for", !!rect, rect)
check("its rect: the page between header and bar", rect && rect.y >= 40 && rect.y < 120 && rect.width === 390 && rect.y + rect.height <= 844 - 40, rect)
check("the tab on screen's card shows it", cs.find((x) => x.current)?.img === true, cs)

// Pick the other (a): leaving the list takes no picture (the list is no page); open the list from a: a is pictured too.
const other = cs.find((x) => !x.current).id
await P.click(`[data-tab-row="${other}"] button[aria-label]:not([aria-label^=Close])`); await settle()
await P.click("[data-tabs-button]"); await settle()
cs = await cards()
check("both cards show pictures", cs.length === 2 && cs.every((x) => x.img), cs)

// Move a on to another file: its card goes back to the stand-in until it's pictured again.
await P.click("[data-sheet-done]"); await settle()
await P.evaluate((h) => { location.hash = h }, H(c)); await wait(800)
await P.evaluate(() => { window.__shots.length = 0 })
// Look at the list without picturing (as a tab moved on elsewhere would): open it straight.
await P.evaluate(() => { history.replaceState({ sheet: 0 }, "", `#${location.hash.slice(1)}/tabs`); dispatchEvent(new HashChangeEvent("hashchange")) }); await settle()
cs = await cards()
check("a tab that moved on: stand-in, not its old picture", cs.find((x) => x.current)?.img === false && cs.find((x) => !x.current)?.img === true, cs)
await P.click("[data-sheet-done]"); await settle()

// Kept across a reload.
await P.reload(); await P.waitForSelector("[data-phone-bar]"); await wait(1200)
await P.evaluate(() => { history.replaceState({ sheet: 0 }, "", `#${location.hash.slice(1)}/tabs`); dispatchEvent(new HashChangeEvent("hashchange")) }); await settle()
cs = await cards()
check("after a reload: the pictures are back", cs.filter((x) => x.img).length >= 1, cs)

// Close the pictured tab: its picture goes from the cache too (on the next picture taken).
const gone = cs.find((x) => x.img && !x.current)?.id
await P.click(`[data-tab-row="${gone}"] [aria-label^=Close]`); await wait(600)
await P.click("[data-sheet-done]"); await settle()
await P.click("[data-tabs-button]"); await settle()
const cached = await P.evaluate(async () => (await (await caches.open("vaultite-tab-shots")).keys()).map((r) => decodeURIComponent(r.url.split("/__tab-shot/")[1])))
check("a closed tab's picture is forgotten", gone && !cached.includes(gone), { gone, cached })

noErrors()

// Without the shell: nothing asked, cards drawn.
const plain = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const Q = await plain.newPage()
await Q.goto(`${B}${H(a)}`); await Q.waitForSelector("[data-phone-bar]"); await wait(800)
await Q.click("[data-tabs-button]"); await settle()
check("in a browser: cards drawn, no pictures", await Q.evaluate(() => !document.querySelector("[data-tab-shot] img[src^=blob]") && !!document.querySelector("[data-tab-shot]")), null)

await done()
