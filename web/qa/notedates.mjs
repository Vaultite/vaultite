// Note dates (plugins/core/note-dates): set on new notes, moved in the save itself with no conflict, and a lost save's
// answer isn't a conflict with itself (core/autosave.ts). WRITES Qa dates/ (removed after): throwaway server only.
//   node web/qa/notedates.mjs <base url> <vault path>
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const P = "Qa dates/Trip.md", abs = `${VAULT}/${P}`
const read = () => readFileSync(abs, "utf8")
const OLD = "2020-01-02 03:04:05"
const r = await fetch(`${B}api/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: P, text: "Pack bags.\n\nBook the train.\n" }) })
check("a new note through the API gets created and updated", r.ok && /^---\ncreated: '[\d-]+ [\d:]+'\nupdated: '[\d-]+ [\d:]+'\n/.test(read()), read())
// (an old updated, so a save's own shows)
const aged = () => writeFileSync(abs, read().replace(/updated: '[^']+'/, `updated: '${OLD}'`))
aged()
await wait(800)

const page = watch(await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage())
await page.goto(`${B}#file/${encodeURIComponent(P)}`)
await until(() => page.locator(".file-view .cm-content").count(), 10000); await wait(600)
if (!(await page.locator("[data-tip^='2020-01-02']").count())) { await page.locator("text=Properties").first().click(); await wait(300) }
check("Properties shows them as dates, what's stored in the tip", await page.locator(`[data-tip='${OLD}']`, { hasText: "2020" }).count() === 1)
const view = () => page.evaluate(() => { const v = document.querySelector(".file-view .cm-content")?.cmTile?.root?.view; return v ? [v.state.doc.toString(), v.state.doc.lineAt(v.state.selection.main.head).text] : [null, null] })

await page.locator(".cm-line", { hasText: "Book the train" }).click()
await page.keyboard.press("End")
await page.keyboard.type(" Window seat.", { delay: 20 })
await until(() => !read().includes(OLD), 4000)
await page.keyboard.type(" Aisle ok.", { delay: 20 })
await until(() => read().includes("Aisle ok."), 4000); await wait(800)
const [doc, line] = await view()
check("typing moves updated, in the editor as on disk", !read().includes(OLD) && read().includes("Book the train. Window seat. Aisle ok.") && doc === read(), [read(), doc])
check("the cursor stays where it was typing", line === "Book the train. Window seat. Aisle ok.", line)
check("no conflict", !(await page.locator(".cm-clash").count()) && !(await page.locator("[role=alert]", { hasText: "while you typed" }).count()))

// The answer to a save lost: the server wrote it with its date, so the next save builds on it.
aged()
await wait(1500)
let dropped = 0
await page.route("**/api/file", async (route) => {
  if (route.request().method() !== "PUT" || dropped) return route.fallback()
  dropped++
  await route.fetch()
  await route.abort("failed")
})
await page.keyboard.type(" Cut off mid-sen")
await until(() => dropped, 4000); await wait(300)
await page.unroute("**/api/file")
await page.keyboard.type("tence.")
const saved = !!(await until(() => read().includes("Aisle ok. Cut off mid-sentence."), 6000))
check("a dated save whose answer was lost: saved, no conflict with itself", saved && !read().includes(OLD) && !(await page.locator(".cm-clash").count())
  && !(await page.locator("[role=alert]", { hasText: "while you typed" }).count()), read())

rmSync(`${VAULT}/Qa dates`, { recursive: true, force: true })
await done()
