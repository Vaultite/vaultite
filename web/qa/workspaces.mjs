// Workspaces (plugins/core/workspaces): the switcher and its list (header and rail), workspace 1 from the setup, an
// unused one unwritten until changed, each its own panels and tabs, ⌃1/⌃2 (from a terminal too, its shell surviving),
// Rename, a reload, tabs, panes, tree files and pinned pages dragged onto another workspace's row (with a second window
// on it), the menu (Delete with Undo, Duplicate), and the plugin off = sidebars.json's panels. Runs a shell and WRITES
// .vaultite/plugins.json, sidebars.json, the plugin's files and "Qa ws *.md" (put back or removed): throwaway only.
//   node web/qa/workspaces.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, terminalText, until, wait, workspaceKey } from "./lib/qa.mjs"
import { clearWorkspaces, workspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = "/tmp/workspaces-shots/"], browser, check, watch, noErrors, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const settings = path.join(VAULT, ".vaultite/plugins.json")
const original = existsSync(settings) ? readFileSync(settings, "utf8") : "{}\n"
const setPlugins = (o) => writeFileSync(settings, JSON.stringify({ ...JSON.parse(original), ...o }, null, 2) + "\n")
const data = () => workspaces(VAULT)
const sidebarsFile = path.join(VAULT, ".vaultite/sidebars.json")
const sidebarsBefore = existsSync(sidebarsFile) ? readFileSync(sidebarsFile, "utf8") : null
const DEFAULT = JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] })
const savedSidebars = () => JSON.stringify(JSON.parse(readFileSync(sidebarsFile, "utf8")))
// Workspace 2 hides every panel but Terminals: its own sidebars are that one panel.
const onlyTerminals = (w) => JSON.stringify(w?.sidebars?.left) === '["terminal:sessions"]' && !w.sidebars.right?.length
const moveFile = path.join(VAULT, "Qa ws move.md")
const paneFile = path.join(VAULT, "Qa ws pane.md")
const openFile = path.join(VAULT, "Qa ws open.md")

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true, ignore: /favicon|Failed to load resource|WebSocket/ })

const panels = () => page.$$eval("aside [data-panel]", (els) => els.map((e) => e.getAttribute("data-panel")))
// The switcher: one button in the header (or the rail) with the current number; its list (portalled into body) has a
// row per workspace. Reading the rows opens the list (and closes it again if it was closed).
const LIST = "[data-workspace-list]"
const SWITCHER = "aside [data-workspace-switcher]"
const isOpen = async (p = page) => !!(await p.$(LIST))
const openList = async (p = page) => { if (!(await isOpen(p))) await p.click(SWITCHER); await p.waitForSelector(LIST) }
const closeList = async (p = page) => { if (await isOpen(p)) { await p.keyboard.press("Escape"); await until(async () => !(await isOpen(p)), 2000) } }
const row = (n) => page.locator(`${LIST} [data-workspace='${n}']`)
const numbers = async () => {
  const was = await isOpen()
  await openList()
  const r = await page.$$eval(`${LIST} [data-workspace]`, (els) => els.map((e) => ({
    n: e.getAttribute("data-workspace"), on: e.getAttribute("aria-pressed") === "true", used: e.hasAttribute("data-used"), text: e.innerText.trim(),
  })))
  if (!was) await closeList()
  return r
}
/** The current workspace, from the switcher itself (the list stays as it is). */
const lit = () => page.$eval(SWITCHER, (e) => e.getAttribute("data-workspace-switcher")).catch(() => null)
/** Click workspace n in the list (opening it first). */
const pick = async (n) => { await openList(); await row(n).click() }
const tabs = () => page.$$eval("section[aria-label=Pane] [role=tab]", (els) => els.map((t) => t.innerText.trim()))
const text = () => terminalText(page)
const menuItem = (name) => page.locator("[role=menuitemcheckbox], [role=menuitem]", { hasText: name }).first()
let sid = null

try {
  clearWorkspaces(VAULT)
  // (Links, the backlinks panel, stays off here, like sidebar.mjs: its panel would join every list.)
  setPlugins({ disabled: ["backlinks"] })
  writeFileSync(sidebarsFile, DEFAULT + "\n")
  await page.goto(`${B}#file/${encodeURIComponent("Notes/Alpha.md")}`)
  await page.waitForSelector("aside [data-panel]")
  await until(async () => (await panels()).length === 4, 6000)

  // ---------- the switcher ----------
  await page.waitForSelector(SWITCHER)
  check("one switcher in the header, showing 1", (await page.locator(`aside [data-titlebar] [data-workspace-switcher]`).count()) === 1 && (await lit()) === "1", await lit())
  check("no numbers in the sidebar itself (the list is portalled)", !(await page.$("aside [data-workspace]")))
  check("no wordmark", !(await page.locator("aside [data-titlebar]", { hasText: "Vaultite" }).count()))
  const box = await page.locator("aside [data-titlebar]").boundingBox()
  const sw = await page.locator(SWITCHER).boundingBox()
  const toggle = await page.locator("[data-sidebar-toggle='']").boundingBox()
  check("right-aligned, in line with the toggle", box.x + box.width - (sw.x + sw.width) <= 12 &&
    Math.abs(sw.y + sw.height / 2 - (toggle.y + toggle.height / 2)) <= 1, { box, sw, toggle })
  await page.screenshot({ path: `${OUT}1-header.png`, clip: { x: 0, y: 0, width: 260, height: 90 } })
  await page.click(SWITCHER)
  const ns = await until(async () => { const n = await numbers(); return n.length === 5 ? n : null }, 6000)
  check("the list: five rows", ns?.length === 5, ns)
  check("before any workspace, 1 is lit and the rest unused", ns?.[0].on && ns.slice(1).every((x) => !x.used && !x.on && /New workspace/.test(x.text)), ns)
  check("the switcher says it's open", (await page.getAttribute(SWITCHER, "aria-expanded")) === "true")
  const listAt = await page.evaluate(([sel]) => {
    const l = document.querySelector("[data-workspace-list]").getBoundingClientRect(), b = document.querySelector(sel).getBoundingClientRect()
    return { ok: l.top >= b.bottom && l.top - b.bottom <= 8 && l.left >= 0 && l.right <= innerWidth && l.bottom <= innerHeight, l: [l.left, l.top, l.right, l.bottom], b: [b.left, b.bottom] }
  }, [SWITCHER])
  check("the list: right under the button, on screen", listAt.ok, listAt)
  await page.screenshot({ path: `${OUT}1-list.png`, clip: { x: 0, y: 0, width: 520, height: 300 } })
  await page.keyboard.press("Escape")
  check("Escape closes the list", !!(await until(async () => !(await isOpen()), 6000)))
  await page.click(SWITCHER); await page.waitForSelector(LIST)
  await page.mouse.click(900, 500)
  check("a click outside closes it", !!(await until(async () => !(await isOpen()), 6000)))
  await page.click(SWITCHER); await page.waitForSelector(LIST)
  await page.click(SWITCHER)
  check("the button again closes it", !!(await until(async () => !(await isOpen()), 6000)))

  // ---------- first use: 1 is the setup as it is ----------
  await pick(1)
  check("the list closes on a click", !!(await until(async () => !(await isOpen()), 6000)))
  check("1 is the setup as it is (saved without a click)", !!(await until(() => data()[0]?.layout && JSON.stringify(data()[0].layout).includes("Notes/Alpha.md"), 6000)), data())

  // ---------- a new one: same panels, one blank tab ----------
  await pick(2)
  check("2 is lit", !!(await until(async () => (await lit()) === "2", 6000)), await numbers())
  check("an unused workspace: one blank tab", !!(await until(async () => { const t = await tabs(); return t.length === 1 && !t[0].includes("Alpha") }, 6000)), await tabs())
  check("...and sidebars.json's panels", (await panels()).length === 4, await panels())
  await wait(1500)
  check("...not written: it's nothing yet", !data()[1], data())

  // Hide every panel but Terminals in workspace 2: saved in it, not in sidebars.json.
  await page.click("aside [data-titlebar]", { button: "right", position: { x: 50, y: 20 } })
  for (const name of ["Search field", "Pinned pages", "File explorer"]) { await menuItem(name).click(); await wait(150) }
  await page.keyboard.press("Escape")
  check("only Terminals shows in 2", !!(await until(async () => JSON.stringify(await panels()) === JSON.stringify(["terminal:sessions"]), 6000)), await panels())
  check("...which makes workspace 2: saved in it", !!(await until(() => onlyTerminals(data()[1]), 6000)), data()[1])
  check("...sidebars.json untouched", savedSidebars() === DEFAULT, savedSidebars())

  // A terminal in 2.
  await page.keyboard.press("Control+Backquote")
  sid = await until(async () => decodeURIComponent(page.url()).match(/terminal\/([a-z0-9]+)/)?.[1], 6000)
  check("a terminal opened in 2", !!sid, page.url())
  await until(async () => /%|\$|❯/.test(await text()), 8000)
  await page.locator(".xterm").click()
  await page.keyboard.type("echo pid-$$"); await page.keyboard.press("Enter")
  const pid = (await until(async () => (await text()).match(/pid-(\d+)/)?.[1], 6000))
  check("the terminal answers", !!pid, (await text()).slice(-200))
  await page.screenshot({ path: `${OUT}2-workspace-2.png` })

  // ---------- ⌃1 from inside the terminal: back to 1, its panels and tabs ----------
  await page.locator(".xterm").click()
  await page.keyboard.press(workspaceKey(1))
  check("⌃1 (typed in the terminal) switches to 1", !!(await until(async () => (await lit()) === "1", 6000)), await numbers())
  check("1's panels are back", !!(await until(async () => (await panels()).length === 4, 6000)), await panels())
  check("1's tabs are back", !!(await until(async () => (await tabs()).some((t) => t.includes("Alpha")), 6000)), [await tabs(), data()])
  check("no terminal tab in 1", !(await tabs()).some((t) => t.includes("Terminal")), await tabs())
  check("the address follows", decodeURIComponent(page.url()).includes("Notes/Alpha.md"), page.url())
  check("the shell is still running (Terminals lists it)", !!(await until(() => page.$(`aside [data-session='${sid}']`), 6000)))
  check("2's tabs were saved with the terminal", !!(await until(() => JSON.stringify(data()[1]?.layout ?? {}).includes(`terminal/${sid}`), 6000)), data()[1])
  await page.screenshot({ path: `${OUT}3-back-in-1.png` })

  // ---------- ⌃2: the same shell ----------
  await page.keyboard.press(workspaceKey(2))
  check("⌃2 switches to 2", !!(await until(async () => (await lit()) === "2", 6000)), await numbers())
  check("its terminal tab is back", !!(await until(async () => decodeURIComponent(page.url()).includes(`terminal/${sid}`), 6000)), page.url())
  await until(async () => (await text()).includes(`pid-${pid}`), 8000)
  // (The first keys typed into a terminal that just reattached can be lost, here and in splits.mjs: try a few times.)
  let again = null
  for (let i = 0; i < 3 && !again; i++) {
    await page.locator(".xterm").click(); await wait(500)
    await page.keyboard.type("echo again-$$"); await page.keyboard.press("Enter")
    again = await until(async () => (await text()).match(/^again-(\d+)\s*$/m)?.[1], 3000)
  }
  check("the same shell after switching away and back", again === pid, { pid, again, text: (await text()).slice(-300) })

  // ---------- rename ----------
  // On its row in the list (opened for it from the switcher's own menu), never in the header.
  const FIELD = "[data-workspace-list] input"
  await page.click(SWITCHER, { button: "right" })
  await menuItem("Rename").click()
  check("rename: the list opens, the name in a field on its row", !!(await until(() => page.$(`${FIELD}[aria-label='Name of workspace 2']`), 6000)) && !(await page.$("aside [data-titlebar] input")))
  check("...which has the keyboard", await page.evaluate(() => document.activeElement?.matches("[data-workspace-list] input")))
  await page.keyboard.type("Nope")
  await page.keyboard.press("Escape")
  const shut = await until(async () => !(await page.$("[data-workspace-list]")), 6000)
  check("...Escape leaves the name as it was (and the list, opened for it, closes)", !!shut && !data()[1]?.name, data()[1])
  await openList()
  await row(2).click({ button: "right" })
  await menuItem("Rename").click()
  await page.fill(FIELD, "Shells")
  await page.keyboard.press("Enter")
  check("renamed: saved", !!(await until(() => data()[1]?.name === "Shells", 6000)), data()[1])
  check("...Enter closes the list", !!(await until(async () => !(await page.$("[data-workspace-list]")), 6000)))
  check("...the switcher's tooltip and label say it", !!(await until(async () => (await page.getAttribute(SWITCHER, "data-tip"))?.startsWith("Shells"), 6000)), await page.getAttribute(SWITCHER, "data-tip"))
  check("...and its row in the list", !!(await until(async () => (await numbers())[1]?.text.includes("Shells"), 6000)), await numbers())

  // ---------- reload keeps the current workspace ----------
  await page.reload()
  await page.waitForSelector(SWITCHER)
  check("after a reload: still 2", !!(await until(async () => (await lit()) === "2", 6000)), await numbers())
  check("...its panels", JSON.stringify(await panels()) === JSON.stringify(["terminal:sessions"]), await panels())
  check("...its terminal tab", decodeURIComponent(page.url()).includes(`terminal/${sid}`), page.url())

  // ---------- a tab dragged onto another workspace's number ----------
  // A second window (its own device: its own localStorage) on workspace 1; this one stays on 2.
  writeFileSync(moveFile, "Moved between workspaces.\n")
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx2.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
  const other = watch(await ctx2.newPage(), { label: "other" })
  await other.goto(B)
  await other.waitForSelector(SWITCHER)
  const otherTabs = () => other.$$eval("section[aria-label=Pane] [role=tab]", (els) => els.map((t) => t.innerText.trim()))
  check("move: the other window is on 1", !!(await until(async () => (await other.$eval(SWITCHER, (e) => e.getAttribute("data-workspace-switcher")).catch(() => null)) === "1", 6000)))
  check("move: ...showing 1's tabs", !!(await until(async () => (await otherTabs()).some((t) => t.includes("Alpha")), 6000)), await otherTabs())
  // In a new tab beside the terminal's (the address fills the blank tab).
  await page.click("section[aria-label=Pane] button[aria-label='New tab']"); await wait(200)
  await page.evaluate(() => { location.hash = `#file/${encodeURIComponent("Qa ws move.md")}` })
  check("move: a file opened in 2 (saved)", !!(await until(async () => (await tabs()).some((t) => t.includes("Qa ws move")) && JSON.stringify(data()[1]?.layout ?? {}).includes("Qa ws move.md"), 6000)), [await tabs(), data()[1]])
  const tabBox = await page.locator("section[aria-label=Pane] [role=tab]", { hasText: "Qa ws move" }).boundingBox()
  const dropLit = () => page.$$eval(`${LIST} [data-workspace][data-drop]`, (els) => els.map((e) => e.getAttribute("data-workspace")))
  const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  /** Mid-drag: over the switcher (its list springs open), then onto row n. */
  const overRow = async (n) => {
    const s = await center(page.locator(SWITCHER))
    await page.mouse.move(s.x, s.y, { steps: 10 })
    if (!(await until(() => isOpen(), 2000))) return // (not something another workspace takes: the list stays shut)
    const r = await center(row(n))
    await page.mouse.move(r.x, r.y, { steps: 6 }); await wait(150)
  }
  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(tabBox.x + tabBox.width / 2 + 10, tabBox.y + tabBox.height / 2 + 6, { steps: 3 })
  check("move: the list is closed before the drag reaches the switcher", !(await isOpen()))
  const sc = await center(page.locator(SWITCHER))
  await page.mouse.move(sc.x, sc.y, { steps: 10 })
  check("move: dragging over the switcher opens the list", !!(await until(() => isOpen(), 2000)))
  await overRow(2)
  check("move: its own workspace's row isn't a target", !(await dropLit()).length, await dropLit())
  await overRow(1)
  check("move: over 1, 1 lights up as the target", JSON.stringify(await dropLit()) === "[\"1\"]", await dropLit())
  check("move: ...and the dragged tab says so", (await page.innerText("body")).includes("Move to workspace 1"))
  await page.screenshot({ path: `${OUT}4-drag-to-1.png`, clip: { x: 0, y: 0, width: 520, height: 300 } })
  await page.mouse.up()
  check("move: the list closes with the drop", !!(await until(async () => !(await isOpen()), 2000)))
  check("move: saved: in 1, out of 2", !!(await until(() => JSON.stringify(data()[0]?.layout ?? {}).includes("Qa ws move.md") && !JSON.stringify(data()[1]?.layout ?? {}).includes("Qa ws move.md"), 6000)), data())
  check("move: this window stays on 2", (await lit()) === "2", await numbers())
  check("move: ...and loses the tab (the terminal stays)", !!(await until(async () => { const t = await tabs(); return !t.some((x) => x.includes("Qa ws move")) && t.some((x) => x.includes("Terminal")) }, 6000)), await tabs())
  check("move: the other window shows it, appended", !!(await until(async () => { const t = await otherTabs(); return t[t.length - 1]?.includes("Qa ws move") }, 6000)), await otherTabs())
  check("move: ...without switching to it", decodeURIComponent(other.url()).includes("Notes/Alpha.md"), other.url())
  await wait(2500)
  check("move: nothing stale saved back afterwards", !JSON.stringify(data()[1]?.layout ?? {}).includes("Qa ws move.md") && JSON.stringify(data()[0]?.layout ?? {}).includes("Qa ws move.md"), data())
  check("move: this window still hasn't got it", !(await tabs()).some((x) => x.includes("Qa ws move")), await tabs())
  await other.screenshot({ path: `${OUT}5-other-window.png` })
  await ctx2.close()

  // ---------- a whole pane, dragged by its handle ----------
  const drag = async (from, to, before) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down()
    await page.mouse.move(from.x + 8, from.y + 6, { steps: 3 })
    if (typeof to === "number") await overRow(to); else { await page.mouse.move(to.x, to.y, { steps: 10 }); await wait(200) }
    const seen = { open: await isOpen(), lit: await isOpen() ? await dropLit() : [], zone: await page.$eval("[data-drop-zone]", (e) => e.getAttribute("data-drop-zone")).catch(() => null), ghost: await page.$eval("[data-drag-ghost]", (e) => e.innerText).catch(() => "") }
    if (before) await before()
    await page.mouse.up(); await wait(300)
    return seen
  }
  const mid = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const groups = () => page.$$eval("section[aria-label=Pane]", (els) => els.map((e) => ({ id: e.getAttribute("data-group"), tabs: [...e.querySelectorAll("[role=tab]")].map((t) => t.innerText.trim()) })))
  const openRight = async (file) => {
    await page.click("section[aria-label=Pane] button[aria-label='New tab']"); await wait(200)
    await page.evaluate((f) => { location.hash = `#file/${encodeURIComponent(f)}` }, file)
    await until(async () => (await tabs()).some((t) => t.includes(file.replace(/\.md$/, ""))), 6000)
    await page.click(`section[aria-label=Pane] [role=tab]:has-text("${file.replace(/\.md$/, "")}")`, { button: "right" })
    await menuItem("Move to new split right").click()
    return until(async () => { const g = await groups(); return g.length === 2 ? g : null }, 6000)
  }
  writeFileSync(paneFile, "A pane on its own.\n")
  let gs = await openRight("Qa ws pane.md")
  check("pane: a split with the file on the right", gs?.length === 2, gs)
  const handle = (gid) => page.locator(`[data-pane-handle='${gid}']`)
  await page.hover(`[data-tab-bar='${gs[1].id}']`)
  // It fades in: wait for the end of the transition (a loaded machine is slow).
  const opacity = await until(async () => { const o = await handle(gs[1].id).evaluate((e) => getComputedStyle(e).opacity); return o === "1" ? o : null }, 6000)
    ?? await handle(gs[1].id).evaluate((e) => getComputedStyle(e).opacity)
  check("pane: its handle shows while the pointer is over its bar", opacity === "1", opacity)
  // Onto the other pane's middle: its tabs join that pane, the pane closes.
  let seen = await drag(await mid(handle(gs[1].id)), await mid(page.locator(`[data-pane-body='${gs[0].id}']`)))
  check("pane onto another pane's middle: it lights up, the ghost names the pane", seen.zone === "center" && seen.ghost.includes("Qa ws pane"), seen)
  check("...dropped: one pane with both tabs", !!(await until(async () => { const g = await groups(); return g.length === 1 && g[0].tabs.some((t) => t.includes("Qa ws pane")) && g[0].tabs.some((t) => t.includes("Terminal")) }, 6000)), await groups())
  // A split again, then that pane onto number 3 (unused): 3 is made with it, this window keeps its other pane.
  await page.click(`section[aria-label=Pane] [role=tab]:has-text("Qa ws pane")`, { button: "right" })
  await menuItem("Move to new split right").click()
  gs = await until(async () => { const g = await groups(); return g.length === 2 ? g : null }, 6000)
  seen = await drag(await mid(handle(gs[1].id)), 3)
  check("pane onto an unused number: it lights up, 'Move pane to workspace 3'", JSON.stringify(seen.lit) === "[\"3\"]" && seen.ghost.includes("Move pane to workspace 3"), seen)
  check("...3 has the pane", !!(await until(() => JSON.stringify(data()[2]?.layout ?? {}).includes("Qa ws pane.md"), 6000)), data()[2])
  check("...this window keeps one pane, on 2", !!(await until(async () => { const g = await groups(); return g.length === 1 && !g[0].tabs.some((t) => t.includes("Qa ws pane")) }, 6000)) && (await lit()) === "2", await groups())
  check("...and 3 is no longer faint", !!(await until(async () => (await numbers())[2].used, 6000)), await numbers())
  await page.screenshot({ path: `${OUT}6-pane-moved.png`, clip: { x: 0, y: 0, width: 520, height: 120 } })

  // ---------- a file from the tree, a pinned page, a folder: onto a number ----------
  writeFileSync(openFile, "Opened in another workspace.\n")
  // Workspace 2 hides the tree: show it here for the drags (saved into 2, put back after).
  // (Hidden panels are under More ▸, ticked there one after another in one menu.)
  const showAll = async () => {
    await page.click("aside [data-titlebar]", { button: "right", position: { x: 50, y: 20 } })
    await page.locator("[role=menu] button", { hasText: /^More$/ }).first().hover(); await wait(300)
    for (const name of ["Search field", "Pinned pages", "File explorer"]) {
      await page.locator("[role=menu]").last().locator("[role=menuitemcheckbox]", { hasText: name }).first().click(); await wait(150)
    }
    for (let i = 0; i < 3 && await page.$("[role=menu]"); i++) { await page.keyboard.press("Escape"); await wait(100) }
  }
  await showAll()
  await until(async () => (await panels()).length === 4, 6000)
  const treeRow = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
  await until(() => treeRow("Qa ws open.md").count(), 6000)
  const tabsBefore = JSON.stringify(await tabs())
  seen = await drag(await mid(treeRow("Qa ws open.md")), 4)
  check("tree file onto a number: 'Open in workspace 4'", JSON.stringify(seen.lit) === "[\"4\"]" && seen.ghost.includes("Open in workspace 4"), seen)
  check("...opened in 4 (made with it)", !!(await until(() => JSON.stringify(data()[3]?.layout ?? {}).includes("Qa ws open.md"), 6000)), data()[3])
  check("...nothing changes here, still on 2", JSON.stringify(await tabs()) === tabsBefore && (await lit()) === "2", await tabs())
  const folder = await page.$eval("aside [role=tree] [data-tree-folder]", (e) => e.getAttribute("data-tree-path")).catch(() => null)
  if (folder) {
    seen = await drag(await mid(treeRow(folder)), 5)
    check("a folder over the switcher: refused, the list stays shut", !seen.open && !seen.lit.length && !data()[4], seen)
  }
  const pinsFile = path.join(VAULT, ".vaultite/pages.json")
  const pinned = () => JSON.parse(readFileSync(pinsFile, "utf8")).pinned
  const firstPin = pinned()[0]
  seen = await drag(await mid(page.locator(`aside nav[aria-label=Pages] [data-pin="${firstPin}"]`).first()), 5)
  check("pinned page onto a number: the number wins over 'Unpin'", JSON.stringify(seen.lit) === "[\"5\"]" && seen.ghost.includes("Open in workspace 5") && !seen.ghost.includes("Unpin"), seen)
  check("...opened in 5, and still pinned", !!(await until(() => JSON.stringify(data()[4]?.layout ?? {}).includes(firstPin), 6000)) && pinned()[0] === firstPin, [data()[4], pinned()])
  // Hide them again (ticked, in one menu that stays open): 2 is Terminals only.
  await page.click("aside [data-titlebar]", { button: "right", position: { x: 50, y: 20 } })
  for (const name of ["Search field", "Pinned pages", "File explorer"]) { await menuItem(name).click(); await wait(150) }
  await page.keyboard.press("Escape")
  await until(async () => JSON.stringify(await panels()) === JSON.stringify(["terminal:sessions"]), 6000)

  // ---------- the menu: no Reset; Delete with Undo; Duplicate into an unused one ----------
  const menuOf = async (n) => { await openList(); await row(n).click({ button: "right" }); await wait(150); const t = await page.$$eval("[role=menuitem]", (els) => els.map((e) => e.innerText.trim())); return t }
  let items = await menuOf(5)
  check("menu: Rename, Duplicate, Delete; no Reset", items.some((t) => t.startsWith("Rename")) && items.some((t) => t.startsWith("Duplicate")) && items.includes("Delete") && !items.some((t) => /Reset/.test(t)), items)
  await menuItem("Delete").click()
  check("Delete: no dialog, gone at once", !(await page.$("[role=alertdialog]")) && !!(await until(() => !data()[4], 6000)), data())
  check("...its number faint again", !!(await until(async () => !(await numbers())[4].used, 6000)), await numbers())
  await page.locator("[data-sonner-toast]", { hasText: "Deleted workspace 5" }).locator("button", { hasText: "Undo" }).click()
  check("...Undo brings it back", !!(await until(() => JSON.stringify(data()[4]?.layout ?? {}).includes(firstPin), 6000)), data()[4])
  await menuOf(5); await menuItem("Delete").click()
  await until(() => !data()[4], 6000)
  items = await menuOf(5)
  check("an unused one's menu: nothing to duplicate or delete", !!(await page.$("[role=menuitem]:disabled:has-text('Delete')")), items)
  await page.keyboard.press("Escape")
  check("Escape closes the menu, not the list", !(await page.$("[role=menu]")) && (await isOpen()))
  await menuOf(2)
  await menuItem("Duplicate to workspace 5").click()
  check("Duplicate 2 into the unused 5", !!(await until(() => JSON.stringify(data()[4]?.layout ?? {}).includes("terminal/") && onlyTerminals(data()[4]), 6000)), data()[4])
  await menuOf(5); await menuItem("Delete").click()
  await until(() => !data()[4], 6000)

  // ---------- an unused one: clicking it writes nothing; used and back to a blank tab, it's unused again ----------
  await pick(5)
  check("5 (unused): lit, a blank tab, sidebars.json's panels", !!(await until(async () => (await lit()) === "5" && (await tabs()).length === 1 && (await panels()).length === 4, 6000)), [await numbers(), await tabs()])
  await page.evaluate(() => { location.hash = `#file/${encodeURIComponent("Qa ws open.md")}` })
  check("...a file opened there makes it", !!(await until(() => JSON.stringify(data()[4]?.layout ?? {}).includes("Qa ws open.md"), 6000)), data()[4])
  await page.click("section[aria-label=Pane] [data-tab-close]")
  check("...its last tab closed (a blank tab again): unused, not kept", !!(await until(() => !data()[4], 6000)) && !!(await until(async () => !(await numbers())[4].used || (await lit()) === "5", 6000)), data())
  // Deleting the current one: this window stays on it, blank; Undo puts its tabs back.
  await pick(4)
  await until(async () => (await tabs()).some((t) => t.includes("Qa ws open")), 6000)
  await menuOf(4); await menuItem("Delete").click(); await closeList()
  check("Delete the current one: stays on it, a blank tab", !!(await until(async () => (await lit()) === "4" && (await tabs()).length === 1 && !(await tabs())[0].includes("Qa ws open"), 6000)) && !data()[3], [await tabs(), data()[3]])
  await page.locator("[data-sonner-toast]", { hasText: "Deleted workspace 4" }).locator("button", { hasText: "Undo" }).click()
  check("...Undo: its tabs are back here", !!(await until(async () => (await tabs()).some((t) => t.includes("Qa ws open")) && !!data()[3], 6000)), await tabs())
  await page.keyboard.press(workspaceKey(2))
  await until(async () => (await lit()) === "2", 6000)

  // ---------- the rail ----------
  await page.click("[data-sidebar-toggle='']"); await wait(400)
  // At the top of the rail, right under the toggle: one switcher showing the current number, among the header's items in
  // their header order (the Inbox's button, sort 50, comes before it), above the panels; its list opens beside the rail.
  check("rail: one switcher, showing 2", (await page.locator(SWITCHER).count()) === 1 && (await lit()) === "2", await lit())
  const railAt = await page.evaluate(([sel]) => {
    const sw = document.querySelector(sel), w = sw.getBoundingClientRect(), p = document.querySelector("aside [data-panel]").getBoundingClientRect()
    const head = sw.closest("[data-rail-section]")?.getBoundingClientRect()
    const t = document.querySelector("[data-sidebar-toggle='']").getBoundingClientRect()
    return head && head.top >= t.bottom - 1 && head.top < 60 && w.top >= head.top && w.bottom <= head.bottom + 1 && head.bottom <= p.top + 1
      ? true : [t.bottom, head?.top, head?.bottom, w.top, w.bottom, p.top]
  }, [SWITCHER])
  check("rail: in the header's items right under the toggle, above the panels", railAt === true, railAt)
  await page.click(SWITCHER)
  const railList = await until(async () => { const n = await numbers(); return n.length === 5 ? n : null }, 6000)
  check("rail: the list shows all five, 2 lit", railList?.map((x) => x.n + (x.on ? "*" : "")).join() === "1,2*,3,4,5", railList)
  const railListAt = await page.evaluate(([sel]) => {
    const l = document.querySelector("[data-workspace-list]").getBoundingClientRect(), a = document.querySelector("aside").getBoundingClientRect(), b = document.querySelector(sel).getBoundingClientRect()
    return { ok: l.left >= a.right && l.top <= b.top && l.bottom > b.bottom && l.right <= innerWidth && l.bottom <= innerHeight, l: [l.left, l.top, l.right, l.bottom], rail: a.right }
  }, [SWITCHER])
  check("rail: the list beside the rail, level with the button", railListAt.ok, railListAt)
  await page.screenshot({ path: `${OUT}7-rail.png`, clip: { x: 0, y: 0, width: 400, height: 400 } })
  await row(1).click()
  check("rail: a click switches", !!(await until(async () => (await lit()) === "1", 6000)), await lit())
  await pick(2)
  await until(async () => (await lit()) === "2", 6000)
  // A tab dragged over the rail's switcher opens its list too; let go on the list's heading (no row): nothing moves.
  const railTab = await center(page.locator("section[aria-label=Pane] [role=tab]", { hasText: "Terminal" }).first())
  const tabsNow = JSON.stringify(await tabs())
  await page.mouse.move(railTab.x, railTab.y); await page.mouse.down()
  await page.mouse.move(railTab.x + 10, railTab.y + 6, { steps: 3 })
  const rs = await center(page.locator(SWITCHER))
  await page.mouse.move(rs.x, rs.y, { steps: 10 })
  check("rail: dragging over the switcher opens the list", !!(await until(() => isOpen(), 2000)))
  const head = await center(page.locator(LIST).getByText("Workspaces", { exact: true }))
  await page.mouse.move(head.x, head.y, { steps: 4 }); await wait(150)
  await page.mouse.up()
  check("rail: ...closed when the drag ends, nothing moved", !!(await until(async () => !(await isOpen()), 2000)) && JSON.stringify(await tabs()) === tabsNow && (await lit()) === "2", await tabs())
  await page.click("[data-sidebar-toggle='']"); await wait(400)

  // ---------- plugin off: sidebars.json and pages.json again, no switcher, its files kept; on: 2 again ----------
  // (2 gets a pinned list of its own first: off, the sidebar shows pages.json's.)
  const vaultPins = JSON.parse(readFileSync(path.join(VAULT, ".vaultite/pages.json"), "utf8")).pinned
  await fetch(`${B}api/workspaces/2/pins`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: vaultPins[0], pinned: false }) })
  await until(() => data()[1]?.pinned, 6000)
  await wait(1500)
  const kept = JSON.stringify(data())
  const tabsOn = await tabs()
  setPlugins({ disabled: ["workspaces", "backlinks"] })
  check("off: no switcher", !!(await until(async () => !(await page.$(SWITCHER)), 6000)))
  check("off: sidebars.json's panels", !!(await until(async () => (await panels()).length === 4, 6000)), await panels())
  const pinsOff = await page.$$eval("aside [data-pin]", (els) => els.map((e) => e.getAttribute("data-pin")))
  check("off: pages.json's pinned pages", pinsOff[0] === vaultPins[0], [pinsOff, vaultPins])
  const before = await tabs()
  check("off: the tabs on screen stay", JSON.stringify(before) === JSON.stringify(tabsOn), [before, tabsOn])
  await page.keyboard.press(workspaceKey(1)); await wait(500)
  check("off: ⌃1 does nothing", JSON.stringify(await tabs()) === JSON.stringify(before), await tabs())
  await page.screenshot({ path: `${OUT}8-off.png`, clip: { x: 0, y: 0, width: 260, height: 90 } })
  await wait(1500)
  check("off: its files untouched", JSON.stringify(data()) === kept)
  setPlugins({ disabled: ["backlinks"] })
  check("on again: 2's panels", !!(await until(async () => JSON.stringify(await panels()) === JSON.stringify(["terminal:sessions"]), 6000)), await panels())
  check("on again: 2's tabs", !!(await until(async () => JSON.stringify(await tabs()) === JSON.stringify(tabsOn), 6000)), [await tabs(), tabsOn])
  noErrors()
} finally {
  // Put things back: end the shell, forget the workspaces.
  if (sid) {
    try {
      await page.keyboard.press("ControlOrMeta+p"); await wait(200); await page.keyboard.type("End terminal session"); await page.keyboard.press("Enter"); await wait(500)
    } catch { /* already gone */ }
  }
  clearWorkspaces(VAULT)
  for (const f of [moveFile, paneFile, openFile]) rmSync(f, { force: true })
  writeFileSync(settings, original)
  if (sidebarsBefore === null) rmSync(sidebarsFile, { force: true }); else writeFileSync(sidebarsFile, sidebarsBefore)
  await browser.close()
}
await done()
