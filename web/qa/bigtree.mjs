// A huge folder open in the file tree (components/FileTree.ts, core/virtual.ts): only the rows near the screen are
// drawn, yet the tree is its whole height and scrolls true; End, ↑ and ← reach rows far off (the last file, the folder
// thousands of rows up), ⇧-click selects a run past what's drawn, F2 renames a row far down, revealing a file scrolls to
// it, and typing in a note (with its saves) redraws no row of the tree. WRITES "Qa big" (3000 notes) and files.json
// and sidebars.json (put back): throwaway server only.
//   node web/qa/bigtree.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import path from "node:path"
import { SHOTS, apiAt, qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const api = apiAt(B, { "X-Vaultite-Client": "app/qa" })

const D = "Qa big", N = 3000, name = (i) => `${D}/Note ${String(i).padStart(4, "0")}.md`
fs.rmSync(path.join(VAULT, D), { recursive: true, force: true })
fs.mkdirSync(path.join(VAULT, D))
for (let i = 1; i <= N; i++) fs.writeFileSync(path.join(VAULT, name(i)), `Note ${i}.\n`)
const NOTE = "Qa big typing.md"
fs.writeFileSync(path.join(VAULT, NOTE), "A note to type in.\n")
const filesBefore = await api("GET", "config/files"), sidesBefore = await api("GET", "config/sidebars")
await api("PUT", "config/files", { ...filesBefore, fileSort: "name", folderLimit: 0, autoReveal: false })
// (the tree alone in its sidebar: End goes to its last row, not another panel's)
await api("PUT", "config/sidebars", { ...sidesBefore, left: ["files:files"] })
await until(async () => (await api("GET", "files")).files?.filter((f) => f.path.startsWith(`${D}/`)).length === N, 30000)

// Renders of the tree's rows, counted by their props (names are minified): a stand-in for React DevTools' hook.
const HOOK = () => {
  const P = window.__tree = { rows: 0 }
  const COMP = new Set([0, 11, 14, 15]) // function, forwardRef, memo, simple memo
  const isRow = (c) => COMP.has(c.tag) && !!c.memoizedProps?.rows && "depth" in c.memoizedProps
  const mount = (f) => { for (let c = f; c; c = c.sibling) { if (isRow(c)) P.rows++; if (c.child) mount(c.child) } }
  const walk = (f) => {
    for (let c = f.child; c; c = c.sibling) {
      const a = c.alternate
      if (!a) { if (isRow(c)) P.rows++; if (c.child) mount(c.child); continue }
      if (isRow(c) && (c.flags & 1)) P.rows++
      if (c.child !== a.child) walk(c)
    }
  }
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), inject() { return 1 }, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) { try { if (root.current.alternate) walk(root.current) } catch {} } }
}
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.addInitScript(() => { if (!sessionStorage.getItem("qa")) { localStorage.clear(); sessionStorage.setItem("qa", "1") } localStorage.setItem("vaultite.fileMode", "live") })
await ctx.addInitScript(HOOK)
const page = watch(await ctx.newPage(), { console: true })
const tree = page.locator("aside [role=tree]").first()
const row = (p) => tree.locator(`div[data-tree-path="${p}"]`)
const drawn = () => tree.locator(`div[data-tree-path^="${D}/"]`).count()
const keyRow = () => page.evaluate(() => document.activeElement?.closest("[data-tree-path]")?.getAttribute("data-tree-path") ?? null)
/** Whether a row is drawn and in sight in the sidebar. */
const inSight = (p) => page.evaluate((p) => {
  const el = document.querySelector(`aside [role=tree] div[data-tree-path="${CSS.escape(p)}"]`)
  const body = el?.closest("[data-sidebar-body]")
  if (!el || !body) return false
  const r = el.getBoundingClientRect(), b = body.getBoundingClientRect()
  return r.top >= b.top - 1 && r.bottom <= b.bottom + 1
}, p)
/** What scrolls the tree: the list itself, or the sidebar it's in. */
const scrollTree = (to) => page.evaluate((to) => {
  const ul = document.querySelector("aside [role=tree]")
  let s = ul
  while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
  s.scrollTop = to === "end" ? s.scrollHeight : to * (s.scrollHeight - s.clientHeight)
}, to)

await page.goto(B)
await until(async () => (await row(D).count()) === 1, 15000)
await page.locator('aside [aria-label="Collapse all"]').click().catch(() => {}); await wait(200)
await row(D).locator("button").first().click()
check("opened: its rows show", !!(await until(async () => (await row(name(1)).count()) === 1, 10000)))
await wait(500)

// 1. Only what's near the screen is drawn, in a tree as tall as every row.
const n = await drawn()
check(`only rows near the screen drawn (${n} of ${N})`, n > 10 && n < 250, n)
const tall = await tree.evaluate((ul) => ul.getBoundingClientRect().height)
check("the tree is as tall as all its rows", tall > N * 20, tall)
await page.screenshot({ path: `${OUT}bigtree-1-open.png` })

// 2. Scrolled halfway: the rows in sight are the ones there (Note ~1500), drawn without gaps.
await scrollTree(0.5); await wait(400)
const mid = await page.evaluate((D) => {
  const body = document.querySelector("aside [role=tree]").closest("[data-sidebar-body]").getBoundingClientRect()
  const seen = [...document.querySelectorAll(`aside [role=tree] div[data-tree-path^="${D}/"]`)].filter((el) => { const r = el.getBoundingClientRect(); return r.top >= body.top && r.bottom <= body.bottom })
  return seen.map((el) => Number(/Note (\d+)/.exec(el.getAttribute("data-tree-path"))[1]))
}, D)
check(`halfway down: the rows there are in sight (${mid[0]}…${mid.at(-1)})`, mid.length > 10 && mid[0] > 1200 && mid[0] < 1800 && mid.every((x, i) => !i || x === mid[i - 1] + 1), mid)
await page.screenshot({ path: `${OUT}bigtree-2-middle.png` })

// 3. The keyboard: End to the tree's last row (past the folder: the top's files), ↑ back into the folder's last
// file, ↑ to the one before, then (4) F2, and ← to the folder thousands of rows up.
await scrollTree(0); await wait(300)
await row(name(1)).locator("[data-keyrow]").focus()
await page.keyboard.press("End"); await wait(300)
const last = await page.evaluate(() => [...document.querySelectorAll("aside [role=tree] [data-tree-path]")].at(-1)?.getAttribute("data-tree-path"))
check(`End: the tree's last row, in sight (${last})`, !!last && (await keyRow()) === last && await inSight(last), await keyRow())
for (let i = 0; i < 40 && !(await keyRow())?.startsWith(`${D}/`); i++) { await page.keyboard.press("ArrowUp"); await wait(60) }
check("↑ past the top's files: the folder's last file, in sight", (await keyRow()) === name(N) && await inSight(name(N)), await keyRow())
await page.keyboard.press("ArrowUp"); await wait(200)
check("↑: the one before it", (await keyRow()) === name(N - 1), await keyRow())

// 4. F2 renames a row far down in place (Escape leaves it as it was).
await page.keyboard.press("F2"); await wait(300)
const field = tree.locator('input[aria-label="New name"]')
check("F2: a name field far down", (await field.count()) === 1 && (await field.inputValue()) === `Note ${N - 1}`)
await page.keyboard.press("Escape"); await wait(300)
check("Escape: the row again, with the keyboard", (await field.count()) === 0 && (await keyRow()) === name(N - 1), await keyRow())
await page.keyboard.press("ArrowLeft"); await wait(300)
check("←: the folder, thousands of rows up, in sight", (await keyRow()) === D && await inSight(D), await keyRow())

// 5. ⇧-click: the run from the first file to the last, past the rows not drawn.
await row(name(1)).locator("[data-keyrow]").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] }); await wait(200)
await scrollTree("end"); await wait(400)
await row(name(N)).locator("[data-keyrow]").click({ modifiers: ["Shift"] }); await wait(300)
await row(name(N)).click({ button: "right" }); await wait(300)
const caption = await page.locator("[role=menu]").first().textContent().catch(() => "")
check(`⇧-click selects every file between (${caption.match(/\d+ items selected/)?.[0]})`, caption.includes(`${N} items selected`), caption.slice(0, 80))
await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(200)

// 6. Revealing a file far down (auto-reveal) scrolls the tree to it.
await scrollTree(0); await wait(300)
await api("PATCH", "config/files", { autoReveal: true })
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, name(2400))
check("revealed: the open file's row, in sight", !!(await until(() => inSight(name(2400)), 8000)))
await page.screenshot({ path: `${OUT}bigtree-3-revealed.png` })

// 7. Typing in a note, saves and all: no row of the tree drawn again, nothing in it changed.
await page.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, NOTE)
await until(() => page.evaluate(() => document.querySelectorAll(".cm-content .cm-line").length >= 1), 8000)
await wait(1500)
await page.click(".cm-content"); await page.keyboard.press("ControlOrMeta+End"); await wait(1200)
await page.evaluate(() => {
  window.__tree.rows = 0
  window.__changed = 0
  new MutationObserver((ms) => { window.__changed += ms.length }).observe(document.querySelector("aside [role=tree]"), { subtree: true, childList: true, attributes: true, characterData: true })
})
await page.keyboard.type(" and some more words", { delay: 80 })
await wait(3000) // (its save, and the store's refresh after it)
const saved = fs.readFileSync(path.join(VAULT, NOTE), "utf8").includes("some more words")
const after = await page.evaluate(() => ({ rows: window.__tree.rows, changed: window.__changed }))
check("typing: saved", saved)
check(`typing and its saves: no tree row drawn again, nothing in it changed (${after.rows} rows, ${after.changed} changes)`, after.rows === 0 && after.changed === 0, after)

fs.rmSync(path.join(VAULT, D), { recursive: true, force: true })
fs.rmSync(path.join(VAULT, NOTE), { force: true })
await api("PUT", "config/sidebars", sidesBefore)
// (PATCH: a key it didn't have goes again, null removing it)
await api("PATCH", "config/files", Object.fromEntries(["fileSort", "folderLimit", "autoReveal"].map((k) => [k, filesBefore[k] ?? null])))
await done()
