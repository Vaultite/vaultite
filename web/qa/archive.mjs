// Archiving (plugins/core/archive): Archive in a file's menu moves it into its folder's hidden .archive/ (the key set,
// links rewritten), Undo in the toast brings it back; the tree hides .archive/ until its header's "Show archived files"
// (files.json's showArchived), then shows it dimmed; Unarchive from there; an archived file stays out of a query; the
// palette's "Move archived files into archive folders" moves a file archived by hand, after asking; a new canvas made
// from an archived note goes beside it, not into .archive/. WRITES "Qa archive"
// and files.json (put back): throwaway server only.
//   node web/qa/archive.mjs <base url> [out dir]
import { readFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })
const VAULT = (await api("GET", "vault")).path
const read = (rel) => { try { return readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }
// (Provenance may add `origin` to what the API makes: compare from the body on)
const body = (rel) => read(rel).replace(/^---\n[\s\S]*?\n---\n\n?/, "")

const D = "Qa archive"
await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("POST", "folder", { path: D })
await api("POST", "file", { path: `${D}/Old.md`, text: "An old note.\n" })
await api("POST", "file", { path: `${D}/Keep.md`, text: "Still here.\n" })
await api("POST", "file", { path: `${D}/Links.md`, text: `See [[${D}/Old]].\n` })
await api("POST", "file", { path: `${D}/List.md`, text: `\`\`\`block-query\nfrom: ${D}\nview: list\n\`\`\`\n` })
const filesBefore = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesBefore, showHidden: false, showArchived: false, autoReveal: false })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const shown = (p) => row(p).count().then((n) => n > 0)
const menuItem = (name) => page.getByRole("menuitem", { name, exact: true })

await page.goto(B); await wait(1500)
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)
await row(D).locator("button").first().click(); await wait(300)

// 1. Archive from the tree's menu: moved into .archive/ with the key, links follow, the tree doesn't show it.
await row(`${D}/Old.md`).click({ button: "right" }); await wait(200)
await menuItem("Archive").click()
check("Archive: moved into .archive/, archived: true", !!(await until(() => read(`${D}/.archive/Old.md`).includes("archived: true"))) && !read(`${D}/Old.md`), read(`${D}/.archive/Old.md`))
check("Archive: a link to it follows", body(`${D}/Links.md`) === `See [[${D}/.archive/Old]].\n`, read(`${D}/Links.md`))
check("Archive: gone from the tree (.archive hidden)", !!(await until(async () => !(await shown(`${D}/Old.md`)) && !(await shown(`${D}/.archive`)))))
await page.screenshot({ path: `${OUT}archive-1-archived.png` })
// Undo in the toast: back where it was, key removed, the link back.
await page.locator("[data-sonner-toast]", { hasText: "Archived" }).getByRole("button", { name: "Undo" }).click()
check("Undo: back, key removed", !!(await until(() => read(`${D}/Old.md`) === "An old note.\n" && !read(`${D}/Old.md`).includes("archived"))) && !read(`${D}/.archive/Old.md`), read(`${D}/Old.md`))
check("Undo: the link back", !!(await until(() => body(`${D}/Links.md`) === `See [[${D}/Old]].\n`)), read(`${D}/Links.md`))

// 2. Through the API (as an agent would), then the tree's toggle shows .archive/, dimmed.
await api("POST", "ops/archive.add", { path: `${D}/Old.md` })
check("the query leaves it out", !(await api("GET", `render?path=${encodeURIComponent(`${D}/List.md`)}`)).includes("Old"))
const toggle = page.locator('aside [aria-label="Show archived files"]')
check("the tree's header offers Show archived files", !!(await until(() => toggle.count())))
await toggle.click()
check("Show archived files: saved in files.json", !!(await until(async () => (await api("GET", "config/files")).showArchived === true)))
check("the .archive folder shows", !!(await until(() => shown(`${D}/.archive`))))
await row(`${D}/.archive`).locator("button").first().click(); await wait(300)
check("the archived file shows, dimmed", !!(await until(async () => (await shown(`${D}/.archive/Old.md`)) && (await row(`${D}/.archive/Old.md`).locator("button[data-archived]").count()) === 1)))
await page.screenshot({ path: `${OUT}archive-2-shown.png` })
// 3. Unarchive from its menu.
await row(`${D}/.archive/Old.md`).click({ button: "right" }); await wait(200)
await menuItem("Unarchive").click()
check("Unarchive: back, key removed", !!(await until(() => read(`${D}/Old.md`) === "An old note.\n" && !read(`${D}/Old.md`).includes("archived"))), read(`${D}/Old.md`))
check("Unarchive: in the tree again, not dimmed", !!(await until(async () => (await shown(`${D}/Old.md`)) && (await row(`${D}/Old.md`).locator("button[data-archived]").count()) === 0)))
await page.locator('aside [aria-label="Hide archived files"]').click()
check("Hide archived files: off again", !!(await until(async () => (await api("GET", "config/files")).showArchived === false)))

// 4. Archived by hand: stays; the palette's command moves it, after asking.
await api("PUT", "file", { path: `${D}/Keep.md`, text: "---\narchived: true\n---\n\nStill here.\n" })
await wait(500)
check("by hand: the key alone doesn't move it", !!read(`${D}/Keep.md`))
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
await page.keyboard.type("Move archived files into archive folders"); await wait(300)
await page.keyboard.press("Enter")
const dialog = page.locator("dialog[open]", { hasText: "archived file" })
check("tidy: asks first", !!(await until(() => dialog.count())))
await page.screenshot({ path: `${OUT}archive-3-tidy.png` })
await dialog.getByRole("button", { name: "Move" }).click()
check("tidy: moved", !!(await until(() => read(`${D}/.archive/Keep.md`))) && !read(`${D}/Keep.md`))

// 5. A canvas made from an archived note goes beside it as if it weren't archived, never into .archive/.
await api("POST", "ops/archive.add", { path: `${D}/Old.md` })
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, `${D}/.archive/Old.md`); await wait(1200)
await page.locator("main .cm-content").first().click(); await wait(300)
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
await page.keyboard.type("New canvas"); await wait(300)
await page.keyboard.press("Enter")
const canvas = await until(async () => (await api("GET", "files")).files.concat((await api("GET", "files")).others).map((f) => f.path).find((p) => p.startsWith(`${D}/`) && p.endsWith(".canvas")))
check("New canvas from an archived note: beside it, not in .archive/", !!canvas && !canvas.includes(".archive"), canvas)

await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("PUT", "config/files", filesBefore)
await done()
