// The desktop app (Electron), end to end on a throwaway vault: its window and server, the title bar, the menu's
// commands (⌘T, ⌘W), the menu bar (its menus, icons, keys from hotkeys.json, pinned pages), zoom (⌘+ ⌘- ⌘0, kept), the terminal (an image dropped on it typed as its path), Finder drops on the file tree (copy, ⌥ move, " 1" names; simulated with CDP drag
// events carrying real files), a file dropped on the editor opening from outside the vault (saving in place, Copy to vault; an image, right-clicked for its menu; a PDF
// and a workbook in their viewers, an HTML page run without the vault), a
// file of another known vault opening in that vault's window, Manage vaults (list, create a vault: a second window
// with its own server), the editor's menu (Look up), and vau dev screenshot. WRITES: throwaway vault only.
//   node web/qa/desktop.mjs <vault copy> [packaged app binary]
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, terminalText, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, BIN], check, errs, watch, noErrors, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-desktop-"))
const OUT = path.join(TMP, "shots")
// A Mac hides the title bar for the traffic lights and has Look up; elsewhere the window keeps its own frame.
const MAC = process.platform === "darwin"
const CMD = MAC ? "Cmd" : "Ctrl" // (accelerators: Electron's Cmd is Super on Linux, so the menu says Ctrl there)
fs.mkdirSync(OUT)

const app = await _electron.launch({
  executablePath: BIN ?? path.join(ROOT, "node_modules/.bin/electron"), args: BIN ? ["--vault", VAULT] : [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
check("the window serves the vault from its own server", /^http:\/\/127\.0\.0\.1:\d+$/.test(origin) &&
  (await (await fetch(`${origin}/api/vault`)).json()).path === VAULT, origin)
check("the page knows it's in the app", await win.evaluate(() => document.documentElement.hasAttribute("data-electron") && window.vaultite?.desktop === true))
check("the page knows its platform", await win.evaluate((p) => document.documentElement.dataset.platform === p && window.vaultite?.platform === p, process.platform))
const toggle = await win.locator("[data-sidebar-toggle='']").boundingBox()
if (MAC) check("the sidebar toggle sits right of the traffic lights", toggle && toggle.x >= 76, toggle)
else check("the sidebar toggle sits at the window's edge (its own title bar, no lights)", toggle && toggle.x < 40, toggle)
check("the sidebar's top row drags the window", await win.evaluate(() => getComputedStyle(document.querySelector("[data-titlebar]")).getPropertyValue("-webkit-app-region") === "drag"))
await win.screenshot({ path: path.join(OUT, "window.png") })
// vau dev screenshot: the page captured through the preload's bridge (core/coreops/dev.ts), a PNG where asked.
{
  const shot = path.join(TMP, "dev-shot.png"), el = path.join(TMP, "dev-el.png")
  const vau = (...a) => execFileSync(process.execPath, [path.join(ROOT, "bin/vau"), ...a], { encoding: "utf8", env: { ...process.env, VAULTITE_URL: origin }, stdio: ["ignore", "pipe", "pipe"] })
  let out = "", out2 = ""
  try { out = vau("dev", "screenshot", "--out", shot).trim(); out2 = vau("dev", "screenshot", "--selector", "[role=tree]", "--out", el, "--json") } catch (e) { out = String(e.stderr ?? e) }
  const png = (f) => fs.existsSync(f) && fs.readFileSync(f).subarray(1, 4).toString() === "PNG"
  const size = (() => { try { return JSON.parse(out2) } catch { return {} } })()
  check("vau dev screenshot: the window as a PNG, its path printed", out === shot && png(shot) && fs.statSync(shot).size > 5000, out)
  check("vau dev screenshot --selector: one element, smaller", png(el) && size.width > 0 && size.width < (await win.evaluate(() => innerWidth * devicePixelRatio)), size)
}
const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
if (process.env.SHOW) try { execFileSync("screencapture", ["-x", "-o", `-R${bounds.x},${bounds.y},${bounds.width},120`, path.join(OUT, "titlebar.png")], { stdio: "ignore" }) } catch { /* no screen recording permission */ }

// The menu runs the app's commands.
const tabs = () => win.locator("[role=tablist] [role=tab]").count()
const menuClick = (label) => app.evaluate(({ Menu, BrowserWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BrowserWindow.getAllWindows()[0])
}, label)
await win.bringToFront()
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
const before = await tabs()
await menuClick("New tab")
check("File > New tab (⌘T) opens a tab", await until(async () => (await tabs()) === before + 1, 10000), await tabs())
await menuClick("Close tab")
check("File > Close tab (⌘W) closes it", await until(async () => (await tabs()) === before, 10000), await tabs())
await win.keyboard.press("ControlOrMeta+P")
await win.keyboard.type("Close current tab")
await wait(300)
const listed = await win.evaluate(() => document.querySelector("[role=dialog], [role=listbox]")?.closest("div")?.textContent ?? document.body.textContent)
check(`the palette shows ${MAC ? "⌘W" : "Ctrl W"} on Close current tab`, (MAC ? /Close current tab\s*⌘\s*W/ : /Close current tab\s*Ctrl\s*W/).test(listed), listed.slice(0, 200))
await win.keyboard.press("Escape")

// A pop-out window (Move current tab to new window): a window of the vault's own, title bar hidden, no sidebars, its
// own tabs; the menu's commands go to it while it's in front; closing its last tab closes it.
{
  const note = fs.readdirSync(path.join(VAULT, "Notes")).find((f) => f.endsWith(".md"))
  await win.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(`Notes/${note}`)}`); await wait(600)
  const made = app.waitForEvent("window")
  await win.keyboard.press("ControlOrMeta+P"); await win.keyboard.type("Move current tab to new window"); await wait(300); await win.keyboard.press("Enter")
  const pop = await made
  watch(pop, { label: "popout" })
  await pop.waitForSelector("[data-tab-id]", { timeout: 20000 })
  check("pop-out: a window of its own, showing the tab", decodeURIComponent(pop.url()).includes(`?popout=`) && decodeURIComponent(pop.url()).includes(note), pop.url())
  check("pop-out: the app's, no sidebars", await pop.evaluate(() => document.documentElement.hasAttribute("data-electron") && document.documentElement.hasAttribute("data-popout") && !document.querySelector("aside[data-side]")))
  const pad = await pop.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-corner] > [role=tablist]")).paddingLeft))
  if (MAC) check("pop-out: its tab bar makes room for the traffic lights", pad >= 76, pad)
  else check("pop-out: its tab bar starts at the edge (no lights)", pad < 40, pad)
  check("pop-out: a second window, laid out like the vault's", await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 2) &&
    await pop.evaluate((p) => document.documentElement.dataset.platform === p, process.platform))
  const popTabs = () => pop.locator("[role=tablist] [role=tab]").count()
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes("?popout="))
    const find = (items) => { for (const i of items) { if (i.label === "New tab") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
    find(Menu.getApplicationMenu().items).click(undefined, w)
  })
  check("pop-out: the menu's New tab opens one there", await until(async () => (await popTabs()) === 2, 10000), await popTabs())
  const gone = new Promise((r) => pop.once("close", () => r(true)))
  await pop.keyboard.press("ControlOrMeta+W")
  check("pop-out: ⌘W closes a tab there", await until(async () => (await popTabs()) === 1, 10000), await popTabs())
  // (the window goes while the key is down)
  await pop.keyboard.press("ControlOrMeta+W").catch(() => {})
  check("pop-out: closing its last tab closes it", await Promise.race([gone, wait(5000).then(() => false)]))
  await win.bringToFront()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
}

// The editor's menu (plugins/core/editing/menu.ts): the page leaves the right-click to the system, Electron reports
// the spell checker's word under it, then the app's menu opens, with Look up for a selection (macOS's popover).
{
  fs.writeFileSync(path.join(VAULT, "Notes/Qa spelling.md"), "Look this up please.\n")
  await win.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent("Notes/Qa spelling.md")}`)
  await win.waitForSelector("[data-pane] .cm-content"); await wait(800)
  const said = []
  await app.evaluate(({ BrowserWindow }) => { globalThis.__said = 0; BrowserWindow.getAllWindows()[0].webContents.on("context-menu", () => { globalThis.__said++ }) })
  const first = win.locator("[data-pane] .cm-line").first()
  await first.click(); await win.keyboard.press("Home"); await win.keyboard.press("Shift+Alt+ArrowRight")
  const b = await first.boundingBox()
  await win.mouse.click(b.x + 8, b.y + b.height / 2, { button: "right" })
  const items = await until(async () => (await win.locator("[role=menu] [role=menuitem]").count()) > 0, 2000) ? await win.locator("[role=menu] [role=menuitem]").allTextContents() : []
  said.push(await app.evaluate(() => globalThis.__said))
  check("editor: right-click opens the app's menu after Electron's context-menu", said[0] >= 1 && items.some((i) => i.startsWith("Format")), { said, items })
  if (MAC) {
    check("editor: Look up the selection", items.some((i) => i.startsWith("Look up “Look”")), items)
    await win.getByRole("menuitem", { name: /^Look up/ }).click(); await wait(300)
    check("editor: Look up asks the window without an error", !errs.length, errs)
  } else check("editor: no Look up off a Mac", !items.some((i) => i.startsWith("Look up")), items)
  await win.keyboard.press("Escape")
  // (what follows drops files on a blank pane)
  await menuClick("Close tab"); await wait(300)
}

// Zoom (there's no font size setting): View > Zoom in / out / Actual size, on ⌘= and ⌘+ (⇧⌘=) alike, kept for next time.
const zoomKeys = await app.evaluate(({ Menu }) => {
  const all = []; const walk = (items) => { for (const i of items) { if (/^(Zoom in|Zoom out|Actual size)$/.test(i.label)) all.push(`${i.label}:${i.accelerator}`); if (i.submenu) walk(i.submenu.items) } }
  walk(Menu.getApplicationMenu().items); return all
})
check("View menu: zoom in on ⌘= and ⌘+, out on ⌘-, actual size on ⌘0", [`Zoom in:${CMD}+=`, `Zoom in:${CMD}+Plus`, `Zoom out:${CMD}+-`, `Actual size:${CMD}+0`].every((k) => zoomKeys.includes(k)), zoomKeys)
const factor = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())
await menuClick("Zoom in")
check("Zoom in zooms the page", await until(async () => Math.abs((await factor()) - 1.1) < 0.01, 10000), await factor())
check("the zoom is kept (vaults.json)", await until(() => JSON.parse(fs.readFileSync(path.join(TMP, "userData/vaults.json"), "utf8")).zoom === 1.1, 10000))
await win.reload(); await win.waitForSelector("[role=tree]")
check("a reload keeps the zoom", Math.abs((await factor()) - 1.1) < 0.01, await factor())
await menuClick("Zoom out"); await menuClick("Zoom out")
check("Zoom out", Math.abs((await factor()) - 0.9) < 0.01, await factor())
await menuClick("Actual size")
check("Actual size", (await factor()) === 1, await factor())

// The menu bar is the window's commands (electron/menu.ts): its menus, their icons, the keys in effect (hotkeys.json's
// too, live), the pinned pages.
const menuInfo = () => app.evaluate(({ Menu }) => {
  const out = {}
  const walk = (items, at) => { for (const i of items) {
    if (i.label) out[`${at}${i.label}`] = { key: i.accelerator ?? null, icon: !!i.icon && !i.icon.isEmpty(), enabled: i.enabled, visible: i.visible }
    if (i.submenu) walk(i.submenu.items, `${at}${i.label} > `)
  } }
  walk(Menu.getApplicationMenu().items, ""); return out
})
let menu = await menuInfo()
check("the menu bar has File, Edit, View, Go, Window and Help", ["File", "Edit", "View", "Go", "Window", "Help"].every((m) => menu[m]), Object.keys(menu).filter((k) => !k.includes(">")))
check("File > New note on ⌘N, with its icon (a Mac's: GTK menus get none)", menu["File > New note"]?.key === `${CMD}+N` && (menu["File > New note"].icon || !MAC), menu["File > New note"])
check("most items have icons (a Mac's)", !MAC || Object.values(menu).filter((i) => i.icon).length > 40, Object.values(menu).filter((i) => i.icon).length)
check("Go has Back and Forward, on the app's keys", menu["Go > Back"]?.key === (MAC ? "Cmd+Alt+Left" : "Alt+Left") && menu["Go > Forward"]?.key === (MAC ? "Cmd+Alt+Right" : "Alt+Right"), [menu["Go > Back"], menu["Go > Forward"]])
check("File > Reopen closed tab on ⇧⌘T; Window has Pin and Stack tabs", menu["File > Reopen closed tab"]?.key === `${CMD}+Shift+T` &&
  !!menu["Window > Pin or unpin tab"] && !!menu["Window > Stack or unstack tabs"], [menu["File > Reopen closed tab"], menu["Window > Pin or unpin tab"]])
check("View > Graph view on ⌘G", !menu["View > Graph view"] || menu["View > Graph view"].key === `${CMD}+G`, menu["View > Graph view"])
check("Edit > Search the vault on ⇧⌘F", menu["Edit > Search the vault"]?.key === `${CMD}+Shift+F`, menu["Edit > Search the vault"])
check("Help has the docs, release notes and logs", ["Help > Vaultite help", "Help > Release notes", "Help > Show logs"].every((k) => menu[k]), Object.keys(menu).filter((k) => k.startsWith("Help")))
const hot = (keys) => fetch(`${origin}/api/config/hotkeys`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "graph:open": keys }) })
if (menu["View > Graph view"]) {
  await hot(["Mod+Shift+G"])
  check("a hotkey set in hotkeys.json shows in the menu", await until(async () => (await menuInfo())["View > Graph view"]?.key === `${CMD}+Shift+G`, 10000), (await menuInfo())["View > Graph view"])
  await hot([])
  check("a command with no keys in hotkeys.json has none in the menu", await until(async () => (await menuInfo())["View > Graph view"]?.key === null, 10000), (await menuInfo())["View > Graph view"])
  await hot(null)
}
const pins = await (await fetch(`${origin}/api/state`)).json().then((s) => s.pinned ?? [])
if (pins.length) check("Go > Pinned lists the pinned pages", await until(async () => Object.keys(await menuInfo()).filter((k) => k.startsWith("Go > Pinned > ")).length > 0, 10000), pins)

// The sidebar folded to its rail: the top-left tab bar makes room for the traffic lights and the toggle.
await menuClick("Toggle left sidebar")
await wait(400)
const firstTab = await win.locator("[data-corner] [role=tablist] [role=tab]").first().boundingBox()
check("folded sidebar: the first tab clears the traffic lights (a Mac's) and the toggle", firstTab && firstTab.x >= (MAC ? 110 : 40), firstTab)
await win.screenshot({ path: path.join(OUT, "rail.png") })
await menuClick("Toggle left sidebar")

// Finder drops, as CDP drag events with real files.
const cdp = await win.context().newCDPSession(win)
async function drop(files, x, y, modifiers = 0) {
  const data = { items: [], files, dragOperationsMask: 1 | 16 }
  // (A beat between the events, like a real drag: a busy page may not have handled the enter before the drop.)
  for (const type of ["dragEnter", "dragOver", "drop"]) { await cdp.send("Input.dispatchDragEvent", { type, x, y, data, modifiers }); await wait(100) }
}
// A 1×1 PNG, for image drops.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")

// Terminal: a login shell in the vault's folder.
await win.keyboard.press("ControlOrMeta+P")
await win.keyboard.type("Open terminal")
await win.keyboard.press("Enter")
const term = () => terminalText(win)
await until(async () => (await win.locator(".xterm").count()) > 0, 15000)
await wait(1500)
await win.locator(".xterm").first().click()
await win.keyboard.type("echo vau-$((6*7)) && pwd\n")
check("the terminal runs a shell in the vault", await until(async () => (await term()).includes("vau-42") && (await term()).includes(path.basename(VAULT)), 15000), (await term()).slice(-300))
// An image dropped on it is sent to the server and its path typed (Claude Code attaches it), not opened in a tab.
const shot = path.join(TMP, "Screenshot.png")
fs.writeFileSync(shot, png)
const xb = await win.locator(".xterm").first().boundingBox()
const termUrl = win.url()
await drop([shot], xb.x + xb.width / 2, xb.y + xb.height / 2)
check("an image dropped on the terminal types its uploaded path", await until(async () => /uploads\/\w+-Screenshot\.png/.test(await term()), 5000), (await term()).slice(-300))
check("…and doesn't open it in a tab", win.url() === termUrl, win.url())
await win.keyboard.press("Control+C")
await menuClick("Close tab")

const src = path.join(TMP, "from finder")
fs.mkdirSync(path.join(src, "Folder in"), { recursive: true })
fs.writeFileSync(path.join(src, "Dropped note.md"), "Dropped from Finder.\n")
fs.writeFileSync(path.join(src, "Folder in", "Inside.md"), "Inside a folder.\n")
fs.writeFileSync(path.join(src, "Moved.md"), "Moved with option.\n")
const folderRow = win.locator('[data-tree-path="Notes"]').first()
// Measured before each drop: the tree scrolls to what came in (and the row may be below the fold to start with).
const at = async () => {
  await folderRow.scrollIntoViewIfNeeded()
  let b = await folderRow.boundingBox(), prev = null
  for (let i = 0; i < 20 && JSON.stringify(b) !== JSON.stringify(prev); i++) { await new Promise((r) => setTimeout(r, 100)); prev = b; b = await folderRow.boundingBox() } // settled
  return [b.x + 40, b.y + b.height / 2]
}
await drop([path.join(src, "Dropped note.md"), path.join(src, "Folder in")], ...await at())
check("a drop on a folder copies files and folders in", await until(() => fs.existsSync(path.join(VAULT, "Notes/Dropped note.md")) && fs.existsSync(path.join(VAULT, "Notes/Folder in/Inside.md")), 10000)
  && fs.existsSync(path.join(src, "Dropped note.md")))
await drop([path.join(src, "Dropped note.md")], ...await at())
check("a name that's taken gets \" 1\"", await until(() => fs.existsSync(path.join(VAULT, "Notes/Dropped note 1.md")), 10000))
await drop([path.join(src, "Moved.md")], ...await at(), MAC ? 1 /* Alt */ : 8 /* Shift: Alt drags windows on Linux */)
check("⌥ moves", await until(() => fs.existsSync(path.join(VAULT, "Notes/Moved.md")) && !fs.existsSync(path.join(src, "Moved.md")), 10000))
check("the tree shows what came in", await until(async () => (await win.locator('[data-tree-path="Notes/Dropped note.md"]').count()) > 0, 10000))

// A file dropped on the editor opens from outside the vault, and saves in place.
const outside = path.join(TMP, "Outside note.md")
fs.writeFileSync(outside, "Written outside the vault.\n")
const main = await win.locator("#main-scroll").boundingBox()
await drop([outside], main.x + main.width / 2, main.y + 200)
check("a file dropped on the editor opens in a tab", await until(async () => decodeURIComponent(win.url()).includes(`#file/${outside}`), 10000), win.url())
check("its text shows", await until(async () => (await win.locator(".cm-content").first().textContent()).includes("Written outside the vault."), 10000))
check("it isn't added to the vault", !fs.readdirSync(VAULT).includes("Outside note.md"))
await win.locator(".cm-content").first().click()
await win.keyboard.press("ControlOrMeta+ArrowDown")
await win.keyboard.type("Edited in the app.")
check("editing saves it in place", await until(() => fs.readFileSync(outside, "utf8").includes("Edited in the app."), 5000), fs.readFileSync(outside, "utf8"))
check("the server refuses outside files nobody allowed", (await fetch(`${origin}/api/file?path=${encodeURIComponent("/etc/hosts")}`)).status === 404)
await win.screenshot({ path: path.join(OUT, "outside.png") })
// Its tab's menu copies it into the vault, and the tab shows the copy.
await win.locator('[role="tab"][aria-selected="true"]').first().click({ button: "right" })
await win.getByRole("menuitem", { name: "Copy to vault" }).click()
check("Copy to vault copies it in", await until(() => fs.existsSync(path.join(VAULT, "Outside note.md")) && fs.readFileSync(path.join(VAULT, "Outside note.md"), "utf8").includes("Edited in the app."), 10000))
check("…and the tab shows the vault's copy", await until(async () => decodeURIComponent(win.url()).endsWith("#file/Outside note.md"), 10000), win.url())
await menuClick("New tab") // (a vault note takes drops: attachments)
await wait(500)

// Any file dropped from outside opens in its viewer (a PDF), or drawn by its plugin (a workbook), its bytes served.
const pdfOut = path.join(TMP, "Outside statement.pdf")
fs.writeFileSync(pdfOut, "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")
await drop([pdfOut], main.x + main.width / 2, main.y + 200)
check("a PDF dropped from outside opens in a tab", await until(async () => decodeURIComponent(win.url()).includes(`#file/${pdfOut}`), 10000), win.url())
check("in the PDF viewer, its bytes served", await until(async () => (await win.locator("article iframe[src*='api/raw']").count()) > 0, 10000) &&
  (await fetch(`${origin}/api/raw?path=${encodeURIComponent(pdfOut)}`)).status === 200)
// An image from outside: right-click it for its menu (Copy to vault), or the path bar's button.
const imgOut = path.join(TMP, "Outside photo.png")
fs.writeFileSync(imgOut, png)
await menuClick("New tab")
await wait(500)
await drop([imgOut], main.x + main.width / 2, main.y + 200)
check("an image dropped from outside opens in a tab", await until(async () => decodeURIComponent(win.url()).includes(`#file/${imgOut}`), 10000), win.url())
check("its path bar has Copy to vault", await until(async () => (await win.locator('[data-pane] button[aria-label="Copy to vault"]').count()) > 0, 10000))
await win.locator("[data-pane] article[data-kind=image] img").first().click({ button: "right" })
check("right-clicking it shows Copy image and Copy to vault", await until(async () => (await win.getByRole("menuitem", { name: "Copy to vault" }).count()) > 0
  && (await win.getByRole("menuitem", { name: "Copy image" }).count()) > 0, 10000))
await win.getByRole("menuitem", { name: "Copy to vault" }).click()
const inVault = () => execFileSync("find", [VAULT, "-name", "Outside photo.png"], { encoding: "utf8" }).trim()
check("Copy to vault brings the image in", await until(() => !!inVault(), 10000))
check("…and the tab shows the vault's copy", await until(async () => !decodeURIComponent(win.url()).includes(TMP), 10000), win.url())
await win.locator("[data-pane] article[data-kind=image] img").first().click({ button: "right" })
check("a vault image's right-click has its file's items", await until(async () => (await win.getByRole("menuitem", { name: "Move file to…" }).count()) > 0
  && (await win.getByRole("menuitem", { name: "Delete image" }).count()) > 0, 10000))
await win.keyboard.press("Escape")
const xlsxOut = path.join(TMP, "Outside budget.xlsx")
fs.writeFileSync(xlsxOut, (await import(path.join(ROOT, "tools/fixtures/formats/make.ts"))).xlsx())
await menuClick("New tab") // (a PDF's viewer takes drops itself)
await wait(500)
await drop([xlsxOut], main.x + main.width / 2, main.y + 200)
check("a workbook dropped from outside opens as a grid", await until(async () => (await win.locator("[data-sheet-grid] td", { hasText: "Lamp oil" }).count()) > 0, 15000))
check("the server refuses bytes nobody allowed", (await fetch(`${origin}/api/raw?path=${encodeURIComponent("/etc/hosts")}`)).status === 404)
await win.screenshot({ path: path.join(OUT, "outside-workbook.png") })

// An HTML page from outside runs, sandboxed, and gets nothing of the vault.
const htmlOut = path.join(TMP, "Outside chart.html")
fs.writeFileSync(htmlOut, `<!doctype html><html><head><title>Outside chart</title></head><body><p id="out">ran</p><script>
  document.getElementById("out").textContent = "script ran";
  vau.read("/Welcome.md").then(() => { document.getElementById("out").textContent += ", read the vault" }, () => { document.getElementById("out").textContent += ", vault refused" })
</script></body></html>`)
await menuClick("New tab")
await wait(500)
await drop([htmlOut], main.x + main.width / 2, main.y + 200)
const htmlText = async () => { for (const f of win.frames()) { try { const t = await f.evaluate(() => document.getElementById("out")?.textContent ?? ""); if (t) return t } catch { /* not it */ } } return "" }
check("an HTML page dropped from outside runs", await until(async () => (await htmlText()).startsWith("script ran"), 15000), await htmlText())
check("and can't read the vault", await until(async () => (await htmlText()) === "script ran, vault refused", 10000), await htmlText())
await win.screenshot({ path: path.join(OUT, "outside-html.png") })

// Finder's Open with (the open-file event): a .txt opens as its text in the vault window.
const txt = path.join(TMP, "Plain.txt")
fs.writeFileSync(txt, "Just text.\n")
await app.evaluate(({ app }, p) => app.emit("open-file", { preventDefault() {} }, p), txt)
check("Open with: a file opens in a tab", await until(async () => decodeURIComponent(win.url()).includes(`#file/${txt}`), 10000), win.url())
check("a .txt shows as its text", await until(async () => (await win.locator("[data-pane] .cm-content").first().textContent()).includes("Just text."), 10000))

// Manage vaults: its own window; creating a vault opens a second window with its own server.
await win.evaluate(() => window.vaultite.manageVaults())
const mgr = await until(() => app.windows().some((w) => w.url().endsWith("vaults.html")), 10000) && app.windows().find((w) => w.url().endsWith("vaults.html"))
await mgr.waitForSelector("nav[aria-label=Vaults] button")
check("the manager lists the vault", (await mgr.locator("nav[aria-label=Vaults]").textContent()).includes(path.basename(VAULT)))
await mgr.screenshot({ path: path.join(OUT, "manager.png") })
const parent = path.join(TMP, "vaults")
fs.mkdirSync(parent)
mgr.evaluate((p) => window.vaultite.createVault(p, "Second vault"), parent).catch(() => {}) // (the manager closes)
const second = await until(() => app.windows().some((w) => w.url().startsWith("http") && w.url() !== win.url() && !w.url().startsWith(origin)), 60000)
  && app.windows().find((w) => w.url().startsWith("http") && !w.url().startsWith(origin))
// (The server answers before it has opened the vault: its rules come a moment after the window.)
check("a new vault opens in its own window, on its own server", !!second && await until(() => fs.existsSync(path.join(parent, "Second vault", ".vaultite", "AGENTS.md")), 10000), app.windows().map((w) => w.url()))
check("opening a vault closes the manager", await until(() => !app.windows().some((w) => w.url().endsWith("vaults.html")), 10000))
// A file of a known vault, dropped on the other vault's window: opens in its own vault's window.
fs.writeFileSync(path.join(VAULT, "Notes", "Cross vault.md"), "In the first vault.\n")
// (A new vault opens on its pinned Start here, a note that takes a drop as an attachment: dropped on a blank tab.)
await second.waitForSelector("#main-scroll [data-file-drop]")
await second.keyboard.press("Meta+t")
await second.locator("#main-scroll [data-file-drop]").waitFor({ state: "detached" })
const m2 = await second.locator("#main-scroll").boundingBox()
const cdp2 = await second.context().newCDPSession(second)
for (const type of ["dragEnter", "dragOver", "drop"]) await cdp2.send("Input.dispatchDragEvent", { type, x: m2.x + 200, y: m2.y + 200, data: { items: [], files: [path.join(VAULT, "Notes", "Cross vault.md")], dragOperationsMask: 1 } })
check("a file of another known vault opens in that vault's window", await until(async () => decodeURIComponent(win.url()).endsWith("#file/Notes/Cross vault.md"), 10000), win.url())
const port2 = new URL(second.url()).port
await app.evaluate(({ BrowserWindow }, port) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`:${port}/`)).close(), port2)
check("closing a window stops its server", await until(async () => { try { await fetch(`http://127.0.0.1:${port2}/api/vault`); return false } catch { return true } }, 10000))
await wait(1000)
const saved = JSON.parse(fs.readFileSync(path.join(TMP, "userData", "vaults.json"), "utf8"))
check("the vault list is kept in userData", saved.vaults.length === 2 && saved.vaults.find((v) => v.path === VAULT).open === true && saved.vaults.find((v) => v.path !== VAULT).open === false, saved)

noErrors()
const port1 = new URL(origin).port
await app.close()
check("quitting stops the servers", await until(async () => { try { await fetch(`http://127.0.0.1:${port1}/api/vault`); return false } catch { return true } }, 10000))
// No vaults, set up before (userData/setup.json): the manager. (A first launch shows Set up Vaultite: onboarding.mjs.)
fs.mkdirSync(path.join(TMP, "userData-fresh"), { recursive: true })
fs.writeFileSync(path.join(TMP, "userData-fresh", "setup.json"), JSON.stringify({ done: new Date().toISOString() }))
const fresh = await _electron.launch({
  executablePath: BIN ?? path.join(ROOT, "node_modules/.bin/electron"), args: BIN ? [] : [ROOT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData-fresh"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const first = await fresh.firstWindow()
await first.waitForSelector("text=Open folder as vault")
check("with no vaults, the manager shows", first.url().endsWith("vaults.html"))
await fresh.close()
console.log(`\nshots in ${OUT}`)
await done()
