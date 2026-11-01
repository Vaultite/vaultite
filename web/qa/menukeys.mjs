// Menus from the keyboard (core/keylist.ts focus:menu, ContextMenu.tsx): Shift+F10, the menu key and the palette open
// the menu of what has the keyboard beside it (an editor's at its caret), then arrows, Enter and Escape work it.
// Opens a tab from a menu: throwaway only.
//   node web/qa/menukeys.mjs <base url>
import { palette, qa, until, wait } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, done } = await qa(import.meta.url)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const enc = encodeURIComponent

/** The menu, its rows, what has the keyboard, and whether that's what was marked (`data-qa-had`) before it opened. */
const state = () => page.evaluate(() => {
  const m = document.querySelector("[role=menu]"), a = document.activeElement
  const rows = m ? [...m.querySelectorAll(":scope > button:not(:disabled)")] : []
  const r = m?.getBoundingClientRect()
  return { open: !!m, box: r ? { left: r.left, top: r.top, bottom: r.bottom } : null, rows: rows.length,
    at: rows.indexOf(a), back: !!a?.hasAttribute("data-qa-had") }
})
/** Marks what has the keyboard (to see it get it back) and answers where a menu for it belongs: under it, or in an
 *  editor, at its caret. */
const mark = () => page.evaluate(() => {
  document.querySelectorAll("[data-qa-had]").forEach((e) => e.removeAttribute("data-qa-had"))
  const a = document.activeElement
  a?.setAttribute("data-qa-had", "")
  const s = getSelection()
  if (a?.isContentEditable && s?.focusNode) {
    const r = document.createRange(); r.setStart(s.focusNode, s.focusOffset)
    const c = r.getClientRects()[0]
    return { caret: true, left: c.left, right: c.left, top: c.top, bottom: c.bottom }
  }
  const r = a.getBoundingClientRect()
  return { caret: false, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
})
/** The menu sits by `t`: starting along it, its rows reaching it from below or above (pushed up to fit, near the bottom). */
const beside = (box, t) => !!box && box.left >= t.left - 2 && box.left <= (t.caret ? t.left + 8 : t.right) &&
  box.top <= t.bottom + 16 && box.bottom >= t.top - 16

/** Opens the menu of what has the keyboard with `how` (a key, or a function), then works it: ↓, End, Home, Escape. */
async function drive(label, how) {
  const t = await mark()
  // (the pointer far away: a menu opened at the mouse would show it)
  await page.mouse.move(1270, 890)
  if (typeof how === "string") await page.keyboard.press(how); else await how()
  await until(async () => (await state()).open, 2000)
  // (its rows as they'll stay: a block's sources come in after it opens)
  let n = -1
  await until(async () => { const rows = (await state()).rows, same = rows === n; n = rows; return same }, 2000, 250)
  let s = await state()
  if (!check(`${label}: a menu opens`, s.open, s)) { await page.keyboard.press("Escape"); return }
  check(`${label}: by ${t.caret ? "the caret" : "what has the keyboard"}, not at the mouse`, beside(s.box, t), { box: s.box, t })
  // (on its first row, unless rows came in above it after it opened: a block's sources)
  const at = s.at
  check(`${label}: the keyboard is on one of its rows`, at >= 0, s)
  await page.keyboard.press("ArrowDown"); s = await state()
  check(`${label}: ↓ moves to the next row`, s.at === (at + 1) % s.rows, s)
  await page.keyboard.press("End"); s = await state()
  check(`${label}: End goes to the last row`, s.rows > 1 && s.at === s.rows - 1, s)
  await page.keyboard.press("Home"); s = await state()
  check(`${label}: Home goes to the first row`, s.at === 0, s)
  await page.keyboard.press("Escape")
  await until(async () => { const x = await state(); return !x.open && x.back }, 2000)
  s = await state()
  check(`${label}: Escape closes it and gives the keyboard back`, !s.open && s.back, s)
}
const both = async (label, focus) => {
  for (const key of ["Shift+F10", "ContextMenu"]) { await focus(); await wait(150); await drive(`${label}, ${key}`, key) }
}
const focusOn = (sel) => async () => {
  const ok = await page.evaluate((sel) => { const el = document.querySelector(sel); el?.focus(); return !!el && document.activeElement === el }, sel)
  if (!ok) check(`can focus ${sel}`, false)
}

await page.goto(`${B}#file/${enc("Dashboards/People.md")}`)
await page.waitForSelector("[data-pane] [data-block] button", { timeout: 15000 }); await wait(800)

const TREE_ROW = `[data-sidebar-body=left] [data-tree-path="ME.md"] [data-keyrow]`
await both("a file tree row", focusOn(TREE_ROW))
await both("a tab", focusOn("[data-tab-id] [role=tab]"))
await both("a sidebar row", focusOn("[data-sidebar-body] [data-keyrow]:not([data-tree-path] *)"))
await both("a dashboard block", focusOn("[data-pane] [data-block] button"))

// Enter runs the row the keyboard is on: the tree's Open in new tab.
const tabs = () => page.locator("[data-tab-id]").count()
await focusOn(TREE_ROW)()
const tabs0 = await tabs()
await page.keyboard.press("Shift+F10"); await until(async () => (await state()).open, 2000)
const first = await page.evaluate(() => document.activeElement?.textContent.trim())
await page.keyboard.press("Enter")
check(`Enter runs the row (${first})`, first === "Open in new tab" && await until(async () => await tabs() > tabs0, 3000) && !(await state()).open)

// A note's editor: at the caret, which stays where it was.
await page.goto("about:blank"); await page.goto(`${B}#file/${enc("Notes/Lisbon trip.md")}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 }); await wait(800)
const toCaret = async () => { await page.locator("[data-pane] .cm-content .cm-line").nth(2).click(); await page.keyboard.press("End") }
const head = () => page.evaluate(() => { const s = getSelection(); return `${s.focusNode?.textContent?.slice(0, 20)}@${s.focusOffset}` })
await toCaret(); const caret0 = await head()
await both("a note's editor", toCaret)
await toCaret(); await page.keyboard.press("Shift+F10"); await until(async () => (await state()).open, 2000)
await page.keyboard.press("Escape"); await wait(400)
check("the editor's caret stays where it was", await head() === caret0, [await head(), caret0])

// The palette finds it as a context menu, with its key, and runs it once the keyboard is back where it was.
await toCaret()
await page.keyboard.press("ControlOrMeta+p"); await until(() => page.locator("[role=option]").count(), 3000)
await page.keyboard.type("context menu"); await wait(300)
const option = await page.locator("[role=option]").first().textContent()
check(`the palette finds it by "context menu", with its key (${option})`, /menu of what has the keyboard/i.test(option) && /F10/.test(option), option)
await page.keyboard.press("Escape"); await wait(400)
await toCaret(); await wait(150)
await drive("a note's editor, from the palette", () => palette(page, "Open the menu of what has the keyboard", 100))

// A text field keeps Shift+F10 (and the browser's own menu).
await page.evaluate(() => {
  const f = document.createElement("input"); f.id = "qa-field"; document.body.append(f); f.focus()
  f.addEventListener("keydown", (e) => { setTimeout(() => { window.qaKept = !e.defaultPrevented }) })
})
await page.keyboard.press("Shift+F10"); await wait(300)
check("a text field keeps Shift+F10", await page.evaluate(() => window.qaKept === true && !document.querySelector("[role=menu]")))
await page.evaluate(() => document.getElementById("qa-field")?.remove())

await done()
