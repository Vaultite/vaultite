// References and Research (plugins/core/references, bundles/research, web/demo/research), light, dark and phone. WRITES
// the research example and applies Research: throwaway server only.  node web/qa/references.mjs <base url> <vault path> [out dir]
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { command, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B, VAULT, OUT = "/tmp/references-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = async (p, body) => (await fetch(new URL(`/api/${p}`, B), body === undefined ? undefined
  : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()
const patch = (p, body) => fetch(new URL(`/api/${p}`, B), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const PAPER = "Papers/Paper machines/Draft.md"

cpSync(path.join(import.meta.dirname, "../demo/research"), VAULT, { recursive: true })
const applied = await api("bundles/research/apply", { workspace: null })
check("Research applies", !applied.error, applied)
await patch("config/plugin/references", { zoteroLocal: false })

const open = async (page, rel, theme = "light") => {
  await page.goto("about:blank")
  await page.emulateMedia({ colorScheme: theme })
  await page.goto(`${B}#file/${encodeURIComponent(rel)}`)
  await page.locator(".cm-content").first().waitFor()
  await app(page).idle({ timeout: 20_000 })
}

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
await open(page, PAPER)
const chips = page.locator(".cm-citation")
check("the paper's citations are drawn in APA", await until(async () => (await chips.count()) >= 4, 10_000) &&
  /\(Bush, 1945\)/.test(await chips.first().innerText()), await chips.allInnerTexts())
const panel = page.locator("[data-references-panel]")
const entries = panel.locator("[data-reference]")
check("the References panel lists the paper's references, formatted, DOIs linked", await until(async () => (await entries.count()) >= 15, 10_000) &&
  (await panel.locator("a[href^='https://doi.org/']").count()) > 3, await entries.count())
await page.screenshot({ path: `${OUT}research-light.png` })

await entries.filter({ hasText: "Garfield" }).first().click()
check("a reference without a literature note gets one, beside the others, and it opens", await until(() => existsSync(path.join(VAULT, "Reading notes/garfield1955.md")), 8000) &&
  await until(async () => decodeURIComponent(page.url()).includes("Reading notes/garfield1955.md"), 8000), page.url())
await open(page, PAPER)
await chips.first().hover()
const card = page.locator(".vau-cite-card")
check("pointing at a citation shows its full reference", await until(() => card.locator(".vau-cite-ref").count(), 5000) &&
  /As we may think|As We May Think/i.test(await card.innerText()), await card.count())
await page.screenshot({ path: `${OUT}card.png` })
await page.mouse.move(5, 450)

await panel.locator("[data-option=library]").click()
await panel.locator("input[type=search]").fill("luhmann")
check("the library finds a reference by its author", await until(async () => (await panel.locator("[data-library-row]").count()) >= 1, 5000), await panel.locator("[data-library-row]").count())
await page.screenshot({ path: `${OUT}library.png` })
await panel.locator("[data-option=cited]").click()

writeFileSync(path.join(VAULT, "Qa cites.md"), "As memex [@bush1945] and slips [@blair2010] show.\n")
await open(page, "Qa cites.md")
const qaChips = page.locator(".cm-citation")
check("a note without its own style is in the user's (APA)", await until(async () => /\(Bush, 1945\)/.test(await qaChips.first().innerText().catch(() => "")), 10_000))
await page.locator(".cm-content").first().click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("\nAlso [@luh")
const options = page.locator(".cm-tooltip-autocomplete li")
check("typing [@ suggests from the library by author", await until(async () => (await options.allInnerTexts()).some((t) => t.includes("@luhmann1981")), 8000), await options.allInnerTexts())
await app(page).idle()
await page.keyboard.press("Tab")
check("picking one writes its key in the brackets", await until(async () => (await page.locator(".cm-content").first().innerText()).includes("[@luhmann1981]"), 8000), (await page.locator(".cm-content").first().innerText()).slice(-120))
await patch("config/plugin/references", { style: "ieee" })
check("another style renumbers the citations", await until(async () => /^\[1\]$/.test((await qaChips.first().innerText()).trim()), 10_000), await qaChips.first().innerText())
check("the panel names the style in use", await until(async () => (await panel.locator("[data-references-style]").getAttribute("data-references-style")) === "ieee", 5000))
await open(page, PAPER)
check("a paper's own style (csl:) is kept", await until(async () => /\(Bush, 1945\)/.test(await chips.first().innerText().catch(() => "")), 10_000))
await patch("config/plugin/references", { style: null, inDocument: true })
check("References in document lists them under the paper's own References heading, with none of its own", await until(() => page.locator("[data-bibliography] .vau-ref-text").count(), 10_000) &&
  !(await page.locator("[data-bibliography] h2").count()))
await page.evaluate(() => { window.print = () => { window.qaPrinted = document.getElementById("vau-print")?.innerText ?? "" } })
await command(page, "Print note")
const printed = await until(() => page.evaluate(() => window.qaPrinted), 15_000)
check("a printed paper has its citations in its style and its references under its own heading, once", /\(Bush, 1945\)/.test(printed ?? "") &&
  (printed?.match(/^References$/gm) ?? []).length === 1 && /Ahrens, S\. \(2017\)/.test(printed ?? ""), (printed ?? "").slice(-400))
await patch("config/plugin/references", { inDocument: null })

const dark = watch(await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" }))
await open(dark, PAPER, "dark")
await until(() => dark.locator("[data-reference]").count(), 10_000)
await dark.screenshot({ path: `${OUT}research-dark.png` })

const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }))
await open(phone, PAPER)
check("on a phone the citations are drawn too", await until(async () => (await phone.locator(".cm-citation").count()) >= 3, 10_000))
await phone.screenshot({ path: `${OUT}phone.png` })

await done()
