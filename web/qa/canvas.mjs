// Canvas: a .canvas file (JSON Canvas) as a board of cards: adding, moving (snapping), resizing, selecting, duplicating,
// copy and paste, connecting, arrows and colours, Delete and ⌘Z, Convert to file, a note's card edited in place, a web
// page card, files dragged from the tree, unknown keys kept, changes on disk drawn, scrolling and zooming never
// writing, a big board drawing only what's near, `![[x.canvas]]` in a note, "New canvas", and a phone at 390px.
// WRITES a "Qa canvas" folder and removes the workspaces' data.json for the run (put back): throwaway server only.
// The web page card's preview needs the network (example.com).
//   node web/qa/canvas.mjs <base url> <vault path> [out dir]
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
import { setAsideWorkspaces } from "./lib/wsfiles.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const req = (method, path, body) => fetch(`${B}api/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) })
const BOARD = "Qa canvas/Board.canvas", NOTE = "Qa canvas/With a board.md", TARGET = "Qa canvas/Target note.md", BIG = "Qa canvas/Big.canvas"
const read = () => JSON.parse(readFileSync(`${VAULT}/${BOARD}`, "utf8"))
/** Waits (up to 5 s) for the file on disk to pass `test`; the canvas saves 300 ms after a change, then the autosave. */
const until = async (test, file = BOARD) => {
  for (let i = 0; i < 50; i++) { try { if (test(file === BOARD ? read() : readFileSync(`${VAULT}/${file}`, "utf8"))) return true } catch { /* mid-write */ } await wait(100) }
  return false
}
const putBackWs = setAsideWorkspaces(VAULT)

const board = {
  nodes: [
    { id: "grp", type: "group", label: "Qa group", x: -40, y: -80, width: 760, height: 360, color: "5" },
    { id: "a", type: "text", text: "## First card\nSome **bold** text.", x: 0, y: 0, width: 260, height: 120, mine: "kept" },
    { id: "f", type: "file", file: TARGET, x: 400, y: -20, width: 280, height: 220 },
    { id: "l", type: "link", url: "https://example.com", x: 0, y: 400, width: 260, height: 100 },
  ],
  edges: [{ id: "e1", fromNode: "a", fromSide: "right", toNode: "f", toSide: "left", label: "then", extra: 7 }],
  custom: { keep: true },
}
await req("DELETE", `file?path=${encodeURIComponent("Qa canvas")}`)
await req("PUT", "canvas/settings", { snapToGrid: true, snapToObjects: true })
await req("POST", "file", { path: TARGET, text: "# Target\n\nThe note a card shows.\n" })
await req("POST", "file", { path: BOARD, text: JSON.stringify(board, null, "\t") + "\n" })
await req("POST", "file", { path: NOTE, text: `A board:\n\n![[Board.canvas|300]]\n` })
// A big board: 40 x 40 cards.
const big = { nodes: [], edges: [] }
for (let i = 0; i < 1600; i++) big.nodes.push({ id: `n${i}`, type: "text", text: `Card ${i}`, x: (i % 40) * 300, y: Math.floor(i / 40) * 160, width: 250, height: 100 })
for (let i = 1; i < 1600; i++) if (i % 40) big.edges.push({ id: `e${i}`, fromNode: `n${i - 1}`, toNode: `n${i}` })
await req("POST", "file", { path: BIG, text: JSON.stringify(big) })

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const node = (id) => page.locator(`[data-canvas-node="${id}"]`)
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
/** A point on the board's background with room around it (nothing but the board under it and around it, for a new card). */
const emptyPoint = () => page.evaluate(() => {
  const el = document.querySelector("[data-canvas-board=page]"), r = el.getBoundingClientRect()
  const free = (x, y) => document.elementFromPoint(x, y) === el
  for (let y = r.top + 60; y < r.bottom - 80; y += 20) for (let x = r.right - 140; x > r.left + 100; x -= 20) {
    if ([[0, 0], [-80, 0], [80, 0], [0, -40], [0, 40]].every(([dx, dy]) => free(x + dx, y + dy))) return { x, y }
  }
  return null
})
const dragTo = async (from, to, steps = 10) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps }); await page.mouse.up() }

await page.goto(`${B}#file/${encodeURIComponent(BOARD)}`)
const boardEl = page.locator("[data-canvas-board=page]")
await boardEl.waitFor({ timeout: 15000 })
await wait(1000)
check("draws its cards and arrows", await boardEl.getAttribute("data-canvas-nodes") === "4" && await boardEl.getAttribute("data-canvas-edges") === "1")
check("a text card's Markdown is drawn", await page.locator("[data-canvas-node=a] strong").textContent() === "bold")
await page.waitForFunction(() => document.querySelector("[data-canvas-node=f]")?.textContent?.includes("The note a card shows"), null, { timeout: 5000 }).then(() => check("a file card shows the note", true), () => check("a file card shows the note", false))
check("an arrow's label is drawn", (await page.locator("[data-edge-label=e1]").textContent()).includes("then"))
// The whole pane, edge to edge under the path bar (its format's layout: "pane"), with no title or box around it.
const box = await page.locator("[data-format-pane]").boundingBox()
const paneBox = await page.locator("[data-pane-body]").first().boundingBox()
check(`fills the pane, edge to edge (${Math.round(box?.width ?? 0)} x ${Math.round(box?.height ?? 0)} of ${Math.round(paneBox?.width ?? 0)} x ${Math.round(paneBox?.height ?? 0)})`,
  box && paneBox && Math.abs(box.width - paneBox.width) < 2 && Math.abs(box.y + box.height - (paneBox.y + paneBox.height)) < 2 && box.height > paneBox.height - 70)
check("no box and no title around it", !(await page.$("[data-format-box]")) && !(await page.$("article[data-layout=pane] textarea")))
await page.waitForFunction(() => document.querySelector("[data-canvas-node=l]")?.textContent?.includes("Example Domain"), null, { timeout: 10000 })
  .then(() => check("a web page card shows the page's title", true), () => check("a web page card shows the page's title (needs the network)", false))
await page.screenshot({ path: `${OUT}canvas-edit.png` })

// A double-click on the background: a new card, written in the editor, saved.
const bb = await boardEl.boundingBox()
const spot = await emptyPoint()
await page.mouse.dblclick(spot.x, spot.y)
await page.waitForSelector("[data-editing] .cm-content")
await page.keyboard.type("Hello from **QA** [[Targ")
await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 3000 }).then(() => check("[[ suggests notes in a card", true), () => check("[[ suggests notes in a card", false))
await page.keyboard.press("Escape") // closes the suggestions
await page.keyboard.press("Escape") // ends editing
check("a double-click adds a card and what's written in the editor is saved", await until((d) => d.nodes.length === 5 && d.nodes.some((n) => String(n.text).startsWith("Hello from **QA**"))))
check("Escape ends editing", !(await page.$("[data-editing]")))
let doc = read()
const added = doc.nodes.find((n) => String(n.text).startsWith("Hello from"))
check("unknown keys stay on the file, cards and arrows", doc.custom?.keep === true && doc.nodes.find((n) => n.id === "a").mine === "kept" && doc.edges[0].extra === 7)
check("the file keeps its tab indent", readFileSync(`${VAULT}/${BOARD}`, "utf8").includes('\n\t"nodes"'))
await page.keyboard.press("ControlOrMeta+z")
check("one ⌘Z takes the new card and its text away", await until((d) => d.nodes.length === 4))
await page.keyboard.press("ControlOrMeta+Shift+z")
check("⇧⌘Z brings it back", await until((d) => d.nodes.length === 5))

// Drag a card: it moves in the file, and (the grid's snapping off, from the controls) snaps to the left edge of the
// card below it ("l" at x 0) when let go near it.
await page.click("[data-canvas-tool=Snapping]"); await wait(200)
await page.getByText("Snap to grid", { exact: true }).click(); await wait(300)
const aBox = await node("a").boundingBox()
const k0 = aBox.width / 260
await dragTo({ x: aBox.x + 40, y: aBox.y + 60 }, { x: aBox.x + 40 + 4 * k0, y: aBox.y + 160 })
check(`a dragged card moves in the file and snaps to another's edge (x ${read().nodes.find((n) => n.id === "a").x})`, await until((d) => { const a = d.nodes.find((n) => n.id === "a"); return a.x === 0 && a.y > 40 }))
await page.click("[data-canvas-tool=Snapping]"); await wait(200)
await page.getByText("Snap to grid", { exact: true }).click(); await wait(300)
await page.click("[data-canvas-tool=Snapping]"); await wait(200)
check("snapping to the grid is back on (kept in the plugin's settings)", await page.locator("[role=menu] [aria-checked=true]").filter({ hasText: "Snap to grid" }).count() === 1)
await page.keyboard.press("Escape")

// Resize from the left edge.
await node("a").click()
const wa = read().nodes.find((n) => n.id === "a").width
const lh = await page.locator('[data-handle="resize-w"][data-for="a"]').boundingBox()
await dragTo({ x: lh.x + lh.width / 2, y: lh.y + 12 }, { x: lh.x - 60, y: lh.y + 12 }) // (above the middle's connect dot)
check("a card's left edge resizes it", await until((d) => { const a = d.nodes.find((n) => n.id === "a"); return a.width > wa + 40 && a.x < 0 }))

// A box drawn on the background selects what it touches; the bar above shows Align for several.
// From empty background below the link card and left of the group (a press on the group would move it, and beside
// "a" it would catch the side dot of "a", resized past the group's edge just above), up into "a".
const aC = await center(node("a")), lB = await node("l").boundingBox(), gB = await node("grp").boundingBox()
await dragTo({ x: gB.x - 30, y: lB.y + lB.height + 30 }, aC)
await wait(300)
check("a selection box selects several cards (the bar offers Align)", await page.locator("[data-canvas-toolbar=selection] [data-canvas-tool=Align]").count() === 1)
const picked = Number(await boardEl.getAttribute("data-canvas-selected"))
await page.keyboard.press("ControlOrMeta+d")
check(`⌘D duplicates the selection (${picked} cards)`, picked >= 2 && await until((d) => d.nodes.length === 5 + picked))
await page.keyboard.press("ControlOrMeta+z")
check("and ⌘Z undoes it", await until((d) => d.nodes.length === 5))

// Copy and paste (the clipboard's events, as the browser sends them).
await node("a").click()
const pasted = await page.evaluate(() => {
  const data = new DataTransfer()
  document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }))
  const text = data.getData("text/plain")
  const into = new DataTransfer()
  into.setData("text/plain", text)
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: into, bubbles: true, cancelable: true }))
  return text
})
check("copy and paste make a copy of the card (as JSON Canvas)", pasted.includes('"nodes"') && await until((d) => d.nodes.filter((n) => n.text === "## First card\nSome **bold** text.").length === 2))
await page.evaluate(() => {
  const into = new DataTransfer()
  into.setData("text/plain", "https://example.org/page")
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: into, bubbles: true, cancelable: true }))
})
check("a pasted web address is a web page card", await until((d) => d.nodes.some((n) => n.type === "link" && n.url === "https://example.org/page")))
doc = read()
const copyId = doc.nodes.filter((n) => n.text === "## First card\nSome **bold** text.").find((n) => n.id !== "a").id
const linkId = doc.nodes.find((n) => n.url === "https://example.org/page").id
await node(linkId).click(); await page.keyboard.press("Backspace")
await node(copyId).click(); await page.keyboard.press("Backspace")
check("Delete removes them", await until((d) => d.nodes.length === 5))

// Connect the new card to the web page card by a side dot.
await node(added.id).hover()
const dot = page.locator(`[data-handle=bottom][data-for="${added.id}"]`)
await dragTo(await center(dot), await center(node("l")), 12)
check("dragging a side dot to a card connects them", await until((d) => d.edges.length === 2 && d.edges.some((e) => e.fromNode === added.id && e.toNode === "l" && e.fromSide === "bottom")))
const edgeId = read().edges.find((e) => e.fromNode === added.id).id

// The arrow's bar: Two-way.
// A point on the arrow that nothing covers (cards drawn over it hide parts of it).
const lab = await page.evaluate((id) => {
  const p = document.querySelector(`[data-edge="${id}"] path:nth-of-type(2)`), l = p.getTotalLength(), r = p.getScreenCTM()
  for (let t = 0.5, k = 0; k < 40; k++, t = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02) {
    const m = p.getPointAtLength(l * t), pt = { x: m.x * r.a + r.e, y: m.y * r.d + r.f }
    if (document.elementFromPoint(pt.x, pt.y)?.closest(`[data-canvas-edge="${id}"]`)) return pt
  }
  return null
}, edgeId)
await page.mouse.click(lab.x, lab.y)
await page.click("[data-canvas-toolbar=selection] [data-canvas-tool=Direction]"); await wait(200)
await page.getByText("Two-way", { exact: true }).click()
check("an arrow made two-way from the bar above it", await until((d) => d.edges.find((e) => e.id === edgeId)?.fromEnd === "arrow"))

// Drag a side dot into empty space: a menu, a card there, connected.
await node("a").hover()
const right = page.locator('[data-handle=right][data-for="a"]')
const rc = await center(right)
await dragTo(rc, { x: rc.x + 250, y: rc.y + 260 }, 12)
await page.getByText("Card", { exact: true }).click()
await page.waitForSelector("[data-editing] .cm-content")
await page.keyboard.type("Next step")
await page.keyboard.press("Escape")
check("an arrow let go in empty space makes a connected card there", await until((d) => { const n = d.nodes.find((x) => x.text === "Next step"); return !!n && d.edges.some((e) => e.fromNode === "a" && e.toNode === n.id) }))

// Colour from the selection's bar, Delete, undo.
await node(added.id).click()
await page.click("[data-canvas-toolbar=selection] [data-canvas-tool=Colour]"); await wait(300)
await page.getByText("Red", { exact: true }).click()
check("a colour from the bar above the card (Red = preset 1)", await until((d) => d.nodes.find((n) => n.id === added.id)?.color === "1"))
await node(added.id).click()
await page.keyboard.press("Backspace")
check("Delete removes the card and its arrows", await until((d) => !d.nodes.some((n) => n.id === added.id) && !d.edges.some((e) => e.id === edgeId)))
await page.keyboard.press("ControlOrMeta+z")
check("⌘Z brings it back", await until((d) => d.nodes.some((n) => n.id === added.id) && d.edges.some((e) => e.id === edgeId)))

// Right click > Convert to file.
await node(added.id).click({ button: "right" }); await wait(300)
await page.getByText("Convert to file", { exact: true }).click()
check("Convert to file makes a note of a text card (where new notes go)", await until((d) => { const n = d.nodes.find((x) => x.id === added.id); return n?.type === "file" && /Hello from QA/.test(n.file) && !("text" in n) }))
const made = read().nodes.find((x) => x.id === added.id).file
check(`the note has the card's text (${made})`, existsSync(`${VAULT}/${made}`) && readFileSync(`${VAULT}/${made}`, "utf8").includes("Hello from **QA**"))

// A note's card edited in place.
await node("f").dblclick({ position: { x: 100, y: 120 } })
await page.waitForSelector('[data-canvas-node="f"][data-editing] .cm-content')
await page.keyboard.press("ControlOrMeta+ArrowDown")
await page.keyboard.type("\nWritten on the canvas.")
await page.keyboard.press("Escape")
check("a note's card edits the note in place", await until((t) => t.includes("Written on the canvas."), TARGET))
await wait(300)
check("after Escape the card is selected, with its bar", await page.locator("[data-canvas-toolbar=selection]").count() === 1)

// A file dragged from the file tree.
const row = page.locator(`[data-tree-path="${TARGET}"]`).first()
if (await row.count() && await row.isVisible()) {
  const n0 = read().nodes.length
  await row.scrollIntoViewIfNeeded()
  const to = await emptyPoint()
  const from = await center(row)
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.up()
  check(`a note dragged from the file tree becomes a card (${read().nodes.length - n0} added, at ${JSON.stringify(to)})`, await until((d) => d.nodes.length === n0 + 1 && d.nodes.at(-1).file === TARGET))
} else console.log("skip a note dragged from the file tree (the tree doesn't show it)")

// A change on disk is drawn without a reload.
const onDisk = read()
onDisk.nodes.find((n) => n.id === "a").text = "Changed on disk"
writeFileSync(`${VAULT}/${BOARD}`, JSON.stringify(onDisk, null, "\t") + "\n")
const t = Date.now() / 1000 + 2
utimesSync(`${VAULT}/${BOARD}`, t, t)
await page.waitForFunction(() => document.querySelector("[data-canvas-node=a]")?.textContent?.includes("Changed on disk"), null, { timeout: 8000 })
  .then(() => check("a change made on disk is drawn", true), () => check("a change made on disk is drawn", false))

// Scrolling, zooming and panning with the space bar leave the file alone.
await wait(800)
const before = readFileSync(`${VAULT}/${BOARD}`, "utf8")
await page.mouse.move(bb.x + 100, bb.y + bb.height - 120)
await page.mouse.wheel(0, 200)
await page.keyboard.down("Control"); await page.mouse.wheel(0, -100); await page.keyboard.up("Control")
await boardEl.focus()
await page.keyboard.down(" ")
await dragTo({ x: bb.x + 100, y: bb.y + bb.height - 120 }, { x: bb.x + 300, y: bb.y + bb.height - 200 }, 6)
await page.keyboard.up(" ")
await page.click("[data-canvas-tool='Zoom in']")
await wait(800)
check("scrolling, zooming and panning don't write the file", readFileSync(`${VAULT}/${BOARD}`, "utf8") === before)
check("the space bar pans rather than selecting", !(await page.$("[data-canvas-marquee]")))

// A big board: only what's near the screen is drawn, and zoomed far out cards are names.
await page.goto(`${B}#file/${encodeURIComponent(BIG)}`)
await page.waitForSelector("[data-canvas-board=page]", { timeout: 15000 })
await wait(1500)
const drawn = () => page.evaluate(() => document.querySelectorAll("[data-canvas-board=page] [data-canvas-node]").length)
const fitDrawn = await drawn()
await page.click("[data-canvas-tool='Zoom to 100%']")
await page.waitForFunction(() => document.querySelectorAll("[data-canvas-board=page] [data-canvas-node]").length < 400, null, { timeout: 5000 }).catch(() => {})
const near = await drawn()
check(`a 1,600-card board at 100% draws only the cards near the screen (${near}; fitted ${fitDrawn})`, near < 400)
// (the main thread's work per frame: headless Chrome draws frames slowly whatever the page does)
const cdp = await page.context().newCDPSession(page)
await cdp.send("Performance.enable")
const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value])).TaskDuration
// Two passes, there and back, after the page has settled; the better one counts (other work on the machine adds noise).
await wait(1500)
const pass = async (dx, dy) => {
  const t0 = await metric()
  await page.evaluate(async ([dx, dy]) => {
    const el = document.querySelector("[data-canvas-board=page]")
    const r = el.getBoundingClientRect()
    for (let i = 0; i < 60; i++) {
      el.dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy, clientX: r.left + 200, clientY: r.top + 200, bubbles: true, cancelable: true }))
      await new Promise((res) => requestAnimationFrame(res))
    }
  }, [dx, dy])
  return (await metric() - t0) * 1000 / 60
}
const panMs = Math.min(await pass(40, 25), await pass(-40, -25))
// (3 to 11 ms here, as new cards come near the screen; restyling the whole page each frame was 15+)
check(`scrolling a big board is light work (${panMs.toFixed(1)} ms of the main thread a frame)`, panMs < 12)
await page.click("[data-canvas-tool='Zoom to fit (Shift+1)']")
await page.waitForFunction(() => !document.querySelector("[data-canvas-board=page] [data-canvas-node] .canvas-md"), null, { timeout: 4000 })
  .then(() => check("zoomed far out, cards are drawn as their names", true), () => check("zoomed far out, cards are drawn as their names", false))
await page.screenshot({ path: `${OUT}canvas-big.png` })

// Embedded in a note.
await page.goto(`${B}#file/${encodeURIComponent(NOTE)}`)
await page.waitForSelector("[data-format-embed] [data-canvas-board=embed]", { timeout: 10000 }).then(() => check("![[Board.canvas]] shows the board in a note", true), () => check("![[Board.canvas]] shows the board in a note", false))
await wait(800)
await page.screenshot({ path: `${OUT}canvas-embed.png` })

// New canvas.
await palette(page, "New canvas", 1000)
const hash = decodeURIComponent(await page.evaluate(() => location.hash))
check(`New canvas makes one and opens it (${hash})`, /\.canvas$/.test(hash) && !!(await page.$("[data-canvas-board=page]")))
noErrors()

// Phone: a tap selects and shows the bar.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const pp = await phone.newPage()
await pp.goto(`${B}#file/${encodeURIComponent(BOARD)}`)
await pp.waitForSelector("[data-canvas-board]", { timeout: 15000 })
await wait(1500)
const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
check(`no sideways scroll at 390px (${over})`, over <= 0)
await pp.click("[data-view-toggle=read]") // phones open it reading: to editing
await pp.waitForSelector("[data-view-toggle=live]", { timeout: 5000 })
await wait(500)
const pa = await pp.locator("[data-canvas-node=a]").boundingBox() // (a text card: a tap on a web page card's address opens it)
if (pa) {
  await pp.touchscreen.tap(pa.x + pa.width / 2, pa.y + pa.height / 2)
  await pp.waitForSelector("[data-canvas-toolbar=selection]", { timeout: 3000 }).then(() => check("a tap on a card selects it and shows the bar", true), () => check("a tap on a card selects it and shows the bar", false))
  const fill = await pp.evaluate(() => { const r = document.querySelector("[data-format-pane]").getBoundingClientRect(); return [r.left, r.width] })
  check(`on a phone it fills the screen edge to edge (${fill})`, fill[0] === 0 && fill[1] === 390)
}
await pp.screenshot({ path: `${OUT}canvas-phone.png` })

await browser.close()
putBackWs()
await req("DELETE", `file?path=${encodeURIComponent("Qa canvas")}`)
if (made && !made.startsWith("Qa canvas/")) await req("DELETE", `file?path=${encodeURIComponent(made)}`)
const madeCanvas = hash.replace(/^#file\//, "")
if (madeCanvas.endsWith(".canvas")) await req("DELETE", `file?path=${encodeURIComponent(madeCanvas)}`)
await done()
