// Chrome isn't text, content is (index.css): walks the main surfaces at desktop and phone sizes, in Chromium and in
// WebKit (iOS), and fails on chrome that selects or calls out, on drags and double-clicks that select, and on content
// that doesn't. Opens files, never writes one; throwaway server only:
//   node web/qa/textselect.mjs <base url>
import { command, qa, wait, webkitLaunch } from "./lib/qa.mjs"
import { subjects } from "./subjects.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const v = await subjects(B)
const note = v.need(v.linked, "a note that links to another note and to a person").note.id

// What selects in `sel` though it's chrome: visible elements with text of their own, outside content (fields, editors,
// rendered Markdown, code, what opts in), or that calls out where the engine has callouts (iOS).
const CONTENT = "input, textarea, [contenteditable]:not([contenteditable=false]), .cm-editor, .note-prose, .genui-block, pre, code, samp, .select-text"
const leaks = (page, sel) => page.evaluate(([sel, CONTENT]) => {
  const out = []
  let seen = 0
  for (const root of document.querySelectorAll(sel)) for (const el of [root, ...root.querySelectorAll("*")]) {
    const c = el.closest(CONTENT)
    if (!el.getClientRects().length || (c && root.contains(c)) || el.closest("[inert]")) continue
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    seen++
    const st = getComputedStyle(el), us = st.webkitUserSelect || st.userSelect, co = st.webkitTouchCallout
    if (us !== "none" || (co && co !== "none")) out.push(`${us}/${co ?? "-"} ${el.outerHTML.slice(0, 140)}`)
  }
  // (none seen: the walk missed what it's for, not a pass)
  return seen ? out : ["no text found"]
}, [sel, CONTENT])
const selectsAs = (page, sel) => page.evaluate((sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length); if (!el) return null; const st = getComputedStyle(el); return st.webkitUserSelect || st.userSelect }, sel)
const selection = (page) => page.evaluate(() => getSelection().toString())
const clear = (page) => page.evaluate(() => getSelection().removeAllRanges())
/** A text node's middle in `sel` (the first shown one with a letter or digit: a fresh vault's status bar holds only "0/4"): where a press lands on text, not padding. */
const textAt = (page, sel) => page.evaluate((sel) => {
  for (const root of document.querySelectorAll(sel)) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!/\w/.test(n.textContent)) continue
      const r = document.createRange(); r.selectNodeContents(n)
      const b = r.getBoundingClientRect()
      if (b.width < 8 || !b.height || b.bottom > innerHeight || b.right > innerWidth) continue
      const x = b.left + Math.min(b.width / 2, 30), y = b.top + b.height / 2
      if (root.contains(document.elementFromPoint(x, y))) return { x, y }
    }
  }
  return null
}, sel)
/** Press at `a`, move to `b` in steps (each a point or a selector's text), let go: the drag-select a mouse does. */
const sweep = async (page, ...stops) => {
  const pts = []
  for (const s of stops) pts.push(typeof s === "string" ? await textAt(page, s) : s)
  if (pts.some((p) => !p)) return null
  await page.mouse.move(pts[0].x, pts[0].y)
  await page.mouse.down()
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 8 })
  await page.mouse.up()
  await wait(150)
  return selection(page)
}

const desktop = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
await desktop.goto(`${B}#file/${enc(`${note}.md`)}`)
await desktop.waitForSelector(".cm-content", { timeout: 30000 })
await desktop.waitForSelector("aside[data-side=left] [data-panel]")
await command(desktop, "Show right sidebar", 800)

// Every bar and sidebar: nothing in them selects.
for (const s of ["aside[data-side=left]", "aside[data-side=right]", "[data-tab-bar]", "[data-status-bar]", "[data-title-row]"]) {
  const l = await leaks(desktop, s)
  check(`desktop: nothing in ${s} selects`, !l.length, l)
}
check("desktop: a note's text selects", await selectsAs(desktop, ".cm-content") === "text", await selectsAs(desktop, ".cm-content"))

// Drag-selecting over chrome: nothing.
await clear(desktop)
check("desktop: sweeping from the status bar over the sidebar selects nothing", await sweep(desktop, "[data-status-bar]", "aside[data-side=left] [data-panel]", "[data-tab-bar]") === "", await selection(desktop))
await clear(desktop)
check("desktop: sweeping from the tab bar into the sidebar selects nothing", await sweep(desktop, "[data-tab-bar] [role=tab]", "aside[data-side=left] [data-panel]") === "", await selection(desktop))

// Double-clicks on chrome select no words.
for (const s of ["aside[data-side=left] [data-panel]", "[data-tab-bar] [role=tab]", "[data-status-bar]"]) {
  await clear(desktop)
  const p = await textAt(desktop, s)
  if (!p) { check(`desktop: ${s} has text to double-click`, false); continue }
  await desktop.mouse.dblclick(p.x, p.y)
  await wait(200)
  const got = await selection(desktop)
  await desktop.keyboard.press("Escape")
  check(`desktop: double-clicking ${s} selects no word`, got === "", got)
}

// Content still selects: a word double-clicked in the note.
await clear(desktop)
const word = await textAt(desktop, ".cm-content .cm-line")
await desktop.mouse.dblclick(word.x, word.y)
await wait(200)
const picked = await selection(desktop)
check("desktop: double-clicking a word in a note selects it", /\w/.test(picked), picked)

// A splitter dragged across the note: the selection made before stays as it was, and nothing selects meanwhile.
const sep = desktop.locator("[role=separator]").first()
const sb = await sep.boundingBox()
if (sb) {
  await desktop.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2)
  await desktop.mouse.down()
  await desktop.mouse.move(sb.x + 60, sb.y + sb.height / 2 + 40, { steps: 6 })
  const during = await desktop.evaluate(() => ({ captured: document.documentElement.hasAttribute("data-captured"), us: getComputedStyle(document.querySelector(".cm-content")).userSelect }))
  await desktop.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2, { steps: 6 })
  await desktop.mouse.up()
  await wait(150)
  check("desktop: while a splitter is dragged, nothing selects, the note neither", during.captured && during.us === "none", during)
  check("desktop: a splitter's drag leaves the selection as it was", await selection(desktop) === picked, await selection(desktop))
  check("desktop: let go, the note selects again", await desktop.evaluate(() => !document.documentElement.hasAttribute("data-captured") && getComputedStyle(document.querySelector(".cm-content")).userSelect === "text"))
} else check("desktop: a splitter is drawn", false)

// A file dragged from the sidebar over the note and called off: nothing selected, nothing dropped.
await clear(desktop)
const row = await textAt(desktop, "aside[data-side=left] [data-panel] a[href^='#file/']")
const into = await textAt(desktop, ".cm-content .cm-line")
if (row && into) {
  await desktop.mouse.move(row.x, row.y)
  await desktop.mouse.down()
  await desktop.mouse.move(into.x, into.y + 30, { steps: 10 })
  const during = await desktop.evaluate(() => ({ dragging: document.documentElement.hasAttribute("data-dragging"), us: getComputedStyle(document.querySelector(".cm-content")).userSelect, sel: getSelection().toString() }))
  await desktop.keyboard.press("Escape")
  await desktop.mouse.up()
  await wait(200)
  check("desktop: dragging a file over a note selects nothing", during.dragging && during.us === "none" && !during.sel && await selection(desktop) === "", during)
} else check("desktop: a file row and a note to drag it over", false, { row, into })

// A tab dragged along the bar: nothing selected.
await clear(desktop)
const tab = await textAt(desktop, "[data-tab-bar] [role=tab]")
if (tab) {
  await desktop.mouse.move(tab.x, tab.y)
  await desktop.mouse.down()
  await desktop.mouse.move(tab.x + 120, tab.y + 4, { steps: 10 })
  await desktop.mouse.move(tab.x - 300, tab.y + 200, { steps: 10 })
  const sel = await selection(desktop)
  await desktop.keyboard.press("Escape")
  await desktop.mouse.up()
  check("desktop: dragging a tab selects nothing", sel === "" && await selection(desktop) === "", sel)
}

// Menus, the palette, Settings: chrome too.
await desktop.locator("[data-tab-bar] [role=tab]").first().click({ button: "right" })
await desktop.waitForSelector("[role=menu]")
check("desktop: nothing in a menu selects", !(await leaks(desktop, "[role=menu]")).length, await leaks(desktop, "[role=menu]"))
await desktop.keyboard.press("Escape")
await desktop.keyboard.press(process.platform === "darwin" ? "Meta+p" : "Control+p")
await desktop.waitForSelector("[role=listbox]", { timeout: 5000 }).catch(() => {})
check("desktop: nothing in the palette's rows selects", !(await leaks(desktop, "[role=listbox]")).length, await leaks(desktop, "[role=listbox]"))
check("desktop: the palette's field selects", await selectsAs(desktop, "[role=dialog] input, [role=combobox]") === "text", await selectsAs(desktop, "[role=dialog] input, [role=combobox]"))
await desktop.keyboard.press("Escape")
// Pages: their chrome (rows, cards, labels, empty states) doesn't select, their Markdown does.
const dashboards = v.tree.files.filter((f) => f.type === "dashboard").map((f) => [f.path, `file/${enc(f.path)}`])
for (const [name, at] of [["Settings", "view/settings"], ["the inbox", "view/inbox"], ...dashboards]) {
  await desktop.goto("about:blank"); await desktop.goto(`${B}#${at}`)
  await desktop.waitForSelector("[data-pane] [data-page], [data-pane] h1, [data-pane] h2", { timeout: 15000 }).catch(() => {})
  await wait(1200)
  const l = await leaks(desktop, "[data-pane]")
  check(`desktop: nothing in ${name} selects but its content`, !l.length, l)
  const md = await selectsAs(desktop, "[data-pane] .note-prose")
  if (md) check(`desktop: ${name}'s Markdown selects`, md === "text", md)
}

// A view in a note (a ```block-): chrome inside the editor's text.
const project = v.tree.files.find((f) => f.type === "project")?.path
if (project) {
  await desktop.goto("about:blank"); await desktop.goto(`${B}#file/${enc(project)}`)
  const drawn = await desktop.waitForSelector(".cm-block[data-chrome]", { timeout: 15000 }).catch(() => null)
  check("desktop: a view in a note is chrome", !!drawn)
  await wait(800)
  if (drawn) { const l = await leaks(desktop, ".cm-block[data-chrome]"); check("desktop: nothing in a note's view selects but its content", !l.length, l) }
}

// The phone: bars, the drawer and the tab switcher, in Chromium's touch emulation.
const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }))
const phoneChecks = async (page, engine) => {
  await page.goto(`${B}#file/${enc(`${note}.md`)}`)
  await page.waitForSelector("[data-phone-bar]", { timeout: 30000 })
  await page.waitForSelector(".cm-content", { timeout: 15000 })
  await wait(800)
  for (const s of ["[data-phone-bar]", "[data-phone-header]"]) check(`${engine} phone: nothing in ${s} selects or calls out`, !(await leaks(page, s)).length, await leaks(page, s))
  check(`${engine} phone: a note's text selects`, await selectsAs(page, ".cm-content") === "text", await selectsAs(page, ".cm-content"))
  await page.locator("[data-phone-header] button").first().tap()
  await page.waitForSelector("[data-phone-drawer]:not([aria-hidden=true])", { timeout: 5000 }).catch(() => {})
  await wait(600)
  check(`${engine} phone: nothing in the drawer selects or calls out`, !(await leaks(page, "[data-phone-drawer]")).length, await leaks(page, "[data-phone-drawer]"))
  check(`${engine} phone: the drawer's field selects`, [null, "text"].includes(await selectsAs(page, "[data-phone-drawer] input")), await selectsAs(page, "[data-phone-drawer] input"))
}
await phoneChecks(phone, "chromium")

// WebKit, as iOS draws it: -webkit-user-select (and -webkit-touch-callout, where the build has it: iOS's).
const wk = await webkitLaunch()
try {
  const page = watch(await wk.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), { label: "webkit" })
  await phoneChecks(page, "webkit")
} finally { await wk.close() }

await done()
