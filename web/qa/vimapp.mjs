// The Vim plugin outside the editor (app.tsx): in a note's reading view j/k, gg/G scroll the pane, ]] goes to the next
// heading, f puts hints on links and typing one opens it, / finds and n goes to the next match, : runs :e <name> and
// :q, ? opens the keys sheet (and closes it), i edits where you were reading (the cursor in sight), and j still types
// in a text field. WRITES a "Qa vimapp" folder and plugins.json's `enabled`: throwaway only.
//   node web/qa/vimapp.mjs <base url> [out dir]
import { apiAt, palette, qa, SHOTS, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const LONG = "Qa vimapp/Long.md", TARGET = "Qa vimapp/Target.md"
const json = { "Content-Type": "application/json" }
const put = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: json, body: JSON.stringify({ path, text }) })
// Vim is built in, off until in plugins.json's `enabled`: switched there, the rest of the list kept.
const vim = async (on) => {
  const api = apiAt(B), conf = await api("GET", "config/plugins")
  return api("PATCH", "config/plugins", { enabled: [...(conf.enabled ?? []).filter((x) => x !== "vim"), ...(on ? ["vim"] : [])] })
}

const para = (i) => `Paragraph ${i} of the long note, with enough words in it to take a line or two of the page.`
const sections = []
for (let s = 1; s <= 8; s++) {
  const lines = [`## Section ${s}`, ""]
  for (let i = 1; i <= 8; i++) lines.push(para(`${s}.${i}`), "")
  if (s === 1) lines.push("See [[Target]] for more.", "")
  if (s === 3 || s === 6 || s === 8) lines.push("A needle in this section.", "")
  sections.push(lines.join("\n"))
}
for (const p of [LONG, TARGET]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await put(LONG, sections.join("\n"))
await put(TARGET, "The target note.\n")
await vim(true)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const top = () => page.evaluate(() => document.getElementById("main-scroll").scrollTop)
const hash = () => page.evaluate(() => decodeURIComponent(location.hash))

await page.goto(`${B}#file/${encodeURIComponent(LONG)}`); await wait(2000)
await palette(page, "Switch to reading", 700)
if (await page.getByText("No command matches").count()) { await page.keyboard.press("Escape"); await wait(300) }
check("the note is in reading view", await page.locator(".cm-content[contenteditable=false]").count() > 0)
// Where a reader would click: on the text.
await page.locator(".cm-line", { hasText: "Paragraph 1.2" }).first().click(); await wait(200)

const t0 = await top()
await page.keyboard.press("j"); await page.keyboard.press("j"); await wait(150)
const t1 = await top()
check(`j scrolls down (${t0} -> ${t1})`, t1 > t0 + 80)
await page.keyboard.press("k"); await wait(150)
check("k scrolls up", (await top()) < t1)
await page.keyboard.press("Shift+G"); await wait(300)
const bottom = await top()
check(`G goes to the bottom (${bottom})`, bottom > 1000)
await page.keyboard.press("g"); await page.keyboard.press("g"); await wait(300)
check("gg goes to the top", (await top()) === 0)
await page.keyboard.press("d"); await wait(600)
check("d scrolls half a page", (await top()) > 200)
await page.keyboard.press("g"); await page.keyboard.press("g"); await wait(300)

// ]] twice: Section 2's heading near the top.
await page.keyboard.press("]"); await page.keyboard.press("]"); await wait(200)
await page.keyboard.press("]"); await page.keyboard.press("]"); await wait(300)
const near = await page.evaluate(() => {
  const s = document.getElementById("main-scroll").getBoundingClientRect().top
  const h = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.trim() === "Section 2")
  return h ? Math.round(h.getBoundingClientRect().top - s) : null
})
check(`]] goes to the next heading (Section 2 at ${near}px)`, near !== null && near >= -5 && near < 60)
await page.keyboard.press("["); await page.keyboard.press("["); await wait(300)
const back = await page.evaluate(() => {
  const s = document.getElementById("main-scroll").getBoundingClientRect().top
  const h = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.trim() === "Section 1")
  return h ? Math.round(h.getBoundingClientRect().top - s) : null
})
check(`[[ goes back (Section 1 at ${back}px)`, back !== null && back >= -5 && back < 60)

// f: hints, then the one on the [[Target]] link.
await page.keyboard.press("f"); await wait(300)
const hintCount = await page.locator("[data-hint]").count()
check(`f shows hints (${hintCount})`, hintCount > 5)
await page.screenshot({ path: `${OUT}vimapp-hints.png` })
const label = await page.evaluate(() => {
  const link = [...document.querySelectorAll("[data-wiki]")].find((e) => /Target/.test(e.dataset.wiki))
  if (!link) return null
  const r = link.getBoundingClientRect()
  let best = null, d = Infinity
  for (const h of document.querySelectorAll("[data-hint]")) {
    const b = h.getBoundingClientRect()
    const x = Math.hypot(b.left - r.left, b.top - r.top)
    if (x < d) { d = x; best = h.dataset.hint }
  }
  return best
})
check(`a hint is on the link (${label})`, !!label)
if (label) await page.keyboard.type(label)
await wait(1000)
check("typing its label opens the link", (await hash()).includes("Target"))
check("the hints are gone", await page.locator("[data-hint]").count() === 0)
await page.keyboard.press("f"); await wait(200); await page.keyboard.press("Escape"); await wait(200)
check("Escape puts hints away", await page.locator("[data-hint]").count() === 0)

// : runs :e and :q.
await page.keyboard.press("Shift+;"); await wait(300)
check(": opens the command line", await page.locator("input[aria-label=Command]").count() === 1)
await page.keyboard.type("e Lon"); await page.keyboard.press("Tab"); await wait(100)
check("Tab completes a file name", (await page.locator("input[aria-label=Command]").inputValue()) === "e Long")
await page.keyboard.press("Enter"); await wait(1200)
check(":e Long opens the note", (await hash()).includes("Long"))
await page.locator(".cm-line", { hasText: "Paragraph 1.2" }).first().click(); await wait(200)

// / finds; n goes from match to match.
await page.keyboard.press("/"); await wait(300)
await page.keyboard.type("needle"); await wait(300)
check("/ counts the matches, the ones not drawn yet too", await page.getByText("3 matches").count() === 1)
await page.keyboard.press("Enter"); await wait(400)
const f1 = await top()
const lit = await page.evaluate(() => CSS.highlights.get("vim-find-current")?.size ?? 0)
check(`Enter goes to the first match, highlighted (${f1})`, f1 > 500 && lit === 1)
await page.keyboard.press("n"); await wait(400)
const f2 = await top()
check(`n goes to the next match (${f2})`, f2 > f1)
await page.keyboard.press("Shift+N"); await wait(400)
check("N goes back", (await top()) < f2)
await page.screenshot({ path: `${OUT}vimapp-find.png` })
await page.keyboard.press("Escape"); await wait(200)
check("Escape clears the highlights", await page.evaluate(() => !CSS.highlights.has("vim-find")))

// ? opens the keys sheet, ? closes it.
await page.keyboard.press("Shift+/"); await wait(700)
check("? opens the keys sheet", await page.locator("[data-vim-keys]").count() === 1)
check("it lists the keys outside the editor", await page.getByText("Show link hints").count() >= 1)
await page.screenshot({ path: `${OUT}vimapp-keys.png` })
await page.keyboard.press("Shift+/"); await wait(700)
check("? again closes it", await page.locator("[data-vim-keys]").count() === 0)

// i: edit where you're reading.
await page.keyboard.press("g"); await page.keyboard.press("g"); await wait(200)
for (let i = 0; i < 3; i++) { await page.keyboard.press("]"); await page.keyboard.press("]"); await wait(150) }
const readAt = await page.evaluate(() => {
  const s = document.getElementById("main-scroll").getBoundingClientRect().top
  const h = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent.trim() === "Section 3")
  return h ? Math.round(h.getBoundingClientRect().top - s) : null
})
await page.keyboard.press("i"); await wait(1200)
check("i switches to editing", await page.locator(".cm-content[contenteditable=true]").count() > 0)
const caret = await page.evaluate(() => {
  const s = document.getElementById("main-scroll").getBoundingClientRect()
  const c = document.querySelector(".cm-fat-cursor, .cm-cursor-primary")
  const h = [...document.querySelectorAll(".cm-line")].find((l) => /Section 3/.test(l.textContent))
  return { y: c ? Math.round(c.getBoundingClientRect().top - s.top) : null, h: h ? Math.round(h.getBoundingClientRect().top - s.top) : null }
})
check(`]] three times: Section 3 at the top (${readAt}px)`, readAt !== null && readAt < 60)
check(`the cursor is on the line that was at the top, which stayed in place (cursor ${caret.y}px, line ${caret.h}px, was ${readAt}px)`,
  caret.y !== null && caret.h !== null && Math.abs(caret.y - caret.h) < 30 && Math.abs(caret.h - readAt) < 40)
await page.screenshot({ path: `${OUT}vimapp-edit.png` })
await page.keyboard.press("Escape"); await wait(600)
check("Escape in normal mode goes back to reading", await page.locator(".cm-content[contenteditable=true]").count() === 0)

// :q closes the tab.
await page.keyboard.press("Shift+;"); await wait(300)
await page.keyboard.type("q"); await page.keyboard.press("Enter"); await wait(1000)
check(":q closes the tab", !(await hash()).includes("Long"))

// In a text field j types.
await page.keyboard.press("Meta+o"); await wait(400)
await page.keyboard.type("jk"); await wait(200)
const typed = await page.evaluate(() => document.activeElement?.value)
check(`j and k type in the quick switcher (${typed})`, typed === "jk")
await page.keyboard.press("Escape")
noErrors()

await vim(false)
for (const p of [LONG, TARGET]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await done()
