// The keyboard into the text, with Vim on (FileView's useTextFocus, the one mode for every file): ⌘E from reading puts
// the cursor in the text on the first line in sight, in normal mode (j moves it, types nothing); ⌘E back to reading
// gives j back to the page; ⌘O opens a note with the cursor in it, where it was left in that file; a split's other pane
// follows ⌘E; a file opened from outside (POST /api/ui, `vau open`) doesn't take the keys from a field being typed in.
// WRITES a "Qa vimfocus" folder and plugins.json's `enabled`: throwaway only.
//   node web/qa/vimfocus.mjs <base url> [out dir]
import { apiAt, palette, qa, SHOTS, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const LONG = "Qa vimfocus/Long.md", TARGET = "Qa vimfocus/Target.md", OTHER = "Qa vimfocus/Other.md"
const json = { "Content-Type": "application/json" }
const put = (path, text) => fetch(`${B}api/file`, { method: "POST", headers: json, body: JSON.stringify({ path, text }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${encodeURIComponent(path)}`)).json()).text
// Vim is built in, off until in plugins.json's `enabled`: switched there, the rest of the list kept.
const vim = async (on) => {
  const api = apiAt(B), conf = await api("GET", "config/plugins")
  return api("PATCH", "config/plugins", { enabled: [...(conf.enabled ?? []).filter((x) => x !== "vim"), ...(on ? ["vim"] : [])] })
}

const lines = []
for (let i = 1; i <= 80; i++) lines.push(`Line ${i} of the long note, with a few words on it.`, "")
for (const p of [LONG, TARGET, OTHER]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await put(LONG, lines.join("\n"))
await put(TARGET, "The target note.\n\nIts second line.\n")
await put(OTHER, "Another note.\n")
await vim(true)
const longText = await read(LONG)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const top = () => page.evaluate(() => document.getElementById("main-scroll").scrollTop)
const quick = async (name) => {
  await page.keyboard.press("Meta+o"); await wait(400)
  await page.keyboard.type(name); await wait(400)
  await page.keyboard.press("Enter"); await wait(1200)
}
/** Where the keys are: in a writable editor (and which file), and the cursor's line text and place on screen. */
const keys = () => page.evaluate(() => {
  const a = document.activeElement
  const inText = !!a?.classList.contains("cm-content") && a.contentEditable === "true"
  const file = a?.closest("[data-path]")?.getAttribute("data-path") ?? null
  const s = document.getElementById("main-scroll")?.getBoundingClientRect()
  const c = document.querySelector(".cm-focused .cm-fat-cursor, .cm-focused .cm-cursor-primary")
  const sel = getSelection()
  const line = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement)?.closest(".cm-line")?.textContent ?? null : null
  const y = c && s ? c.getBoundingClientRect().top : null
  return { inText, file, line, y, inSight: y !== null && s ? y >= s.top && y < s.bottom : false }
})

await page.goto(`${B}#file/${encodeURIComponent(LONG)}`); await wait(2000)
await palette(page, "Switch to reading")
if (await page.getByText("No command matches").count()) { await page.keyboard.press("Escape"); await wait(300) }
check("the note is in reading view", await page.locator(".cm-content[contenteditable=false]").count() > 0)
await page.evaluate(() => document.activeElement?.blur())

// Reading: j scrolls. Then ⌘E: the cursor in the text, on a line in sight.
for (let i = 0; i < 8; i++) await page.keyboard.press("j")
await wait(300)
const t0 = await top()
check(`j scrolls the reading view (${t0})`, t0 > 200)
await page.keyboard.press("Meta+e"); await wait(1200)
let k = await keys()
check(`⌘E to editing puts the keys in the text (${JSON.stringify(k)})`, k.inText && k.file === LONG)
check("the cursor is on a line in sight", k.inSight)
check(`the page stayed where it was read (${t0} -> ${await top()})`, Math.abs((await top()) - t0) < 80)
const firstLine = k.line
await page.keyboard.press("j"); await page.keyboard.press("j"); await wait(300)
k = await keys()
check(`j in normal mode moves the cursor (${firstLine} -> ${k.line})`, k.line && k.line !== firstLine && /^Line \d+/.test(k.line))
await wait(1500)
check("j typed nothing into the note", (await read(LONG)) === longText)
await page.screenshot({ path: `${OUT}vimfocus-edit.png` })

// ⌘E back to reading: j scrolls again.
await page.keyboard.press("Meta+e"); await wait(1000)
k = await keys()
check("⌘E back to reading takes the keys out of the text", !k.inText && (await page.locator(".cm-content[contenteditable=true]").count()) === 0)
const t1 = await top()
await page.keyboard.press("j"); await page.keyboard.press("j"); await wait(300)
check(`j scrolls again in reading (${t1} -> ${await top()})`, (await top()) > t1 + 40)
await page.keyboard.press("Meta+e"); await wait(1000)
check("⌘E to editing again: the keys are in the text", (await keys()).inText)
for (let i = 0; i < 4; i++) await page.keyboard.press("j")
await wait(200)
const leftOn = (await keys()).line

// ⌘O: the next note opens with the cursor in it, and coming back finds the cursor where it was left.
await page.keyboard.press("Escape"); await wait(200)
await quick("Target")
k = await keys()
check(`⌘O opens Target with the cursor in it (${JSON.stringify(k)})`, k.inText && k.file === TARGET)
await page.keyboard.press("j"); await wait(200)
check(`j moves down in Target (normal mode) (${(await keys()).line})`, (await keys()).line === "")
await quick("Long")
k = await keys()
check("⌘O back to Long: the cursor in it", k.inText && k.file === LONG)
check(`the cursor is where it was left (${leftOn} / ${k.line})`, k.line === leftOn)

// One mode for every file: a split's other pane follows ⌘E.
await palette(page, "Split right"); await wait(800)
const panes = () => page.evaluate(() => [...document.querySelectorAll("[data-pane]")].map((p) => {
  const c = p.querySelector(".cm-content")
  return c ? c.contentEditable : null
}))
let ps = await panes()
check(`two panes, both editing (${ps})`, ps.length >= 2 && ps.every((x) => x === "true"))
await page.keyboard.press("Meta+e"); await wait(1200)
ps = await panes()
check(`⌘E in one pane: both read (${ps})`, ps.length >= 2 && ps.every((x) => x === "false"))
await page.keyboard.press("Meta+e"); await wait(1200)
ps = await panes()
check(`⌘E again: both edit (${ps})`, ps.every((x) => x === "true"))
await page.screenshot({ path: `${OUT}vimfocus-split.png` })
await palette(page, "Close all other")
if (await page.getByText("No command matches").count()) { await page.keyboard.press("Escape"); await wait(300) }

// A file opened from outside doesn't take the keys from a field being typed in.
await page.evaluate(() => {
  const f = document.createElement("input")
  f.id = "qa-field"; f.style.cssText = "position:fixed;top:0;left:0;z-index:9999"
  document.body.append(f); f.focus()
})
await fetch(`${B}api/ui`, { method: "POST", headers: json, body: JSON.stringify({ action: "open", path: OTHER }) })
await wait(1500)
const still = await page.evaluate(() => ({ id: document.activeElement?.id, shown: !!document.querySelector(`[data-path="Qa vimfocus/Other.md"]`) }))
check("the file opened from outside is shown", still.shown)
check(`the field being typed in keeps the keys (${still.id})`, still.id === "qa-field")
await page.evaluate(() => document.getElementById("qa-field")?.remove())
noErrors()

await vim(false)
for (const p of [LONG, TARGET, OTHER]) await fetch(`${B}api/file?path=${encodeURIComponent(p)}`, { method: "DELETE" })
await done()
