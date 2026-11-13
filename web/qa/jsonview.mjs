// A JSON file as data (components/JsonView.tsx): records as a table, a mixed list numbered, branches open, a null typed
// in. WRITES and removes "Qa json.json": throwaway server only.   node web/qa/jsonview.mjs <base url>
import { apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B), F = "Qa json.json"
const data = { name: "Lighthouse", people: [{ name: "Alice Park", age: 34 }, { name: "Sam Lee", age: 29 }], mixed: [1, "two", { three: 3 }], deep: { inner: { leaf: true } }, empty: null }
await api("PUT", "file", { path: F, text: JSON.stringify(data, null, 2) })
const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
const { idle, sees } = app(page)
try {
  await page.goto(`${B}#file/${encodeURIComponent(F)}`)
  const view = page.locator(".json-view")
  await view.waitFor({ timeout: 20000 })
  await idle()
  const branch = (label) => view.locator("button[aria-expanded]", { hasText: label }).first().locator("xpath=..")
  const table = await view.locator("table").evaluateAll((ts) => ts.map((t) => ({ heads: [...t.querySelectorAll("th")].map((th) => th.textContent), rows: t.querySelectorAll("tbody tr").length })))
  check("a list of records is one table: its keys as columns, a row each", table.length === 1 && table[0].heads.join() === "name,age" && table[0].rows === 2, table)
  const mixed = await branch("mixed").innerText()
  check("a mixed list is numbered rows, its record a branch named by its place", /1\s+1/.test(mixed) && mixed.includes("two") && /3\s*1 field/.test(mixed) && !(await branch("mixed").locator("table").count()), mixed)
  check("nested objects open to their leaves", (await branch("deep").innerText()).includes("leaf") && (await branch("deep").innerText()).includes("true"), await branch("deep").innerText())
  await view.locator("[role=button]", { hasText: "null" }).first().click()
  const field = view.locator("input[aria-label=Value]")
  await field.fill("42")
  await sees(F, () => field.press("Enter"))
  const saved = await until(async () => { const { text } = await api("GET", `file?path=${encodeURIComponent(F)}`); return text?.includes('"empty": 42') && text }, 8000)
  check("a null typed as a number is saved as one", !!saved, saved)
} finally {
  await api("DELETE", `file?path=${encodeURIComponent(F)}`).catch(() => {})
  await browser.close()
}
await done()
