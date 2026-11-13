// Long folders in the file tree cut at files.json's folderLimit, with Show N more and Show less.
// WRITES "Qa long" and files.json (put back): throwaway server only.
//   node web/qa/foldercap.mjs <base url> [out dir]
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })

const D = "Qa long", N = 40, name = (i) => `${D}/Note ${String(i).padStart(2, "0")}.md`
await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("POST", "folder", { path: D })
await api("POST", "folder", { path: `${D}/Sub` })
for (let i = 1; i <= N; i++) await api("POST", "file", { path: name(i), text: `Note ${i}.\n` })
await api("POST", "file", { path: `${D}/Short.md`, text: "x\n" }).catch(() => {})
const filesBefore = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesBefore, fileSort: "name", folderLimit: 10, autoReveal: false })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const tree = page.locator("aside [role=tree]").first()
const row = (p) => tree.locator(`div[data-tree-path="${p}"]`)
const fileRows = () => tree.locator(`div[data-tree-path^="${D}/"]:not([data-tree-folder])`).count()
const more = () => tree.locator(`[data-tree-more="${D}"] button`)

await page.goto(B); await wait(1500)
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)
await row(D).locator("button").first().click(); await wait(300)

check("cut: 10 files shown", (await until(async () => (await fileRows()) === 10)) === true, await fileRows())
check("cut: its folder still shows", (await row(`${D}/Sub`).count()) === 1)
check("cut: the first ones in the sort", (await row(name(1)).count()) === 1 && (await row(name(11)).count()) === 0)
check("cut: Show 31 more", (await more().textContent()) === "Show 31 more", await more().textContent())
await page.screenshot({ path: `${OUT}foldercap-1-cut.png` })

await more().click()
check("show more: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())
check("show more: Show less", (await more().textContent()) === "Show less")
await more().click()
check("show less: cut again", !!(await until(async () => (await fileRows()) === 10)))

await more().click(); await until(async () => (await fileRows()) === N + 1)
await row(D).locator("button").first().click(); await wait(200)
await row(D).locator("button").first().click(); await wait(300)
check("closed and opened: cut again", (await fileRows()) === 10, await fileRows())

await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, name(30)); await wait(1200)
check("open file: shown past the cut", !!(await until(async () => (await row(name(30)).count()) === 1)))
check("open file: the count leaves it out", (await more().textContent()) === "Show 30 more", await more().textContent())

await api("PATCH", "config/files", { folderLimit: 0 })
check("limit 0: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())
check("limit 0: no Show more row", (await more().count()) === 0)

await api("PATCH", "config/files", { folderLimit: N - 2 })
check("a few over: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())

await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("PATCH", "config/files", Object.fromEntries(["fileSort", "folderLimit", "autoReveal"].map((k) => [k, filesBefore[k] ?? null])))
await done()
