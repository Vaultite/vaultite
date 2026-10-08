// Moving files and folders in the tree: drag a folder into another (the folder you'd drop into is
// highlighted as a whole), back out to the top level (empty space, or a top-level file: the whole tree highlights), a
// folder into itself or a file into its own folder (refused: nothing highlights, nothing moves), a closed folder
// opening while you hold a drag over it, the tree scrolling near its edge, and Move file to… (the folder picker, "/" for
// the top level, Shift+Enter makes a folder). Pins follow moves made in the app and through the API. On phones: Move to…
// from the … menu. WRITES (makes, moves and trashes "Qa ..." folders): throwaway server only.
//   node web/qa/move.mjs <base url> [out dir]
import { SHOTS, apiAt, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B)
const exists = async (p) => (await api("GET", "files")).files.some((f) => f.path === p) || (await api("GET", "files")).folders.includes(p)
const pins = async () => (await api("GET", "config/pages")).pinned

// A fresh set of folders: Qa move/{Inbox/Draft.md, Sub/}, Qa target/Deep/, Qa note.md at the top level.
for (const p of ["Qa move", "Qa target", "Inbox", "Qa new", "Qa note.md"]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
for (const p of ["Qa move", "Qa move/Inbox", "Qa move/Sub", "Qa target", "Qa target/Deep"]) await api("POST", "folder", { path: p })
await api("POST", "file", { path: "Qa move/Inbox/Draft.md", text: "A draft.\n" })
await api("POST", "file", { path: "Qa note.md", text: "Top level.\n" })
const pinnedBefore = await pins()
const filesBefore = await api("GET", "config/files")
await api("PUT", "config/files", { ...filesBefore, fileSort: "name", autoReveal: false })
// Two pages only, so the sidebar doesn't scroll and the tree keeps its own scrolling (steps 3 and 5 need it). Put back
// at the end.
await api("PUT", "config/pages", { pinned: [...pinnedBefore.filter((p) => p !== "files").slice(0, 2), "Qa move/Inbox/Draft.md"] })

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } })
const page = watch(await ctx.newPage(), { console: true })
const shot = (name) => page.screenshot({ path: `${OUT}move-${name}.png` })
const row = (p) => page.locator(`aside [role=tree] div[data-tree-path="${p}"]`).first()
const side = () => page.locator("nav[aria-label=Pages] a").allInnerTexts()
const expanded = (p) => page.locator(`aside [role=tree] li:has(div[data-tree-path="${p}"]):not(:has(li div[data-tree-path="${p}"]))`).first().getAttribute("aria-expanded")
const open = async (p) => { if ((await expanded(p)) !== "true") { await row(p).locator("button").first().click(); await wait(150) } }
const highlighted = () => page.evaluate(() => [...document.querySelectorAll("aside .drop-target")].map((el) =>
  el.getAttribute("role") === "tree" ? "/" : el.querySelector("div[data-tree-path]")?.getAttribute("data-tree-path")))
const center = async (loc, dx = 0, dy = 0) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); return [b.x + Math.min(60, b.width / 2) + dx, b.y + b.height / 2 + dy] }
/** Start dragging a row; `over` moves over points (with a pause each); `drop` releases. Returns what was highlighted at the end. */
async function drag(from, points, { drop = true, hold = 120, name } = {}) {
  const [x, y] = await center(row(from))
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x + 6, y + 4, { steps: 3 }); await wait(60)
  for (const p of points) { const [px, py] = typeof p === "string" ? await center(row(p)) : p; await page.mouse.move(px, py, { steps: 6 }); await wait(hold) }
  const lit = await highlighted()
  if (name) await shot(name)
  if (drop) await page.mouse.up(); else { await page.keyboard.press("Escape"); await page.mouse.up() }
  await wait(700)
  return lit
}

await page.goto(B); await wait(1500)
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)
check("the pinned draft shows in the sidebar", (await side()).includes("Draft"), await side())
await open("Qa move")

// 1. A folder into another folder: the target folder highlights as a whole.
let lit = await drag("Qa move/Inbox", ["Qa target"], { name: "into-folder" })
check("dragging over a folder highlights it", lit.join() === "Qa target", lit)
check("the folder moved into it", await exists("Qa target/Inbox/Draft.md"))
check("its pin followed", (await pins()).includes("Qa target/Inbox/Draft.md") && !(await pins()).includes("Qa move/Inbox/Draft.md"), await pins())
check("the sidebar still shows the pin", (await side()).includes("Draft"), await side())
check("the moved folder shows in the tree", await row("Qa target/Inbox").isVisible())

// 2. Over a file: its folder highlights (the whole block); over a top-level file: the whole tree.
await open("Qa target/Inbox")
lit = await drag("Qa move/Sub", ["Qa target/Inbox/Draft.md"], { drop: false, name: "over-file" })
check("over a file, its folder highlights", lit.join() === "Qa target/Inbox", lit)

// 3. Back out to the top level: over empty tree space, the whole tree highlights.
const tree = page.locator("aside [role=tree]")
const tb = await tree.boundingBox()
// Empty space: below the last row (the tree has some at its end), away from the edge that scrolls.
// The tree scrolls, or (a sidebar with more panels than fit) the sidebar does: bring the tree's end into view either way.
const empty = async () => {
  const last = await tree.evaluate((el) => { el.scrollTop = el.scrollHeight; el.scrollIntoView({ block: "end" }); return el.lastElementChild.getBoundingClientRect().bottom })
  return [tb.x + 80, last + 12]
}
const [ex, ey] = await empty()
const [ix, iy] = await center(row("Qa target/Inbox"))
await page.mouse.move(ix, iy); await page.mouse.down(); await page.mouse.move(ix + 6, iy + 4, { steps: 3 }); await wait(60)
await page.mouse.move(ex, (await empty())[1], { steps: 6 }); await wait(150)
lit = await highlighted(); await shot("to-root")
await page.mouse.up(); await wait(700)
check("over empty space the whole tree highlights", lit.join() === "/", lit)
check("dropped on empty space: at the top level", await exists("Inbox/Draft.md") && !(await exists("Qa target/Inbox/Draft.md")))
check("its pin followed to the top level", (await pins()).includes("Inbox/Draft.md"), await pins())

// 4. Onto a top-level file: the top level too.
await open("Qa target")
lit = await drag("Qa target/Deep", ["Qa note.md"])
check("over a top-level file the whole tree highlights", lit.join() === "/", lit)
check("dropped on a top-level file: at the top level", await exists("Deep") && !(await exists("Qa target/Deep")))
await api("POST", "file/move", { from: "Deep", to: "Qa target/Deep" }); await page.reload(); await wait(1200)

// 5. Refused: a folder into its own child, a file into the folder it's in.
await open("Qa move")
lit = await drag("Qa move", ["Qa move/Sub"], { name: "into-itself" })
check("a folder over its own child: nothing highlights", lit.length === 0, lit)
check("and nothing moved", await exists("Qa move/Sub") && !(await exists("Qa move/Sub/Qa move")))
await open("Inbox")
lit = await drag("Inbox/Draft.md", ["Inbox"])
check("a file over its own folder: nothing highlights", lit.length === 0, lit)
check("and it stayed", await exists("Inbox/Draft.md"))

// 6. Holding a drag over a closed folder opens it; then drop inside.
if ((await expanded("Qa target")) === "true") { await row("Qa target").locator("button").first().click(); await wait(150) }
const [dx, dy] = await center(row("Inbox/Draft.md"))
await page.mouse.move(dx, dy); await page.mouse.down(); await page.mouse.move(dx + 6, dy + 4, { steps: 3 }); await wait(60)
await page.mouse.move(...(await center(row("Qa target"))), { steps: 6 }); await wait(300)
check("a closed folder stays closed at first", (await expanded("Qa target")) === "false")
await wait(700)
check("held over for a moment, it opens", (await expanded("Qa target")) === "true")
await page.mouse.move(...(await center(row("Qa target/Deep"))), { steps: 6 }); await wait(150)
await shot("hover-open")
await page.mouse.up(); await wait(700)
check("dropped into the folder it opened", await exists("Qa target/Deep/Draft.md"))

// 7. The tree scrolls near its bottom edge while dragging.
await page.locator('aside [aria-label="Expand all"]').click().catch(() => {}); await wait(300)
await tree.evaluate((el) => { el.scrollTop = 0 })
const canScroll = await tree.evaluate((el) => el.scrollHeight > el.clientHeight + 50)
if (canScroll) {
  const [sx, sy] = await center(row("Qa note.md").isVisible() ? row("Qa target") : row("Qa target"))
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 6, sy + 4, { steps: 3 }); await wait(60)
  await page.mouse.move(tb.x + 80, tb.y + tb.height - 6, { steps: 6 }); await wait(700)
  const top = await tree.evaluate((el) => el.scrollTop)
  await page.keyboard.press("Escape"); await page.mouse.up(); await wait(300)
  check("the tree scrolls while dragging near its bottom", top > 40, top)
} else console.log("skip scrolling: the tree isn't long enough")
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)

// 8. Move file to…: the folder picker.
await open("Qa target"); await open("Qa target/Deep")
await row("Qa target/Deep/Draft.md").click({ button: "right" }); await wait(200)
const menu = await page.locator("[role=menu] button").allInnerTexts()
check("the menu has Move file to…", menu.some((t) => t.includes("Move file to…")), menu)
await page.locator("[role=menu] button", { hasText: "Move file to…" }).click(); await wait(250)
const dialog = page.locator('[role=dialog][aria-label="Move to folder"]')
check("the folder picker opens", await dialog.isVisible())
const options = await dialog.locator("[role=option]").allInnerTexts()
check("the top level is first, as /", options[0]?.startsWith("/"), options.slice(0, 3))
check("its own folder isn't offered", !options.some((t) => t.trim() === "Qa target/Deep"), options)
await shot("picker")
await page.keyboard.type("qa move sub"); await wait(150)
check("fuzzy: the folder comes first", (await dialog.locator("[role=option]").first().innerText()).startsWith("Qa move/Sub"))
await shot("picker-typed")
await page.keyboard.press("Enter"); await wait(800)
check("Move to… moved it", await exists("Qa move/Sub/Draft.md"))
check("and the pin followed", (await pins()).includes("Qa move/Sub/Draft.md"), await pins())
await row("Qa move").click({ button: "right" }); await wait(200)
await page.locator("[role=menu] button", { hasText: "Move folder to…" }).click(); await wait(250)
const fopts = await dialog.locator("[role=option]").allInnerTexts()
check("a folder can't go into itself or its children", !fopts.some((t) => t.startsWith("Qa move")), fopts)
await page.keyboard.press("Escape"); await wait(200)
await row("Qa move/Sub/Draft.md").click({ button: "right" }); await wait(200)
await page.locator("[role=menu] button", { hasText: "Move file to…" }).click(); await wait(250)
await page.keyboard.type("Qa new/Here"); await wait(150)
check("a folder that isn't there is offered", (await dialog.locator("[role=option]").last().innerText()).includes("New folder"))
await page.keyboard.press("Shift+Enter"); await wait(800)
check("Shift+Enter makes it and moves there", await exists("Qa new/Here/Draft.md"))

// 9. A move through the API (an AI): the pin follows and the app shows it after a reload.
await api("POST", "file/move", { from: "Qa new/Here/Draft.md", to: "Qa target/Draft.md" })
check("an API move moves the pin", (await pins()).includes("Qa target/Draft.md") && !(await pins()).some((p) => p.startsWith("Qa new")), await pins())
await page.reload(); await wait(1500)
check("the sidebar shows it after an API move", (await side()).includes("Draft"), await side())
await fetch(`${B}api/file?path=${encodeURIComponent("Qa target/Draft.md")}`, { method: "DELETE" })
check("trashing a pinned file drops its pin", !(await pins()).includes("Qa target/Draft.md"), await pins())

// 10. Phones: Move to… from the … menu (drag isn't needed there).
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
const m = watch(await phone.newPage())
await api("POST", "file", { path: "Qa move/Phone.md", text: "From the phone.\n" })
await m.goto(`${B}#view/files`); await wait(1500)
const mrow = (p) => m.locator(`[role=tree]:visible div[data-tree-path="${p}"]`).first()
if ((await m.locator('[role=tree]:visible li:has(div[data-tree-path="Qa move"]):not(:has(li div[data-tree-path="Qa move"]))').first().getAttribute("aria-expanded")) !== "true") { await mrow("Qa move").locator("button").first().click(); await wait(200) }
await mrow("Qa move/Phone.md").locator('button[aria-label^="More for"]').click(); await wait(250)
await m.locator("[role=menu] button", { hasText: "Move file to…" }).click(); await wait(300)
await m.screenshot({ path: `${OUT}move-phone-picker.png` })
await m.locator('[role=dialog] [role=option]').first().click(); await wait(800)
check("phone: Move to… the top level", await exists("Phone.md"))
await phone.close()

// Clean up.
for (const p of ["Qa move", "Qa target", "Inbox", "Qa new", "Qa note.md", "Phone.md", "Deep"]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await api("PUT", "config/pages", { pinned: pinnedBefore })
await api("PUT", "config/files", filesBefore)
await done()
