// The sidebars' stacks (core/sidebars.ts, sidebars.json): the default order; panels dragged by their heading (the
// drop line, the ends, onto the right sidebar's toggle, back from a pane's view tab); scrolling per panel (the tree's
// box, Pinned's divider and its saved height) and as one scroller (Settings); folding; the menu (a panel's own items,
// Open in a tab, Panels, More, Move, Hide); the empty right sidebar; the rail. Makes a folder of notes (Qa stack/), many
// pinned. WRITES those, sidebars.json, pages.json and appearance.json's sidebarScroll (put back) and empties the
// workspaces: throwaway only.
//   node web/qa/sidebarstack.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/sidebarstack-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = (p, init) => fetch(new URL(`/api/${p}`, B), init).then((r) => r.json())
const put = async (s) => { const body = { right: [], collapsed: [], heights: {}, ...s }; await fetch(new URL("/api/config/sidebars", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const w = (await fetch(new URL("/api/workspaces", B)).then((r) => r.json())).workspaces; if (w?.[0]) await fetch(new URL("/api/workspaces/1", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sidebars: body }) }) }
const sbs = async () => { const w = (await fetch(new URL("/api/workspaces", B)).then((r) => r.json())).workspaces; return w?.[0]?.sidebars ?? await fetch(new URL("/api/config/sidebars", B)).then((r) => r.json()) }
const DEFAULT = { left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [], heights: {} }
/** sidebars.json's left or right sidebar, as compact text: "search:search|pages:pages!" (! marks a folded panel). */
const saved = async (side = "left") => { const s = await sbs(); return (s[side] ?? []).map((k) => k + ((s.collapsed ?? []).includes(k) ? "!" : "")).join("|") }

for (const n of [1, 2, 3, 4, 5]) await fetch(new URL(`/api/workspaces/${n}`, B), { method: "DELETE" })
// What it needs, whatever the vault holds: a long tree (a folder of 40 notes, opened) and more pinned pages than Pinned
// has room for by default, but not more than it could show dragged all the way down (the workspaces are empty, so
// Pinned shows pages.json's).
const STACK = Array.from({ length: 40 }, (_, i) => `Qa stack/Note ${String(i + 1).padStart(2, "0")}.md`)
for (const p of STACK) await fetch(new URL("/api/file", B), { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path: p, text: `A note for the sidebar's tree.\n` }) })
const pagesAtStart = await api("config/pages")
// 14 pinned: more than Pinned gets beside the tree in the 900px window (about ten rows, so its box scrolls), fewer than
// a 1300px one holds whole (later steps need the stack to fit).
await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pagesAtStart, pinned: [...(pagesAtStart.pinned ?? []), ...STACK.slice(0, 14)] }) })
await put(DEFAULT)
await fetch(new URL("/api/config/appearance", B), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sidebarScroll: null }) })

const page = watch(await browser.newPage({ viewport: { width: 1440, height: 900 } }))
const L = "aside[data-side=left]", R = "aside[data-side=right]"
/** A sidebar's panels, top to bottom. */
const shown = (side = "left") => page.$$eval(`aside[data-side=${side}] [data-panel]`, (els) => els.map((e) => e.dataset.panel))
const menuItems = () => page.$$eval("[role=menu] [role^=menuitem]", (els) => els.map((e) => e.textContent.trim()))
const box = async (sel) => (await page.$(sel)).boundingBox()
const mid = (b) => [b.x + b.width / 2, b.y + b.height / 2]
const panel = (k, side = "left") => `aside[data-side=${side}] [data-panel='${k}']`
const head = (k, side = "left") => `${panel(k, side)} [data-panel-handle]`
const visible = (sel) => page.$eval(sel, (e) => !!e.getClientRects().length).catch(() => false)
const clickHead = (k, side) => page.click(head(k, side), { position: { x: 12, y: 14 } })
/** The drop line's top, in the page (null: none). */
const lineY = () => page.$eval("[data-panel-line]", (e) => e.getBoundingClientRect().top).catch(() => null)
const ghost = () => page.$eval("[data-drag-ghost]", (e) => e.textContent).catch(() => "")
/** Drag from an element to (x, y); `during` looks while over the target (before the drop); `cancel`: Escape, no drop. */
async function dragTo(from, x, y, during, cancel) {
  const b = await box(from)
  await page.mouse.move(b.x + Math.min(20, b.width / 2), b.y + b.height / 2); await page.mouse.down()
  await page.mouse.move(b.x + 40, b.y + b.height / 2 + 6, { steps: 5 }); await page.mouse.move(x, y, { steps: 12 }); await wait(250)
  const seen = during ? await during() : null
  if (cancel) await page.keyboard.press("Escape")
  await page.mouse.up(); await wait(cancel ? 300 : 600)
  return seen
}
/** Where a panel starts and ends, in the page. */
const edges = async (k, side) => { const b = await box(panel(k, side)); return { top: b.y, bottom: b.y + b.height } }
const near = (a, b) => a !== null && Math.abs(a - b) <= 2.5

try {
  const file = (await api("state")).files.files.find((f) => f.path.endsWith(".md") && !f.path.startsWith("Dashboards/"))?.path
  await page.goto(`${B}#file/${encodeURIComponent(file)}`)
  await page.waitForSelector(`${L} [data-panel]`); await wait(800)
  check("the default: Search, Pinned, Terminals, Files", (await shown()).join() === DEFAULT.left.join(), await shown())
  check("...no tab strips", !(await page.$("[data-group-tabs], [data-panel-tab]")))
  check("no right sidebar, only its toggle", !(await page.$(R)) && !!(await page.$("[data-sidebar-toggle=right]")))
  const density = await page.evaluate(() => document.documentElement.dataset.density ?? "compact")
  const unit = density === "comfortable" ? 4.5 : 4
  check("the search field first: no top margin", (await page.$eval(`${L} [data-sidebar-search]`, (e) => getComputedStyle(e).marginTop)) === "0px")

  const folders = ["Qa stack", "People", "Notes", "Logs", "Projects", "Books", "Daily"]
  const openFolders = async (want) => {
    for (const f of folders) {
      const row = await page.$(`${L} [data-tree-folder][data-tree-path='${f}'] > button`)
      if (row && ((await row.getAttribute("aria-expanded")) === "true") !== want) { await row.click(); await wait(150) }
    }
    await wait(400)
  }
  const body = `${L} [data-sidebar-body]`
  // ---------- scrolling, the default: each panel in its own box (components/panelLayout.ts), dividers move room ----------
  await openFolders(true)
  /** Each panel's place, its box (the scroller) and what it draws; the sidebar's room. */
  const layoutOf = () => page.evaluate((b) => {
    const body = document.querySelector(b)
    const panels = [...body.querySelectorAll(":scope > [data-panel]")].map((w) => {
      const sc = w.querySelector(":scope > [data-panel-scroll]"), r = w.getBoundingClientRect()
      const head = sc.querySelector("[data-panel-handle]:not([data-sidebar-search])")
      return { key: w.dataset.panel, top: r.top, bottom: r.bottom, box: sc.clientHeight, content: sc.firstElementChild.getBoundingClientRect().height,
        scrolls: sc.scrollHeight > sc.clientHeight + 1, scrollTop: sc.scrollTop, head: head ? head.getBoundingClientRect().top : null }
    })
    const inner = [...body.querySelectorAll("[data-panel-scroll] *")].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
    return { mode: body.dataset.scroll, bodyScrolls: body.scrollHeight > body.clientHeight + 1, end: body.getBoundingClientRect().bottom - parseFloat(getComputedStyle(body).paddingBottom), panels, inner: inner.length }
  }, body)
  const of = (l, k) => l.panels.find((p) => p.key === k)
  /** No panel taller than what it draws (no empty room inside one). */
  const noRoomInside = (l) => l.panels.every((p) => p.box <= p.content + 1)
  let lay = await layoutOf()
  check("panels mode (the default): the sidebar doesn't scroll, the tree's box does, nothing inside a box", lay.mode === "panels" && !lay.bodyScrolls && of(lay, "files:files").scrolls && !lay.inner, lay)
  check("...no panel taller than what it draws", noRoomInside(lay), lay.panels)
  check("...the tree takes what's left: the panels reach the bottom", Math.abs(lay.panels.at(-1).bottom - lay.end) <= 2, [lay.panels.at(-1), lay.end])
  // The tree scrolled by the wheel: its heading stays where it was (its gap is outside the box).
  const fh = of(lay, "files:files")
  await page.mouse.move(120, fh.top + (fh.bottom - fh.top) * 0.6); await page.mouse.wheel(0, 300); await wait(400)
  let after = await layoutOf()
  check("wheel over the tree: its box scrolls, the sidebar doesn't", of(after, "files:files").scrollTop > 0 && !after.bodyScrolls, of(after, "files:files"))
  check("...its heading stays put", Math.abs(of(after, "files:files").head - fh.head) < 0.5, [fh.head, of(after, "files:files").head])
  await page.$eval(`${panel("files:files")} [data-panel-scroll]`, (e) => { e.scrollTop = 0 })
  // A sidebar of a fractional height (838.5px reads 839 as clientHeight): the panels fit its real height, never half a
  // pixel past its bottom, and the sidebar doesn't scroll (an outer scrollbar for a stray pixel).
  const vp = page.viewportSize()
  await page.setViewportSize({ width: vp.width, height: vp.height - 1 })
  await page.evaluate(() => { document.querySelector("aside[data-side=left]").style.paddingBottom = "0.5px" }); await wait(500)
  const half = await page.evaluate((b) => { const e = document.querySelector(b); const r = e.getBoundingClientRect(); return { h: r.height, bottom: r.bottom - parseFloat(getComputedStyle(e).paddingBottom), last: e.lastElementChild.getBoundingClientRect().bottom, overflow: getComputedStyle(e).overflowY, marked: e.hasAttribute("data-overflow") } }, body)
  check("a fractional height: the panels end inside it, the sidebar doesn't scroll", half.h % 1 !== 0 && half.last <= half.bottom + 0.01 && half.overflow === "hidden" && !half.marked, half)
  await page.evaluate(() => { document.querySelector("aside[data-side=left]").style.paddingBottom = "" })
  await page.setViewportSize(vp); await wait(500)
  // Pinned (the vault's many pages) doesn't fit: its box scrolls; its divider moves room between it and the tree.
  const pin0 = of(lay, "pages:pages")
  check("Pinned with many pages: shorter than what it draws, its box scrolls", pin0.scrolls && pin0.box + 4 < pin0.content, pin0)
  const divider = `${L} [role=separator][aria-label="Resize Pinned pages"]`
  const dragDivider = async (dy) => {
    const db = await box(divider)
    await page.mouse.move(db.x + 60, db.y + db.height / 2); await page.mouse.down()
    await page.mouse.move(db.x + 60, db.y + db.height / 2 + dy, { steps: 8 }); await page.mouse.up(); await wait(700)
  }
  await dragDivider(40)
  after = await layoutOf()
  let hs = await sbs()
  check("its divider dragged down 40px: Pinned 40px taller, the tree 40px shorter", Math.abs(of(after, "pages:pages").box - pin0.box - 40) <= 3 &&
    Math.abs(of(lay, "files:files").box - of(after, "files:files").box - 40) <= 3, [pin0.box, of(after, "pages:pages").box, of(lay, "files:files").box, of(after, "files:files").box])
  check("...saved for Pinned only (the tree still takes what's left)", Math.abs(hs.heights?.["pages:pages"] - (of(after, "pages:pages").bottom - of(after, "pages:pages").top)) <= 2 && !("files:files" in hs.heights), hs.heights)
  await dragDivider(2000)
  after = await layoutOf()
  check("dragged far down: Pinned only as tall as what it draws (no empty room)", Math.abs(of(after, "pages:pages").box - of(after, "pages:pages").content) <= 1 && noRoomInside(after) && !of(after, "pages:pages").scrolls, of(after, "pages:pages"))
  check("...the panels still reach the bottom", Math.abs(after.panels.at(-1).bottom - after.end) <= 2, [after.panels.at(-1), after.end])
  await dragDivider(-2000)
  after = await layoutOf()
  check("dragged far up: Pinned keeps a few rows (four rows' height), the tree grows", of(after, "pages:pages").box >= 100 && of(after, "pages:pages").box < 140 && of(after, "files:files").box > of(lay, "files:files").box, [of(after, "pages:pages").box, of(after, "files:files").box])
  await page.dblclick(divider); await wait(700)
  check("double-click: fitted to its content again (no height saved)", !("pages:pages" in ((await sbs()).heights ?? {})), await sbs())
  after = await layoutOf()
  check("...and laid out as before", Math.abs(of(after, "pages:pages").box - pin0.box) <= 1, [pin0.box, of(after, "pages:pages").box])
  check("no divider under the last panel", !(await page.$(`${L} [role=separator][aria-label="Resize File explorer"]`)))
  // Heights saved before (or on a bigger screen) that would leave empty room are drawn no taller than what they draw.
  await put({ ...DEFAULT, heights: { "pages:pages": 3000, "terminal:sessions": 900 } })
  await wait(900)
  after = await layoutOf()
  check("old heights taller than what panels draw: clamped, no empty room inside", noRoomInside(after) && Math.abs(after.panels.at(-1).bottom - after.end) <= 2, after.panels)
  await put(DEFAULT); await wait(600)
  // Folding a panel and opening it again moves only the panels below it, and comes back to the same place.
  lay = await layoutOf()
  await clickHead("pages:pages"); await wait(500)
  after = await layoutOf()
  check("Pinned folded: the panels above it don't move, the tree grows by what it gave", of(after, "search:search").bottom === of(lay, "search:search").bottom &&
    Math.abs((of(after, "files:files").box - of(lay, "files:files").box) - (of(lay, "pages:pages").bottom - of(lay, "pages:pages").top - (of(after, "pages:pages").bottom - of(after, "pages:pages").top))) <= 1, [lay.panels, after.panels])
  await clickHead("pages:pages"); await wait(500)
  after = await layoutOf()
  check("...opened again: every panel where it was", after.panels.every((p, i) => Math.abs(p.top - lay.panels[i].top) <= 1 && Math.abs(p.bottom - lay.panels[i].bottom) <= 1), [lay.panels, after.panels])
  // The user's sidebar: one pinned page, one terminal row, a long tree: Pinned and Terminals whole, the tree the rest.
  const pinsBefore = await api("config/pages")
  await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pinsBefore, pinned: [pinsBefore.pinned?.[0] ?? "Dashboards/Today.md"] }) })
  await until(async () => (await page.$$(`${panel("pages:pages")} [data-pin]`)).length === 1); await wait(500)
  after = await layoutOf()
  check("one pinned page: Pinned as tall as what it draws, not cut", !of(after, "pages:pages").scrolls && Math.abs(of(after, "pages:pages").box - of(after, "pages:pages").content) <= 1, of(after, "pages:pages"))
  check("...Terminals too", !of(after, "terminal:sessions").scrolls, of(after, "terminal:sessions"))
  check("...the tree takes the rest", of(after, "files:files").scrolls && Math.abs(after.panels.at(-1).bottom - after.end) <= 2, [of(after, "files:files"), after.end])
  await page.screenshot({ path: `${OUT}1-small-panels.png`, clip: { x: 0, y: 0, width: 320, height: 900 } })
  await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pinsBefore) })
  // Many panels: each its own box, never a box inside a box.
  await put({ left: ["search:search", "activity:feed", "backlinks:links", "outline:outline", "tags:tags", "pages:pages", "terminal:sessions", "files:files", "graph:local"] })
  await until(async () => (await shown()).length === 9); await wait(800)
  lay = await layoutOf()
  check("nine panels, panels mode: no scroller inside a panel's box, none taller than what it draws", !lay.inner && noRoomInside(lay), lay)
  await page.screenshot({ path: `${OUT}1-panels.png` })
  await put(DEFAULT)
  await until(async () => (await shown()).join() === DEFAULT.left.join())
  // Settings > Appearance switches to one scroller (appearance.json `sidebarScroll`); the sidebar's menu doesn't have it.
  await page.click(head("pages:pages"), { button: "right" }); await wait(250)
  check("the sidebar's menu has no scroll setting", !(await menuItems()).some((t) => /scroll/i.test(t)), await menuItems())
  await page.keyboard.press("Escape")
  await page.evaluate(() => { location.hash = "settings" }); await wait(800)
  await page.click('[aria-label="Scroll sidebar panels separately"]'); await wait(600)
  check("Settings' switch: sidebarScroll is sidebar", (await api("config/appearance")).sidebarScroll === "sidebar", await api("config/appearance"))
  check("...and no dividers then", !(await page.$(`${L} [role=separator]`)))
  await page.goBack(); await wait(500)

  // ---------- scrolling as one (sidebarScroll: sidebar): a long file tree, the sidebar the one scroller ----------
  await openFolders(true)
  const geo = () => page.evaluate((b) => {
    const body = document.querySelector(b)
    const inner = [...body.querySelectorAll("*")].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4)
    return { overflow: getComputedStyle(body).overflowY, scrolls: body.scrollHeight > body.clientHeight + 4, scrollTop: body.scrollTop, inner: inner.map((e) => e.className.slice(0, 60)) }
  }, body)
  let g = await geo()
  check("a long tree: the sidebar body scrolls", g.overflow === "auto" && g.scrolls, g)
  check("...and nothing in it scrolls itself", !g.inner.length, g)
  const tb = await box(panel("files:files"))
  await page.mouse.move(tb.x + tb.width / 2, 600); await page.mouse.wheel(0, 600); await wait(400)
  g = await geo()
  check("wheel over the tree: the sidebar scrolls", g.scrollTop > 0, g)
  await page.$eval(body, (e) => { e.scrollTop = 0 }); await wait(200)
  // Held near the bottom edge, a dragged panel scrolls the sidebar; let go there, it's last.
  const sb0 = await box(body)
  const held = await dragTo(head("terminal:sessions"), sb0.x + 100, sb0.y + sb0.height - 6, async () => { await until(() => page.$eval(body, (e) => e.scrollTop >= e.scrollHeight - e.clientHeight - 1), 9000); return page.$eval(body, (e) => e.scrollTop) })
  check("a panel held at the sidebar's bottom edge scrolls it", held > 0, held)
  check("...and dropped there it's last", !!(await until(async () => (await saved()) === "search:search|pages:pages|files:files|terminal:sessions")), await saved())
  // Many panels shown at once: still one scrollbar (Activity, Links, Outline and Tags don't scroll themselves).
  await put({ left: ["search:search", "activity:feed", "backlinks:links", "outline:outline", "tags:tags", "pages:pages", "terminal:sessions", "files:files", "graph:local"] })
  await until(async () => (await shown()).length === 9)
  await wait(800)
  g = await geo()
  check("nine panels: one scroller, none inside", g.scrolls && !g.inner.length, g)
  const graph = await page.$eval(`${panel("graph:local")} [data-local-graph-panel] > div:last-child`, (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }).catch(() => null)
  check("the local graph is a square (or says there's no file)", !graph || Math.abs(graph[0] - graph[1]) <= 2, graph)
  await page.screenshot({ path: `${OUT}1-many.png` })
  await put(DEFAULT)
  await until(async () => (await shown()).join() === DEFAULT.left.join())
  await openFolders(false)
  await page.$eval(body, (e) => { e.scrollTop = 0 })

  // ---------- reorder: down ----------
  let f = await edges("files:files")
  let seen = await dragTo(head("pages:pages"), 120, f.top + 4, async () => ({ y: await lineY(), at: f.top }))
  check("Pinned dragged down (into the gap above Files): a line at that gap", near(seen.y, seen.at - 1), seen)
  check("dropped: under Terminals", !!(await until(async () => (await saved()) === "search:search|terminal:sessions|pages:pages|files:files")), await saved())
  check("...drawn so", (await shown()).join() === "search:search,terminal:sessions,pages:pages,files:files", await shown())

  // ---------- reorder: up ----------
  const t = await edges("terminal:sessions")
  seen = await dragTo(head("files:files"), 120, t.top + 3, async () => { await page.screenshot({ path: `${OUT}2-line.png` }); return { y: await lineY(), at: t.top } })
  check("Files dragged up (into the gap above Terminals): a line at that gap", near(seen.y, seen.at - 1), seen)
  check("dropped: under Search", !!(await until(async () => (await saved()) === "search:search|files:files|terminal:sessions|pages:pages")), await saved())

  // ---------- its own place: no line ----------
  const p = await edges("terminal:sessions")
  seen = await dragTo(head("terminal:sessions"), 120, p.top + 2, async () => ({ above: await lineY() }), true)
  check("over its own top gap: no line", seen.above === null, seen)
  seen = await dragTo(head("terminal:sessions"), 120, p.bottom - 2, async () => ({ below: await lineY() }), true)
  check("...nor its bottom one", seen.below === null, seen)
  check("...and nothing moved", (await saved()) === "search:search|files:files|terminal:sessions|pages:pages", await saved())

  // ---------- the nearest gap ----------
  // The geometry below wants the whole stack on screen: the tree's folders closed, a taller window, scrolled to the top.
  if (await page.$(`${L} [aria-label="Collapse all"]`)) await page.click(`${L} [aria-label="Collapse all"]`, { force: true })
  await page.setViewportSize({ width: 1440, height: 1300 }); await wait(400)
  await page.$eval(body, (e) => { e.scrollTop = 0 })
  check("...the whole stack fits now", await page.$eval(body, (e) => e.scrollHeight <= e.clientHeight + 1))
  // Over Files (tall: the tree), a third of the way down: the gap above it; two thirds: the gap below it.
  f = await edges("files:files")
  seen = await dragTo(head("pages:pages"), 120, f.top + (f.bottom - f.top) / 3, async () => ({ y: await lineY(), at: f.top }), true)
  check("a third into Files: the line above it", near(seen.y, seen.at - 1), seen)
  seen = await dragTo(head("pages:pages"), 120, f.top + (f.bottom - f.top) * 2 / 3, async () => ({ y: await lineY(), at: f.bottom }), true)
  check("two thirds into Files: the line below it", near(seen.y, seen.at - 1), seen)
  check("...Escape: nothing moved", (await saved()) === "search:search|files:files|terminal:sessions|pages:pages", await saved())

  // ---------- the very top ----------
  const s = await edges("search:search")
  seen = await dragTo(head("pages:pages"), 120, s.top + 1, async () => ({ y: await lineY(), at: s.top }))
  check("dragged to the very top: a line above Search", seen.y !== null && seen.y <= seen.at + 1, seen)
  check("dropped: first", !!(await until(async () => (await saved()) === "pages:pages|search:search|files:files|terminal:sessions")), await saved())
  check("the search field second: an 8px top margin (2 units)", (await page.$eval(`${L} [data-sidebar-search]`, (e) => parseFloat(getComputedStyle(e).marginTop))) === 2 * unit,
    await page.$eval(`${L} [data-sidebar-search]`, (e) => getComputedStyle(e).marginTop))

  // ---------- folding, and the empty space below the last panel ----------
  await clickHead("files:files")
  check("a heading clicked: Files folds to it", !!(await until(async () => !!(await page.$(`${panel("files:files")}[data-collapsed]`)) && !(await visible(`${panel("files:files")} [role=tree]`)))))
  check("...saved as collapsed", !!(await until(async () => (await saved()) === "pages:pages|search:search|files:files!|terminal:sessions")), await saved())
  const bb = await box(body), lastEnd = (await edges("terminal:sessions")).bottom
  check("...the room below the stack is empty", bb.y + bb.height - lastEnd > 200, [bb, lastEnd])
  seen = await dragTo(head("pages:pages"), 120, bb.y + bb.height - 40, async () => ({ y: await lineY(), at: lastEnd }))
  check("over the empty space below: the line under the last panel", near(seen.y, seen.at - 1), seen)
  check("dropped: the last", !!(await until(async () => (await saved()) === "search:search|files:files!|terminal:sessions|pages:pages")), await saved())
  await page.screenshot({ path: `${OUT}3-folded.png` })
  await clickHead("files:files")
  check("clicked again: open", !!(await until(async () => (await saved()) === "search:search|files:files|terminal:sessions|pages:pages")) && (await visible(`${panel("files:files")} [role=tree]`)), await saved())

  // ---------- the right sidebar's toggle ----------
  await clickHead("terminal:sessions")
  await until(async () => (await saved()).includes("terminal:sessions!"))
  const rt = await box("[data-sidebar-toggle=right]")
  seen = await dragTo(head("terminal:sessions"), ...mid(rt), async () => ({ hint: await ghost(), lit: await page.$eval("[data-sidebar-toggle=right]", (e) => e.className.includes("ring-primary")) }))
  check("over the right toggle: lit, 'To the right sidebar'", seen.lit && seen.hint.includes("To the right sidebar"), seen)
  check("dropped: Terminals in the right sidebar, unfolded, the sidebar open", !!(await until(async () => (await shown("right")).join() === "terminal:sessions")) &&
    !(await page.$(`${R}[data-collapsed]`)) && !(await page.$(`${panel("terminal:sessions", "right")}[data-collapsed]`)), await shown("right"))
  check("...saved", (await saved("right")) === "terminal:sessions" && (await saved()) === "search:search|files:files|pages:pages", [await saved(), await saved("right")])
  // Fold the right sidebar to its rail, then Pinned onto its toggle: the end there, and the sidebar opens.
  await page.click("[data-sidebar-toggle=right]"); await wait(400)
  check("the right sidebar folded to its rail", !!(await page.$(`${R}[data-collapsed]`)))
  await dragTo(head("pages:pages"), ...mid(await box("[data-sidebar-toggle=right]")))
  check("Pinned onto the folded right's toggle: last there, and it opens", !!(await until(async () => (await saved("right")) === "terminal:sessions|pages:pages")) &&
    !!(await until(async () => !(await page.$(`${R}[data-collapsed]`)) && (await shown("right")).join() === "terminal:sessions,pages:pages")), [await saved("right"), await shown("right")])

  // ---------- the menu ----------
  await page.click(head("files:files"), { button: "right" })
  let items = await menuItems()
  check("a left panel's menu: Open in a tab, Panels, Move to right sidebar, Hide", ["Open File explorer in a tab", "Panels", "Move to right sidebar", "Hide File explorer"].every((x) => items.includes(x)) && !items.includes("Separate from tabs"), items)
  await page.keyboard.press("Escape")
  await page.click(head("terminal:sessions", "right"), { button: "right" })
  items = await menuItems()
  check("a right panel's menu: Move to left sidebar", items.includes("Open Terminals in a tab") && items.includes("Move to left sidebar") && items.includes("Hide Terminals"), items)
  await page.keyboard.press("Escape"); await clickHead("pages:pages", "right")
  await until(async () => (await saved("right")).includes("pages:pages!"))
  await page.click(head("pages:pages", "right"), { button: "right" })
  await page.getByRole("menuitem", { name: "Move to left sidebar" }).click()
  check("Pinned folded, then Move to left sidebar: the end there, unfolded", !!(await until(async () => (await saved()) === "search:search|files:files|pages:pages" && (await saved("right")) === "terminal:sessions")), [await saved(), await saved("right")])

  // ---------- the sidebar's menu: its panels ticked, the rest in More ▸ ----------
  const ticked = () => page.$$eval("[role=menuitemcheckbox]", (els) => els.map((e) => `${e.textContent.trim()}:${e.getAttribute("aria-checked")}`))
  // Escape closes a submenu first, then the menu.
  const closeMenus = async () => { while (await page.$("[role=menu]")) { await page.keyboard.press("Escape"); await wait(100) } }
  const fromMore = async (name) => {
    await page.locator("[role=menu]").first().locator(":scope > button", { hasText: /^More$/ }).hover(); await wait(300)
    const more = (await page.locator("[role=menu]").nth(1).locator("button").allInnerTexts()).map((t) => t.replace(/\s+/g, ""))
    await page.locator("[role=menu]").nth(1).locator("button", { hasText: name }).click()
    return more
  }
  await page.click(`${L} [data-titlebar]`, { button: "right" })
  items = await ticked()
  check("the left's menu: its panels, ticked, in order (no hidden or other sidebar's)", items.join() === "Search field:true,File explorer:true,Pinned pages:true", items)
  // Unticked: hidden, its row stays (unticked); ticked again: back in its place.
  await page.locator("[role=menuitemcheckbox]", { hasText: "File explorer" }).click()
  check("unticked: hidden, its row still there", !!(await until(async () => (await saved()) === "search:search|pages:pages")) && (await ticked()).join() === "Search field:true,File explorer:false,Pinned pages:true", [await saved(), await ticked()])
  await page.locator("[role=menuitemcheckbox]", { hasText: "File explorer" }).click()
  check("ticked again: back where it was", !!(await until(async () => (await saved()) === "search:search|files:files|pages:pages")), await saved())
  const more = await fromMore("Outline")
  check("More ▸: the hidden ones, then the right one's labelled", more.includes("Outline") && more.at(-1) === "TerminalsRightsidebar", more)
  check("a hidden one picked from More: the end of the left, the menu left open", !!(await until(async () => (await saved()) === "search:search|files:files|pages:pages|outline:outline")) && !!(await page.$("[role=menu]")), await saved())
  await closeMenus()
  await page.click(`${L} [data-titlebar]`, { button: "right" })
  await fromMore("Terminals")
  check("the right's picked here: moved to the end of the left", !!(await until(async () => (await saved()) === "search:search|files:files|pages:pages|outline:outline|terminal:sessions" && !(await saved("right")))), [await saved(), await saved("right")])
  await closeMenus()
  await page.click(`${L} [data-titlebar]`, { button: "right" })
  await page.locator("[role=menuitemcheckbox]", { hasText: "Outline" }).click()
  check("unticked: hidden (in neither sidebar)", !!(await until(async () => !(await saved()).includes("outline") && !(await shown()).includes("outline:outline"))), await saved())
  await page.keyboard.press("Escape")
  await page.click(`${L} [data-titlebar]`, { button: "right" })
  check("opened again: it's under More, not in the list", !(await ticked()).some((x) => x.startsWith("Outline")), await ticked())
  await page.keyboard.press("Escape")
  await page.click(head("pages:pages"), { button: "right" })
  await page.getByRole("menuitem", { name: "Hide Pinned pages" }).click()
  check("Hide: out of the sidebar and of sidebars.json", !!(await until(async () => (await saved()) === "search:search|files:files|terminal:sessions")) && !(await shown()).includes("pages:pages"), await saved())
  check("the right sidebar empty: gone", !!(await until(async () => !(await page.$(R)))))

  // ---------- a panel's own items (its `menu`): the File explorer's Show / Hide hidden files, on top ----------
  const dotRow = `${panel("files:files")} [data-tree-path='.vaultite']`
  await page.click(head("files:files"), { button: "right" })
  check("File explorer's menu: Show hidden files on top", (await menuItems())[0] === "Show hidden files", await menuItems())
  await page.getByRole("menuitem", { name: "Show hidden files" }).click()
  check("...shows .vaultite in the tree", !!(await until(() => page.$(dotRow))))
  await page.click(head("files:files"), { button: "right" })
  check("...then the menu says Hide hidden files", (await menuItems())[0] === "Hide hidden files", await menuItems())
  await page.getByRole("menuitem", { name: "Hide hidden files" }).click()
  check("...which hides them again", !!(await until(async () => !(await page.$(dotRow)))))

  // ---------- a pane's view tab back into a sidebar ----------
  await page.click(head("files:files"), { button: "right" })
  await page.getByRole("menuitem", { name: "Open File explorer in a tab" }).click()
  check("Open File explorer in a tab: a Files tab", !!(await until(() => page.evaluate(() => location.hash === "#view/files"))), await page.evaluate(() => location.hash))
  const paneTab = (await page.$$("section[data-group] [data-tab-id]")).at(-1)
  const tabSel = `[data-tab-id='${await paneTab.getAttribute("data-tab-id")}']`
  // Into the left sidebar, the gap above Terminals.
  const tt = await edges("terminal:sessions")
  const back = await dragTo(tabSel, 120, tt.top + 3, async () => ({ y: await lineY(), at: tt.top, hint: await ghost() }))
  check("over the sidebar: a line at the gap, 'To the left sidebar'", near(back.y, back.at - 1) && back.hint.includes("To the left sidebar"), back)
  check("dropped: Files moved there", !!(await until(async () => (await saved()) === "search:search|files:files|terminal:sessions")), await saved())
  check("...and its tab closes", !!(await until(async () => !(await page.$(tabSel)))))
  // From the right sidebar: Files there, its tab dragged into the left's empty space below.
  await page.click(head("files:files"), { button: "right" })
  await page.getByRole("menuitem", { name: "Move to right sidebar" }).click()
  await until(async () => (await saved("right")) === "files:files")
  await page.click(head("files:files", "right"), { button: "right" })
  await page.getByRole("menuitem", { name: "Open File explorer in a tab" }).click()
  await until(() => page.evaluate(() => location.hash === "#view/files"))
  const tab2 = `[data-tab-id='${await (await page.$$("section[data-group] [data-tab-id]")).at(-1).getAttribute("data-tab-id")}']`
  const lb = await box(body)
  await dragTo(tab2, 120, lb.y + lb.height - 40)
  check("the right one's tab into the left's empty space: the end of the left", !!(await until(async () => (await saved()) === "search:search|terminal:sessions|files:files" && !(await saved("right")))), [await saved(), await saved("right")])
  check("...its tab closes", !!(await until(async () => !(await page.$(tab2)))))

  // ---------- the empty right sidebar ----------
  check("nothing on the right: no right sidebar", !!(await until(async () => !(await page.$(R)))))
  await page.click("[data-sidebar-toggle=right]")
  check("its toggle clicked: open, empty, 'Drag panels here'", !!(await until(() => page.$(`${R} [data-stack-empty]`))) && (await page.textContent(`${R} [data-stack-empty]`)).includes("Drag panels here"))
  await page.screenshot({ path: `${OUT}4-empty-right.png` })
  await page.click("[data-sidebar-toggle=right]")
  await until(async () => !(await page.$(R)))

  // ---------- the rail: every panel's icons ----------
  await put({ left: ["search:search", "pages:pages", "terminal:sessions", "outline:outline", "files:files"], collapsed: ["pages:pages", "outline:outline"] })
  await until(async () => (await shown()).length === 5)
  await page.click("[data-sidebar-toggle='']"); await wait(500)
  const rail = await shown()
  check("the rail: every panel, folded or not, in order", rail.join() === "search:search,pages:pages,terminal:sessions,outline:outline,files:files", rail)
  check("...folded Pinned still shows its icons", await visible(`${L} [data-panel='pages:pages'] [data-pin]`))
  check("...no headings", !(await page.$(`${L} [data-panel-handle]`)))
  await page.screenshot({ path: `${OUT}5-rail.png` })
  await page.click("[data-sidebar-toggle='']"); await wait(400)
} catch (e) {
  check(String(e), false)
}
await browser.close()
await put(DEFAULT)
await fetch(new URL("/api/config/pages", B), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pagesAtStart) })
await fetch(new URL("/api/config/appearance", B), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sidebarScroll: null }) })
await done()
