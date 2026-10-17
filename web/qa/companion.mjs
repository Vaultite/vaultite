// Companion: an agent's cursor glides to where it looks (reading what it's handed, a tick when it lets that pass), its
// words pop in a bubble by it, comments sit in the margin (a dot on a phone, opened by a tap) and take a reply, a suggestion is struck through with its replacement after it
// and Tab takes it, an edit is typed in before the user's eyes and lit in its colour, and "@claude …" + Enter is an ask
// the agent hears at once; what the user writes reaches it after a pause. Driven through the ops an agent calls.
// WRITES "QA companion/" and the plugin's data.json: throwaway server only.
//   node web/qa/companion.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/companion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
const op = (id, params = {}) => api("POST", `ops/${id}`, params)
const enc = encodeURIComponent

const plugins = JSON.parse(text(".vaultite/plugins.json") || "{}")
if (!(plugins.enabled ?? []).includes("companion")) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), "companion"] }, null, 2))
  await wait(1500)
}
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1 })
const DIR = "QA companion", NOTE = `${DIR}/Garden ideas.md`
rmSync(file(DIR), { recursive: true, force: true })
await api("PUT", "file", { path: NOTE, text: "# Garden ideas\n\nTomatos along the fence, where it's sunny.\n\nBasil between them.\n" })
await api("PUT", "file", { path: `${DIR}/Seeds.md`, text: "# Seeds\n" })
await op("companion.next", { timeout: 0 }) // (what came before)
await op("companion.clear")

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
await page.goto(`${B}/#file/${enc(NOTE)}`)
await page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 10000 })
await wait(1200)
const editor = page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)

// Its cursor goes where it looks.
await op("companion.look", { path: NOTE, find: "Basil" })
const cursor = page.locator('.companion-cursor[data-agent="Claude"]')
await cursor.waitFor({ timeout: 4000 })
await wait(900)
const basil = await editor.getByText("Basil between them").boundingBox()
const at = await cursor.boundingBox()
check("look: its cursor glides to the text it looks at", !!basil && !!at && Math.abs(at.y - basil.y) < 30 && Math.abs(at.x - basil.x) < 40, { basil, at })
await page.screenshot({ path: `${OUT}look.png` })
await op("companion.look", { path: `${DIR}/Seeds.md` })
await wait(900)
const row = await page.locator(`[data-tree-path="${DIR}/Seeds.md"]`).first().boundingBox(), there = await cursor.boundingBox()
check("look: a note that isn't open, its row in the file tree", !!row && !!there && Math.abs(there.y - row.y) < 20 && there.x < row.x + row.width, { row, there })

// Words by its cursor.
await op("companion.say", { text: "Basil keeps aphids off tomatoes.", path: NOTE, find: "Basil" })
await page.getByText("Basil keeps aphids off tomatoes.").waitFor({ timeout: 3000 })
await wait(800)
check("say: a bubble by its cursor", await cursor.getByText("Basil keeps aphids off tomatoes.").isVisible())
await page.screenshot({ path: `${OUT}say.png` })

// "@claude …" then Enter: an ask, at once; it shows thinking.
await editor.click()
await page.keyboard.press("Meta+End")
await page.keyboard.type("\n@claude how far apart should they be?\n")
let r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 6000)
await until(() => text(NOTE).includes("@claude how far apart"), 5000)
check("ask: @claude and Enter reach it at once, with the question and its line", r?.moments.some((m) => m.kind === "ask" && m.text === "how far apart should they be?" && m.path === NOTE && m.line === text(NOTE).split("\n").indexOf("@claude how far apart should they be?") + 1), r)
await until(async () => (await cursor.getAttribute("data-state")) === "thinking", 3000)
check("ask: its cursor shows it thinking", (await cursor.getAttribute("data-state")) === "thinking")
await wait(800)
await page.screenshot({ path: `${OUT}thinking.png` })
r = await until(async () => { const x = await op("companion.next", { timeout: 3 }); return x.moments?.find((m) => m.kind === "edit") ? x : null }, 8000)
check("edit: what the user wrote reaches it after a pause, as lines added", r?.moments.some((m) => m.kind === "edit" && m.hunks?.some((h) => h.added.includes("@claude how far apart should they be?"))), r)

// Handed a moment, its cursor reads it there; back for more without a word, a seen tick.
await until(async () => (await cursor.getAttribute("data-state")) === "reading", 3000)
check("edit: handed what they wrote, its cursor shows it reading", (await cursor.getAttribute("data-state")) === "reading")
await op("companion.next", { timeout: 0 })
await until(async () => (await cursor.getAttribute("data-seen")) !== null, 3000)
check("silence: back for more without acting, a seen tick by its cursor", await cursor.getByLabel("seen").isVisible())
await wait(600)
await page.screenshot({ path: `${OUT}seen.png` })

// Mid-sentence it waits longer: a burst of dictation is often half a thought.
await page.keyboard.type("Then the")
let t0 = Date.now()
r = await op("companion.next", { timeout: 6 })
check("pause: mid-sentence, what they wrote waits longer than the pause", r.moments?.some((m) => m.kind === "edit") && Date.now() - t0 > 1800, { ms: Date.now() - t0, r })
await page.keyboard.type(" basil.")
t0 = Date.now()
r = await op("companion.next", { timeout: 6 })
check("pause: a sentence's end, only the pause", r.moments?.some((m) => m.kind === "edit") && Date.now() - t0 < 1800, { ms: Date.now() - t0, r })

// A comment in the margin, a reply to it.
r = await op("companion.comment", { path: NOTE, find: "how far apart", text: "About 60 cm: they get big." })
const commentId = r.id
const card = page.locator(`[data-companion-note="${r.id}"]`)
await card.waitFor({ timeout: 3000 })
await wait(700)
const cb = await card.boundingBox(), content = await editor.boundingBox()
check("comment: a card in the margin, beside the text", !!cb && !!content && cb.x >= content.x + content.width, { cb, content })
await page.screenshot({ path: `${OUT}comment.png` })
await card.getByText("Reply").click()
await page.keyboard.type("And the basil?")
await page.keyboard.press("Enter")
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "reply") ? x : null }, 5000)
check("comment: a reply comes back to it", r?.moments.some((m) => m.kind === "reply" && m.text === "And the basil?"), r)
await op("companion.comment", { id: commentId, text: "25 cm is plenty." })
await card.getByText("25 cm is plenty.").waitFor({ timeout: 3000 })
check("comment: its answer joins the thread", true)

// A suggestion: struck through, the new text after it, Tab takes it.
r = await op("companion.suggest", { path: NOTE, find: "Tomatos", replace: "Tomatoes", why: "Spelling" })
await page.locator(".cm-companion-del").waitFor({ timeout: 3000 })
check("suggest: the old text struck through, the new after it", (await page.locator(".cm-companion-del").innerText()) === "Tomatos" && (await page.locator(".cm-companion-ins").innerText()) === "Tomatoes")
await page.screenshot({ path: `${OUT}suggest.png` })
await editor.getByText("along the fence").click()
await page.keyboard.press("Tab")
await until(() => text(NOTE).includes("Tomatoes along"), 5000)
check("suggest: Tab takes it, and it's saved", text(NOTE).includes("Tomatoes along the fence") && !(await page.locator(".cm-companion-del").count()), text(NOTE))
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "accept") ? x : null }, 5000)
check("suggest: the agent hears it was taken", !!r)

// An edit, typed in before the user's eyes and lit in its colour, then saved.
r = await op("companion.edit", { path: NOTE, line: text(NOTE).split("\n").findIndex((l) => l.startsWith("Basil")) + 1, text: "- Water them every morning" })
check("edit: typed into the open note", r.how === "typed", r)
check("edit: what it typed is lit in its colour", (await page.locator(".cm-companion-typed").count()) > 0)
await page.screenshot({ path: `${OUT}edit.png` })
await until(() => text(NOTE).includes("Basil between them.\n- Water them every morning"), 5000)
check("edit: and saved", text(NOTE).includes("Basil between them.\n- Water them every morning"), text(NOTE))
await page.keyboard.press("Meta+z")
await wait(400)
check("edit: the user can undo it", !(await editor.innerText()).includes("Water them every morning"))
await page.keyboard.press("Meta+Shift+z")

// A highlight in its colour.
await op("companion.highlight", { path: NOTE, find: "sunny" })
await page.locator(".cm-companion-hl").waitFor({ timeout: 3000 })
check("highlight: lit in its colour", (await page.locator(".cm-companion-hl").innerText()) === "sunny")
await page.screenshot({ path: `${OUT}highlight.png` })

// The user typing while it types: one moment after their pause, without its words, not one a key.
await op("companion.next", { timeout: 0 })
await editor.getByText("along the fence").click()
await page.keyboard.press("End")
const typing = op("companion.edit", { path: NOTE, append: true, text: "- Mulch in June, before the heat comes and dries the soil out" })
for (const ch of " or so") { await page.keyboard.type(ch); await wait(120) }
await typing
r = await until(async () => { const x = await op("companion.next", { timeout: 4 }); return x.moments?.length ? x : null }, 8000)
const edits = r?.moments.filter((m) => m.kind === "edit") ?? []
check("edit: typing while it types is one moment, theirs only", edits.length === 1 && edits[0].hunks[0].added.some((l) => l.endsWith("sunny. or so")) && !JSON.stringify(edits).includes("Mulch"), r)

// Ask command: starts an @claude line.
await editor.getByText("Basil between them").click()
await page.keyboard.press("End")
await page.keyboard.press("Meta+Shift+K")
await wait(300)
check("Ask the companion (⌘⇧K): a new @claude line under the cursor", (await editor.innerText()).includes("Basil between them.\n@claude "), await editor.innerText())
await ctx.close()

await op("companion.clear")
// A phone: comments fold to a dot at the line's end; a tap opens it.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage(), { label: 390 })
await pp.goto(`${B}/#file/${enc(NOTE)}`)
await pp.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 10000 })
await wait(1200)
await op("companion.comment", { path: NOTE, find: "Basil", text: "Plant it after the last frost." })
const dot = pp.locator('button[aria-label="Claude\'s comment"]').last()
await dot.waitFor({ timeout: 3000 })
const db = await dot.boundingBox()
check("phone: a comment is a dot inside the screen", !!db && db.x + db.width <= 390, db)
await dot.tap()
await pp.getByText("Plant it after the last frost.").waitFor({ timeout: 3000 })
const opened = await pp.locator("[data-companion-note]").last().boundingBox()
check("phone: a tap opens it, inside the screen", !!opened && opened.x >= 0 && opened.x + opened.width <= 390, opened)
await pp.screenshot({ path: `${OUT}phone.png` })
// Its cursor reads there too, and ticks when it lets it pass.
writeFileSync(`${OUT}moment.jsonl`, JSON.stringify({ kind: "edit", path: NOTE, line: 5, hunks: [{ line: 5, added: ["Basil between them."], removed: [] }], t: 1 }))
await op("companion.replay", { file: `${OUT}moment.jsonl` })
await until(async () => (await op("companion.next", { timeout: 2 })).moments?.length, 4000)
const pc = pp.locator('.companion-cursor[data-agent="Claude"]')
await until(async () => (await pc.getAttribute("data-state")) === "reading", 3000)
const pcb = await pc.boundingBox()
check("phone: handed a moment, its cursor reads it, inside the screen", !!pcb && pcb.x >= 0 && pcb.x + 20 <= 390, pcb)
await op("companion.next", { timeout: 0 })
await until(async () => (await pc.getAttribute("data-seen")) !== null, 3000)
await wait(600)
check("phone: and a seen tick", await pc.getByLabel("seen").isVisible())
await pp.screenshot({ path: `${OUT}phone-seen.png` })
await phone.close()

await op("companion.clear")
// Long cards at a note's end, stacked: each stays reachable, scrolled to, over neither the status bar nor the phone's bar.
const LONG = `${DIR}/Long.md`, words = "Measured: a call takes a tenth of a second, so tools aren't it. ".repeat(12)
await api("PUT", "file", { path: LONG, text: `# Long\n\n${Array.from({ length: 40 }, (_, i) => `Line ${i + 3} of a long note.`).join("\n")}\n` })
// (a phone's page scrolls the window)
const toEnd = () => { const s = document.querySelector("[data-pane]"); if (s) s.scrollTop = s.scrollHeight; else scrollTo(0, document.documentElement.scrollHeight) }
for (const [label, viewport, mobile] of [["desktop", { width: 1400, height: 700 }, false], ["phone", { width: 390, height: 700 }, true]]) {
  const c = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  const p = watch(await c.newPage(), { label: `long ${label}` })
  await p.goto(`${B}/#file/${enc(LONG)}`)
  await p.locator(`.file-view[data-path="${LONG}"]:visible .cm-content`).waitFor({ timeout: 10000 })
  await wait(1200)
  const ids = []
  for (const line of [38, 40, 42]) ids.push((await op("companion.comment", { path: LONG, line, text: words })).id)
  if (mobile) {
    await p.locator('button[aria-label="Claude\'s comment"]').last().waitFor({ timeout: 3000 })
    await p.evaluate(toEnd)
    await wait(600)
    await p.locator('button[aria-label="Claude\'s comment"]').last().tap()
  } else await p.locator(`[data-companion-note="${ids[2]}"]`).waitFor({ timeout: 3000 })
  await wait(600)
  await p.evaluate(toEnd)
  await wait(800)
  const shown = mobile ? [ids[2]] : ids
  const [top, floor] = await p.evaluate(() => {
    const at = (q, side) => [...document.querySelectorAll(q)].map((e) => e.getBoundingClientRect()).filter((r) => r.height).map((r) => r[side])
    return [Math.max(0, ...at("[data-pane]", "top"), ...at("[data-phone-header]", "bottom")), Math.min(innerHeight, ...at("[data-status-bar], [data-phone-bar]", "top"))]
  })
  const last = p.locator(`[data-companion-note="${ids[2]}"]`), box = await last.boundingBox(), reply = await last.getByText("Reply").boundingBox()
  check(`${label}: the lowest of long cards fits on screen and, at the note's end, its Reply is above the bar`, !!box && !!reply && box.height <= floor - top && reply.y + reply.height <= floor, { box, reply, top, floor })
  const boxes = await Promise.all(shown.map((id) => p.locator(`[data-companion-note="${id}"]`).boundingBox()))
  check(`${label}: stacked cards don't cover each other`, boxes.every((b, i) => !i || b.y >= boxes[i - 1].y + boxes[i - 1].height), boxes)
  await p.screenshot({ path: `${OUT}long-${label}.png` })
  await op("companion.clear")
  await wait(600)
  check(`${label}: with the cards gone, the note gives back the room it kept`, await p.evaluate(() => [...document.querySelectorAll(".cm-content")].every((e) => !e.style.marginBottom)))
  await c.close()
}
rmSync(file(DIR), { recursive: true, force: true })
for (const r of restore) r()
await done()
