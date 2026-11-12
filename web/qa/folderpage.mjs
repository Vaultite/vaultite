// A folder's page (view:folder/<path>): a pinned folder's tile on a phone opens it, list and grid, columns and gallery,
// groups, its tab's menu, into a subfolder and back, a file opening, crumbs, a folder dropped on a pane, a file dropped
// on a subfolder, `vau open <folder>`.
// WRITES "Qa folder", files.json's folderView, folderGroup and fileSort, a pin (all put back): throwaway server only.
//   node web/qa/folderpage.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/folderpage-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })

const D = "Qa folder"
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAHElEQVR4nGNgYGD4z4ABMIQoUsCIRREjZQq+AwBEIgQK3VV9gQAAAABJRU5ErkJggg==", "base64")
await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
await api("POST", "folder", { path: D })
await api("POST", "folder", { path: `${D}/Sub` })
await api("POST", "file", { path: `${D}/Sub/Inner.md`, text: "Inside.\n" })
await api("POST", "file", { path: `${D}/Alpha.md`, text: "# Alpha\n\nThe first lines of **Alpha**, with a [[link]] and more words after them.\n" })
await api("POST", "file", { path: `${D}/Beta.md`, text: "Beta's text.\n" })
await fetch(`${B}api/upload?path=${encodeURIComponent(`${D}/Pic.png`)}`, { method: "POST", body: PNG })
const filesBefore = await api("GET", "config/files")
await api("PATCH", "config/files", { fileSort: "name", folderView: null, folderGroup: null, autoReveal: false })
const pinsBefore = (await api("GET", "config/pages")).pinned ?? []
await api("POST", "pins", { path: D, pinned: true })
const hash = (p) => p.evaluate(() => decodeURIComponent(location.hash))
const shown = (p) => p.locator("[data-folder-page]:visible").first().getAttribute("data-folder-page").catch(() => null)
const order = (p) => p.locator("[data-folder-page]:visible [data-folder-item]").evaluateAll((els) => els.map((e) => e.dataset.folderItem))

// ---------- a phone ----------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
await phone.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const P = watch(await phone.newPage(), { label: "phone", console: true })
await P.goto(B); await wait(1800)
// A new tab: its pinned pages as tiles.
await P.locator("[data-bar=new]").tap().catch(() => {}); await wait(900)
const tile = P.locator(`main [data-pin="${D}"]`).first()
check("phone: the pinned folder is a tile on a new tab", await until(async () => (await tile.count()) === 1))
await tile.tap()
check("phone: a tap on its tile opens its page", await until(async () => (await shown(P)) === D), [await hash(P), await shown(P)])
check("phone: as a list by default, folders first", await until(async () => (await order(P)).join() === [`${D}/Sub`, `${D}/Alpha.md`, `${D}/Beta.md`, `${D}/Pic.png`].join()), await order(P))
await P.screenshot({ path: `${OUT}phone-list.png` })
await P.locator(`[data-folder-item="${D}/Sub"] a`).tap()
check("phone: a folder in it opens in the same tab", await until(async () => (await shown(P)) === `${D}/Sub`), await hash(P))
await P.screenshot({ path: `${OUT}phone-sub.png` })
await P.locator("[data-bar=back]").tap()
check("phone: Back comes out", await until(async () => (await shown(P)) === D), await hash(P))
await P.locator(`[data-folder-item="${D}/Sub"] a`).tap(); await until(async () => (await shown(P)) === `${D}/Sub`)
await P.locator("[data-folder-head] button", { hasText: D }).tap()
check("phone: a crumb goes up", await until(async () => (await shown(P)) === D), await hash(P))
// Show as ▸ Grid, from the header's … menu.
await P.locator("[data-phone-header] [aria-label=More]").tap(); await wait(400)
await P.locator("[role=menu] >> text=Show as").first().tap(); await wait(400)
await P.locator("[role=menu] >> text=Grid").last().tap(); await wait(600)
check("phone: Show as Grid draws cards", await until(async () => (await P.locator("[data-folder-grid]:visible").count()) === 1))
check("phone: the choice is files.json's", await until(async () => (await api("GET", "config/files")).folderView === "grid"))
// The header's own button (beside New note) shows the other one, in step with the menu and Settings.
await P.locator("[data-folder-head] [data-folder-view=list]").tap()
check("phone: the header's button shows it as a list", await until(async () => (await P.locator("[data-folder-list]:visible").count()) === 1 && (await api("GET", "config/files")).folderView === "list"))
await P.locator("[data-folder-head] [data-folder-view=grid]").tap()
check("phone: and as a grid again", await until(async () => (await P.locator("[data-folder-grid]:visible").count()) === 1 && (await api("GET", "config/files")).folderView === "grid"))
check("phone: a note's card shows its text, not its Markdown", await until(async () => /The first lines of Alpha, with a link/.test(await P.locator(`[data-folder-item="${D}/Alpha.md"]`).innerText())),
  await P.locator(`[data-folder-item="${D}/Alpha.md"]`).innerText())
check("phone: an image's card shows it", await until(() => P.locator(`[data-folder-item="${D}/Pic.png"] img`).evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false)))
await P.screenshot({ path: `${OUT}phone-grid.png` })
await P.emulateMedia({ colorScheme: "dark" }); await wait(400)
await P.screenshot({ path: `${OUT}phone-grid-dark.png` })
await P.emulateMedia({ colorScheme: "light" })
await P.locator(`[data-folder-item="${D}/Alpha.md"]`).tap()
check("phone: a file in it opens", await until(async () => (await hash(P)).includes(`file/${D}/Alpha.md`)), await hash(P))
await phone.close()

// ---------- a computer ----------
const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await desk.addInitScript(() => { try { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } } catch { /* about:blank */ } })
const W = watch(await desk.newPage(), { label: "desktop", console: true })
await W.goto("about:blank"); await W.goto(`${B}#view/${encodeURIComponent(`folder/${D}`)}`); await wait(1800)
check("desktop: the address opens its page", await until(async () => (await shown(W)) === D), await hash(W))
check("desktop: its tab is named after it", await until(async () => (await W.locator("[role=tab][aria-selected=true]").first().innerText()).trim() === D))
check("desktop: the bar's crumbs: the vault, then it", await until(async () => /\/\s*Qa folder$/.test((await W.locator("nav[aria-label='Folder path']:visible").innerText()).trim())))
check("desktop: Grid, as chosen on the phone (one setting)", await until(async () => (await W.locator("[data-folder-grid]:visible").count()) === 1))
await W.screenshot({ path: `${OUT}desktop-grid.png` })
await W.emulateMedia({ colorScheme: "dark" }); await wait(400)
await W.screenshot({ path: `${OUT}desktop-grid-dark.png` })
await W.locator("[data-folder-page] header [data-folder-view=list]:visible").click()
check("desktop: List from the page's header (its bar can fade)", await until(async () => (await W.locator("[data-folder-list]:visible").count()) === 1 && (await api("GET", "config/files")).folderView === "list"))
await W.screenshot({ path: `${OUT}desktop-list-dark.png` })
await W.emulateMedia({ colorScheme: "light" }); await wait(300)
await W.screenshot({ path: `${OUT}desktop-list.png` })
check("desktop: no count under its name (the rows say it)", !/\bitems?\b/.test(await W.locator("[data-folder-page]:visible header").innerText()))

// Columns: a column for each folder down to it; a file picked shows its preview, → goes into a folder, ← back out.
await W.locator("[data-folder-page] header [data-folder-view=columns]:visible").click()
check("desktop: Columns: the vault's top, then it", await until(async () => (await W.locator("[data-folder-column]:visible").evaluateAll((els) => els.map((e) => e.dataset.folderColumn))).join("|") === `|${D}`))
await W.locator(`[data-folder-column="${D}"] [data-folder-item="${D}/Alpha.md"]`).click()
check("desktop: Columns: a file picked shows its preview, the tab stays", await until(async () => (await W.locator(`[data-folder-preview="${D}/Alpha.md"]:visible`).count()) === 1) && (await shown(W)) === D)
await W.screenshot({ path: `${OUT}desktop-columns.png` })
await W.locator(`[data-folder-column="${D}"] [data-folder-item="${D}/Sub"]`).click()
check("desktop: Columns: a folder picked shows its things beside it", await until(async () => (await W.locator(`[data-folder-column="${D}/Sub"]:visible`).count()) === 1))
await W.keyboard.press("ArrowRight")
check("desktop: Columns: → goes into it", await until(async () => (await shown(W)) === `${D}/Sub`), await hash(W))
await W.keyboard.press("ArrowLeft")
check("desktop: Columns: ← comes back out, it still picked", await until(async () => (await shown(W)) === D && (await W.locator(`[data-folder-column="${D}/Sub"]:visible`).count()) === 1), await hash(W))
// Gallery: the picked thing large, ← → through the strip.
await W.locator("[data-folder-page] header [data-folder-view=gallery]:visible").click()
await W.locator(`[data-folder-strip] [data-folder-item="${D}/Pic.png"]`).click()
check("desktop: Gallery: a thing picked in the strip is shown large", await until(async () => (await W.locator(`[data-folder-stage="${D}/Pic.png"]:visible`).count()) === 1))
await W.keyboard.press("ArrowLeft")
check("desktop: Gallery: ← shows the one before", await until(async () => (await W.locator(`[data-folder-stage="${D}/Beta.md"]:visible`).count()) === 1))
await W.screenshot({ path: `${OUT}desktop-gallery.png` })
// Group by Kind, from the page's Sort button: headings, folders first.
await W.locator("[data-folder-page] header [data-folder-view=list]:visible").click()
await W.locator("[data-folder-arrange]:visible").click()
await W.locator("[role=menu] [role=menuitemradio]", { hasText: /^Kind$/ }).click()
check("desktop: Group by Kind: headings", await until(async () => (await W.locator("[data-folder-page]:visible [data-folder-heading]").evaluateAll((els) => els.map((e) => e.dataset.folderHeading))).join() === "Folders,Notes,Images"))
await api("PATCH", "config/files", { folderGroup: null })
// Its tab's menu: how it shows, then the folder's own.
await W.locator("[role=tab][aria-selected=true]").first().click({ button: "right" })
const tabMenu = await until(async () => (await W.locator("[role=menu]").first().innerText()).split("\n"))
check("desktop: its tab's menu: Show as, Sort by, Group by, then New note, Copy path, Reveal in file tree",
  ["Show as", "Sort by", "Group by", "New note", "Copy path", "Reveal in file tree", "More folder actions"].every((l) => tabMenu?.includes(l)), tabMenu)
await W.keyboard.press("Escape"); await wait(200)
await W.locator(`[data-folder-item="${D}/Sub"] a`).click()
check("desktop: a folder opens in the same tab", await until(async () => (await shown(W)) === `${D}/Sub`) && (await W.locator("[role=tab]").count()) === 1, await hash(W))
await W.locator("nav[aria-label='Folder path'] button", { hasText: D }).click()
check("desktop: a crumb goes up", await until(async () => (await shown(W)) === D), await hash(W))
await W.locator("[aria-label='Navigate back']:visible").click()
check("desktop: Back goes to the folder it came up from", await until(async () => (await shown(W)) === `${D}/Sub`), await hash(W))
await W.locator("[aria-label='Navigate back']:visible").click(); await until(async () => (await shown(W)) === D)

// ⌘-click selects (Finder's way), the menu then is the selection's.
const mod = process.platform === "darwin" ? "Meta" : "Control"
await W.locator(`[data-folder-item="${D}/Alpha.md"] a`).click({ modifiers: [mod] })
await W.locator(`[data-folder-item="${D}/Beta.md"] a`).click({ modifiers: [mod] })
await W.locator(`[data-folder-item="${D}/Beta.md"] a`).click({ button: "right" })
check("desktop: ⌘-click selects, the menu is for both", await until(async () => (await W.locator("[role=menu]").innerText()).includes("2 items selected")) && (await W.locator("[role=tab]").count()) === 1)
await W.keyboard.press("Escape"); await W.keyboard.press("Escape"); await wait(200)
// New folder from the page's …: named in place.
await W.locator("[data-folder-more]:visible").click()
await W.locator("[role=menu] [role=menuitem]", { hasText: /^New folder$/ }).click()
const field = W.locator("[data-folder-page]:visible input[aria-label='New name']")
check("desktop: New folder: its name typed in place", await until(async () => (await field.count()) === 1))
await field.fill("Made here"); await field.press("Enter")
check("desktop: ...made with that name", await until(async () => (await api("GET", "files")).folders.includes(`${D}/Made here`)), (await api("GET", "files")).folders.filter((f) => f.startsWith(D)))
// Rename from a row's menu.
await W.locator(`[data-folder-item="${D}/Made here"] a`).click({ button: "right" })
await W.locator("[role=menu] [role=menuitem]", { hasText: /^Rename$/ }).first().click()
await field.fill("Renamed"); await field.press("Enter")
check("desktop: Rename in place", await until(async () => (await order(W)).includes(`${D}/Renamed`)), await order(W))

// A long folder draws only what's near the screen.
await api("POST", "folder", { path: `${D}/Renamed/Long` })
// (32 at a time: 300 connections at once can overflow macOS's accept queue of 128)
for (let i = 0; i < 300; i += 32) await Promise.all(Array.from({ length: Math.min(32, 300 - i) }, (_, k) => api("POST", "file", { path: `${D}/Renamed/Long/Note ${String(i + k).padStart(3, "0")}.md`, text: `Note ${i + k}.\n` })))
await W.locator(`[data-folder-item="${D}/Renamed"] a`).click()
await until(async () => (await shown(W)) === `${D}/Renamed`)
await W.locator(`[data-folder-item="${D}/Renamed/Long"] a`).click()
const drawn = () => W.locator("[data-folder-page]:visible [data-folder-item]").count()
check("desktop: a long folder draws only some of its rows", await until(async () => (await shown(W)) === `${D}/Renamed/Long` && (await drawn()) > 10 && (await drawn()) < 300), await drawn())
await W.evaluate(() => { const s = document.querySelector("[data-pane] [data-folder-page]")?.closest("[data-pane]"); if (s) s.scrollTop = s.scrollHeight })
check("desktop: ...and its last once scrolled there", await until(async () => (await W.locator(`[data-folder-item="${D}/Renamed/Long/Note 299.md"]`).count()) === 1))
await W.locator("nav[aria-label='Folder path'] button", { hasText: D }).click(); await until(async () => (await shown(W)) === D)

// A file dragged onto a folder in the page moves into it.
async function drag(from, to, fy = 0.5) {
  await from.scrollIntoViewIfNeeded()
  const a = await from.boundingBox(), b = await to.boundingBox()
  await W.mouse.move(a.x + 30, a.y + a.height / 2); await W.mouse.down()
  await W.mouse.move(a.x + 38, a.y + a.height / 2 + 4, { steps: 2 })
  await W.mouse.move(b.x + b.width / 2, b.y + b.height * fy, { steps: 10 }); await wait(200)
  await W.mouse.up(); await wait(700)
}
await drag(W.locator(`[data-folder-item="${D}/Beta.md"]`), W.locator(`[data-folder-item="${D}/Sub"]`))
check("desktop: a file dropped on a folder moves into it", await until(async () => (await api("GET", "files")).files.some((f) => f.path === `${D}/Sub/Beta.md`)))
check("desktop: and leaves the page", await until(async () => !(await order(W)).includes(`${D}/Beta.md`)), await order(W))

// A file opens beside it; the path bar's folder opens its page.
await W.locator(`[data-folder-item="${D}/Alpha.md"] a`).click()
check("desktop: a file opens in a tab beside it", await until(async () => (await hash(W)).includes(`file/${D}/Alpha.md`)) && (await W.locator("[role=tab]").count()) === 2, await hash(W))
await W.locator("nav[aria-label='File path'] button", { hasText: D }).click()
check("desktop: a note's path bar folder opens its page", await until(async () => (await shown(W)) === D), await hash(W))

// A folder from the tree dropped on a pane opens its page there.
const tree = W.locator("aside [role=tree][aria-label=Files]").first()
const folderRow = tree.locator(`div[data-tree-path="${D}"] button[role=treeitem]`)
if ((await folderRow.getAttribute("aria-expanded")) !== "true") { await folderRow.click(); await wait(300) }
const body = W.locator("[data-pane-body]").first()
await W.locator("[role=tab]").first().click(); await wait(300)
// (in the pane's middle, below the page's rows: on a folder's row it would move in)
await drag(tree.locator(`div[data-tree-path="${D}/Sub"]`), body, 0.7)
check("desktop: a folder dropped on a pane opens its page there", await until(async () => (await shown(W)) === `${D}/Sub`), await hash(W))
// Its menu in the tree: Open.
await tree.locator(`div[data-tree-path="${D}"]`).click({ button: "right" })
await W.locator("[role=menu] [role=menuitem]", { hasText: /^Open$/ }).first().click()
check("desktop: Open in a folder's menu", await until(async () => (await shown(W)) === D), await hash(W))

// An agent's `vau open <folder>`.
await api("POST", "ops/ui.open", { path: `${D}/Sub` })
check("vau open <folder> shows its page", await until(async () => (await shown(W)) === `${D}/Sub`), await hash(W))

// The sidebar's pinned pages as tiles: a folder's tile opens its page on a computer too.
await api("PATCH", "config/plugin/pages", { show: "tiles" })
// (a tile: until the list redraws as tiles, its row is there too, a click on which opens it in place)
const deskTile = W.locator(`aside [data-pin-tiles] [data-pin="${D}"]`).first()
await until(async () => (await deskTile.count()) === 1)
await deskTile.click()
check("desktop: a folder's tile in the sidebar opens its page", await until(async () => (await shown(W)) === D), await hash(W))
await api("PATCH", "config/plugin/pages", { show: null })

await fetch(`${B}api/file?path=${encodeURIComponent(D)}`, { method: "DELETE" })
check("a folder gone says so", await until(async () => (await W.locator("[data-folder-gone]:visible").count()) === 1))
await api("PATCH", "config/files", Object.fromEntries(["fileSort", "folderView", "folderGroup", "autoReveal"].map((k) => [k, filesBefore[k] ?? null])))
if (!pinsBefore.includes(D)) await api("POST", "pins", { path: D, pinned: false })
await done()
