// Do it: an open task line's button in a note hands it over (its op answered here: the delegate test has the server's side),
// done lines have none; a suggestion in the inbox has one on its row and settles when it's handed over.
// WRITES fixtures (QA/ in the vault): throwaway server only.
//   node web/qa/doit.mjs <base url> <vault path>
import { mkdirSync, writeFileSync } from "node:fs"
import { apiAt, qa, until, SHOTS as OUT } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
mkdirSync(`${VAULT}/QA`, { recursive: true })
writeFileSync(`${VAULT}/QA/Errands.md`, "---\ntype: note\n---\n# Errands\n\n- [ ] Compare the two flights\n- [x] Book the car\n\n```\n- [ ] In a code block\n```\n")
writeFileSync(`${VAULT}/QA/Hub.md`, "---\ntype: note\n---\nIts errands:\n\n![[QA/Errands]]\n")
const api = apiAt(B)
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
watch(page)
const asked = []
await page.route("**/api/ops/companion.do", (r) => { asked.push(r.request().postDataJSON()); return r.fulfill({ json: { id: "j1", title: "Compare the two flights", agent: "claude", state: "running", link: "view:claude-session/x", unseen: false, at: 1 } }) })
await page.goto(`${B}#file/${encodeURIComponent("QA/Errands.md")}`)
await page.waitForSelector(".cm-line", { timeout: 20000 })
const buttons = page.locator(".cm-do-it")
check("only the open task, not the done one nor code", await until(async () => await buttons.count() === 1, 8000), await buttons.count())
const line = page.locator(".cm-line", { hasText: "Compare the two flights" })
check("hidden until hovered", await buttons.evaluate((b) => getComputedStyle(b).opacity) === "0")
await line.hover()
check("shown on hover", await until(() => buttons.evaluate((b) => getComputedStyle(b).opacity === "1"), 2000))
await page.screenshot({ path: `${OUT}doit-line.png` })
await buttons.click()
check("a click hands over its note, line and words", await until(() => asked.length === 1, 3000) && asked[0].path === "QA/Errands.md" && asked[0].text === "Compare the two flights" && /^\d+$/.test(String(asked[0].line)), asked)
check("the toast says so", await until(() => page.getByText("Handed off: Compare the two flights").count().then((n) => n > 0), 3000))

// A drawn note (embedded): the same.
asked.length = 0
await page.goto(`${B}#file/${encodeURIComponent("QA/Hub.md")}`)
const read = page.locator(".md-do-it")
check("drawn: only the open task has one", await until(async () => await read.count() === 1, 15000), await read.count())
check("drawn: hidden until hovered", await read.evaluate((b) => getComputedStyle(b).opacity) === "0")
await page.locator("[data-embed] li", { hasText: "Compare the two flights" }).first().hover()
check("drawn: shown on hover", await until(() => read.evaluate((b) => getComputedStyle(b).opacity === "1"), 2000))
await page.screenshot({ path: `${OUT}doit-read.png` })
await read.click()
check("drawn: a click hands over its note, line and words", await until(() => asked.length === 1, 3000) && asked[0].path === "QA/Errands.md" && asked[0].text === "Compare the two flights" && asked[0].line === 6, asked)
asked.length = 1

const [, item] = await api("POST", "ops/inbox.add", { title: "Tidy the trip note", tldr: "It has three copies of the hotel.", do: "Tidy the trip note", from: "Dream" }).then((r) => [r.status ?? 200, r.body ?? r])
const row = page.locator("[data-result]", { hasText: "Tidy the trip note" }).first()
await page.goto(`${B}#view/inbox`)
check("a suggestion's row has its Do it", await until(() => row.locator("[data-do-it]").count().then((n) => n === 1), 8000), item)
await page.screenshot({ path: `${OUT}doit-inbox.png` })
await row.locator("[data-do-it]").click()
check("a click hands over its words", await until(() => asked.length === 2, 3000) && asked[1].text === "Tidy the trip note" && !asked[1].path, asked)
check("and settles it", await until(() => row.count().then((n) => n === 0), 5000))
await page.close()
done()
