// The Web viewer in a browser (the desktop app's side is web/qa/webviewer.mjs): there's no viewer here, so a web link
// in a note opens a browser tab as before (a click and a ⌘-click), a `view:web/<url>` tab says pages open in the
// desktop app and links out, "Open web page…" isn't offered, and on a phone (390px) the tab reads the same.
// WRITES Notes/Qa web links.md: throwaway server only.
//   node web/qa/weblinks.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { devices } from "playwright-core"
import { SHOTS, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = `${SHOTS}weblinks/`], browser, check, errs, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const URL_ = "https://example.com/an-article"
await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: "Notes/Qa web links.md", text: `# Qa web links\n\nRead [the article](${URL_}) later.\n` }) })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
// Opened pages are only counted (nothing leaves this machine).
await ctx.route("https://example.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Example</title>Example" }))
const page = watch(await ctx.newPage(), { console: true, fail: false })

await page.goto(`${B}#file/${encodeURIComponent("Notes/Qa web links.md")}`)
await page.waitForSelector(".cm-link[data-url]", { timeout: 15000 })
await page.locator(".cm-line", { hasText: "Qa web links" }).first().click()
await wait(300)
let popup = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null)
await page.locator(".cm-link[data-url]").first().click()
const p1 = await popup
check("a click on a web link in a note: a browser tab, as before", p1?.url() === URL_, p1?.url())
check("… and no web tab here", (await page.locator("[data-web-page], [data-web-elsewhere]").count()) === 0)
await p1?.close()

// A web tab opened anyway (a link to one, a workspace from the desktop app).
await page.goto(`${B}#view/${encodeURIComponent(`web/${URL_}`)}`)
check("a web tab in a browser says it's the desktop app's", await until(async () => (await page.locator("[data-web-elsewhere]").count()) === 1, 20000))
check("… with a link out", (await page.locator("[data-web-elsewhere] a").getAttribute("href")) === URL_)
check("… and its tab is named after the site", await until(async () => (await page.locator("[role=tab]", { hasText: "example.com" }).count()) > 0, 8000))
await page.screenshot({ path: `${OUT}elsewhere.png` })
popup = page.waitForEvent("popup", { timeout: 5000 }).catch(() => null)
await page.locator("[data-web-elsewhere] a").click()
check("the link out opens a browser tab", (await popup)?.url() === URL_)

await page.keyboard.press("ControlOrMeta+P")
await page.keyboard.type("Open web page")
await wait(400)
const listed = await page.evaluate(() => document.body.innerText)
check("\"Open web page…\" isn't offered in a browser", !listed.includes("Open web page…"), listed.slice(0, 200))
await page.keyboard.press("Escape")

const phone = await browser.newContext({ ...devices["iPhone 13"] })
const pp = await phone.newPage()
await pp.goto(`${B}#view/${encodeURIComponent(`web/${URL_}`)}`)
check("on a phone the web tab says the same", await until(async () => (await pp.locator("[data-web-elsewhere]").count()) === 1, 20000))
const wide = await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
check("… without scrolling sideways", wide)
await pp.screenshot({ path: `${OUT}phone.png` })

await fetch(`${B}api/file?path=${encodeURIComponent("Notes/Qa web links.md")}`, { method: "DELETE" })
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await done()
