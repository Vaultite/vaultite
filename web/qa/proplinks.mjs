// Links in properties (components/Properties.tsx): `owner: "[[Alice Park]]"` and a list of links are drawn as links,
// as Obsidian does, in reading and editing; a click on one follows it, a click beside it edits the text as written. Shot:
// the properties. WRITES a note: throwaway server only.
//   node web/qa/proplinks.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"

const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const NOTE = "Qa links/Lighthouse.md", PERSON = "Qa links/Alice Park.md"
await api("POST", "file", { path: PERSON, text: "# Alice Park\n" })
await api("POST", "file", { path: NOTE, text: "---\nowner: \"[[Alice Park]]\"\nrelated: [\"[[Alice Park|Alice]]\", \"[[Nowhere yet]]\"]\nsite: See https://example.com first\nstatus: active\n---\n\nA small app.\n" })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = watch(await ctx.newPage())
const props = () => page.locator('section[aria-label="Properties"]').first()
async function openNote() {
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
  await page.waitForSelector('section[aria-label="Properties"]', { timeout: 30000 })
  const head = props().locator("button[aria-expanded]").first()
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click()
  await until(() => props().locator("a[data-wiki]").count(), 4000)
}
await openNote()
const links = await props().locator("a[data-wiki]").evaluateAll((els) => els.map((e) => `${e.textContent}>${e.getAttribute("data-wiki")}`))
check("a text property's [[link]] is a link, named as its note", links[0] === "Alice Park>Alice Park", links)
check("...a list's are too, an alias by its alias", links.includes("Alice>Alice Park"), links)
check("...a link to no note yet is still one", links.some((l) => l.startsWith("Nowhere yet>")), links)
check("...a web address in text is a link, the words around it as written", await props().locator('a[href="https://example.com"], a[data-url="https://example.com"]').count() === 1 &&
  (await props().innerText()).includes("See ") && (await props().innerText()).includes(" first"))
check("...a value with no link is its field as before", await props().locator("input").evaluateAll((els) => els.some((e) => e.value === "active")))
await page.screenshot({ path: `${OUT}proplinks.png`, clip: { x: 240, y: 0, width: 820, height: 420 } })

await props().locator("a[data-wiki]").first().click()
check("a click on the link opens its note", !!(await until(() => decodeURIComponent(page.url()).includes(PERSON), 4000)), page.url())
await openNote()
const field = props().locator("[data-prop-linked]").first(), box = await field.boundingBox()
await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2)
check("a click beside it edits it as written", await until(() => page.evaluate(() => document.activeElement?.tagName === "INPUT" && document.activeElement.value === "[[Alice Park]]"), 2000))
await page.keyboard.press("Escape"); await wait(300)
check("...and done, it's a link again", await props().locator("[data-prop-linked] a[data-wiki]").count() >= 1)

await api("DELETE", `file?path=${encodeURIComponent("Qa links")}`)
await ctx.close()
await done()
