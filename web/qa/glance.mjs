// Glance (plugins/core/glance): ⌥-click a [[link]] or a tree file and it opens over the page, shut or opened as a tab or
// split from there. Turns Glance on (put back) and opens notes in tabs: throwaway server only.
//   node web/qa/glance.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/glance-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = async (p, init) => (await fetch(new URL(`/api/${p}`, B), { headers: { "Content-Type": "application/json" }, ...init })).json()
const before = await api("config/plugins")
await api("config/plugins", { method: "PATCH", body: JSON.stringify({ enabled: [...new Set([...(before.enabled ?? []), "glance"])] }) })

// A note of Notes/ with a [[link]] to another note there.
const state = await api("state")
const notes = state.files.files.filter((f) => f.path.startsWith("Notes/") && f.path.endsWith(".md"))
const names = new Set(notes.map((f) => f.path.slice(6, -3)))
const from = notes.find((f) => f.links.some((t) => names.has(t)))
if (!from) { console.error("needs a note in Notes/ linking to another"); process.exit(2) }
const target = from.links.find((t) => names.has(t))
const targetPath = `Notes/${target}.md`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } } catch { /* about:blank */ } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}glance-${name}.png` })
const sheet = page.locator("dialog[open]")
const glanceOpen = () => page.evaluate(() => !!document.querySelector("dialog[open]") && location.hash.includes("/glance/"))
const activeTabs = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]")].map((s) => s.querySelector("[role=tab][aria-selected=true]")?.innerText.trim()))
const link = () => page.locator("main .cm-wikilink:not(.is-missing), main a[data-wiki]", { hasText: target }).filter({ visible: true }).first()

async function openFrom() {
  await page.goto("about:blank")
  await page.goto(`${B}#file/${encodeURIComponent(from.path)}`)
  await until(async () => (await link().count()) > 0, 10000)
  await wait(400)
}
async function glance() {
  await link().click({ modifiers: ["Alt"] })
  return until(glanceOpen, 4000)
}

await openFrom()
check("⌥-click on a [[link]] opens a glance", await glance())
check("the glance shows the linked note", await until(() => sheet.locator(`.file-view[data-path="${targetPath}"]`).count(), 4000))
await wait(400) // (its zoom in)
const box = await sheet.boundingBox()
check("the glance is wide: about 80% of the window, centred", box && Math.abs(box.width - 1440 * 0.8) < 4 && Math.abs(box.x + box.width / 2 - 720) < 4 && box.height > 700, box)
check("its bar names it and offers Open in tab and Open to the side",
  (await sheet.locator("header").innerText()).includes(target) && await sheet.getByRole("button", { name: "Open in tab" }).isVisible() && await sheet.getByRole("button", { name: "Open to the side" }).isVisible())
check("the page under it still shows the note it was opened from", (await activeTabs()).length === 1 && (await activeTabs())[0]?.includes(from.path.slice(6, -3)), await activeTabs())
check("the glance's note is live: its editor is there", await sheet.locator(".cm-editor").count() > 0)
await shot("open")

await page.keyboard.press("Escape")
check("Escape closes it", await until(async () => !(await glanceOpen()), 3000))

await glance()
await wait(500)
await page.mouse.click(30, 450)
check("a click outside closes it", await until(async () => !(await glanceOpen()), 3000))

await glance()
await sheet.getByRole("button", { name: "Close" }).click()
check("Close closes it", await until(async () => !(await glanceOpen()), 3000))

await glance()
await sheet.getByRole("button", { name: "Open in tab" }).click()
const promoted = await until(async () => !(await glanceOpen()) && (await page.evaluate(() => decodeURIComponent(location.hash))).includes(targetPath), 4000)
check("Open in tab closes the glance and shows the note in the focused pane", promoted, await page.evaluate(() => location.hash))
const tabNames = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane] [role=tab]")].map((t) => t.innerText.trim()))
// (a new tab grows in, its name shown once it's wide enough)
const beside = (tabs) => tabs.some((t) => t.includes(target)) && tabs.some((t) => t.includes(from.path.slice(6, -3)))
check("as a new tab beside the one it was glanced from", !!(await until(async () => beside(await tabNames()), 2000)), await tabNames())
await wait(1200)
check("and it stays there (no sheet comes back)", !(await glanceOpen()) && (await page.evaluate(() => decodeURIComponent(location.hash))).includes(targetPath))

await openFrom()
await glance()
await sheet.getByRole("button", { name: "Open to the side" }).click()
check("Open to the side opens it in a split", await until(async () => !(await glanceOpen()) && (await activeTabs()).length === 2, 4000), await activeTabs())
check("the split shows the glanced note", !!(await until(async () => (await activeTabs()).some((t) => t?.includes(target)), 2000)), await activeTabs())

// The tree: ⌥-click a file there.
await openFrom()
const row = page.locator(`[data-tree-path="${targetPath}"]`).filter({ visible: true }).first()
if (!(await row.count())) await page.locator('[data-tree-path="Notes"][data-tree-folder] button').first().click().catch(() => {})
await wait(300)
if (await row.count()) {
  await row.locator("button").first().click({ modifiers: ["Alt"] })
  check("⌥-click on a file in the tree glances at it", await until(glanceOpen, 3000))
  check("and the tab stays the note it was on", (await activeTabs())[0]?.includes(from.path.slice(6, -3)), await activeTabs())
  await page.keyboard.press("Escape"); await until(async () => !(await glanceOpen()), 3000)
} else check("the tree shows the note to ⌥-click", false)

// A plain click still follows the link, in the tab.
await link().click()
check("a plain click still follows the link", await until(async () => !(await glanceOpen()) && (await page.evaluate(() => decodeURIComponent(location.hash))).includes(targetPath), 4000))

await api("config/plugins", { method: "PATCH", body: JSON.stringify({ enabled: before.enabled ?? [] }) })
await done()
