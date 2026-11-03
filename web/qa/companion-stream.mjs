// Companion, an answer streamed into a note (as a chat session's edit is written): its words come in pieces where it
// writes, it waits while the user types and goes on after, their words stay theirs (what they wrote meanwhile reaches it
// as theirs alone), its whole edit is one undo step, its cursor stays at its end, and Esc stops it where it is. The
// server's stream is played to the window's socket, so no session runs.
// WRITES "QA companion/Stream.md" and the plugin's data.json: throwaway server only.
//   node web/qa/companion-stream.mjs <base url> <vault path>
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
const file = (rel) => `${VAULT}/${rel}`
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = keep(".vaultite/plugins/companion/data.json")
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const NOTE = "QA companion/Stream.md", TEXT = "# Stream\n\nLine one.\n\nLine two.\n"
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
await api("PUT", "file", { path: NOTE, text: TEXT })

const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } })
// (the companion's socket: what it sends kept, and messages played to it as if the server sent them)
await ctx.addInitScript(() => {
  const W = window.WebSocket
  window.__sent = []
  window.WebSocket = class extends W {
    constructor(...a) {
      super(...a)
      if (!String(a[0]).includes("companion/live")) return
      window.__companion = this
      const send = this.send.bind(this)
      this.send = (d) => { try { window.__sent.push(JSON.parse(d)) } catch { /* not ours */ } send(d) }
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
// (the note as the editor has it, without the frontmatter a vault's note dates add)
const doc = () => page.evaluate((p) => { const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`); return (el.cmView?.view ?? el.cmTile?.view).state.doc.toString() }, NOTE).then((t) => t.replace(/^---\n[\s\S]*?\n---\n\n?/, ""))
const play = (m) => page.evaluate((x) => window.__play(x), m)
const sent = () => page.evaluate(() => window.__sent)
/** The caret at the end of the title. */
const atTitle = () => page.evaluate((p) => {
  const el = document.querySelector(`.file-view[data-path="${p}"] .cm-content`), v = el.cmView?.view ?? el.cmTile?.view, d = v.state.doc
  for (let i = 1; i <= d.lines; i++) if (d.line(i).text.startsWith("# Stream")) { v.focus(); v.dispatch({ selection: { anchor: d.line(i).to } }); return i }
  return 0
}, NOTE)

// Its words come in pieces after the line it writes after; the user types on the title meanwhile: it waits for them.
await play({ t: "stream", rid: "q1", agent: "Claude", path: NOTE, after: "Line one.", text: "First" })
await until(async () => (await doc()).includes("Line one.\nFirst"), 3000)
await play({ t: "stream-more", rid: "q1", at: 5, add: " words" })
await until(async () => (await doc()).includes("First words"), 3000)
check("stream: its first words go right after the line it writes after", (await doc()) === "# Stream\n\nLine one.\nFirst words\n\nLine two.\n", await doc())
await atTitle()
await page.keyboard.type("!!", { delay: 30 })
await play({ t: "stream-more", rid: "q1", at: 11, add: " come in" })
await wait(250)
check("yield: while the user types, it waits", !(await doc()).includes("come in"), await doc())
await until(async () => (await doc()).includes("First words come in"), 3000)
check("yield: once they stop, it goes on, and their words are where they typed them", (await doc()).startsWith("# Stream!!\n") && (await doc()).includes("First words come in\n"), await doc())
await play({ t: "stream-more", rid: "q1", at: 19, add: "\nand more" })
await play({ t: "stream-end", rid: "q1", text: "First words come in\nand more" })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q1"), 3000)
const fin = await doc()
check("stream: it ends with all its words, and tells the server so", fin === "# Stream!!\n\nLine one.\nFirst words come in\nand more\n\nLine two.\n" &&
  (await sent()).find((m) => m.t === "done" && m.rid === "q1")?.text === "First words come in\nand more", fin)
// (what reaches it of theirs: the title alone, never its own words as theirs)
const edit = await until(async () => (await sent()).find((m) => m.t === "moment" && m.kind === "edit"), 6000), title = await atTitle()
check("stream: what the user typed meanwhile reaches it as theirs alone", JSON.stringify(edit?.hunks) === JSON.stringify([{ line: title, removed: ["# Stream"], added: ["# Stream!!"] }]), edit)

// Undo: all of its edit at once (it ended after they typed), then their typing.
await atTitle()
await page.keyboard.press("Meta+z")
await wait(150)
const once = await doc()
await page.keyboard.press("Meta+z")
await wait(150)
const twice = await doc()
check("undo: Cmd+Z takes all of its edit in one step, then the user's typing", once === TEXT.replace("# Stream", "# Stream!!") && twice === TEXT, [once, twice])
await page.keyboard.press("Meta+Shift+z")
await page.keyboard.press("Meta+Shift+z")
await wait(150)
check("redo: and back", (await doc()) === fin, await doc())

// Esc: it stops where it is, says so, and asks the server to stop its turn.
await play({ t: "stream", rid: "q2", agent: "Claude", path: NOTE, after: "Line two.", text: "Stopped" })
await until(async () => (await doc()).includes("Line two.\nStopped"), 3000)
await atTitle()
await page.keyboard.press("Escape")
await play({ t: "stream-more", rid: "q2", at: 7, add: " here, not here" })
await wait(300)
const esc = (await sent()).find((m) => m.t === "done" && m.rid === "q2")
check("Esc: its words stop where they were", (await doc()).endsWith("Line two.\nStopped\n") && esc?.stopped === true && esc.text === "Stopped", [await doc(), esc])

// A replace streams over its text; the cursor is the server's (its agent message), so only the text is checked here.
await play({ t: "stream", rid: "q3", agent: "Claude", path: NOTE, find: "Line one.", text: "Line" })
await play({ t: "stream-more", rid: "q3", at: 4, add: " 1." })
await play({ t: "stream-end", rid: "q3", text: "Line 1." })
await until(async () => (await sent()).some((m) => m.t === "done" && m.rid === "q3"), 3000)
check("stream: a replace takes its text's place", (await doc()).includes("\nLine 1.\nFirst words") && !(await doc()).includes("Line one."), await doc())

await ctx.close()
restore()
rmSync(file("QA companion/Stream.md"), { force: true })
await done()
