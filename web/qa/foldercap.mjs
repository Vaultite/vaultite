// Long folders in the file tree: past files.json's folderLimit files (and a few more), a folder shows its first ones in
// the sort order, its folders, then "Show N more"; that shows them all and becomes "Show less"; closing the folder
// cuts it again; the open file and one revealed in the tree show past the cut; 0 shows every file. WRITES "Qa long" and
// files.json (put back): throwaway server only.
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

// 1. Cut: its folder, its first 10 files by name, then "Show 31 more" (41 files).
check("cut: 10 files shown", (await until(async () => (await fileRows()) === 10)) === true, await fileRows())
check("cut: its folder still shows", (await row(`${D}/Sub`).count()) === 1)
check("cut: the first ones in the sort", (await row(name(1)).count()) === 1 && (await row(name(11)).count()) === 0)
check("cut: Show 31 more", (await more().textContent()) === "Show 31 more", await more().textContent())
await page.screenshot({ path: `${OUT}foldercap-1-cut.png` })

// 2. Show more: all of them, the row now Show less; Show less cuts it again.
await more().click()
check("show more: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())
check("show more: Show less", (await more().textContent()) === "Show less")
await more().click()
check("show less: cut again", !!(await until(async () => (await fileRows()) === 10)))

// 3. Closing the folder after showing all: cut again when it opens.
await more().click(); await until(async () => (await fileRows()) === N + 1)
await row(D).locator("button").first().click(); await wait(200)
await row(D).locator("button").first().click(); await wait(300)
check("closed and opened: cut again", (await fileRows()) === 10, await fileRows())

// 4. The open file shows past the cut.
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, name(30)); await wait(1200)
check("open file: shown past the cut", !!(await until(async () => (await row(name(30)).count()) === 1)))
check("open file: the count leaves it out", (await more().textContent()) === "Show 30 more", await more().textContent())

// 5. 0: every file, no row.
await api("PATCH", "config/files", { folderLimit: 0 })
check("limit 0: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())
check("limit 0: no Show more row", (await more().count()) === 0)

// 6. Only a few over: not cut (a row in place of two would hide nothing worth it).
await api("PATCH", "config/files", { folderLimit: N - 2 })
check("a few over: every file", !!(await until(async () => (await fileRows()) === N + 1)), await fileRows())

await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
// (PATCH: a key it didn't have goes again, null removing it)
await api("PATCH", "config/files", Object.fromEntries(["fileSort", "folderLimit", "autoReveal"].map((k) => [k, filesBefore[k] ?? null])))
await done()
