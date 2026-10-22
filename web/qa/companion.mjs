// Companion: an agent's cursor glides to where it looks (reading what it's handed, a tick when it lets that pass), its
// words pop in a bubble by it, comments are cards in the margin (a dot on a phone, opened by a tap; or, a setting,
// threads in the Conversations panel, a dot by the line) and take a reply, a suggestion is struck through with its replacement after it
// and Tab takes it, an edit is typed in before the user's eyes and lit in its colour, and "@claude …" + Enter is an ask
// the agent hears at once (mid-line, at the pause, its cursor reading along as it's written); what the user writes
// reaches it after a pause. Its cursor: hovered, its status; clicked, its last words and a box to ask it; dragged onto
// text, a point; its flag follows it; agents on one spot fan out from one flag. A file's top bar items dock in a
// sidebar and come back. Driven through the ops an agent calls.
// WRITES "QA companion/", the plugin's data.json and the sidebars' setup: throwaway server only.
//   node web/qa/companion.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [BASE, VAULT, OUT = "/tmp/companion-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => `${VAULT}/${rel}`
const text = (rel) => { try { return readFileSync(file(rel), "utf8") } catch { return "" } }
const keep = (rel) => { const was = existsSync(file(rel)) ? readFileSync(file(rel), "utf8") : null; return () => { if (was === null) rmSync(file(rel), { force: true }); else writeFileSync(file(rel), was) } }
const restore = [keep(".vaultite/plugins/companion/data.json"), keep(".vaultite/plugins.json"), keep(".vaultite/appearance.json"), keep(".vaultite/sidebars.json")]
const api = (method, p, body) => fetch(`${B}/api/${p}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then((r) => r.json())
/** An op as the companion's agent calls it: `vau` run by Claude Code (not this script, which only a machine where it runs
 *  under Claude Code would take for it). */
const op = (id, params = {}) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params) }).then((r) => r.json())
const enc = encodeURIComponent
/** The right sidebar folded to its rail (the Conversations panel is there by default), for the margin's cards' room. */
const foldRight = (c) => c.addInitScript(() => { try { localStorage.setItem("vaultite.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("vaultite.prefs") || "{}"), rightSidebar: false })) } catch { /* private */ } })
/** An op as the user calls it in the app (Review's keep and revert are theirs only). */
const asUser = (id, params) => fetch(`${B}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify(params) }).then((r) => r.json())

const plugins = JSON.parse(text(".vaultite/plugins.json") || "{}")
// (Activity too: Review reads who changed what from it)
const want = ["companion", "activity"].filter((id) => !(plugins.enabled ?? []).includes(id))
if (want.length) {
  writeFileSync(file(".vaultite/plugins.json"), JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []), ...want] }, null, 2))
  await wait(1500)
}
// (the margin's cards, the default, first; the sidebar after)
await api("PATCH", "config/plugin/companion", { mode: "pair", pause: 1, comments: null })
await op("plugin.grant", { id: "activity", allow: false }) // (its recaps' ask would cover the page)
const DIR = "QA companion", NOTE = `${DIR}/Garden ideas.md`
rmSync(file(DIR), { recursive: true, force: true })
await api("PUT", "file", { path: NOTE, text: "# Garden ideas\n\nTomatos along the fence, where it's sunny.\n\nBasil between them.\n" })
await api("PUT", "file", { path: `${DIR}/Seeds.md`, text: "# Seeds\n" })
await asUser("review.keep", { all: true }) // (an earlier run's AI changes reviewed)
await op("companion.next", { timeout: 0 }) // (what came before)
await op("companion.clear")

const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
await foldRight(ctx)
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

// (the row scrolled out of its list: the cursor stays at the list's edge, not over what's above or below it)
{
  const rowEl = page.locator(`[data-tree-path="${DIR}/Seeds.md"]`).first()
  const size = page.viewportSize()
  await page.setViewportSize({ width: size.width, height: 360 }); await wait(400)
  const scrolled = await rowEl.evaluate((el) => {
    let s = el.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    if (!s) return null
    const r0 = el.getBoundingClientRect()
    s.scrollTop = r0.top - s.getBoundingClientRect().top > s.clientHeight / 2 ? 0 : s.scrollHeight
    return true
  })
  await wait(700)
  check("look: (setup) the file list scrolls on a short window", !!scrolled)
  if (scrolled) {
    const out = await rowEl.evaluate((el) => {
      let s = el.parentElement
      while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
      const box = s.getBoundingClientRect(), r = el.getBoundingClientRect()
      return { hidden: r.bottom <= box.top || r.top >= box.bottom, top: box.top, bottom: box.bottom }
    })
    const c = await cursor.boundingBox()
    check("look: (setup) the row is scrolled out of its list", out.hidden, out)
    check("look: a row scrolled out of its list, the cursor sits at the list's edge", out.hidden && !!c && c.y >= out.top - 2 && c.y <= out.bottom, { out, c })
  }
  await page.setViewportSize(size); await wait(400)
}

// Words by its cursor.
await op("companion.say", { text: "Basil keeps aphids off tomatoes.", path: NOTE, find: "Basil" })
await page.getByText("Basil keeps aphids off tomatoes.").waitFor({ timeout: 3000 })
await wait(800)
check("say: a bubble by its cursor", await cursor.getByText("Basil keeps aphids off tomatoes.").isVisible())
await page.screenshot({ path: `${OUT}say.png` })

// "@claude …" then Enter: an ask, at once; it shows thinking.
await editor.click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("\n@claude how far apart should they be?\n")
let r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 6000)
await until(() => text(NOTE).includes("@claude how far apart"), 5000)
check("ask: @claude and Enter reach it at once, with the question and its line", r?.moments.some((m) => m.kind === "ask" && m.text === "how far apart should they be?" && m.path === NOTE && m.waited < 1000 && m.line === text(NOTE).split("\n").indexOf("@claude how far apart should they be?") + 1), r)
await until(async () => (await cursor.getAttribute("data-state")) === "thinking", 3000)
check("ask: its cursor shows it thinking", (await cursor.getAttribute("data-state")) === "thinking")
await wait(800)
await page.screenshot({ path: `${OUT}thinking.png` })
r = await op("companion.next", { timeout: 3 })
check("ask: not said again as an edit", !r.moments?.some((m) => m.kind === "edit"), r)
await page.keyboard.type("Maybe a hand apart.\n")
r = await until(async () => { const x = await op("companion.next", { timeout: 3 }); return x.moments?.find((m) => m.kind === "edit") ? x : null }, 8000)
check("edit: what the user wrote reaches it after a pause, as lines added", r?.moments.some((m) => m.kind === "edit" && m.hunks?.some((h) => h.added.includes("Maybe a hand apart."))), r)

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

// @claude mid-sentence: the picker, a chip, and the ask goes at the pause without Enter, the whole line, once.
await op("companion.next", { timeout: 0 })
await page.keyboard.type("\nAlright, how is it going @")
const midList = await until(async () => (await page.locator(".cm-tooltip-autocomplete li").allInnerTexts()).join(" "), 3000)
check("@ mid-line: the picker lists the agents", /claude/.test(midList ?? ""), midList)
await page.keyboard.type("claude?")
const ASK = "Alright, how is it going @claude?"
check("@claude mid-line: a chip", (await editor.locator(".cm-line", { hasText: "how is it going" }).locator(".cm-companion-mention").count()) === 1)
check("@claude mid-line: until the pause sends it, a line fills under the chip", (await editor.locator(".cm-companion-soon").count()) === 1)
check("@claude mid-line: its cursor comes over to read along at once, before the ask goes", (await cursor.getAttribute("data-state")) === "reading")
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 6000)
check("@claude mid-line: the ask reaches it at the pause, the whole line", r?.moments.some((m) => m.kind === "ask" && m.text === ASK && m.line === text(NOTE).split("\n").indexOf(ASK) + 1), r)
await page.keyboard.press("Enter")
r = await op("companion.next", { timeout: 3 })
check("@claude mid-line: Enter after it doesn't ask again", !r.moments?.some((m) => m.kind === "ask"), r)
// An ask mid-sentence goes at the pause all the same: written on, it comes again.
await page.keyboard.type("@claude and what about the")
t0 = Date.now()
r = await until(async () => { const x = await op("companion.next", { timeout: 3 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 5000)
check("@claude mid-sentence: the ask goes at the pause, not the longer one", r?.moments.some((m) => m.kind === "ask" && m.text === "and what about the") && Date.now() - t0 < 1800, { ms: Date.now() - t0, r })
await page.keyboard.press("Enter")
await op("companion.next", { timeout: 2 })
await page.keyboard.type("Mail bob@claude.com or ask @nobody.")
r = await op("companion.next", { timeout: 4 })
check("@ in an email or an unknown name mid-line: no chip, no ask", !r.moments?.some((m) => m.kind === "ask") &&
  (await editor.locator(".cm-line", { hasText: "Mail bob" }).locator(".cm-companion-mention").count()) === 0, r)
// Out of the editor (to its terminal, a menu): the note is still where they are, for next and the ops alike.
await page.evaluate(() => document.activeElement?.blur())
await wait(500)
r = await op("companion.say", { text: "Going well.", find: "how is it going" })
check("say: no path, the note they just left the editor of", r.path === NOTE, r)
await editor.click()

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
await editor.getByText("along the fence").click({ position: { x: 40, y: 8 } })
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
await page.keyboard.press("ControlOrMeta+z")
await wait(400)
check("edit: the user can undo it", !(await editor.innerText()).includes("Water them every morning"))
await page.keyboard.press("ControlOrMeta+Shift+z")

// What it typed is its own in Review (the app's save of it is Claude's, not the user's), and reverts like any AI's.
const rev = await until(async () => (await api("GET", "review")).files?.find((f) => f.path === NOTE && f.by.includes("Claude")), 8000)
check("edit: in Review as Claude's, against the text before it", !!rev && rev.added >= 1, rev)
await until(() => text(NOTE).includes("Water them every morning"), 5000) // (its redo saved)
await wait(1200)
const reverted = await asUser("review.revert", { path: NOTE })
await until(() => !text(NOTE).includes("Water them every morning"), 5000)
check("edit: reverted from Review, gone from the note and its editor", !text(NOTE).includes("Water them every morning") && text(NOTE).includes("Basil between them.") &&
  !!(await until(async () => !(await editor.innerText()).includes("Water them every morning"), 5000)), { reverted: reverted.reverted?.length, text: text(NOTE), editor: await editor.innerText() })

// A highlight in its colour.
await op("companion.highlight", { path: NOTE, find: "sunny" })
await page.locator(".cm-companion-hl").waitFor({ timeout: 3000 })
check("highlight: lit in its colour", (await page.locator(".cm-companion-hl").innerText()) === "sunny")
await page.screenshot({ path: `${OUT}highlight.png` })

// The user typing while it types: one moment after their pause, without its words, not one a key.
await op("companion.next", { timeout: 0 })
await editor.getByText("along the fence").click({ position: { x: 40, y: 8 } })
await page.keyboard.press("End")
const typing = op("companion.edit", { path: NOTE, append: true, text: "- Mulch in June, before the heat comes and dries the soil out" })
for (const ch of " or so") { await page.keyboard.type(ch); await wait(120) }
await typing
r = await until(async () => { const x = await op("companion.next", { timeout: 4 }); return x.moments?.length ? x : null }, 8000)
const edits = r?.moments.filter((m) => m.kind === "edit") ?? []
check("edit: typing while it types is one moment, theirs only", edits.length === 1 && edits[0].hunks[0].added.some((l) => l.endsWith("sunny. or so")) && !JSON.stringify(edits).includes("Mulch"), r)

// Three quick edits while the user types: one at a time, each whole, and their typing whole.
await editor.getByText("along the fence").click({ position: { x: 40, y: 8 } })
await page.keyboard.press("End")
const LINES = ["- Pinch the basil flowers off", "- Harvest tomatoes from the top", "- Compost the vines in October"]
const three = Promise.all(LINES.map((text) => op("companion.edit", { path: NOTE, append: true, text })))
for (const ch of " and in pots") { await page.keyboard.type(ch); await wait(40) }
const done3 = await three
await until(() => LINES.every((l) => text(NOTE).includes(l)) && text(NOTE).includes("sunny. or so and in pots"), 6000)
const lines3 = text(NOTE).split("\n")
check("edits: three at once while the user types land one at a time, none mixed", done3.every((x) => x.how === "typed") &&
  LINES.every((l) => lines3.filter((x) => x === l).length === 1) && lines3.some((l) => l.endsWith("sunny. or so and in pots")), { done3, text: text(NOTE) })
await op("companion.next", { timeout: 0 })

// Several agents: @ lists the ones around, and "@ada …" + Enter asks Ada alone, who shows thinking.
await op("companion.next", { timeout: 0, as: "Ada" })
await op("companion.next", { timeout: 0 })
await editor.getByText("Basil between them").click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("\n@")
const listed = await until(async () => (await page.locator(".cm-tooltip-autocomplete li").allInnerTexts()).join(" "), 3000)
check("@: the agents around are listed, the companion first", /^claude.*ada/s.test(listed ?? ""), listed)
await page.keyboard.type("ada is basil a perennial?")
const chip = editor.locator('.cm-companion-mention[data-agent="Ada"]')
check("@ada: a chip in Ada's colour as it's typed", (await chip.count()) === 1 && (await chip.innerText()) === "@ada" && /--c: var\(--(?!orange)/.test(await chip.getAttribute("style") ?? ""))
await page.keyboard.press("Enter")
await chip.and(page.locator(".cm-companion-asked")).waitFor({ timeout: 1500 })
check("@ada: the chip lights up as the ask goes", true)
r = await until(async () => { const x = await op("companion.next", { timeout: 2, as: "Ada" }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 6000)
check("@ada: the ask reaches Ada", r?.moments.some((m) => m.kind === "ask" && m.text === "is basil a perennial?" && m.for === "Ada"), r)
const ada = page.locator('.companion-cursor[data-agent="Ada"]')
await until(async () => (await ada.getAttribute("data-state")) === "thinking", 3000)
check("@ada: Ada thinks, Claude doesn't", (await ada.getAttribute("data-state")) === "thinking" && (await cursor.getAttribute("data-state")) !== "thinking")
r = await op("companion.next", { timeout: 0 })
check("@ada: Claude isn't asked", !r.moments.some((m) => m.kind === "ask"), r)
await op("companion.say", { text: "No, an annual.", as: "Ada" })
await page.screenshot({ path: `${OUT}two.png` })

// A name no agent has: Start @name last, at Sonnet and medium; Tab or → opens a chooser (← → pick, ↓ the row, Esc back),
// Enter starts it. (The op is caught here: no agent runs.)
const started = []
await page.route("**/api/ops/companion.start", (route) => { started.push(route.request().postDataJSON()); return route.fulfill({ json: { id: "t", running: false, name: "Bob" } }) })
await editor.getByText("Basil between them").click()
await page.keyboard.press("ControlOrMeta+End")
await page.keyboard.type("\n@bob")
const rows = await until(async () => { const t = await page.locator(".cm-tooltip-autocomplete li").allInnerTexts(); return t.some((x) => x.includes("Start @bob")) ? t : null }, 3000)
check("@bob: a name no agent has, Start @bob last, its chip saying what it runs", /Start @bob\s*new companion\s*Sonnet · medium ›/.test(rows?.at(-1) ?? ""), rows)
await page.keyboard.press("Tab")
const chooser = page.locator("[data-companion-start]")
await chooser.waitFor({ timeout: 2000 })
const pressed = async () => (await chooser.locator("button[aria-pressed]").allInnerTexts()).join()
check("Tab on it: a chooser, at Sonnet and medium, the list gone", (await pressed()) === "Sonnet,Medium" && !(await page.locator(".cm-tooltip-autocomplete").count()), await pressed())
for (const k of ["ArrowRight", "ArrowDown", "ArrowRight"]) await page.keyboard.press(k)
check("arrows pick another model and effort", (await pressed()) === "Opus,High", await pressed())
await page.screenshot({ path: `${OUT}start-chooser.png` })
await page.keyboard.press("Escape")
check("Esc goes back to the list", !!(await until(async () => (await page.locator(".cm-tooltip-autocomplete li").allInnerTexts()).some((x) => x.includes("Start @bob")), 2000)) && !(await chooser.count()))
// (its chip, a split button's other half: the chooser, as a tap on a phone opens it)
await page.locator(".cm-tooltip-autocomplete .cm-companion-chip").click()
await chooser.waitFor({ timeout: 2000 })
check("its chip, clicked: the chooser, nothing started", (await pressed()) === "Sonnet,Medium" && !started.length, { pressed: await pressed(), started })
await chooser.getByRole("button", { name: "Max", exact: true }).click()
check("a click picks an effort, up to max", (await pressed()) === "Sonnet,Max", await pressed())
await page.keyboard.press("Escape")
await until(async () => (await page.locator(".cm-tooltip-autocomplete li").allInnerTexts()).some((x) => x.includes("Start @bob")), 2000)
await page.keyboard.press("ArrowRight")
await chooser.waitFor({ timeout: 2000 })
await page.keyboard.press("ArrowRight")
await page.keyboard.press("Enter")
await until(() => started.length > 0, 3000)
const bobLine = (await editor.innerText()).split("\n").findIndex((l) => l.startsWith("@bob"))
check("Enter starts it with what was picked, where it was called, and its @name goes in", started[0]?.as === "Bob" && started[0].model === "opus" && started[0].effort === "medium" &&
  started[0].path === NOTE && started[0].line > 1 && bobLine >= 0 && !(await chooser.count()), { started, bobLine })
await page.keyboard.type("x")
check("no new line from that Enter", (await editor.innerText()).includes("@bob x"), await editor.innerText())
await page.keyboard.press("Backspace")
await page.unroute("**/api/ops/companion.start")

// Ask command: starts an @claude line.
await editor.getByText("Basil between them").click()
await page.keyboard.press("End")
await page.keyboard.press("ControlOrMeta+Shift+K")
await wait(300)
check("Ask the companion (⌘⇧K): a new @claude line under the cursor", (await editor.innerText()).includes("Basil between them.\n@claude "), await editor.innerText())

// A long card shows its first lines and More; clicked, all of it; clicking elsewhere folds it again. Lists are lists.
await op("companion.clear")
r = await op("companion.comment", { path: NOTE, find: "Basil", text: "- **Hover** shows its status\n- **Click** asks it\n- **Drag** points it\n- Follow it\n- Pin a bubble\n- One more" })
const lc = page.locator(`[data-companion-note="${r.id}"]`)
await lc.waitFor({ timeout: 3000 })
await wait(500)
check("cards: a list in a comment is drawn as a list", (await lc.locator("li").count()) === 6)
check("cards: a long one shows its first lines and More", await lc.getByRole("button", { name: "More", exact: true }).isVisible())
const shut = (await lc.boundingBox()).height
await lc.getByRole("button", { name: "More", exact: true }).click()
await wait(500)
check("cards: clicked, it opens whole", (await lc.boundingBox()).height > shut + 20 && !(await lc.getByRole("button", { name: "More", exact: true }).count()))
await page.screenshot({ path: `${OUT}card-open.png` })
await editor.getByText("along the fence").click({ position: { x: 40, y: 8 } })
await wait(500)
check("cards: clicking elsewhere folds it again", await lc.getByRole("button", { name: "More", exact: true }).isVisible())
await lc.getByRole("button", { name: "Dismiss" }).click()
await lc.waitFor({ state: "detached", timeout: 3000 })
check("cards: Dismiss takes it out of the margin", true)
await op("companion.clear")

// Hover its cursor: its flag says what it's doing. Click: its last words, and a box to ask it there.
const line = (s) => text(NOTE).split("\n").findIndex((l) => l.startsWith(s)) + 1
await op("companion.next", { timeout: 0 })
await op("companion.look", { path: `${DIR}/Seeds.md`, as: "Ada" }) // (out of Claude's way: on one spot they'd stack)
await op("companion.look", { path: NOTE, find: "Basil" })
await op("companion.say", { text: "First thought." })
await op("companion.say", { text: "Second thought." })
await wait(900)
const grip = cursor.locator("[data-companion-grip]"), flag = cursor.locator('button[aria-label="Go to Claude"]')
await grip.hover()
await wait(300)
check("hover: its flag says what it's doing", /idle|thinking|reading/.test(await flag.innerText()), await flag.innerText())
await grip.click()
const pop = page.locator('[data-companion-popover="Claude"]')
await pop.waitFor({ timeout: 2000 })
const said = await pop.locator("[data-said]").allInnerTexts()
check("click: its last words, newest at the bottom", said.length >= 2 && said.at(-1).includes("Second thought.") && said.at(-2).includes("First thought."), said)
await page.screenshot({ path: `${OUT}popover.png` })
await page.keyboard.type("what about the basil?")
await page.keyboard.press("Enter")
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "ask") ? x : null }, 5000)
check("click: Enter asks it, with where its cursor is", r?.moments.some((m) => m.kind === "ask" && m.text === "what about the basil?" && m.path === NOTE && m.line === line("Basil")), r?.moments)
check("click: and the box closes", !(await pop.count()))
await page.keyboard.press("Escape")

// Right-click its cursor: its menu (its session, the mode, Start fresh, Stop); … in its box opens the same.
const menu = page.locator('[role="menu"]').filter({ hasText: "Start fresh" })
const menuRows = ["Show its session", "Quiet: only when asked", "Start fresh", "Stop"]
await grip.click({ button: "right" })
await menu.waitFor({ timeout: 2000 })
let menuText = await menu.innerText()
check("right-click: its menu, its session, the mode, Start fresh and Stop", menuRows.every((x) => menuText.includes(x)), menuText)
await page.screenshot({ path: `${OUT}cursor-menu.png` })
await page.keyboard.press("Escape")
await grip.click()
await pop.getByRole("button", { name: "More for Claude" }).click()
await menu.waitFor({ timeout: 2000 })
menuText = await menu.innerText()
check("…: the same menu from its box, which closes", menuRows.every((x) => menuText.includes(x)) && !(await pop.count()), menuText)
await page.keyboard.press("Escape")

// Pin a bubble: a margin comment with its words, by its line.
await op("companion.say", { text: "Pin me, please.", path: NOTE, find: "Tomatoes" })
await cursor.getByText("Pin me, please.").waitFor({ timeout: 3000 })
await cursor.getByRole("button", { name: "Pin as a comment" }).click()
await page.locator("[data-companion-note]").filter({ hasText: "Pin me, please." }).waitFor({ timeout: 3000 })
r = await op("companion.status")
check("pin: the bubble becomes a comment, same words, same line", r.notes.some((n) => n.kind === "comment" && n.text === "Pin me, please." && n.line === line("Tomatoes")) && !r.notes.some((n) => n.kind === "say" && n.text === "Pin me, please."), r.notes)
await op("companion.clear")

// Drag its cursor onto text: "look at this", there; it stays.
await op("companion.next", { timeout: 0 })
await op("companion.look", { path: NOTE, find: "Basil" })
await wait(900)
const dest = await editor.getByText("Tomatoes along").boundingBox(), g = await grip.boundingBox()
await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
await page.mouse.down()
for (let i = 1; i <= 8; i++) { await page.mouse.move(g.x + (dest.x + 40 - g.x) * i / 8, g.y + (dest.y + dest.height / 2 - g.y) * i / 8); await wait(30) }
await page.mouse.up()
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "point") ? x : null }, 5000)
check("drag: dropped on a line, a point moment there", r?.moments.some((m) => m.kind === "point" && m.path === NOTE && m.line === line("Tomatoes")), r)
check("drag: it comes with the note's lines", r?.notes?.some((e) => e.path === NOTE), r?.notes)
await wait(900)
const stays = await cursor.boundingBox()
check("drag: its cursor stays where it was dropped", Math.abs(stays.y - dest.y) < 24, { stays, dest })
await page.screenshot({ path: `${OUT}point.png` })

// Follow: from another note, its flag (or the status bar's menu) goes where it is.
await page.locator(`[data-tree-path="${DIR}/Seeds.md"]`).first().click()
await page.locator(`.file-view[data-path="${DIR}/Seeds.md"]:visible`).waitFor({ timeout: 5000 })
await wait(900)
await grip.hover()
await flag.click()
await page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 5000 })
check("follow: its flag opens the note it's in", true)
await page.locator(`[data-tree-path="${DIR}/Seeds.md"]`).first().click()
await page.locator(`.file-view[data-path="${DIR}/Seeds.md"]:visible`).waitFor({ timeout: 5000 })
const face = page.locator('[data-companion-presence]:visible button[aria-label="Go to Claude"]')
check("presence: the note's top bar shows each agent around in its colour", (await page.locator("[data-companion-presence]:visible button[data-agent]").count()) >= 2)
await face.click()
await page.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 5000 })
check("presence: clicking one goes where it is", true)
await page.screenshot({ path: `${OUT}presence.png` })
await ctx.close()

await op("companion.clear")
// A phone: comments fold to a dot at the line's end; a tap opens it.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const pp = watch(await phone.newPage(), { label: 390 })
await pp.goto(`${B}/#file/${enc(NOTE)}`)
await pp.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 10000 })
await wait(1200)
// Start @name's chip, tapped: its chooser, every effort inside the screen (no Tab on a phone); nothing started.
const zed = []
await pp.route("**/api/ops/companion.start", (route) => { zed.push(route.request().postDataJSON()); return route.fulfill({ json: { id: "t", running: false, name: "Zed" } }) })
await pp.getByRole("button", { name: "Edit", exact: true }).tap()
await pp.locator(".cm-line").filter({ hasText: "Basil between them" }).first().tap()
await pp.keyboard.press("End")
await pp.keyboard.type("\n@zed")
const zchip = pp.locator(".cm-tooltip-autocomplete .cm-companion-chip")
await zchip.waitFor({ timeout: 3000 })
await zchip.tap()
const zc = pp.locator("[data-companion-start]")
await zc.waitFor({ timeout: 2000 })
const zb = await zc.locator("button").evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right } }))
check("phone: Start @name's chip, tapped, opens the chooser, nothing started, every choice inside the screen", !zed.length && zb.length >= 9 && zb.every((b) => b.l >= 0 && b.r <= 390), { zed, zb })
await zc.getByRole("button", { name: "Max", exact: true }).tap()
check("phone: a tap picks an effort", (await zc.locator("button[aria-pressed]").allInnerTexts()).join() === "Sonnet,Max")
await pp.screenshot({ path: `${OUT}phone-start.png` })
await pp.keyboard.press("Escape")
await pp.keyboard.press("Escape")
for (let i = 0; i < 5; i++) await pp.keyboard.press("Backspace")
await pp.unroute("**/api/ops/companion.start")
await pp.getByRole("button", { name: "Read", exact: true }).tap()
await op("companion.comment", { path: NOTE, find: "Basil", text: "Plant it after the last frost." })
const dot = pp.locator('button[aria-label="Claude\'s comment"]').last()
await dot.waitFor({ timeout: 3000 })
const db = await dot.boundingBox()
check("phone: @names are chips here too", (await pp.locator(".cm-companion-mention").count()) >= 2)
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
// A tap on its cursor: the box to ask it; a held finger drags it onto text.
await pp.locator('.companion-cursor[data-agent="Claude"] [data-companion-grip]').tap()
const ppop = pp.locator('[data-companion-popover="Claude"]')
await ppop.waitFor({ timeout: 2000 })
const pb = await ppop.boundingBox()
check("phone: a tap opens its box, inside the screen", !!pb && pb.x >= 0 && pb.x + pb.width <= 390, pb)
await pp.screenshot({ path: `${OUT}phone-popover.png` })
await pp.locator(".cm-content").first().tap({ position: { x: 10, y: 10 } })
await wait(300)
await op("companion.next", { timeout: 0 })
const cdp = await phone.newCDPSession(pp)
const pg = await pp.locator('.companion-cursor[data-agent="Claude"] [data-companion-grip]').boundingBox()
const pt = await pp.locator(".cm-line").filter({ hasText: "Tomatoes along" }).first().boundingBox()
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] })
const [sx, sy, ex, ey] = [pg.x + pg.width / 2, pg.y + pg.height / 2, pt.x + 60, pt.y + pt.height / 2 + 40]
await touch("touchStart", sx, sy)
await wait(500)
for (let i = 1; i <= 8; i++) { await touch("touchMove", sx + (ex - sx) * i / 8, sy + (ey - sy) * i / 8); await wait(30) }
await touch("touchEnd")
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "point") ? x : null }, 5000)
check("phone: held and dragged onto a line, a point there", r?.moments.some((m) => m.kind === "point" && m.path === NOTE && m.line === text(NOTE).split("\n").findIndex((l) => l.startsWith("Tomatoes")) + 1), r)
await phone.close()

await op("companion.clear")
// Long cards at a note's end, stacked: each stays reachable, scrolled to, over neither the status bar nor the phone's bar.
const LONG = `${DIR}/Long.md`, words = "Measured: a call takes a tenth of a second, so tools aren't it. ".repeat(12)
await api("PUT", "file", { path: LONG, text: `# Long\n\n${Array.from({ length: 40 }, (_, i) => `Line ${i + 3} of a long note.`).join("\n")}\n` })
// (a phone's page scrolls the window)
const toEnd = () => { const s = document.querySelector("[data-pane]"); if (s) s.scrollTop = s.scrollHeight; else scrollTo(0, document.documentElement.scrollHeight) }
for (const [label, viewport, mobile] of [["desktop", { width: 1500, height: 700 }, false], ["phone", { width: 390, height: 700 }, true]]) {
  const c = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile })
  await foldRight(c)
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
// Comments in the sidebar (a setting): threads in the Conversations panel in the note's order, a dot by each line.
await api("PATCH", "config/plugin/companion", { comments: "sidebar" })
await op("companion.clear")
const sc = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const sp = watch(await sc.newPage(), { label: "sidebar" })
await sp.goto(`${B}/#file/${enc(NOTE)}`)
const sed = sp.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`)
await sed.waitFor({ timeout: 10000 })
await wait(1200)
const c1 = (await op("companion.comment", { path: NOTE, find: "Basil between", text: "Basil keeps aphids off." })).id
const s1 = (await op("companion.suggest", { path: NOTE, find: "sunny", replace: "sunniest", why: "Stronger" })).id
const panel = sp.locator("[data-companion-panel]:visible")
await panel.locator(`[data-companion-thread="${s1}"]`).waitFor({ timeout: 4000 })
await wait(600) // (the sidebar opening moves the note's text)
check("sidebar: an agent commenting shows the Conversations panel, in the right sidebar", await sp.locator('aside[data-side="right"] [data-panel="companion:conversations"]').isVisible())
const order = await panel.locator("[data-companion-thread]").evaluateAll((els) => els.map((e) => e.dataset.companionThread))
check("sidebar: threads in the note's order", order.join() === [s1, c1].join(), order)
check("sidebar: no cards in the margin, a dot by each line", !(await sp.locator("[data-companion-note]").count()) && (await sp.locator("[data-companion-gutter]").count()) === 2)
const gd = await sp.locator(`[data-companion-gutter="${c1}"]`).boundingBox(), bl = await sed.getByText("Basil between them").boundingBox()
check("sidebar: a thread's dot is left of its line, level with it", !!gd && !!bl && gd.x + gd.width <= bl.x + 4 && Math.abs(gd.y + gd.height / 2 - (bl.y + bl.height / 2)) < 12, { gd, bl })
await sp.screenshot({ path: `${OUT}sidebar.png` })
await panel.locator(`[data-companion-thread="${c1}"]`).click()
await sed.locator(".cm-companion-picked").first().waitFor({ timeout: 2000 })
check("sidebar: a thread clicked lights its line", (await sed.locator(".cm-companion-picked").innerText()).includes("Basil between them"))
await panel.getByPlaceholder("Reply").fill("And for the tomatoes?")
await sp.keyboard.press("Enter")
r = await until(async () => { const x = await op("companion.next", { timeout: 2 }); return x.moments?.find((m) => m.kind === "reply") ? x : null }, 5000)
check("sidebar: a reply from the panel reaches it", r?.moments.some((m) => m.kind === "reply" && m.text === "And for the tomatoes?"), r)
await panel.locator(`[data-companion-thread="${s1}"]`).getByRole("button", { name: /Accept/ }).click()
await until(() => text(NOTE).includes("sunniest"), 5000)
check("sidebar: Accept in the panel takes the suggestion", text(NOTE).includes("sunniest"), text(NOTE))
// Resolved: listed under Resolved, and Reopen brings it back.
await panel.locator(`[data-companion-thread="${c1}"]`).getByRole("button", { name: "Resolve" }).click()
await panel.locator(`[data-companion-thread="${c1}"]`).waitFor({ state: "detached", timeout: 3000 })
await panel.locator('[data-filter="resolved"]').click()
await panel.locator(`[data-companion-thread="${c1}"]`).waitFor({ timeout: 3000 })
check("history: a resolved comment is under Resolved", true)
await panel.locator(`[data-companion-thread="${c1}"]`).getByRole("button", { name: "Reopen" }).click()
await until(async () => (await op("companion.status")).notes.some((n) => n.id === c1), 3000)
await wait(300)
check("history: Reopen brings it back, open", (await panel.locator('[data-filter="open"]').getAttribute("aria-checked")) === "true" && await panel.locator(`[data-companion-thread="${c1}"]`).isVisible())
// The right sidebar closed: a dot on the panel's icon in its rail; a line's dot opens it at its thread.
await sp.locator("[data-sidebar-toggle=right]").click()
await sp.locator("[data-companion-rail]").waitFor({ timeout: 3000 })
check("sidebar: closed, the panel's rail icon has a dot", true)
await sp.locator(`[data-companion-gutter="${c1}"]`).click()
await panel.locator(`[data-companion-thread="${c1}"][data-picked]`).waitFor({ timeout: 3000 })
check("sidebar: a line's dot opens the panel at its thread", await sp.locator('aside[data-side="right"]').evaluate((e) => !e.dataset.collapsed))

// Two agents on one spot: side by side, one flag fanning out into a chip each, a chip opening that one's box.
await op("companion.next", { timeout: 0, as: "Ada" })
await op("companion.look", { path: NOTE, find: "Basil between" })
await op("companion.look", { path: NOTE, find: "Basil between", as: "Ada" })
const stack = sp.locator(".companion-cursor[data-stacked]")
await stack.waitFor({ timeout: 4000 })
await wait(900)
const [arrowC, arrowA] = await Promise.all(["Claude", "Ada"].map((n) => sp.locator(`.companion-cursor[data-agent="${n}"] svg`).first().boundingBox()))
check("stacked: two agents on one spot sit side by side, each colour showing", !!arrowC && !!arrowA && Math.abs(arrowC.x - arrowA.x) >= 3 && Math.abs(arrowC.y - arrowA.y) < 4, { arrowC, arrowA })
await stack.locator("[data-companion-grip]").hover()
await stack.locator("[data-companion-flag]").hover()
const chips = sp.locator("[data-companion-fan] button")
await chips.first().waitFor({ timeout: 2000 })
const names = (await chips.evaluateAll((els) => els.map((e) => e.dataset.agent))).sort()
check("stacked: hovering their flag fans out a chip per agent", names.join() === "Ada,Claude", names)
await sp.screenshot({ path: `${OUT}stacked.png` })
await chips.and(sp.locator('[data-agent="Ada"]')).click()
await sp.locator('[data-companion-popover="Ada"]').waitFor({ timeout: 2000 })
check("stacked: a chip opens that agent's box", true)
await sp.keyboard.press("Escape")
await sp.mouse.move(700, 700)
await wait(500)
await stack.locator("[data-companion-flag]").focus()
await sp.keyboard.press("ArrowDown")
await wait(150)
await sp.keyboard.press("ArrowDown")
await wait(150)
const chosen = await sp.evaluate(() => document.activeElement?.closest("[data-companion-fan]") && document.activeElement.getAttribute("data-agent"))
await sp.keyboard.press("Enter")
await sp.locator(`[data-companion-popover="${chosen}"]`).waitFor({ timeout: 2000 }).catch(() => {})
check("stacked: the keyboard reaches each: Tab to the flag, arrows choose, Enter opens", !!chosen && (await sp.locator(`[data-companion-popover="${chosen}"]`).count()) === 1, chosen)
await sp.keyboard.press("Escape")

// A file's top bar items move: Move to right sidebar docks one as a section there; dragged back, it's in the bar again.
const pres = sp.locator('[data-file-bar="bar"]:visible [data-file-bar-key="companion:presence"]')
await pres.click({ button: "right" })
await sp.getByRole("menuitem", { name: "Move to right sidebar" }).click()
const docked = sp.locator('aside[data-side="right"] [data-panel="companion:presence"]')
await docked.waitFor({ timeout: 3000 })
check("top bar: Move to right sidebar docks it there, for the note, out of the bar", !(await pres.count()) && (await docked.locator("[data-companion-presence] button[data-agent]").count()) >= 2)
await sp.screenshot({ path: `${OUT}docked.png` })
const hb = await docked.locator("[data-panel-handle]").boundingBox(), fb = await sp.locator('[data-file-bar="bar"]:visible').boundingBox()
await sp.mouse.move(hb.x + 20, hb.y + hb.height / 2)
await sp.mouse.down()
for (let i = 1; i <= 10; i++) { await sp.mouse.move(hb.x + 20 + (fb.x - hb.x - 20) * i / 10, hb.y + hb.height / 2 + (fb.y + fb.height / 2 - hb.y - hb.height / 2) * i / 10); await wait(30) }
// (over the bar, it opens a gap for the item and grows to the left: its first item is aimed at where it's laid out
// then, not where it slid to make way)
const first = await sp.locator('[data-file-bar="bar"]:visible').evaluate((bar) => { const e = [...bar.children].find((c) => c.dataset.fileBarKey && c.offsetWidth), r = bar.getBoundingClientRect(); return { x: r.x + e.offsetLeft, y: r.y + r.height / 2 } })
await sp.mouse.move(first.x + 2, first.y, { steps: 4 }); await wait(100)
await sp.mouse.up()
await pres.waitFor({ timeout: 3000 })
const bar = await sp.locator('[data-file-bar="bar"]:visible > [data-file-bar-key]').evaluateAll((els) => els.filter((e) => e.offsetWidth).map((e) => e.dataset.fileBarKey))
check("top bar: dragged back from the sidebar, first in the bar, out of the sidebar", bar[0] === "companion:presence" && !(await docked.count()), bar)
await sc.close()

// A phone: a thread's dot opens the right drawer at it; the dots step aside while it's out.
const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const pq = watch(await ph.newPage(), { label: "sidebar 390" })
await pq.goto(`${B}/#file/${enc(NOTE)}`)
await pq.locator(`.file-view[data-path="${NOTE}"]:visible .cm-content`).waitFor({ timeout: 10000 })
await wait(1200)
const pdot = pq.locator(`[data-companion-gutter="${c1}"]`)
await pdot.waitFor({ timeout: 3000 })
const pdb = await pdot.boundingBox()
check("phone: a thread's dot inside the screen, big enough for a finger", !!pdb && pdb.x >= 0 && pdb.x + pdb.width <= 390 && pdb.width >= 30, pdb)
await pdot.tap()
await pq.locator(`[data-companion-thread="${c1}"]:visible`).waitFor({ timeout: 3000 })
check("phone: tapped, the right drawer opens at its thread", true)
check("phone: the dots step aside while the drawer is out", !(await pdot.isVisible()))
await pq.screenshot({ path: `${OUT}phone-sidebar.png` })
// Many agents: as many faces as fit, the rest behind +N, clear of Open / Resolved.
for (const as of ["Bob", "Cy", "Dee", "Eve"]) await op("companion.next", { timeout: 0, as })
const pqp = pq.locator("[data-companion-panel]:visible")
await pqp.getByRole("button", { name: /more agents/ }).waitFor({ timeout: 3000 }).catch(() => {})
await until(async () => { const b = await pqp.locator('[role="radiogroup"]').boundingBox(); return b && b.x + b.width <= 390 }, 3000) // (the drawer done sliding in)
const fcb = await pqp.locator("[data-companion-presence]").boundingBox(), rgb = await pqp.locator('[role="radiogroup"]').boundingBox()
check("phone: many agents' faces fit beside Open / Resolved, the rest behind +N", !!fcb && !!rgb && fcb.x + fcb.width <= rgb.x + 1 && await pqp.getByRole("button", { name: /more agents/ }).isVisible(), { fcb, rgb })
await pq.screenshot({ path: `${OUT}phone-faces.png` })
await ph.close()

rmSync(file(DIR), { recursive: true, force: true })
for (const r of restore) r()
await done()
