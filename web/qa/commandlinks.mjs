// A note's vaultite://command/<id> links: one that only opens something (fromLink: the quick switcher) runs at once,
// any other asks first, naming the command (the note may not be the user's); Cancel runs nothing, Run runs it.
// WRITES Notes/Qa command links.md: throwaway server only.
//   node web/qa/commandlinks.mjs <base url>
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, errs, watch, done } = await qa(import.meta.url)

const NOTE = "Notes/Qa command links.md"
await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: NOTE, text: "# Qa command links\n\n[Find a file](vaultite://command/switcher:open) and [a new tab](vaultite://command/tab:new).\n" }) })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage())
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector(".cm-link[data-url]", { timeout: 15000 })
await page.locator(".cm-line", { hasText: "Qa command links" }).first().click()
await wait(300)
const link = (text) => page.locator(".cm-link[data-url]", { hasText: text }).first()
const tabs = () => page.locator("[data-tab-id]").count()

await link("Find a file").click()
check("a link to the quick switcher opens it at once", await until(() => page.$('[role="dialog"][aria-label="Search"]'), 5000))
check("… without asking", (await page.locator("[data-confirm]").count()) === 0)
await page.keyboard.press("Escape")
await wait(300)

const before = await tabs()
await link("a new tab").click()
const asked = await until(() => page.$("[data-confirm]"), 5000)
check("a link to any other command asks first, naming it", !!asked && /Open new tab\?/.test(await page.locator("[data-confirm]").innerText()))
await page.keyboard.press("Escape")
await wait(400)
check("… Cancel runs nothing", (await tabs()) === before, [before, await tabs()])
await link("a new tab").click()
await until(() => page.$("[data-confirm]"), 5000)
await page.click("[data-confirm-ok]")
check("… Run runs it", await until(async () => (await tabs()) === before + 1, 5000), [before, await tabs()])

await fetch(`${B}api/file?path=${encodeURIComponent(NOTE)}`, { method: "DELETE" })
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await done()
