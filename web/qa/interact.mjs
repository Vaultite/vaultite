// Interaction consistency (desktop, 1440x900): things that should behave the same everywhere do. "Open … in a tab"
// commands show the tab a view has instead of opening another (and "in right split" too); the keyboard goes back to
// the editor when the command palette, the quick switcher, a menu or the workspace list closes, and into the new
// pane's editor after Split right or Focus on the pane to the left; the workspace list takes arrow keys; a file
// dropped on a bar that has it moves its tab; a terminal dragged from the Terminals panel opens where it's dropped; a
// tab's menu lists a file's items in the tree menu's order; Go to next/previous tab; Move current tab to workspace 3.
// Runs a shell (ended) and WRITES a "Qa interact" folder, tabs and workspaces 1 and 3 (all removed at the end):
// throwaway server only.
//   node web/qa/interact.mjs <base url> [out dir]
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import path from "node:path"
import { REVEAL, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/interact-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
// What it uses, whatever the vault turned off or hid (the sandbox starts calm: da5190b): Workspaces for the workspace
// list and Move to workspace, the Terminals panel for dragging a terminal's row. Told through vau, to the served vault
// (not the one this shell's VAULTITE_VAULT may name: in a Vaultite terminal, the user's).
const vaultPath = (await (await fetch(new URL("api/vault", B))).json()).path
const vau = (...a) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../../bin/vau"), "--url", B, ...a],
  { encoding: "utf8", env: { ...process.env, VAULTITE_URL: B, VAULTITE_VAULT: vaultPath } })
vau("plugin", "on", "workspaces")
for (const where of [[], ["--vault"]]) if (!vau("panels", ...where).match(/sidebar:\n(?:\s+\d+\. .*\n)*?\s+\d+\. terminal:sessions/)) vau("panels", "show", "terminals", ...where)
const DIR = "Qa interact"
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await api("POST", "folder", { path: DIR })
for (const n of ["One", "Two"]) await api("POST", "file", { path: `${DIR}/${n}.md`, text: `${n}.\n` })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })
const shot = (name) => page.screenshot({ path: `${OUT}interact-${name}.png` })
const panes = () => page.evaluate(() => [...document.querySelectorAll("section[aria-label=Pane]")].map((s) => ({
  id: s.dataset.group, x: s.getBoundingClientRect().x, tabs: [...s.querySelectorAll("[role=tab]")].map((t) => t.innerText.trim()),
})).sort((a, b) => a.x - b.x))
const tabs = async () => (await panes()).flatMap((p) => p.tabs)
const count = async (label) => (await tabs()).filter((t) => t === label).length
const cmd = async (name) => {
  await page.keyboard.press("ControlOrMeta+p"); await wait(250)
  await page.keyboard.type(name); await wait(150)
  await page.keyboard.press("Enter"); await wait(600)
}
/** Where the keyboard is: "editor:<pane id>", "palette", "tab", a row of the workspace list ("ws:<n>"), or its tag. */
const focus = () => page.evaluate(() => {
  const a = document.activeElement
  if (!a || a === document.body) return "body"
  if (a.matches(".cm-content")) return `editor:${a.closest("[data-pane]")?.dataset.pane}`
  if (a.closest("[role=dialog][aria-modal]")) return "palette"
  if (a.dataset.workspace) return `ws:${a.dataset.workspace}`
  if (a.hasAttribute("data-workspace-switcher")) return "switcher"
  if (a.closest("[data-tab-id]")) return "tab"
  return a.tagName.toLowerCase()
})
const focusedPane = () => page.evaluate(() => document.querySelector("#main-scroll")?.dataset.pane)

await page.goto(`${B}#file/${encodeURIComponent(`${DIR}/One.md`)}`); await wait(2000)

// ---------- one tab per view ----------
await cmd("Open tags in a tab"); await cmd("Open tags in a tab")
check("Open tags in a tab, twice: one Tags tab", (await count("Tags")) === 1, await tabs())
await cmd("Open outline in right split"); await cmd("Open outline in right split"); await cmd("Open outline in a tab")
check("Open outline in right split twice, then in a tab: one Outline tab", (await count("Outline")) === 1, await tabs())
await cmd("Open links in a tab"); await cmd("Open links in right split")
check("Open links in a tab, then in right split: one Links tab", (await count("Links")) === 1, await tabs())
// Start again from one tab, its folder open: both workspace 1's (there always is a workspace, 02c5ae8).
const fresh = async () => {
  // (Off the app once its tabs are saved, about 1 s after a change: one still on its way is saved over these by the next
  // page, workspaces/state.ts' leaving.)
  const saved = (x) => x?.kids ? x.kids.flatMap(saved) : (x?.tabs ?? []).map((t) => `${x.id}/${t.id}`)
  const shown = () => page.$$eval("section[data-group] [data-tab-id]", (els) => els.map((e) => `${e.closest("section").dataset.group}/${e.dataset.tabId}`))
  await until(async () => saved((await api("GET", "workspaces")).workspaces?.[0]?.layout?.root).sort().join() === (await shown()).sort().join(), 6000)
  await page.goto(`${B}api/state`)
  await api("PUT", "workspaces/1", { layout: { root: { id: "g0", tabs: [{ id: "t1", to: `file:${DIR}/One.md` }], active: "t1" }, focus: "g0" }, state: { "files:open": [DIR] } })
  await page.goto(`${B}#file/${encodeURIComponent(`${DIR}/One.md`)}`); await wait(1800)
}
await fresh()

// ---------- a drop never gives a bar the same place twice ----------
/** Drag `from` (a locator) to (x, y) and let go. */
async function dragTo(from, x, y) {
  await from.scrollIntoViewIfNeeded()
  const b = await from.boundingBox()
  const [fx, fy] = [b.x + Math.min(40, b.width / 2), b.y + b.height / 2]
  await page.mouse.move(fx, fy); await page.mouse.down()
  await page.mouse.move(fx + 8, fy + 4, { steps: 2 }); await page.mouse.move(x, y, { steps: 10 }); await wait(200)
  const ghost = await page.evaluate(() => ({ text: document.querySelector("[data-drag-ghost]")?.textContent ?? null, line: !!document.querySelector("[data-drop-line]") }))
  await page.mouse.up(); await wait(500)
  return ghost
}
await page.locator(`aside [data-tree-path="${DIR}/Two.md"] > button`).first().click({ button: "middle" }); await wait(500)
const two = await page.locator("[data-tab-id]", { hasText: "Two" }).first().boundingBox()
const g = await dragTo(page.locator(`aside [data-tree-path="${DIR}/One.md"]`).first(), two.x + two.width - 4, two.y + two.height / 2)
check("a tree file dropped on a bar that has its tab: offered (a line)", g.line, g)
check("...its tab moves there, no second one", (await tabs()).join("|") === "Two|One", await tabs())
await fresh()

// ---------- a terminal dragged from the Terminals panel opens where it's dropped, like a file ----------
await cmd("Open terminal"); await wait(1500)
const term = await page.evaluate(() => document.querySelector("aside [data-session]")?.getAttribute("data-session"))
await page.locator("[data-tab-id]", { hasText: "One" }).first().click(); await wait(300)
const body = await page.locator("[data-pane-body]").first().boundingBox()
const tg = await dragTo(page.locator(`aside [data-session="${term}"]`).first(), body.x + body.width - 20, body.y + body.height / 2)
const ps = await panes()
check("a Terminals panel row dropped on a pane's right edge: a split with that terminal", ps.length === 2 && ps[1].tabs.join() === "Terminal" && /Terminal/.test(tg.text ?? ""), [ps, tg])
await page.locator(`aside [data-session="${term}"]`).first().hover()
await page.locator(`aside [data-session="${term}"] [aria-label="End session"]`).first().click(); await wait(400)
if (await page.$("[role=alertdialog]")) await page.locator("[role=alertdialog] button", { hasText: /End/ }).click()
await wait(600)
await fresh()

// ---------- a middle-click is "in a new tab" everywhere, never the browser's new tab ----------
let popups = 0
ctx.on("page", () => popups++)
const pinned = page.locator("aside nav[aria-label=Pages] [data-pin]").first()
const pinName = (await pinned.textContent()).trim()
await pinned.click({ button: "middle" }); await wait(700)
check("a pinned page middle-clicked: a tab here, no browser tab", popups === 0 && (await tabs()).includes(pinName), [popups, await tabs()])
for (const p of ctx.pages()) if (p !== page) await p.close()
await fresh()

// ---------- the keyboard after overlays ----------
await page.click(".cm-content"); await wait(150)
const ed = await focus()
check("typing in the editor", ed.startsWith("editor:"), ed)
await page.keyboard.press("ControlOrMeta+p"); await wait(300)
check("⌘P: the palette has the keyboard", (await focus()) === "palette", await focus())
await page.keyboard.press("Escape"); await wait(300)
check("...Escape: back in the editor", (await focus()) === ed, await focus())
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
await page.keyboard.press("Escape"); await wait(300)
check("⌘O, Escape: back in the editor", (await focus()) === ed, await focus())
await page.keyboard.press("ControlOrMeta+o"); await wait(300)
await page.keyboard.type("Two"); await wait(300); await page.keyboard.press("Enter"); await wait(900)
const showing = () => page.evaluate(() => document.activeElement?.closest("section")?.querySelector("[role=tab][aria-selected=true]")?.textContent.trim())
check("⌘O, a file picked: its editor has the keyboard", (await focus()).startsWith("editor:") && (await showing()) === "Two", [await focus(), await showing()])
await page.goto(`${B}#file/${encodeURIComponent(`${DIR}/One.md`)}`); await wait(1200)
await page.click(".cm-content"); await wait(150)
await cmd("Split right"); await wait(300)
const right = await focusedPane()
check("Split right from the palette: the new pane's editor has the keyboard", (await focus()) === `editor:${right}`, [await focus(), right])
await cmd("Focus on the pane to the left"); await wait(300)
const left = await focusedPane()
check("Focus on the pane to the left: its editor has the keyboard", left !== right && (await focus()) === `editor:${left}`, [await focus(), left])
await page.locator("[data-tab-id]").first().click({ button: "right" }); await wait(250)
check("a tab's menu has the keyboard", await page.evaluate(() => !!document.activeElement?.closest("[role=menu]")))
await page.keyboard.press("Escape"); await wait(300)
check("...Escape: the keyboard back on that tab", (await focus()) === "tab", await focus())
await page.click(".cm-content"); await wait(150)
await cmd("Change colour scheme"); await wait(400)
await page.keyboard.press("Escape"); await wait(400)
check("a sheet (colour schemes) closed with Escape: back in the editor", (await focus()).startsWith("editor:"), await focus())

// ---------- a tab's menu and the tree's say the same about a file, in the same order ----------
const menuItems = async (loc) => {
  await loc.click({ button: "right" }); await wait(250)
  const items = await page.$$eval("[role=menu] > button", (bs) => bs.map((b) => b.innerText.trim()))
  await page.keyboard.press("Escape"); await wait(200)
  return items
}
const FILE_ITEMS = ["Rename", "Move file to…", "Duplicate", "Pin", "Unpin", "Archive", "More", "Copy path", REVEAL, "Delete"]
const fileOrder = (items) => items.filter((t) => FILE_ITEMS.includes(t))
// (the tab's own items come first, its Pin among them: the file's start at Rename)
const tabItems = await menuItems(page.locator("[data-tab-id]").first())
const tabMenu = fileOrder(tabItems.slice(Math.max(0, tabItems.indexOf("Rename"))))
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, `${DIR}/One.md`); await wait(600)
const treeMenu = fileOrder(await menuItems(page.locator(`aside [data-tree-path="${DIR}/One.md"]`).first()))
check("a file's tab menu has the tree menu's file items, in its order", tabMenu.length >= 6 && tabMenu.join("|") === treeMenu.join("|"), { tabMenu, treeMenu })
const pinMenu = await menuItems(page.locator("aside nav[aria-label=Pages] [data-pin]").first())
check("a pinned page's menu opens it like the tree's (new tab, to the right in its submenu) and unpins it", pinMenu.slice(0, 2).join("|") === "Open in new tab|Unpin", pinMenu) // "Unpin" since 23d1a2c (one pinned list per workspace)

// ---------- the workspace list ----------
await page.click("aside [data-workspace-switcher]"); await wait(300)
check("the workspace list opens with the keyboard on the current one", (await focus()) === "ws:1", await focus())
await page.keyboard.press("ArrowDown"); await wait(100)
check("...ArrowDown: the next one", (await focus()) === "ws:2", await focus())
await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp"); await wait(100)
check("...ArrowUp twice: round to the last", (await focus()) === "ws:5", await focus())
await page.keyboard.press("Escape"); await wait(300)
check("...Escape: closed, the keyboard back on the switcher", !(await page.$("[data-workspace-list]")) && (await focus()) === "switcher", await focus())
await page.keyboard.press("Escape")

// ---------- tabs and workspaces from the keyboard ----------
await fresh()
await page.locator(`aside [data-tree-path="${DIR}/Two.md"] > button`).first().click({ button: "middle" }); await wait(500)
const active = async () => page.evaluate(() => document.querySelector("#main-scroll")?.closest("section")?.querySelector("[role=tab][aria-selected=true]")?.textContent.trim())
await cmd("Go to previous tab")
check("Go to previous tab", (await active()) === "One", await active())
await cmd("Go to previous tab")
check("...again: round to the last", (await active()) === "Two", await active())
const before = (await api("GET", "state")).workspaces ?? []
if (before[2]) console.log("(skipping the workspace move: this vault uses workspace 3)")
else {
  await cmd("Move current tab to workspace 3"); await wait(1000)
  const ws = (await api("GET", "state")).workspaces ?? []
  check("Move current tab to workspace 3: gone from here, there in 3", (await tabs()).join() === "One" && JSON.stringify(ws[2] ?? {}).includes(`${DIR}/Two.md`), [await tabs(), ws[2]])
  await page.locator("[data-sonner-toast] button", { hasText: "Undo" }).first().click(); await wait(1200)
  const ws2 = (await api("GET", "state")).workspaces ?? []
  check("...its toast's Undo: back here, and 3 unused again", (await tabs()).join() === "One,Two" && !JSON.stringify(ws2[2] ?? null).includes(`${DIR}/Two.md`), [await tabs(), ws2[2]])
  for (const n of [1, 3]) await fetch(`${B}api/workspaces/${n}`, { method: "DELETE" })
}
await shot("end")

await browser.close()
await fetch(`${B}api/file?path=${encodeURIComponent(DIR)}`, { method: "DELETE" })
await done()
