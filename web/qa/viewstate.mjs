// Where you left a place (core/viewstate.ts): a tab comes back scrolled to where it was (another tab and back, the app
// reloaded, a phone's tab), and Properties are open in editing and reading (read-only), the same for a note and a
// project, and stay folded on a file once folded. Switching views (reading, live preview, source; FileView's keepPlace)
// keeps the same line at the top, on a computer and on a phone, and a dashboard the card at the top. WRITES to the vault (a long note): throwaway server only.
//   node web/qa/viewstate.mjs <base url> <vault path>
import { writeFileSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
import { subjects } from "./subjects.mjs"
const { args: [B, VAULT], browser, check, done } = await qa(import.meta.url)
const LONG = "Notes/Qa long note.md"
writeFileSync(`${VAULT}/${LONG}`, `---\ntype: note\nkind: note\ntags: [Qa]\n---\n\n${Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\n${"Text to make this note long enough to scroll. ".repeat(8)}`).join("\n\n")}\n`)
const hash = (p) => `#file/${encodeURIComponent(p)}`
// Where the reader is: the first "Section N" heading under the top of what scrolls (a pane, or the window on a phone),
// and how far below it. A place comes back by its line (core/viewstate.ts), so that's what's compared: the same
// scrollTop can show another line once the editor has measured what it had only estimated.
const headingAt = (page) => page.evaluate(() => {
  const m = document.getElementById("main-scroll")
  const top = m && /auto|scroll/.test(getComputedStyle(m).overflowY) ? m.getBoundingClientRect().top : 0
  const l = [...document.querySelectorAll("[data-pane] .file-view .cm-line, #main-scroll .file-view .cm-line")]
    .find((l) => l.getBoundingClientRect().top > top + 40 && /Section \d+/.test(l.textContent))
  return l ? { text: l.textContent.replace(/^#+\s*/, ""), y: Math.round(l.getBoundingClientRect().top - top) } : null
})
const same = (a, b) => !!a && !!b && a.text === b.text && Math.abs(a.y - b.y) <= 8
const said = (a) => (a ? `${a.text} at ${a.y}` : "none")
// A computer: panes.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const top = () => page.evaluate(() => document.getElementById("main-scroll")?.scrollTop ?? -1)
  const props = page.locator("article section[aria-label=Properties]")
  const propsOpen = () => props.locator("button[aria-expanded]").first().getAttribute("aria-expanded")
  await page.goto(`${B}${hash(LONG)}`); await wait(2000)
  check("editing a note: Properties folded", await props.count() === 1 && await propsOpen() === "false")
  await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 3000 }); await wait(600)
  const left = await top(), leftAt = await headingAt(page)
  await page.evaluate((h) => { location.hash = h }, hash("Projects/Lighthouse.md")); await wait(1500)
  check(`another file starts at its top (${await top()})`, await top() < 50)
  check("editing a project: Properties folded too", await props.count() === 1 && await propsOpen() === "false")
  await page.evaluate((h) => { location.hash = h }, hash(LONG)); await wait(1500)
  check(`back to the note: where it was left (${said(leftAt)} / ${said(await headingAt(page))})`, left > 2900 && same(await headingAt(page), leftAt))
  await page.reload(); await wait(2500)
  check(`reloaded: where it was left (${said(leftAt)} / ${said(await headingAt(page))})`, same(await headingAt(page), leftAt))
  await page.evaluate(() => { document.getElementById("main-scroll").scrollTop = 0 }); await wait(300)
  await props.locator("button[aria-expanded]").first().click(); await wait(200)
  await page.evaluate((h) => { location.hash = h }, hash("Projects/Lighthouse.md")); await wait(1200)
  check("opening one file's Properties leaves another's folded", await propsOpen() === "false")
  await page.evaluate((h) => { location.hash = h }, hash(LONG)); await wait(1200)
  check("a file whose Properties were opened keeps them open", await propsOpen() === "true")
  await props.locator("button[aria-expanded]").first().click(); await wait(200)
  await page.keyboard.press("ControlOrMeta+e"); await wait(800)
  check("reading a note: Properties, read-only", await props.count() === 1 && await props.locator("input, button[aria-label^=Remove]").count() === 0)
  await page.evaluate((h) => { location.hash = h }, hash("Projects/Lighthouse.md")); await wait(1200)
  const reading = await props.count() === 1
  await page.keyboard.press("ControlOrMeta+e"); await wait(800)
  check("a project: Properties reading and editing", reading && await props.count() === 1)
  // Switching views keeps the place: the same heading at the same height, whatever the view adds above it.
  const palette = async (name) => { await page.keyboard.press("ControlOrMeta+p"); await wait(300); await page.keyboard.type(name); await wait(300); await page.keyboard.press("Enter"); await wait(900) }
  await page.evaluate((h) => { location.hash = h }, hash(LONG)); await wait(1500)
  if (await props.count() === 0) { await page.keyboard.press("ControlOrMeta+e"); await wait(800) } // back to editing
  const heading = (n) => page.evaluate((n) => {
    const box = document.getElementById("main-scroll")
    const line = [...box.querySelectorAll(".cm-line")].find((l) => l.textContent.replace(/^#+\s*/, "") === `Section ${n}`)
    return line ? Math.round(line.getBoundingClientRect().top - box.getBoundingClientRect().top) : null
  }, n)
  await page.evaluate(() => { const box = document.getElementById("main-scroll"); box.scrollTop = 4000 }); await wait(400)
  const n = await page.evaluate(() => {
    const box = document.getElementById("main-scroll"), top = box.getBoundingClientRect().top + 120
    const l = [...box.querySelectorAll(".cm-line")].find((l) => /Section \d+/.test(l.textContent) && l.getBoundingClientRect().top > top)
    return Number(/Section (\d+)/.exec(l.textContent)[1])
  })
  const was = await heading(n)
  for (const [how, name] of [["ControlOrMeta+e", "reading"], ["ControlOrMeta+e", "live preview"], ["Switch to source mode", "source"], ["Switch to live preview", "live preview again"], ["ControlOrMeta+e", "reading"], ["Switch to source mode", "source from reading"], ["ControlOrMeta+e", "reading from source"]]) {
    if (how.startsWith("ControlOrMeta")) { await page.keyboard.press(how); await wait(900) } else await palette(how)
    const now = await heading(n)
    check(`switched to ${name}: Section ${n} stays where it was (${was} -> ${now})`, now !== null && Math.abs(now - was) <= 3)
  }
  await palette("Switch to live preview")
  // A person file opens with its ```block-person drawn: the cursor goes into the text, never into a block at the top
  // (it would show its Markdown until a click elsewhere), and ⌘E back to editing does the same.
  const person = (await subjects(B)).people.find((p) => /^---\n[\s\S]*?\n---\n\s*```block-person/.test(p.text))
  if (person) {
    const drawn = () => page.evaluate(() => {
      const a = document.querySelector("#main-scroll article")
      return { raw: [...a.querySelectorAll(".cm-line")].some((l) => l.textContent.includes("```block-person")),
        typing: !!document.activeElement?.closest(".cm-content") }
    })
    await page.evaluate((h) => { location.hash = h }, hash(person.path)); await wait(1800)
    let d = await drawn()
    check(`opening a person file: the person block drawn, the cursor in the text (${JSON.stringify(d)})`, !d.raw && d.typing)
    await page.keyboard.press("ControlOrMeta+e"); await wait(900); await page.keyboard.press("ControlOrMeta+e"); await wait(1200)
    d = await drawn()
    check(`reading and back to editing: the person block still drawn (${JSON.stringify(d)})`, !d.raw && d.typing)
  } else check("the vault needs a person file starting with a person block", false)
  // A dashboard (drawn as a grid in reading) keeps its place, both ways.
  await page.evaluate((h) => { location.hash = h }, hash("Dashboards/Design.md")); await wait(2500)
  // In reading (the pane's view is the last one used: the person step above leaves it editing).
  const inReading = () => page.evaluate(() => /reading/i.test(document.querySelector("[role=status] button[aria-label^='Current view']")?.getAttribute("aria-label") ?? ""))
  if (!(await inReading())) { await page.keyboard.press("ControlOrMeta+e"); await wait(1500) }
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
  // can read back as the line above it, and switching back would show the part before).
  await page.evaluate(() => { const b = document.getElementById("main-scroll"); b.scrollTop = (b.scrollHeight - b.clientHeight) / 2 }); await wait(400)
  await page.evaluate(() => {
    const b = document.getElementById("main-scroll"), top = b.getBoundingClientRect().top + 8
    const el = [...b.querySelectorAll("[data-line]")].find((e) => { const r = e.getBoundingClientRect(); return r.height && r.top <= top && r.bottom > top })
    if (el) b.scrollTop += el.getBoundingClientRect().top - b.getBoundingClientRect().top
  }); await wait(400)
  const c0 = await card()
  await page.keyboard.press("ControlOrMeta+e"); await wait(1500)
  const shown = await editorTop()
  check(`a dashboard keeps its place, read to edit: the card at the top (lines ${c0?.line}-${c0?.end}) is the editor's top line (${shown})`,
    await inReading() === false && c0 !== null && shown !== null && shown >= c0.line && shown <= c0.end)
  await page.keyboard.press("ControlOrMeta+e"); await wait(1500)
  const c1 = await card()
  check(`...and back to reading, the same card at the top (line ${c0?.line} -> ${c1?.line})`, c0 !== null && c1?.line === c0.line)
  // ⌘E to reading and back keeps the cursor where it was (a dashboard's editor is made anew), so typing goes on there.
  const cursor = () => page.evaluate(() => {
    const v = document.querySelector("#main-scroll .cm-content")?.cmTile?.view
    return v && v.hasFocus ? v.state.selection.main.head : null
  })
  for (const file of ["Dashboards/Design.md", LONG]) {
    await page.evaluate((h) => { location.hash = h }, hash(file)); await wait(2000)
    if (await inReading()) { await page.keyboard.press("ControlOrMeta+e"); await wait(1500) }
    const lineEl = page.locator("#main-scroll .cm-line").nth(4)
    await lineEl.click(); await wait(200)
    await page.keyboard.press("End"); await wait(200)
    const at = await cursor()
    await page.keyboard.press("ControlOrMeta+e"); await wait(1500)
    await page.keyboard.press("ControlOrMeta+e"); await wait(1500)
    const back = await cursor()
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
  const page = await ctx.newPage()
  await page.goto(`${B}${hash(LONG)}`); await wait(2000)
  await page.evaluate(() => scrollTo(0, 2000)); await wait(600)
  const phoneAt = await headingAt(page)
  await page.evaluate((h) => { location.hash = h }, hash("Projects/Lighthouse.md")); await wait(1500)
  check(`phone: another file starts at its top (${await page.evaluate(() => scrollY)})`, await page.evaluate(() => scrollY) < 50)
  await page.evaluate((h) => { location.hash = h }, hash(LONG)); await wait(1500)
  check(`phone: back to the note, where it was left (${said(phoneAt)} / ${said(await headingAt(page))})`, same(await headingAt(page), phoneAt))
  // The read / edit toggle in the header keeps the same line at the top.
  const top = () => page.evaluate(() => {
    const l = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.getBoundingClientRect().top > 120 && /Section \d+/.test(l.textContent))
    return l ? { text: l.textContent.replace(/^#+\s*/, ""), y: Math.round(l.getBoundingClientRect().top) } : null
  })
  const before = await top()
  await page.locator("[data-view-toggle]").click(); await wait(1200)
  const line = await page.evaluate((t) => {
    const l = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.textContent.replace(/^#+\s*/, "") === t)
    return l ? Math.round(l.getBoundingClientRect().top) : null
  }, before.text)
  check(`phone: switching view keeps ${before.text} in place (${before.y} -> ${line})`, line !== null && Math.abs(line - before.y) <= 3)
  await ctx.close()
}
await done()
