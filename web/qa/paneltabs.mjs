// Sidebar panels as tabs, and terminal tabs named like the Terminals panel's rows. Opens Files, Terminals, Pinned pages
// and Search as tabs from the palette (view:files, view:terminals, view:pages, view:search/<query>); drags panels'
// headings onto a pane's middle, an edge and a tab bar (a tab opens; the same panel again into a pane that has it only
// shows it; the panel stays in the sidebar); "Open Terminals in a tab" in a heading's right-click menu; the search tab keeps its
// query in its address and across a switch and a reload; a terminal whose process is `claude` (a stand-in: a tiny sleeping program under
// that name) shows its pane title, its colour and working/waiting state on its tab, live, like its sidebar row; phones at 390px
// draw each view (screenshots); the wheel over rows of every panel as a tab scrolls its pane (no wheel trap inside it:
// a scroller with overscroll containment and nothing to scroll). Writes plugins.json (Workspaces off) and sidebars.json (put back), runs a shell:
// throwaway server only.
//   node web/qa/paneltabs.mjs <base url> <vault path> [out dir]
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/paneltabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const settings = path.join(VAULT, ".vaultite/plugins.json")
const original = existsSync(settings) ? readFileSync(settings, "utf8") : null // a new vault has none yet
const sidebarsFile = path.join(VAULT, ".vaultite/sidebars.json")
const sidebarsBefore = existsSync(sidebarsFile) ? readFileSync(sidebarsFile, "utf8") : null
// Workspaces off (their own QA checks them): the tabs are this browser's; the default panels, none folded.
writeFileSync(settings, JSON.stringify({ ...JSON.parse(original ?? "{}"), disabled: ["workspaces"] }, null, 2) + "\n")
const DEFAULT = JSON.stringify({ left: ["search:search", "pages:pages", "terminal:sessions", "files:files"], right: [], collapsed: [] })
writeFileSync(sidebarsFile, DEFAULT + "\n")
const sid = `qa${Date.now().toString(36)}`
// A stand-in for Claude Code: a program named claude that only sleeps (a copied system binary won't run: its signature).
const standDir = mkdtempSync(path.join(tmpdir(), "qa-claude-"))
const stand = path.join(standDir, "claude")
writeFileSync(`${stand}.c`, "#include <unistd.h>\n#include <stdlib.h>\nint main(int c, char **v) { sleep(c > 1 ? atoi(v[1]) : 60); return 0; }\n")
execFileSync("cc", ["-o", stand, `${stand}.c`])

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}/#new`)
  await page.evaluate(() => localStorage.removeItem("vaultite.tabs"))
  await page.reload()
  await page.waitForSelector("aside [data-panel]")
  await wait(500)
  const palette = async (name) => { await page.keyboard.press("ControlOrMeta+P"); await page.keyboard.type(name); await wait(250); await page.keyboard.press("Enter"); await wait(300) }
  const tabs = () => page.$$eval("[data-tab-bar] [data-tab-id]", (els) => els.map((e) => e.textContent.trim()))
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash))

  // ---- the commands ----
  await palette("Open files in a tab")
  check("Open files in a tab: a Files tab with the tree", (await tabs()).includes("Files") && !!(await page.$("main [data-files-view] [role=tree]")), await tabs())
  check("  its address is #view/files", (await hash()) === "#view/files", await hash())
  await page.screenshot({ path: `${OUT}files-tab.png` })
  await palette("Open terminals in a tab")
  check("Open terminals in a tab", (await tabs()).includes("Terminals") && !!(await page.$("main [data-terminals-view]")), await tabs())
  await palette("Open pinned pages in a tab")
  check("Open pinned pages in a tab: the pages listed", (await tabs()).includes("Pinned pages") && (await page.$$("main [data-pages-view] [data-pin]")).length > 0, await tabs())
  await page.screenshot({ path: `${OUT}pages-tab.png` })
  // A page clicked in the tab opens beside it (the tab stays).
  const first = await page.$eval("main [data-pages-view] [data-pin]", (e) => e.getAttribute("data-pin"))
  await page.click("main [data-pages-view] [data-pin]")
  await wait(400)
  check("  a page clicked there opens in a tab of its own", (await hash()) === `#file/${first}` && (await tabs()).includes("Pinned pages"), [await hash(), await tabs()])
  await palette("Open pinned pages in a tab")
  check("  the command again goes to that tab (no second one)", (await tabs()).filter((t) => t === "Pinned pages").length === 1, await tabs())

  // ---- search ----
  await palette("Open search in a tab")
  await page.waitForSelector("main [data-search-view] input")
  const word = await page.evaluate(async () => {
    // A word that's surely in some note: the longest word of the first file's first line.
    const s = await (await fetch("api/search?q=the&limit=5&lines=1")).json()
    const line = s.find((r) => r.matches?.length)?.matches[0].text ?? "the"
    return line.split(/[^A-Za-z]+/).filter((w) => w.length > 4).sort((a, b) => b.length - a.length)[0]?.toLowerCase() ?? "the"
  })
  await page.fill("main [data-search-view] input[aria-label='Search the vault']", word)
  const found = await until(() => page.$$eval("main [data-search-file]", (els) => els.length), 6000)
  check(`search: files with "${word}" listed`, found > 0, found)
  check("  their lines, the word marked", (await page.$$("main [data-search-file] li mark")).length > 0)
  await until(async () => (await hash()) === `#view/search/${word}`, 6000)
  check("  the query is in the tab's address", (await hash()) === `#view/search/${word}`, await hash())
  check("  the tab is titled with it", (await tabs()).includes(`Search: ${word}`), await tabs())
  await page.screenshot({ path: `${OUT}search-tab.png` })
  // Away and back: the query is still there.
  await page.click(`[data-tab-bar] [data-tab-id]:has-text("Files")`)
  await wait(300)
  await page.click(`[data-tab-bar] [data-tab-id]:has-text("Search")`)
  await wait(300)
  check("  switching away and back keeps it", (await page.inputValue("main [data-search-view] input[aria-label='Search the vault']")) === word)
  await page.reload()
  await page.waitForSelector("main [data-search-view] input")
  check("  and a reload", (await page.inputValue("main [data-search-view] input[aria-label='Search the vault']")) === word)
  // Typing keeps the field (the view isn't drawn afresh when its arg changes).
  await page.focus("main [data-search-view] input[aria-label='Search the vault']")
  await page.keyboard.type("x")
  await wait(700)
  check("  typing on after the address changed keeps the field focused", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Search the vault"))
  await page.keyboard.press("Backspace")
  await wait(500)

  // ---- right-click a heading ----
  await page.click("aside [data-panel='terminal:sessions'] [data-panel-handle]", { button: "right" })
  await wait(200)
  const items = await page.$$eval("[role=menu] [role=menuitem], [role=menu] [role=menuitemcheckbox]", (els) => els.map((e) => e.textContent.trim()))
  check("right-click a panel's heading: Open Terminals in a tab", items.includes("Open Terminals in a tab"), items)
  await page.keyboard.press("Escape")

  // ---- dragging headings ----
  await palette("Close all other tabs")
  await wait(300)
  const center = async (sel) => { const b = await (await page.$(sel)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b] }
  const dragFrom = async (panel, to) => {
    const [x, y] = await center(`aside [data-panel='${panel}'] [data-panel-handle] span`)
    await page.mouse.move(x, y); await page.mouse.down()
    await page.mouse.move(x + 20, y + 5, { steps: 3 })
    await page.mouse.move(to[0], to[1], { steps: 8 })
    await wait(150)
    const zone = await page.$eval("[data-drop-zone]", (e) => e.getAttribute("data-drop-zone")).catch(() => null)
    const line = !!(await page.$("[data-drop-line]"))
    const ghost = await page.$eval("[data-drag-ghost]", (e) => e.textContent).catch(() => null)
    await page.mouse.up()
    await wait(400)
    return { zone, line, ghost }
  }
  let [px, py, pb] = await center("[data-pane-body]")
  let r = await dragFrom("pages:pages", [px, py])
  check("drag Pinned's heading onto a pane's middle: offered there", r.zone === "center", r)
  check("  the dragged item says what it opens", r.ghost?.includes("Pinned pages"), r.ghost)
  check("  it opens as a tab", (await tabs()).includes("Pinned pages") && (await hash()) === "#view/pages", [await tabs(), await hash()])
  check("  the panel stays in the sidebar", !!(await page.$("aside [data-panel='pages:pages']")))
  const before = (await tabs()).length
  r = await dragFrom("pages:pages", [px, py])
  check("  again onto the pane showing it: not offered", !r.zone, r)
  // Onto the tab bar of a pane that has it but shows another tab: shows it, no second one.
  await palette("Open files in a tab")
  const barBox = await (await page.$("[data-tab-bar]")).boundingBox()
  r = await dragFrom("pages:pages", [barBox.x + barBox.width - 60, barBox.y + barBox.height / 2])
  check("  onto a tab bar whose pane has it: that tab shown, not a second", (await tabs()).filter((t) => t === "Pinned pages").length === 1 && (await hash()) === "#view/pages", [await tabs(), await hash()])
  r = await dragFrom("terminal:sessions", [barBox.x + barBox.width - 60, barBox.y + barBox.height / 2])
  check("drag Terminals' heading onto the tab bar: a line, then a tab", r.line && (await tabs()).includes("Terminals"), [r, await tabs()])
  ;[px, py, pb] = await center("[data-pane-body]")
  // (Not at the window's very edge: that's where a panel goes to the right sidebar.)
  r = await dragFrom("files:files", [pb.x + pb.width - 90, py])
  check("drag Files' heading onto a pane's right edge: a split with Files", r.zone === "right" && (await page.$$("[data-tab-bar]")).length === 2, [r, (await page.$$("[data-tab-bar]")).length])
  await page.screenshot({ path: `${OUT}dragged-split.png` })
  const after = JSON.stringify(JSON.parse(readFileSync(sidebarsFile, "utf8")))
  check("the sidebar's panels are unchanged by those drops", after === DEFAULT, after)

  // ---- a terminal tab named like its sidebar row ----
  await palette("Close all other tabs")
  await page.evaluate((id) => { location.hash = `#view/terminal%2F${id}` }, sid)
  await page.waitForSelector(".xterm-screen")
  await wait(1500)
  check("a plain terminal's tab: Terminal", (await tabs()).includes("Terminal"), await tabs())
  // The stand-in for Claude Code, with a pane title and the hooks' state: what an agent's hooks write (the terminal's
  // state file, whatever its backend: plugins/core/terminal/plugin.ts, stateCommand).
  const stateFile = path.join(tmpdir(), "vaultite-terminal", "states", sid)
  await page.click(".xterm-screen")
  await page.keyboard.type(`printf '\\033]2;Refactor the parser\\033\\\\' && printf working > '${stateFile}' && ${stand} 120\n`)
  const named = await until(async () => (await tabs()).includes("Refactor the parser"), 8000)
  check("its tab shows the session's name, as the sidebar row does", named, await tabs())
  if (!named) console.log(await page.evaluate(() => [...document.querySelectorAll("[data-terminal]")].map((e) => e.terminalText?.() ?? "").join("\n").trim()))
  const row = await page.$eval(`aside [data-session='${sid}']`, (e) => e.textContent).catch(() => null)
  check("  the same name as its row", row?.includes("Refactor the parser"), row)
  const tabIcon = () => page.$eval(`[data-tab-bar] [data-tab-id]:has-text("Refactor the parser") svg`, (e) => e.getAttribute("class")).catch(() => null)
  check("  its icon pulses while working", (await tabIcon())?.includes("animate-pulse"), await tabIcon())
  // The colour is the icon's style (a view's iconTint, a row's tint); waiting is a dot on the icon (kit.tsx: Badged).
  const colourOf = (sel) => page.$eval(sel, (e) => e.style.color || getComputedStyle(e).color).catch(() => null)
  const tabSvg = `[data-tab-bar] [data-tab-id]:has-text("Refactor the parser") svg`, rowSvg = `aside [data-session='${sid}'] svg`
  const [rowColour, tabColour] = [await colourOf(rowSvg), await colourOf(tabSvg)]
  check("  in the session's own colour, the same as its row", !!rowColour && rowColour === tabColour, [rowColour, tabColour])
  writeFileSync(stateFile, "waiting")
  const dot = await until(async () => (await page.$(`[data-tab-bar] [data-tab-id]:has-text("Refactor the parser") [data-badged]`)) !== null, 6000)
  check("  and shows a dot while waiting, live", dot, await tabIcon())
  // Colour is the state's (sessions.ts: tintOf): yellow waiting, grey idle; waiting sorts first (SessionsPanel: useByState).
  const yellow = await page.evaluate(() => { const e = document.createElement("i"); e.style.color = "var(--yellow)"; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c })
  const drawn = (sel) => page.$eval(sel, (e) => getComputedStyle(e).color).catch(() => null)
  check("  in yellow while waiting, row and tab", (await drawn(rowSvg)) === yellow && (await drawn(tabSvg)) === yellow, [await drawn(rowSvg), await drawn(tabSvg), yellow])
  await page.mouse.move(700, 300)
  const onTop = await until(async () => (await page.$eval("aside [data-session]", (e) => e.dataset.session).catch(() => null)) === sid, 4000)
  check("  and its row sorts first in the panel", onTop, await page.$$eval("aside [data-session]", (es) => es.map((e) => e.dataset.state ?? "-")))
  writeFileSync(stateFile, "idle")
  const grey = await until(async () => !(await page.$eval(rowSvg, (e) => e.style.color).catch(() => "x")), 6000)
  check("  in the icons' grey once idle, without the dot", grey && !(await page.$(`[data-tab-bar] [data-tab-id]:has-text("Refactor the parser") [data-badged]`)), await colourOf(rowSvg))
  await page.screenshot({ path: `${OUT}terminal-tab-name.png` })
  await page.screenshot({ path: `${OUT}terminal-tab-bar.png`, clip: { x: 0, y: 0, width: 900, height: 44 } })
  await palette("Close current tab") // ends that shell

  // ---- the wheel over a panel's rows in a tab scrolls its pane ----
  // A wheel trap: a box that is a scroller (overflow auto) with overscroll containment but nothing to scroll (as tall as
  // what it holds). Chrome ends the wheel's scroll chain there, so over its rows the pane didn't scroll (the Files tab's
  // tree did that). None may be inside a pane; and for real, in a short window, the wheel over rows scrolls the pane.
  const traps = (sel) => page.evaluate((sel) => {
    const pane = document.querySelector(`main ${sel}`)?.closest("[data-pane]")
    if (!pane) return null
    return [...pane.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowY) && s.overscrollBehaviorY !== "auto" && e.scrollHeight <= e.clientHeight + 1 })
      .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`)
  }, sel)
  for (const [name, sel] of [["files", "[data-files-view]"], ["terminals", "[data-terminals-view]"], ["pages", "[data-pages-view]"], [`search%2F${word}`, "[data-search-view]"],
    ["links", "[data-links-view]"], ["outline", "[data-outline-view]"], ["tags", "[data-tags-view]"], ["properties", "[data-properties-view]"]]) {
    await page.evaluate((v) => { location.hash = `#view/${v}` }, name)
    const drawn = await page.waitForSelector(`main ${sel}`, { timeout: 6000 }).then(() => true, () => false)
    await wait(300)
    const t = await traps(sel)
    check(`view:${name.split("%2F")[0]} in a tab: nothing in its pane stops the wheel`, drawn && Array.isArray(t) && !t.length, { drawn, t })
  }
  await page.setViewportSize({ width: 1280, height: 420 }); await wait(400)
  for (const [name, sel, row] of [["files", "[data-files-view]", "[data-tree-path]"], ["pages", "[data-pages-view]", "[data-pin]"]]) {
    await page.evaluate((v) => { location.hash = `#view/${v}` }, name)
    await page.waitForSelector(`main ${sel} ${row}`); await wait(400)
    const paneOf = (s) => page.$eval(`main ${s}`, (e) => { const p = e.closest("[data-pane]"); return { top: p.scrollTop, room: p.scrollHeight - p.clientHeight } })
    await page.$eval(`main ${sel}`, (e) => { e.closest("[data-pane]").scrollTop = 0 })
    const rows = await page.$$(`main ${sel} ${row}`)
    const r = await rows[Math.min(2, rows.length - 1)].boundingBox()
    await page.mouse.move(r.x + Math.min(60, r.width / 2), r.y + r.height / 2); await page.mouse.wheel(0, 200); await wait(500)
    const p = await paneOf(sel)
    check(`view:${name} in a tab: the wheel over its rows scrolls the pane`, p.room <= 0 || p.top > 0, p)
  }
  await page.setViewportSize({ width: 1280, height: 800 }); await wait(300)

  // ---- phones ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const pp = watch(await phone.newPage(), { label: "phone" })
  for (const [name, sel] of [["files", "[data-files-view]"], ["terminals", "[data-terminals-view]"], ["pages", "[data-pages-view]"], [`search%2F${word}`, "[data-search-view]"]]) {
    await pp.goto(`${B}/#view/${name}`)
    const ok = await pp.waitForSelector(sel, { timeout: 6000 }).then(() => true, () => false)
    await wait(600)
    const wide = await pp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    check(`phone: view:${name.split("%2F")[0]} draws, no sideways scroll`, ok && !wide, { ok, wide })
    await pp.screenshot({ path: `${OUT}phone-${name.split("%2F")[0]}.png` })
  }
  await phone.close()
} finally {
  if (original === null) rmSync(settings, { force: true }); else writeFileSync(settings, original)
  if (sidebarsBefore === null) rmSync(sidebarsFile, { force: true }); else writeFileSync(sidebarsFile, sidebarsBefore)
  rmSync(standDir, { recursive: true, force: true })
  await browser.close()
}
await done()
