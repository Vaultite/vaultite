// A file's actions (core/actions.ts: Add to timeline from a person's menu, ⌘.) and the status bar's ambient items.
// WRITES "Qa actions" and appearance.json: throwaway server only.
//   node web/qa/actions.mjs <base url> [out dir]
import { readFileSync } from "node:fs"
import path from "node:path"
import { SHOTS, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
const { args: [BASE, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.endsWith("/") ? BASE : `${BASE}/`
const api = async (method, p, body) => {
  const r = await fetch(`${B}api/${p}`, { method, headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: body && JSON.stringify(body) })
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text()
}
const VAULT = (await api("GET", "vault")).path
const read = (rel) => { try { return readFileSync(path.join(VAULT, rel), "utf8") } catch { return "" } }

const D = "Qa actions", P = `${D}/Zoe Quinn.md`
await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("POST", "folder", { path: D })
await api("POST", "file", { path: P, text: "---\ntype: person\n---\n\n## Timeline\n" })
// (one new in the inbox, for its status bar item; in the test's folder, removed with it)
await api("POST", "file", { path: `${D}/Research.md`, text: "---\ntype: inbox\nstatus: new\n---\n\nSomething to read.\n" })
const look = await api("GET", "config/appearance")
await api("PATCH", "config/appearance", { statusBar: null })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const page = watch(await ctx.newPage(), { console: true }), ui = app(page)
  const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
  const menuItem = (name) => page.getByRole("menuitem", { name, exact: true })
  const palette = page.locator("[role=dialog]").filter({ has: page.locator("input") }).last()

  await page.goto(`${B}#file/${encodeURIComponent(P)}`); await ui.idle()

  // 1. The tree's menu on a person: its kind's action, run from there (kind picked, text typed).
  await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await ui.idle()
  await row(D).locator("button").first().click(); await ui.idle()
  await ui.menu.context(row(P)); await ui.idle()
  check("tree menu: a person has Add to timeline", await menuItem("Add to timeline").count() === 1, await ui.menu.items())
  check("tree menu: Archive once (the op's action is left to the menu's own)", await menuItem("Archive").count() === 1)
  await ui.menu.pick("Add to timeline")
  // (any word is a kind: the palette says the ones with icons)
  check("asks the kind in the palette, saying the kinds", /Add to timeline: what it was[\s\S]*call, hang out/.test(await palette.innerText().catch(() => "")), await palette.innerText().catch(() => ""))
  await page.keyboard.type("call"); await page.keyboard.press("Enter"); await ui.idle()
  await page.keyboard.type("Talked about the garden"); await ui.idle(); await page.keyboard.press("Enter")
  check("the line is in the timeline", !!(await until(() => /call.*Talked about the garden/i.test(read(P)))), read(P))
  check("a toast says what it did", !!(await until(async () => (await page.locator("[data-sonner-toast]").count()) > 0)))
  await page.screenshot({ path: `${OUT}actions-1-timeline.png` })

  // 2. ⌘. lists the open file's actions (the menu's plugin items and the ones the menu leaves to its own).
  await page.locator(`.file-view[data-path="${P}"]`).first().click(); await ui.idle()
  await page.keyboard.press("ControlOrMeta+Period"); await palette.waitFor(); await ui.idle()
  const listed = await palette.innerText().catch(() => "")
  check("⌘.: the file's actions, each once", /Add to timeline/.test(listed) && /Remember something about them/.test(listed) && listed.match(/^Archive$/gm)?.length === 1 && !/Hand to a coding agent/.test(listed), listed)
  await page.screenshot({ path: `${OUT}actions-2-palette.png` })
  await page.keyboard.press("Escape"); await ui.idle()

  // 3. The status bar's ambient items: the inbox's new items, on a page and on a blank tab.
  // (the bar holding it: there's one on each side)
  const INBOX = "[data-ambient] button[data-tip^='Inbox, ']"
  const bar = page.locator("[role=status]").filter({ has: page.locator(INBOX) })
  const chip = () => page.locator(`[role=status] ${INBOX}`)
  check("status bar: the inbox's new items on a file", !!(await until(async () => (await chip().count()) === 1)), await page.locator("[role=status]").allInnerTexts())
  await page.goto(`${B}#new`); await ui.idle()
  check("status bar: still there on a blank tab", !!(await until(async () => (await chip().count()) === 1)))
  await page.screenshot({ path: `${OUT}actions-3-bar.png` })
  await ui.menu.context(bar)
  await ui.menu.pick("Inbox")
  await ui.menu.close()
  check("right-click: turned off, saved in appearance.json", !!(await until(async () => { const a = await api("GET", "config/appearance"); return Array.isArray(a.statusBar) && !a.statusBar.includes("inbox:new") })) && (await chip().count()) === 0,
    await api("GET", "config/appearance"))
} finally {
  await api("PATCH", "config/appearance", { statusBar: look.statusBar ?? null })
  await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
}
await done()
