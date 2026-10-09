// Long lists show everything (pages/Search.tsx, SearchPalette.tsx, FileTree.tsx): the search tab's totals count every
// file and line, more files come as it's scrolled, "N more in this file" shows them, and a line opens its file with the
// match selected on that line; the quick switcher lists more as it's scrolled, ends with the search tab, and finds
// text from two letters; a folder of hundreds draws as it's scrolled, every file in the end.
// WRITES a "Qa lists" folder (removed after).
//   node web/qa/lists.mjs <base url> <vault path>
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)

const DIR = "Qa lists", FILES = 340, LINES = 25
mkdirSync(path.join(VAULT, DIR), { recursive: true })
for (let i = 1; i <= FILES; i++) {
  const body = Array.from({ length: LINES }, (_, k) => `Line ${k + 1} of ${i}: a quokka here`).join("\n")
  writeFileSync(path.join(VAULT, DIR, `Qa note ${i}.md`), `---\nstatus: seed\n---\n\n${body}\n${i === 7 ? "A rare xq pair\n" : ""}`)
}
await wait(2500) // (the server reads them)

try {
  const page = watch(await browser.newPage({ viewport: { width: 1280, height: 800 } }))
  await page.goto("about:blank")
  await page.goto(`${B}#view/search%2Fquokka`)
  await until(() => page.$("[data-search-file]"), 10000)
  await wait(800)
  const head = await page.textContent('[aria-label="In files"] h2')
  check("the search tab counts every line in every file", head.includes(`${FILES * LINES} lines in ${FILES} files`), head)
  const first = await page.$$eval("[data-search-file]", (es) => es.length)
  check("it lists a page of files at first", first === 100, first)
  for (let n = 0; n < 40 && (await page.$$eval("[data-search-file]", (es) => es.length)) < FILES; n++) {
    await page.evaluate(() => { const s = document.querySelector("[data-search-view]")?.closest("[data-pane], #main-scroll"); (s ?? document.scrollingElement).scrollTop = 1e9 })
    await wait(500)
  }
  const all = await page.$$eval("[data-search-file]", (es) => es.length)
  check("scrolled to the end, it lists every file", all === FILES, all)

  const one = `${DIR}/Qa note 3.md`
  const sel = `[data-search-file="${one}"]`
  await page.$eval(sel, (e) => e.scrollIntoView())
  const lines = () => page.$$eval(`${sel} [data-line]`, (es) => es.length)
  check("a file shows its first 20 lines", (await lines()) === 20, await lines())
  await page.click(`${sel} button:has-text("5 more in this file")`)
  await until(async () => (await lines()) === LINES, 5000)
  check("N more in this file shows every line", (await lines()) === LINES, await lines())
  const at = await page.$eval(`${sel} [data-line]:nth-child(1)`, (e) => e.getAttribute("data-line")).catch(() => null)
  check("lines are numbered as the file's, frontmatter counted", at === "5", at)

  await page.click(`${sel} li:nth-child(12) [data-line]`)
  // (the editor's own selection: CodeMirror draws it, and the page's may lag behind in a headless browser)
  const picked = () => page.evaluate(() => {
    const v = [...document.querySelectorAll(".cm-content")].find((e) => e.getClientRects().length)?.cmTile?.root?.view
    const r = v?.state.selection.main
    return r ? { text: v.state.sliceDoc(r.from, r.to), line: v.state.doc.lineAt(r.head).text } : null
  })
  await until(async () => (await picked())?.text === "quokka", 6000)
  const where = await picked() ?? {}
  check("a line opens its file there, the match selected", where.text === "quokka" && where.line?.startsWith("Line 12 of 3:"), where)

  // The quick switcher: more rows as it's scrolled, then the search tab; text from two letters.
  await page.keyboard.press("Escape")
  await page.keyboard.press("ControlOrMeta+o")
  await until(() => page.$('[role="dialog"][aria-label="Search"]'), 8000)
  await page.fill('[role="dialog"][aria-label="Search"] input', "qa note")
  await wait(700)
  const options = () => page.$$eval('[role="listbox"] [role="option"]', (es) => es.length)
  const before = await options()
  for (let n = 0; n < 12; n++) { await page.$eval('[role="listbox"]', (l) => { l.scrollTop = 1e9 }); await wait(250) }
  const after = await options()
  check("the quick switcher lists more as it's scrolled", before <= 81 && after > before + 100, { before, after })
  const last = await page.$eval('[role="listbox"] [role="option"]:last-of-type', (e) => e.textContent)
  check("it ends with the search tab", /Search for "qa note" in every file/.test(last), last)
  await page.fill('[role="dialog"][aria-label="Search"] input', "xq")
  await until(async () => (await page.textContent('[role="listbox"]')).includes("Qa note 7"), 4000).catch(() => {})
  check("text matches from two letters", (await page.textContent('[role="listbox"]')).includes("Qa note 7"), await page.textContent('[role="listbox"]'))
  await page.keyboard.press("Escape")

  // The file tree: every file, drawn as it's scrolled.
  await page.goto("about:blank")
  await page.goto(`${B}#view/files`)
  const folder = `[data-path="${DIR}"]`
  await until(() => page.$(`${folder}, [data-tree-path="${DIR}"]`), 8000).catch(() => {})
  const row = await page.$(`[data-pane] [data-tree-path="${DIR}"] > button`) ?? await page.$(`[data-pane] [data-tree-path="${DIR}"]`)
  if (row) {
    await row.click()
    await wait(800)
    // (the sidebar has a tree too: the tab's alone)
    const drawn = () => page.$$eval(`[data-pane] [data-tree-path^="${DIR}/"][data-select-key]`, (es) => es.length)
    const d0 = await drawn()
    for (let n = 0; n < 10; n++) { await page.evaluate((p) => document.querySelector(`[data-pane] [data-tree-path="${p}"]`)?.closest("ul")?.lastElementChild?.scrollIntoView(), DIR); await wait(300) }
    const d1 = await drawn()
    check("a long folder draws its first rows, then every file as it's scrolled", d0 > 0 && d0 < FILES && d1 === FILES, { d0, d1 })
  } else check("the files tab shows the folder", false, null)

  // Recent files: 50 (its setting's default), then Show more.
  await page.goto("about:blank")
  await page.goto(`${B}#view/recent`)
  await until(() => page.$('[data-recent-view] section[aria-label="Recently changed"] [data-recent-more]'), 8000)
  const changed = () => page.$$eval('[data-recent-view] section[aria-label="Recently changed"] [data-select-key]', (es) => es.length)
  const c0 = await changed()
  await page.click('[data-recent-view] section[aria-label="Recently changed"] [data-recent-more]')
  await wait(400)
  const c1 = await changed()
  check("recent files list 50, then Show more lists more", c0 === 50 && c1 === 100, { c0, c1 })
} finally {
  rmSync(path.join(VAULT, DIR), { recursive: true, force: true })
}
await done()
