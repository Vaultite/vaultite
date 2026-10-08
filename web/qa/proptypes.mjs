// Property types and `this` in database views: a "Qa types" folder with a note whose properties get a vault-wide type
// from the icon before a key (only .vaultite/types.json's key changes, the input becomes a date picker, a value that
// isn't a number gets its quiet note), and a note with a query (`file.links contains this`) embedded in another, which
// lists what links to the note embedding it. Desktop and 390px. Screenshots in the third argument (or
// /tmp/vaultite-proptypes/).
// WRITES a "Qa types" folder and .vaultite/types.json (both removed after): throwaway server only.
//   node web/qa/proptypes.mjs <base url> <vault path> [screenshots dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa } from "./lib/qa.mjs"
const { args: [B, VAULT, SHOTS_DIR = "/tmp/vaultite-proptypes"], browser, check, watch, done } = await qa(import.meta.url)
const OUT = SHOTS_DIR.replace(/\/?$/, "/")
mkdirSync(OUT, { recursive: true })
const api = (method, p, body) => fetch(`${B}api/${p}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
const put = async (path, text) => { const r = await api("POST", "file", { path, text }); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`) }
const TYPES = `${VAULT}/.vaultite/types.json`
const hadTypes = existsSync(TYPES) ? readFileSync(TYPES, "utf8") : null

const F = "Qa types"
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
await put(`${F}/Trip.md`, "---\ndue: 2026-09-01\nrating: '12'\nplace: Lighthouse\n---\n\nA trip.\n")
await put(`${F}/Related.md`, "```block-query\ntitle: Qa linked here\nfrom: Qa types/\nwhere: \"file.links contains this\"\nview: list\n```\n")
await put(`${F}/Project.md`, "About the project.\n\n![[Related]]\n")
await put(`${F}/Linker.md`, "See [[Project]].\n")
await put(`${F}/Other.md`, "About [[Related]].\n")
const url = (p) => `${B}#file/${encodeURIComponent(p)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = watch(await ctx.newPage())

// `this`: the embedded note's query is about the note embedding it.
await page.goto(url(`${F}/Project.md`)); await page.waitForTimeout(2500)
const embedded = page.locator(`[data-embed="${F}/Related.md"]`).first()
await embedded.waitFor({ timeout: 8000 }).catch(() => {})
const listed = await embedded.locator("[data-query-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-query-row")))
check("embedded, a query's `this` is the note embedding it", JSON.stringify(listed) === JSON.stringify([`${F}/Linker.md`]), listed)
await page.screenshot({ path: `${OUT}this-embedded-desktop.png` })
await page.goto(url(`${F}/Related.md`)); await page.waitForTimeout(2000)
const own = await page.locator("[data-query-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-query-row")))
check("on its own, the note it's in", own.includes(`${F}/Other.md`) && own.includes(`${F}/Project.md`) && !own.includes(`${F}/Linker.md`), own)

// Types: the icon before a key sets its type for the vault; the input follows; a value that isn't one is noted.
await page.goto(url(`${F}/Trip.md`)); await page.waitForTimeout(2000)
const props = page.locator("section[aria-label=Properties]").first()
if (!(await props.locator("[role=table]").count())) await props.locator("button", { hasText: /^Properties/ }).click()
await page.waitForTimeout(300)
const typeBtn = (k) => props.locator(`button[aria-label^="${k}:"]`).first()
check("each key has its type's icon, none declared yet", (await typeBtn("due").getAttribute("data-prop-type")) === "" && (await props.locator("input[type=date]").count()) === 0)
await typeBtn("due").click(); await page.waitForTimeout(200)
const items = await page.locator("[role=menu] [role^=menuitem]").allInnerTexts()
check("its menu lists the types, none checked", ["Text", "List", "Number", "Checkbox", "Date", "Date and time", "Tags", "Aliases", "Link"].every((t) => items.includes(t))
  && (await page.locator("[role=menu] [aria-checked=true]").count()) === 0, items)
await page.getByRole("menuitemradio", { name: "Date", exact: true }).click()
await page.waitForTimeout(1500)
const typesNow = existsSync(TYPES) ? JSON.parse(readFileSync(TYPES, "utf8")) : null
check("picking Date writes that one key into .vaultite/types.json", typesNow?.types?.due === "date" && Object.keys(typesNow.types).length === 1, typesNow)
check("the file isn't changed", readFileSync(`${VAULT}/${F}/Trip.md`, "utf8").startsWith("---\ndue: 2026-09-01\nrating: '12'\n"))
check("its input is a date picker now, with its value", (await props.locator("input[type=date]").count()) === 1 && (await props.locator("input[type=date]").inputValue()) === "2026-09-01")
await api("POST", "ops/property.type", { key: "rating", type: "number" }); await page.waitForTimeout(1500)
const note = props.locator("[data-prop-note=rating]")
check("a value that isn't of its type gets a quiet note", (await note.count()) === 1 && /is a number, not '12'/.test(await note.innerText()), await note.count() && await note.innerText())
await page.screenshot({ path: `${OUT}types-desktop.png` })

// 390px: the rows fit.
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800)
const wide = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
check("390px: the properties don't widen the page", !wide)
await page.screenshot({ path: `${OUT}types-phone.png` })

await browser.close()
await api("DELETE", `file?path=${encodeURIComponent(F)}`)
if (hadTypes === null) rmSync(TYPES, { force: true }); else writeFileSync(TYPES, hadTypes)
await done()
