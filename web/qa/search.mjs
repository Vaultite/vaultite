// Search (core/search.ts, components/SearchPalette.tsx, pages/Search.tsx, core/searchquery.ts): the quick switcher
// marks what matched in the grey text too (a word found only in a note's body shows the part around it), files found by
// their text come under "In files", pages aren't found by their folder's name, an operator query lists files only with
// what it asks for in words, a bad query says why, and a running terminal is found by name. The search tab lists the
// operators while empty (a click adds one), marks matched lines, and its options (match case, sort, collapse, more
// context, explain) are saved in .vaultite/plugins/search/data.json. Phones at 390px: no horizontal overflow.
// WRITES a "Qa search" folder, a note in Notes/ and the search plugin's settings (put back), runs a shell.
//   node web/qa/search.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/search-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => { const f = `${OUT}${name}.png`; await page.screenshot({ path: f }); try { execFileSync("sips", ["-Z", "1200", f], { stdio: "ignore" }) } catch { /* no sips */ } }

const DIR = "Qa search"
const put = (rel, text) => { mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); writeFileSync(path.join(VAULT, rel), text) }
put(`${DIR}/Budget plan.md`, "---\ntags: [qa-search]\nstatus: seed\n---\n# Rent\nPay the rent and buy food.\n- [ ] call the landlord about the heating\n\nSomething else entirely.\n")
put("Notes/Qa airship.md", "---\ntype: note\nkind: idea\nstatus: seed\nid: qa-airship\n---\nA long opening that goes on about weather, maps, routes, fuel, crews and the price of tickets before it finally names the zeppelin we want.\n")
const SETTINGS = path.join(VAULT, ".vaultite/plugins/search/data.json")
const before = existsSync(SETTINGS) ? readFileSync(SETTINGS, "utf8") : null

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const rows = () => page.$$eval('[role="listbox"] > *', (els) => els.map((e) => ({ heading: e.getAttribute("role") === "presentation", text: e.textContent.trim(), marks: [...e.querySelectorAll("mark")].map((m) => m.textContent) })))
const palette = async (q) => {
  if (!(await page.$('[role="dialog"][aria-label="Search"]'))) { await page.keyboard.press("ControlOrMeta+o"); await until(() => page.$('[role="dialog"][aria-label="Search"]'), 8000) }
  await page.fill('[role="dialog"][aria-label="Search"] input', q)
  await wait(700)
  return rows()
}

try {
  await page.goto(`${B}#file/${encodeURIComponent("Welcome.md")}`)
  await until(() => page.$(".cm-editor, [data-file-view], main"), 15000)
  await wait(1500)

  // Pages aren't found by their folder.
  let r = await palette("dashboards")
  check("a page isn't found by its folder's name", !r.some((x) => /^Today\s*Page/.test(x.text)), r.map((x) => x.text))
  // A word only in a note's body: the part around it, marked.
  r = await palette("zeppelin")
  const air = r.find((x) => x.text.startsWith("Qa airship"))
  check("a note found by its body shows the part with the word", !!air && air.text.includes("…") && air.marks.includes("zeppelin"), r)
  await shot(page, "palette-body")
  // Found by the server's text search: under "In files", the word marked.
  r = await palette("landlord")
  const head = r.findIndex((x) => x.heading && x.text === "In files")
  const budget = r.findIndex((x) => x.text.startsWith("Budget plan"))
  check("words inside files come under In files", head >= 0 && budget > head, r)
  check("with the word marked in the line", r[budget]?.marks.includes("landlord"), r[budget])
  await shot(page, "palette-in-files")
  // Title marks and meta marks together.
  r = await palette("budget rent")
  const both = r.find((x) => x.text.startsWith("Budget plan"))
  check("a title word and a text word are both marked", both && both.marks.includes("Budget") && both.marks.some((m) => /rent/i.test(m)), r)
  // Operators: files only, what it asks for in words.
  r = await palette("tag:qa-search [status:seed]")
  check("an operator query says what it asks for", r[0]?.text.startsWith("Files where it's tagged #qa-search"), r[0])
  check("and lists the files", r.some((x) => x.text.startsWith("Budget plan")) && !r.some((x) => x.text.startsWith("Qa airship")), r)
  await shot(page, "palette-operators")
  r = await palette('"open')
  check("a query it can't read says why", r.some((x) => x.text.includes("A quote isn't closed")) || (await page.textContent('[role="dialog"]')).includes("A quote isn't closed"), r)
  await page.keyboard.press("Escape")

  // A running terminal is found by name.
  await page.goto(`${B}#view/terminal%2Fqasearch`)
  await wait(3000)
  await page.goto(`${B}#file/${encodeURIComponent("Welcome.md")}`)
  await wait(1200)
  r = await palette("termin")
  check("a running terminal is found", r.some((x) => /^Terminal/.test(x.text)), r.map((x) => x.text))
  await shot(page, "palette-terminal")
  await page.keyboard.press("Escape")

  // The search tab: operators while empty, a click adds one.
  await page.goto(`${B}#view/search`)
  await until(() => page.$("[data-search-view]"), 8000)
  check("the empty search tab lists the operators", (await page.textContent("[data-search-view]")).includes("in the file's name"), null)
  await shot(page, "tab-empty")
  await page.click('[aria-label="Search syntax"] button:has-text("tag:")')
  check("a click adds the operator", (await page.inputValue('[aria-label="Search the vault"]')) === "tag:", await page.inputValue('[aria-label="Search the vault"]'))
  await page.fill('[aria-label="Search the vault"]', "rent food")
  await until(() => page.$('[data-search-file="Qa search/Budget plan.md"]'), 8000)
  const lineMarks = await page.$$eval('[data-search-file="Qa search/Budget plan.md"] li mark', (ms) => ms.map((m) => m.textContent))
  check("the tab marks the words in each line", lineMarks.includes("rent") && lineMarks.includes("food"), lineMarks)
  await shot(page, "tab-plain")
  // Options: more context, saved in the vault.
  await page.click('[aria-label="Search options"]')
  await page.click('text="Show more context"')
  await until(() => page.$('[data-search-file="Qa search/Budget plan.md"] [data-ctx]'), 8000)
  check("more context shows lines around a match", !!(await page.$('[data-search-file="Qa search/Budget plan.md"] [data-ctx]')), null)
  check("and is saved in the vault", await until(() => existsSync(SETTINGS) && JSON.parse(readFileSync(SETTINGS, "utf8")).context === 2, 8000), existsSync(SETTINGS) && readFileSync(SETTINGS, "utf8"))
  // Match case.
  await page.fill('[aria-label="Search the vault"]', "Rent")
  await page.click('[aria-label="Match case"]')
  await wait(1200)
  const cased = await page.$$eval('[data-search-file="Qa search/Budget plan.md"] li:not(:has([data-ctx])) mark', (ms) => ms.map((m) => m.textContent))
  check("match case marks only that case", cased.length > 0 && cased.every((m) => m === "Rent"), cased)
  await page.click('[aria-label="Match case"]')
  // Operators in the tab: explained, a property query lists the file without lines.
  await page.fill('[aria-label="Search the vault"]', "line:(landlord heating)")
  await until(() => page.$("[data-search-explain]"), 8000)
  check("the tab explains an operator query", (await page.textContent("[data-search-explain]")).includes('a line has "landlord" and "heating"'), await page.textContent("[data-search-explain]"))
  await shot(page, "tab-operators")
  await page.fill('[aria-label="Search the vault"]', "(rent")
  await until(() => page.$('[role="alert"]'), 8000)
  check("a bad query says why in the tab", (await page.textContent('[role="alert"]')).includes("isn't closed"), null)

  // Phone: no horizontal overflow.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await phone.goto(`${B}#view/search`)
  await until(() => phone.$("[data-search-view]"), 8000)
  await wait(800)
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check("phone: the search tab fits 390px", wide <= 0, wide)
  await shot(phone, "phone-tab")
} finally {
  if (before === null) rmSync(SETTINGS, { force: true }); else writeFileSync(SETTINGS, before)
  rmSync(path.join(VAULT, DIR), { recursive: true, force: true })
  rmSync(path.join(VAULT, "Notes/Qa airship.md"), { force: true })
  // End the shell it started, like the Terminals panel's x (?end=1 on its socket).
  await page.evaluate((b) => new Promise((done) => {
    const s = new WebSocket(`${b.replace(/^http/, "ws").replace(/\/$/, "")}/api/terminal/qasearch?end=1`)
    s.onclose = s.onerror = () => done(); setTimeout(done, 2000)
  }), B).catch(() => {})
  await browser.close()
}
await done()
