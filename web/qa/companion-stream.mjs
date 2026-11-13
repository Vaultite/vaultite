// Companion's answer streamed into a note: it waits while the user types, is one undo step, and Esc stops it.
// Plays the server's stream to the window's socket, so no session runs.
// WRITES "QA companion/Streamed answer.md" and the plugin's data.json: throwaway server only.
//   node web/qa/companion-stream.mjs <base url> <vault path>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = keep(".vaultite/plugins/companion/data.json")
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const NOTE = "QA companion/Streamed answer.md", TEXT = "# Stream\n\nLine one.\n\nLine two.\n"
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
await api("PUT", "file", { path: NOTE, text: TEXT })

const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } })
await ctx.addInitScript(() => {
  const W = window.WebSocket
  window.__sent = []
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a)
      if (!String(a[0]).includes("companion/live")) return
      window.__companion = this
      const send = this.send.bind(this)
      this.send = (d) => { try { window.__sent.push(JSON.parse(d)) } catch {} send(d) }
    }
  }
  window.__play = (m) => window.__companion.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(m) }))
})
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${encodeURIComponent(NOTE)}`)
const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
await editor.waitFor({ timeout: 15000 })
await until(() => page.evaluate(() => window.__companion?.readyState === 1), 10000)
await wait(1200)
const doc = () => page.evaluate((p) => { const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`); return (el.cmView?.view ?? el.cmTile?.view).state.doc.toString() }, NOTE).then((t) => t.replace(/^---\n[\s\S]*?\n---\n\n?/, ""))
const play = (m) => page.evaluate((x) => window.__play(x), m)
const sent = () => page.evaluate(() => window.__sent)
const atTitle = () => page.evaluate((p) => {
  const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`), v = el.cmView?.view ?? el.cmTile?.view, d = v.state.doc
  for (let i = 1; i <= d.lines; i++) if (d.line(i).text.startsWith("# Stream")) { v.focus(); v.dispatch({ selection: { anchor: d.line(i).to } }); return i }
  return 0
}, NOTE)

await play({ t: "stream", rid: "q1", agent: "Claude", path: NOTE, after: "Line one.", text: "First" })
await until(async () => (await doc()).includes("Line one.\nFirst"), 3000)
await play({ t: "stream-more", rid: "q1", at: 5, add: " words" })
await until(async () => (await doc()).includes("First words"), 3000)
check("stream: its first words go right after the line it writes after", (await doc()) === "# Stream\n\nLine one.\nFirst words\n\nLine two.\n", await doc())
await atTitle()
await page.keyboard.type("xx", { delay: 30 })
await play({ t: "stream-more", rid: "q1", at: 11, add: " come in" })
await wait(250)
check("yield: while the user types, it waits", !(await doc()).includes("come in"), await doc())
await until(async () => (await doc()).includes("First words come in"), 3000)
check("yield: once they stop, it goes on, and their words are where they typed them", (await doc()).startsWith("# Streamxx\n") && (await doc()).includes("First words come in\n"), await doc())
await play({ t: "stream-more", rid: "q1", at: 19, add: "\nand more" })
await play({ t: "stream-end", rid: "q1", text: "First words come in\nand more" })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q1"), 3000)
const fin = await doc()
check("stream: it ends with all its words, and tells the server so", fin === "# Streamxx\n\nLine one.\nFirst words come in\nand more\n\nLine two.\n" &&
  (await sent()).find((m) => m.t === "done" && m.rid === "q1")?.text === "First words come in\nand more", fin)
await page.evaluate((p) => { const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`), v = el.cmView?.view ?? el.cmTile?.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length - 1 } }) }, NOTE)
await page.keyboard.type(" mine", { delay: 20 })
const edit = await until(async () => (await sent()).find((m) => m.t === "moment" && m.kind === "edit"), 8000), title = await atTitle()
check("stream: what the user typed meanwhile reaches it as theirs alone, a hunk each place", JSON.stringify(edit?.hunks) === JSON.stringify([{ line: title, removed: ["# Stream"], added: ["# Streamxx"] },
  { line: title + 6, removed: ["Line two."], added: ["Line two. mine"] }]), edit)

await page.keyboard.press("ControlOrMeta+z")
await wait(150)
const zero = await doc()
await page.keyboard.press("ControlOrMeta+z")
await wait(150)
const once = await doc()
await page.keyboard.press("ControlOrMeta+z")
await wait(150)
const twice = await doc()
check("undo: Cmd+Z takes all of its edit in one step, never with the user's typing", zero === fin && once === TEXT.replace("# Stream", "# Streamxx") && twice === TEXT, [zero, once, twice])
await page.keyboard.press("ControlOrMeta+Shift+z")
await page.keyboard.press("ControlOrMeta+Shift+z")
await wait(150)
check("redo: and back", (await doc()) === fin, await doc())

await play({ t: "stream", rid: "q2", agent: "Claude", path: NOTE, after: "Line two.", text: "Stopped" })
await until(async () => (await doc()).includes("Line two.\nStopped"), 3000)
await atTitle()
await page.keyboard.press("Escape")
await play({ t: "stream-more", rid: "q2", at: 7, add: " here, not here" })
await wait(300)
const esc = (await sent()).find((m) => m.t === "done" && m.rid === "q2")
check("Esc: its words stop where they were", (await doc()).endsWith("Line two.\nStopped\n") && esc?.stopped === true && esc.text === "Stopped", [await doc(), esc])

await play({ t: "stream", rid: "q3", agent: "Claude", path: NOTE, find: "Line one.", text: "Line" })
await play({ t: "stream-more", rid: "q3", at: 4, add: " 1." })
await play({ t: "stream-end", rid: "q3", text: "Line 1." })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q3"), 3000)
check("stream: a replace takes its text's place", (await doc()).includes("\nLine 1.\nFirst words") && !(await doc()).includes("Line one."), await doc())

const atEnd = () => page.evaluate((p) => { const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`), v = el.cmView?.view ?? el.cmTile?.view; v.focus(); v.dispatch({ selection: { anchor: v.state.doc.length } }) }, NOTE)
await atEnd()
await play({ t: "stream", rid: "q4", agent: "Claude", path: NOTE, append: true, text: "Appended" })
await play({ t: "stream-more", rid: "q4", at: 8, add: " words" })
await play({ t: "stream-end", rid: "q4", text: "Appended words" })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q4"), 3000)
await page.keyboard.type("Mine", { delay: 20 })
check("caret: typing where its streamed words went in follows them, on the next line", (await doc()).endsWith("\nAppended words\nMine"), await doc())
await page.keyboard.press("Enter")
await play({ t: "edit", rid: "q5", agent: "Claude", path: NOTE, append: true, text: "Typed whole", animate: false })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q5"), 3000)
await page.keyboard.type("More", { delay: 20 })
check("caret: and where an edit went in whole", (await doc()).endsWith("\nMine\nTyped whole\nMore"), await doc())

await atTitle()
await page.keyboard.type("yy", { delay: 30 })
await play({ t: "stream", rid: "q6", agent: "Claude", path: NOTE, after: "Line two.", text: "Held" })
await wait(250)
check("yield: its place waits while the user types", !(await doc()).includes("Held"), await doc())
await until(async () => (await doc()).includes("Line two.\nHeld"), 3000)
await atTitle()
await page.keyboard.type("zz", { delay: 30 })
await play({ t: "stream-end", rid: "q6", text: "Held back" })
await wait(250)
check("yield: its last words wait too", !(await doc()).includes("Held back"), await doc())
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q6"), 3000)
check("yield: then they go in where it was writing", (await doc()).includes("Line two.\nHeld back\n") && (await doc()).startsWith("# Streamxxyyzz\n"), await doc())

const where = async () => (await sent()).filter((m) => m.t === "where").at(-1)
const hide = (on) => page.evaluate(([p, on]) => { document.querySelector(`.file-view[data-path="${p}"]`).style.display = on ? "none" : "" }, [NOTE, on])
await page.evaluate(() => document.activeElement?.blur())
await hide(true)
const hidden = await until(async () => { const w = await where(); return w && !w.shown.includes(NOTE) && w.open.includes(NOTE) ? w : null }, 3000)
check("hidden tab: its note is open but not shown, so edits go to the file", !!hidden, await where())
await play({ t: "stream", rid: "q7", agent: "Claude", path: NOTE, after: "Line 1.", text: "Nowhere" })
const unshown = await until(async () => (await sent()).find((m) => m.t === "done" && m.rid === "q7"), 3000)
check("hidden tab: a stream there is answered as not shown, so the server writes it", unshown?.ok === false && !unshown.error, unshown)
await hide(false)
check("hidden tab: shown again, it says so", !!(await until(async () => (await where())?.shown.includes(NOTE), 3000)), await where())

await play({ t: "stream", rid: "q8", agent: "Claude", path: NOTE, after: "Line 1.", text: "Cut short" })
await until(async () => (await doc()).includes("Line 1.\nCut short"), 3000)
await page.evaluate(() => window.__companion.close())
await wait(200)
await play({ t: "stream-more", rid: "q8", at: 9, add: " past the cut" })
await wait(200)
check("socket closed: the stream ends with what it had", (await doc()).includes("Line 1.\nCut short\n") && !(await doc()).includes("past the cut"), await doc())

await ctx.close()
restore()
rmSync(file("QA companion/Streamed answer.md"), { force: true })
await done()
