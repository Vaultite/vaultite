// Tabs archiving themselves (plugins/core/tabs/archived.tsx): unseen unpinned tabs close into Archived tabs, reopened,
// found and renamed there. WRITES the Tabs settings, plugins.json and workspaces' files (put back): throwaway only.
//   node web/qa/tabarchive.mjs <base url> <vault path>
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { apiAt, command, qa, until, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces, workspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)

const notes = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 3).map((f) => `Notes/${f}`)
if (notes.length < 3) { console.error("the vault needs three notes in Notes/"); process.exit(2) }
const [a, b, c] = notes
const TABS = path.join(VAULT, ".vaultite/plugins/tabs/data.json")
const PLUGINS = path.join(VAULT, ".vaultite/plugins.json")
const tabsBefore = existsSync(TABS) ? readFileSync(TABS, "utf8") : null
const pluginsBefore = readFileSync(PLUGINS, "utf8")
const putBackWorkspaces = setAsideWorkspaces(VAULT)
mkdirSync(path.dirname(TABS), { recursive: true })
writeFileSync(TABS, JSON.stringify({ archive_after: "12h" }) + "\n")

const old = Date.now() - 13 * 3600_000
const layout = { root: { id: "g0", active: "ta", tabs: [
  { id: "ta", to: `file:${a}` }, { id: "tb", to: `file:${b}`, seen: old }, { id: "tp", to: `file:${c}`, pinned: true, seen: old },
  { id: "tt", to: "view:terminal/qaarchiv", seen: old }, { id: "tw", to: "view:web/https://example.com/", seen: old },
] }, focus: "g0" }

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await page.goto(B)
  await page.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
  await page.evaluate((l) => localStorage.setItem("vaultite.tabs", JSON.stringify(l)), layout)
  await page.goto("about:blank"); await page.goto(`${B}#file/${encodeURIComponent(a)}`)
  await page.waitForSelector("[data-tab-id='ta']", { timeout: 30000 })
  const ids = () => page.$$eval("section[aria-label=Pane] [data-tab-id]", (els) => els.map((e) => e.getAttribute("data-tab-id")))
  check("the tabs as saved", (await ids()).join() === "ta,tb,tp,tt,tw", await ids())

  // The first sweep waits a minute after the window opens (its workspace's tabs in place first).
  await until(async () => (await ids()).length === 3, 100_000, 1000)
  check("unseen for over 12 hours: the note and the web page are archived; the tab on screen, the pinned one and the terminal stay",
    (await ids()).join() === "ta,tp,tt", await ids())
  const toast = await page.locator("[data-sonner-toast]", { hasText: "Archived 2 tabs" }).count()
  check("a toast says so", toast > 0)

  await page.mouse.click(640, 400) // (the window in use: agents' asks come here)
  const listed = await api("POST", "ops/tabs.archived", {})
  const got = JSON.stringify(listed)
  check("vau tabs archived lists them", got.includes(`file:${b}`) && got.includes("view:web/https://example.com/"), listed)
  const renamed = b.replace(/\.md$/, " renamed.md")
  await api("POST", "file/move", { from: b, to: renamed })
  const followed = await until(async () => JSON.stringify(await api("POST", "ops/tabs.archived", {})).includes(`file:${renamed}`), 5000)
  await api("POST", "file/move", { from: renamed, to: b })
  const back = await until(async () => JSON.stringify(await api("POST", "ops/tabs.archived", {})).includes(`file:${b}`), 5000)
  check("an archived file renamed: its archived tab follows, and back (plugins' onMove)", !!followed && !!back)

  // The quick switcher finds the archived page; picking it reopens it.
  await page.keyboard.press("ControlOrMeta+o")
  await until(() => page.$('[role="dialog"][aria-label="Search"]'), 8000)
  await page.fill('[role="dialog"][aria-label="Search"] input', "example.com")
  await wait(800)
  const hit = page.locator('[role="listbox"] [role="option"]', { hasText: "Archived just now" }).first()
  check("the quick switcher finds the archived web page", await hit.count() > 0, await page.$$eval('[role="listbox"] > *', (els) => els.map((e) => e.textContent.trim())))
  await hit.click()
  await until(async () => (await ids()).includes("tw"), 5000)
  check("picked, it's back where it was, shown", (await ids()).join() === "ta,tp,tt,tw" && await page.locator("[data-tab-id='tw'] [aria-selected=true]").count() === 1, await ids())

  // The Archived tabs tab: removing one (Undo puts it back), a click puts it back in its place.
  await command(page, "Show archived tabs", 800)
  const rows = () => page.$$eval("[data-archived-tab]", (els) => els.map((e) => e.getAttribute("data-archived-tab")))
  check("Archived tabs lists what's still archived", (await rows()).join() === "tb", await rows())
  await page.locator("[data-archived-tab='tb']").click({ button: "right" })
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click()
  await until(async () => !(await rows()).length, 3000)
  check("removed, the list says it's empty", !(await rows()).length && await page.locator("[data-archived-tabs]", { hasText: "No archived tabs." }).count() === 1, await rows())
  const emptySize = await page.locator("[data-archived-tabs] p", { hasText: "No archived tabs." }).evaluate((e) => getComputedStyle(e).fontSize)
  check("… as a page's empty state (Empty: 15px), as the Inbox's", emptySize === "15px", emptySize)
  await page.locator("[data-sonner-toast]", { hasText: "Removed 1 archived tab" }).locator("[data-button]").click()
  await until(async () => (await rows()).length === 1, 3000)
  check("Undo puts it back", (await rows()).join() === "tb", await rows())
  await page.locator("[data-archived-tab='tb']").click()
  await until(async () => (await ids()).includes("tb"), 5000)
  check("reopened at its place (after the tab before it)", (await ids()).slice(0, 2).join() === "ta,tb", await ids())
  await ctx.close()

  // With Workspaces: switching tabs writes no workspace file; the archive is the workspace's.
  writeFileSync(PLUGINS, JSON.stringify({ ...JSON.parse(pluginsBefore), enabled: [...(JSON.parse(pluginsBefore).enabled ?? []), "workspaces"] }, null, 2) + "\n")
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const p2 = watch(await ctx2.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
  await p2.goto(`${B}#file/${encodeURIComponent(a)}`)
  await p2.waitForSelector("[aria-label='New tab']", { timeout: 30000 })
  for (const f of [b, c]) { await command(p2, "Open new tab"); await p2.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`); await wait(600) }
  await until(() => workspaces(VAULT)[0]?.layout, 8000)
  await wait(2500)
  const stamped = JSON.stringify(workspaces(VAULT)[0]?.layout ?? {})
  check("with Workspaces, the tabs' stamps go with the layout", /"seen":\d+/.test(stamped), stamped.slice(0, 300))
  // (files opened lately are kept in the workspace too, as they stay in view: only the tabs are looked at)
  const before = JSON.stringify(workspaces(VAULT)[0]?.layout)
  const tabIds = await p2.$$eval("section[aria-label=Pane] [data-tab-id]", (els) => els.map((e) => e.getAttribute("data-tab-id")))
  for (const id of [...tabIds, ...tabIds]) { await p2.click(`[data-tab-id='${id}'] [role=tab]`); await wait(400) }
  await wait(2000)
  check("switching tabs writes nothing of the tabs (their stamps wait for a write that happens anyway)", JSON.stringify(workspaces(VAULT)[0]?.layout) === before,
    [before, JSON.stringify(workspaces(VAULT)[0]?.layout)])
  await ctx2.close()
} finally {
  if (tabsBefore === null) rmSync(TABS, { force: true }); else writeFileSync(TABS, tabsBefore)
  writeFileSync(PLUGINS, pluginsBefore)
  putBackWorkspaces()
}
await done()
