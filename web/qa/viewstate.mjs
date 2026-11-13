// Where you left a place (core/viewstate.ts): scroll and Properties' folds coming back, and the same line on top across
// views, on a computer and a phone. WRITES a long note: throwaway server only.
//   node web/qa/viewstate.mjs <base url> <vault path>
import { readFileSync, writeFileSync } from "node:fs"
import { command, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { pagePath } from "./subjects.mjs"
const { args: [B, VAULT], browser, check, done } = await qa(import.meta.url)
const LONG = "Notes/Qa long note.md"
writeFileSync(`${VAULT}/${LONG}`, `---\ntype: note\nkind: note\ntags: [Qa]\n---\n\n${Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\n${"Text to make this note long enough to scroll. ".repeat(8)}`).join("\n\n")}\n`)
// (a person file starting with its profile block: the sandbox's people have none written)
const PERSON = "People/Qa person.md"
writeFileSync(`${VAULT}/${PERSON}`, "---\ntype: person\nrelation: friend\n---\n\n```block-person\n```\n\nMet at a pottery class.\n")
const DESIGN = await pagePath(B, "Design")
// (a built-in page is read-only, no cursor: the user's own dashboard, a copy of it, for the cursor)
const MINE = "Notes/Qa dashboard.md"
writeFileSync(`${VAULT}/${MINE}`, readFileSync(`${VAULT}/${DESIGN}`, "utf8"))
const hash = (p) => `#file/${encodeURIComponent(p)}`
// Where the reader is: the first "Section N" heading under the top of what scrolls, and how far below it. Compared by
// line, as places come back: the same scrollTop can show another line once the editor has measured.
const headingAt = (page) => page.evaluate(() => {
  const m = document.getElementById("main-scroll")
  const top = m && /auto|scroll/.test(getComputedStyle(m).overflowY) ? m.getBoundingClientRect().top : 0
  const l = [...document.querySelectorAll("[data-pane] .file-view .cm-line, #main-scroll .file-view .cm-line")]
    .find((l) => l.getBoundingClientRect().top > top + 40 && /Section \d+/.test(l.textContent))
  return l ? { text: l.textContent.replace(/^#+\s*/, ""), y: Math.round(l.getBoundingClientRect().top - top) } : null
})
const same = (a, b) => !!a && !!b && a.text === b.text && Math.abs(a.y - b.y) <= 8
const said = (a) => (a ? `${a.text} at ${a.y}` : "none")
const fileView = (page, p) => page.locator(`article.file-view[data-path="${p}"]:visible`).first()
const open = async (page, ui, p) => { await page.evaluate((h) => { location.hash = h }, hash(p)); await fileView(page, p).waitFor(); await ui.idle() }
const kept = async (page, ui, p) => {
  await ui.saved()
  check(`${p}'s place is kept`, await page.evaluate((key) => {
    const box = document.getElementById("main-scroll")
    const y = box && /auto|scroll/.test(getComputedStyle(box).overflowY) ? box.scrollTop : scrollY
    const place = new Map(JSON.parse(localStorage.getItem("vaultite.places") ?? "null")?.places ?? []).get(key)
    return place?.y === Math.round(y) && place.line !== undefined
  }, `file:${p}`))
}
// A computer: panes.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage(), ui = app(page)
  const top = () => page.evaluate(() => document.getElementById("main-scroll")?.scrollTop ?? -1)
  const props = page.locator("article section[aria-label=Properties]")
  const propsOpen = () => props.locator("button[aria-expanded]").first().getAttribute("aria-expanded")
  await page.goto(`${B}${hash(LONG)}`); await fileView(page, LONG).locator(".cm-content").waitFor(); await props.waitFor(); await ui.idle()
  check("editing a note: Properties folded", await props.count() === 1 && await propsOpen() === "false")
  await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 3000 }); await kept(page, ui, LONG)
  const left = await top(), leftAt = await headingAt(page)
  await open(page, ui, "Projects/Lighthouse.md")
  check(`another file starts at its top (${await top()})`, await top() < 50)
  check("editing a project: Properties folded too", await props.count() === 1 && await propsOpen() === "false")
  // (the place lands as the editor measures its lines: waited for)
  const landed = async (ms) => (await until(async () => { const h = await headingAt(page); return same(h, leftAt) ? h : null }, ms)) ?? await headingAt(page)
  await page.evaluate((h) => { location.hash = h }, hash(LONG))
  let at = await landed(6000)
  check(`back to the note: where it was left (${said(leftAt)} / ${said(at)})`, left > 2900 && same(at, leftAt))
  await page.reload()
  at = await landed(8000)
  check(`reloaded: where it was left (${said(leftAt)} / ${said(at)})`, same(at, leftAt))
  await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 0 }); await ui.idle()
  await props.locator("button[aria-expanded]").first().click(); await ui.idle()
  await open(page, ui, "Projects/Lighthouse.md")
  check("opening one file's Properties leaves another's folded", await propsOpen() === "false")
  await open(page, ui, LONG)
  check("a file whose Properties were opened keeps them open", await propsOpen() === "true")
  const viewNow = () => page.evaluate(() => document.querySelector("[role=status] button[aria-label^='Current view']")?.getAttribute("aria-label") ?? "")
  const view = async (how) => {
    const from = await viewNow()
    if (how.startsWith("ControlOrMeta")) await page.keyboard.press(how); else await command(page, how, 0)
    await until(async () => await viewNow() !== from); await page.locator("#main-scroll article.file-view:visible").first().waitFor(); await ui.idle()
  }
  await props.locator("button[aria-expanded]").first().click(); await ui.idle()
  await view("ControlOrMeta+e")
  check("reading a note: Properties, read-only", await props.count() === 1 && await props.locator("input, button[aria-label^=Remove]").count() === 0)
  await open(page, ui, "Projects/Lighthouse.md")
  const reading = await props.count() === 1
  await view("ControlOrMeta+e")
  check("a project: Properties reading and editing", reading && await props.count() === 1)
  // Switching views keeps the place: the same heading at the same height, whatever the view adds above it.
  await open(page, ui, LONG)
  if (await props.count() === 0) await view("ControlOrMeta+e") // back to editing
  const heading = (n) => page.evaluate((n) => {
    const box = document.getElementById("main-scroll")
    const line = [...box.querySelectorAll(".cm-line")].find((l) => l.textContent.replace(/^#+\s*/, "") === `Section ${n}`)
    return line ? Math.round(line.getBoundingClientRect().top - box.getBoundingClientRect().top) : null
  }, n)
  await page.evaluate(() => { const box = document.getElementById("main-scroll"); box.scrollTop = 4000 }); await ui.idle()
  const n = await page.evaluate(() => {
    const box = document.getElementById("main-scroll"), top = box.getBoundingClientRect().top + 120
    const l = [...box.querySelectorAll(".cm-line")].find((l) => /Section \d+/.test(l.textContent) && l.getBoundingClientRect().top > top)
    return Number(/Section (\d+)/.exec(l.textContent)[1])
  })
  // (where it is once the editor has measured it: the same twice in a row)
  let was = await heading(n)
  await until(async () => { const h = await heading(n); const still = h === was; was = h; return still }, 5000, 300)
  for (const [how, name] of [["ControlOrMeta+e", "reading"], ["ControlOrMeta+e", "live preview"], ["Switch to source mode", "source"], ["Switch to live preview", "live preview again"], ["ControlOrMeta+e", "reading"], ["Switch to source mode", "source from reading"], ["ControlOrMeta+e", "reading from source"]]) {
    await view(how)
    const now = (await until(async () => { const h = await heading(n); return h !== null && Math.abs(h - was) <= 3 ? h : null }, 4000)) ?? await heading(n)
    check(`switched to ${name}: Section ${n} stays where it was (${was} -> ${now})`, now !== null && Math.abs(now - was) <= 3)
  }
  const stays = async (want) => (await until(async () => { const h = await heading(n); return /reading/i.test(await viewNow()) === (want === "reading") && h !== null && Math.abs(h - was) <= 3 ? h : null }, 5000)) ?? await heading(n)
  {
    const other = await ctx.newPage()
    await other.goto(`${B}${hash(LONG)}`)
    await other.waitForSelector("#main-scroll .cm-content")
    await other.keyboard.press("ControlOrMeta+e")
    const now = await stays("editing")
    check(`another window switches the view: this one follows, Section ${n} where it was (${was} -> ${now}, ${await viewNow()})`, now !== null && Math.abs(now - was) <= 3 && !/reading/i.test(await viewNow()))
    await other.close()
  }
  await page.keyboard.press("ControlOrMeta+e")
  check(`back to reading for the properties (${await stays("reading")})`, /reading/i.test(await viewNow()))
  await page.evaluate((p) => dispatchEvent(new CustomEvent("vau:properties", { detail: p })), LONG)
  const shownProps = await stays("editing")
  check(`a block's "This file's properties" from reading: editing, Section ${n} where it was (${was} -> ${shownProps}, ${await viewNow()})`, shownProps !== null && Math.abs(shownProps - was) <= 3 && !/reading/i.test(await viewNow()))
  await view("Switch to live preview")
  // A person file opens with its ```block-person drawn: the cursor goes into the text, never into a block at the top
  // (it would show its Markdown until a click elsewhere), and ⌘E back to editing does the same.
  {
    const drawn = () => page.evaluate(() => {
      const a = document.querySelector("#main-scroll article")
      return { raw: [...a.querySelectorAll(".cm-line")].some((l) => l.textContent.includes("```block-person")),
        typing: !!document.activeElement?.closest(".cm-content") }
    })
    const settled = async () => (await until(async () => { const d = await drawn(); return !d.raw && d.typing && d })) || await drawn()
    await open(page, ui, PERSON)
    let d = await settled()
    check(`opening a person file: the person block drawn, the cursor in the text (${JSON.stringify(d)})`, !d.raw && d.typing)
    await view("ControlOrMeta+e"); await view("ControlOrMeta+e")
    d = await settled()
    check(`reading and back to editing: the person block still drawn (${JSON.stringify(d)})`, !d.raw && d.typing)
  }
  // A dashboard (drawn as a grid in reading) keeps its place, both ways.
  await open(page, ui, DESIGN)
  // In reading (the pane's view is the last one used: the person step above leaves it editing).
  const inReading = () => page.evaluate(() => /reading/i.test(document.querySelector("[role=status] button[aria-label^='Current view']")?.getAttribute("aria-label") ?? ""))
  if (!(await inReading())) await view("ControlOrMeta+e")
  // Its place is the card at the top of the pane (its first line in the file, data-line: places are kept by line since
  // 4376642 and 9b9f4b8, not by how far down, since the editor and the grid aren't the same height in proportion).
  const card = () => page.evaluate(() => {
    const b = document.getElementById("main-scroll"), top = b.getBoundingClientRect().top + 8
    const el = [...b.querySelectorAll("[data-line]")].find((e) => { const r = e.getBoundingClientRect(); return r.height && r.top <= top && r.bottom > top })
    return el ? { line: Number(el.dataset.line), end: Number(el.dataset.end ?? el.dataset.line) } : null
  })
  // The editor's line at the top of the pane (8px in, like card(); the body's, 0-based like data-line), through
  // CodeMirror's own handle on its content (cmTile.view).
  const editorTop = () => page.evaluate(() => {
    const v = document.querySelector("#main-scroll .cm-content")?.cmTile?.view
    if (!v) return null
    const b = v.lineBlockAtHeight(document.getElementById("main-scroll").getBoundingClientRect().top + 8 - v.documentTop)
    // (the editor holds the whole file: the frontmatter's lines aren't the body's)
    const fm = /^---\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)\n?/.exec(v.state.doc.toString())?.[0] ?? ""
    return v.state.doc.lineAt(b.from).number - 1 - (fm.match(/\n/g)?.length ?? 0)
  })
  // Halfway down, then the card there lined up with the top of the pane (the hard case: a place at a part's very top
  // can read back as the line above it, and switching back would show the part before); in the gap between two rows, the next.
  await page.evaluate(() => { const b = document.getElementById("main-scroll"); b.scrollTop = (b.scrollHeight - b.clientHeight) / 2 }); await ui.idle()
  await page.evaluate(() => {
    const b = document.getElementById("main-scroll"), top = b.getBoundingClientRect().top + 8
    const cards = [...b.querySelectorAll("[data-line]")].filter((e) => e.getBoundingClientRect().height)
    const el = cards.find((e) => { const r = e.getBoundingClientRect(); return r.top <= top && r.bottom > top }) ?? cards.find((e) => e.getBoundingClientRect().top > top)
    if (el) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top
  }); await ui.idle()
  const c0 = await card()
  await view("ControlOrMeta+e")
  const shown = await editorTop()
  check(`a dashboard keeps its place, read to edit: the card at the top (lines ${c0?.line}-${c0?.end}) is the editor's top line (${shown})`,
    await inReading() === false && c0 !== null && shown !== null && shown >= c0.line && shown <= c0.end)
  await view("ControlOrMeta+e")
  const c1 = await card()
  check(`...and back to reading, the same card at the top (line ${c0?.line} -> ${c1?.line})`, c0 !== null && c1?.line === c0.line)
  // ⌘E to reading and back keeps the cursor where it was (a dashboard's editor is made anew), so typing goes on there.
  const cursor = () => page.evaluate(() => {
    const v = document.querySelector("#main-scroll .cm-content")?.cmTile?.view
    return v && v.hasFocus ? v.state.selection.main.head : null
  })
  for (const file of [MINE, LONG]) {
    await open(page, ui, file)
    if (await inReading()) { await page.keyboard.press("ControlOrMeta+e"); await until(async () => !(await inReading()), 5000) }
    // (from the top: a place still landing would move the line under the click)
    await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 0 }); await ui.idle()
    const lineEl = page.locator("#main-scroll .cm-line").nth(4)
    await lineEl.click(); await ui.idle()
    await page.keyboard.press("End"); await ui.idle()
    const at = await cursor()
    await page.keyboard.press("ControlOrMeta+e"); await until(() => inReading(), 5000); await ui.idle()
    await page.keyboard.press("ControlOrMeta+e")
    const back = await until(async () => !(await inReading()) && await cursor(), 5000)
    check(`${file}: ⌘E twice keeps the cursor (${at} -> ${back})`, at !== null && back === at)
  }
  // (and the editor's trace says so: the views switched, the editors made, never the text)
  const evs = await page.evaluate(() => (window.__vauTrace?.editor ?? []).map((e) => e.ev))
  check(`the editor trace has views, mounts and updates (${evs.length})`, ["view", "land", "mount", "destroy", "update"].every((e) => evs.includes(e)))
  await ctx.close()
}
// A phone: the window scrolls, one tab at a time.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage(), ui = app(page)
  await page.goto(`${B}${hash(LONG)}`); await fileView(page, LONG).locator(".cm-content").waitFor(); await ui.idle()
  await page.evaluate(() => scrollTo(0, 2000)); await kept(page, ui, LONG)
  const phoneAt = await headingAt(page)
  await open(page, ui, "Projects/Lighthouse.md")
  check(`phone: another file starts at its top (${await page.evaluate(() => scrollY)})`, await page.evaluate(() => scrollY) < 50)
  await open(page, ui, LONG)
  const phoneBack = (await until(async () => { const h = await headingAt(page); return same(h, phoneAt) && h })) || await headingAt(page)
  check(`phone: back to the note, where it was left (${said(phoneAt)} / ${said(phoneBack)})`, same(phoneBack, phoneAt))
  // The read / edit toggle in the header keeps the same line at the top.
  const top = () => page.evaluate(() => {
    const l = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.getBoundingClientRect().top > 120 && /Section \d+/.test(l.textContent))
    return l ? { text: l.textContent.replace(/^#+\s*/, ""), y: Math.round(l.getBoundingClientRect().top) } : null
  })
  const before = await top()
  const toggle = page.locator("[data-view-toggle]"), mode = await toggle.getAttribute("data-view-toggle")
  await toggle.click(); await page.locator(`[data-view-toggle]:not([data-view-toggle="${mode}"])`).waitFor(); await fileView(page, LONG).waitFor(); await ui.idle()
  const line = await page.evaluate((t) => {
    const l = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.textContent.replace(/^#+\s*/, "") === t)
    return l ? Math.round(l.getBoundingClientRect().top) : null
  }, before.text)
  check(`phone: switching view keeps ${before.text} in place (${before.y} -> ${line})`, line !== null && Math.abs(line - before.y) <= 3)
  await ctx.close()
}
await done()
