// Text sizes (web/src/core/textsize.ts): a note's and a terminal's own size, apart from the app's zoom. ⌘ + the wheel over
// a note steps it (110%, back down), a pinch (⌃ + small wheel deltas) too; only what's under the path bar grows (the
// path bar and the sidebar stay), the column widens with it, and a click in the zoomed editor still lands where it
// points; a dashboard isn't zoomed; the commands (Reset note text size) and Settings > Appearance's rows (− 100% +) do
// the same; the size is this device's (localStorage), not the vault's. A terminal: ⌘ + the wheel makes its text bigger
// and the shell gets fewer columns (`tput cols`). Phone width: the rows are there and a note is drawn at its size.
// WRITES "Qa text size/" and runs a shell on the server's machine: throwaway server only.
//   node web/qa/textsize.mjs <base url> [out dir]
import fs from "node:fs"
import { apiAt, qa, terminalText, until, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/textsize-shots/"], browser, check, watch, done } = await qa(import.meta.url)
fs.mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
const NOTE = "Qa text size/Sizes.md"
await api("PUT", "file", { path: NOTE, text: "Alpha one\n\nBravo two\n\nCharlie three is a longer paragraph, long enough to wrap across a couple of lines in a column of the usual width, so the column's width shows in how it wraps.\n" })
const fileHash = (p) => `file/${encodeURIComponent(p)}`

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = watch(await ctx.newPage())
const pref = (k) => page.evaluate((k) => JSON.parse(localStorage.getItem("vaultite.prefs") ?? "{}").device?.[`textSize:${k}`] ?? 100, k)
const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } }, sel)
const wheelOver = async (sel, dy, mod = "Meta", times = 1) => {
  const b = await box(sel)
  await page.mouse.move(b.x + Math.min(b.w / 2, 200), b.y + Math.min(b.h / 2, 60))
  await page.keyboard.down(mod)
  for (let i = 0; i < times; i++) await page.mouse.wheel(0, dy)
  await page.keyboard.up(mod)
  await wait(250)
}

// A note
await page.goto(`${B}#${fileHash(NOTE)}`)
check("note drawn", await until(async () => (await page.locator(".file-view .cm-content").count()) > 0, 8000))
await wait(600)
const body0 = await box(".file-view .cm-content"), bar0 = await box(".file-view > *:first-child"), side0 = await box("aside, [data-sidebar]")
const lineH0 = await page.evaluate(() => document.querySelector(".file-view .cm-line")?.getBoundingClientRect().height)
await page.screenshot({ path: `${OUT}note-100.png` })
await wheelOver(".file-view .cm-content", -100)
check("⌘ + wheel up over a note: 110%", (await pref("note")) === 110, await pref("note"))
const lineH1 = await page.evaluate(() => document.querySelector(".file-view .cm-line")?.getBoundingClientRect().height)
check("its lines are drawn 1.1 times as tall", Math.abs(lineH1 / lineH0 - 1.1) < 0.03, [lineH0, lineH1])
const body1 = await box(".file-view .cm-content"), bar1 = await box(".file-view > *:first-child"), side1 = await box("aside, [data-sidebar]")
check("the column widens with it", Math.abs(body1.w / body0.w - 1.1) < 0.03, [body0.w, body1.w])
check("the path bar stays as it was", bar0 && bar1 && Math.abs(bar0.h - bar1.h) < 0.5, [bar0, bar1])
check("the sidebar stays as it was", JSON.stringify(side0) === JSON.stringify(side1), [side0, side1])
await wheelOver(".file-view .cm-content", -100, "Meta", 3)
check("three more steps: 140%", (await pref("note")) === 140, await pref("note"))
await page.screenshot({ path: `${OUT}note-140.png` })
await wheelOver(".file-view .cm-content", 100)
check("⌘ + wheel down: 130%", (await pref("note")) === 130, await pref("note"))
// A pinch: ⌃ and small deltas, added up.
await wheelOver(".file-view .cm-content", -4, "Control", 6)
check("a pinch out: 140%", (await pref("note")) === 140, await pref("note"))
check("the app's zoom isn't touched", await page.evaluate(() => Math.abs(window.visualViewport.scale - 1) < 0.01 && window.outerWidth > 0))

// A click in the zoomed editor lands where it points: the end of "Bravo two", then typing.
const at = await page.evaluate(() => {
  const line = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.textContent === "Bravo two")
  const r = document.createRange(); r.selectNodeContents(line); const b = r.getBoundingClientRect()
  return { x: b.right - 2, y: b.y + b.height / 2 }
})
await page.mouse.click(at.x, at.y)
await page.keyboard.press("End")
await page.keyboard.type("X")
check("a click and typing in the zoomed editor", await until(async () => (await api("GET", `file?path=${encodeURIComponent(NOTE)}`)).text?.includes("Bravo twoX"), 4000))
const caret = await page.evaluate(() => {
  const sel = document.getSelection(), c = document.querySelector(".cm-cursor")?.getBoundingClientRect() ?? (sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null)
  const line = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.textContent === "Bravo twoX")
  const r = document.createRange(); r.selectNodeContents(line); const b = r.getBoundingClientRect()
  return c && { caret: c.x, end: b.right, cy: c.y + c.height / 2, ly: b.y + b.height / 2 }
})
check("the caret is drawn at the end of the line", caret && Math.abs(caret.caret - caret.end) < 4 && Math.abs(caret.cy - caret.ly) < 6, caret)
// A click on "Charlie" at its start: the caret goes there (the click's coordinates map into the zoomed text).
const ch = await page.evaluate(() => {
  const line = [...document.querySelectorAll(".file-view .cm-line")].find((l) => l.textContent.startsWith("Charlie"))
  const t = line.firstChild; const r = document.createRange(); r.setStart(t, 3); r.setEnd(t, 4); const b = r.getBoundingClientRect()
  return { x: b.x + 1, y: b.y + b.height / 2 }
})
await page.mouse.click(ch.x, ch.y)
await page.keyboard.type("Y")
check("a click mid-word lands on that letter", await until(async () => (await api("GET", `file?path=${encodeURIComponent(NOTE)}`)).text?.includes("ChaYrlie"), 4000))

// The commands
await page.keyboard.press("Escape")
await page.keyboard.press("ControlOrMeta+p")
await page.keyboard.type("Reset note text size")
await wait(300)
await page.keyboard.press("Enter")
check("Reset note text size: 100%", await until(async () => (await pref("note")) === 100, 2000), await pref("note"))
check("back at 100% the note isn't zoomed", await page.evaluate(() => !document.querySelector("[data-text-size]")))
await page.keyboard.press("ControlOrMeta+p")
await page.keyboard.type("Increase note text size")
await wait(300)
await page.keyboard.press("Enter")
check("Increase note text size: 110%", await until(async () => (await pref("note")) === 110, 2000), await pref("note"))
check("not in the vault", !JSON.stringify(await api("GET", "config/appearance")).includes("110"))

// A dashboard isn't a note: ⌘ + the wheel leaves the note size alone.
await page.goto(`${B}#${fileHash("Dashboards/Today.md")}`)
await until(async () => (await page.locator(".file-view").count()) > 0, 8000)
await wait(800)
await wheelOver(".file-view", -100)
check("not over a dashboard", (await pref("note")) === 110, await pref("note"))

// Settings > Appearance
await page.goto(`${B}#settings`)
check("Settings has a row per kind", await until(async () => (await page.locator("[data-text-size-row=note]").count()) === 1 && (await page.locator("[data-text-size-row=terminal]").count()) === 1, 8000))
const row = page.locator("[data-text-size-row=note]")
check("the row says 110%", (await row.innerText()).includes("110%"), await row.innerText())
await row.getByRole("button", { name: "Increase note text size" }).click()
check("+: 120%", (await pref("note")) === 120, await pref("note"))
await row.getByRole("button", { name: "Decrease note text size" }).click()
await row.getByRole("button", { name: "Decrease note text size" }).click()
check("− −: 100%", (await pref("note")) === 100, await pref("note"))
await row.getByRole("button", { name: "Decrease note text size" }).click()
await page.getByRole("button", { name: "Reset note text size" }).click()
check("its reset button: back to 100%", (await pref("note")) === 100, await pref("note"))
await page.locator("section", { has: page.getByRole("heading", { name: "Appearance" }) }).last().screenshot({ path: `${OUT}settings.png` })

// A terminal
const id = `qats${Date.now().toString(36)}`
await page.goto(`${B}#view/terminal%2F${id}`)
check("terminal drawn", await until(async () => (await page.locator(".xterm-screen").count()) > 0, 8000))
const text = () => terminalText(page)
const cols = async (tag) => {
  await page.locator(".xterm").click()
  await page.keyboard.type(`echo ${tag}=$(tput cols)\n`)
  let n = 0
  await until(async () => { const m = (await text()).match(new RegExp(`${tag}=(\\d+)`)); n = m ? Number(m[1]) : 0; return n > 0 }, 8000)
  return n
}
await wait(800)
const c0 = await cols("before")
// A cell's height (the keyboard field is one cell tall): the font's size, whichever renderer draws it (WebGL: a canvas).
const cell = () => page.evaluate(() => parseFloat(document.querySelector(".xterm-helper-textarea").style.lineHeight))
const h0 = await cell()
await wheelOver(".xterm", -100, "Meta", 3)
check("⌘ + wheel over a terminal: 130%", (await pref("terminal")) === 130, await pref("terminal"))
check("the note's size didn't change", (await pref("note")) === 100)
await wait(500)
const c1 = await cols("after")
check("the shell gets fewer columns", c0 > 0 && c1 > 0 && c1 < c0 * 0.85, [c0, c1])
const h1 = await cell()
check("the terminal's cells are 130% as tall (13px to 17px)", h0 > 0 && Math.abs(h1 / h0 - 17 / 13) < 0.08, [h0, h1])
await page.screenshot({ path: `${OUT}terminal-130.png` })
await page.keyboard.press("ControlOrMeta+p")
await page.keyboard.type("Reset terminal text size")
await wait(300)
await page.keyboard.press("Enter")
check("Reset terminal text size: 100%", await until(async () => (await pref("terminal")) === 100, 2000))
await page.locator(".xterm").click()
await page.keyboard.type("exit\n")
await wait(500)

// Phone width: the rows (no ⌘ hint), and a note at its size.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
const p2 = watch(await phone.newPage())
await p2.goto(`${B}#settings`)
await until(async () => (await p2.locator("[data-text-size-row=note]").count()) === 1, 8000)
const rowText = await p2.locator("[data-text-size-row=note]").locator("xpath=../..").innerText()
check("phone: the note row, without the scroll hint", !rowText.includes("scroll") && rowText.includes("This device only"), rowText)
await p2.locator("[data-text-size-row=note]").getByRole("button", { name: "Increase note text size" }).tap()
await p2.locator("[data-text-size-row=note]").getByRole("button", { name: "Increase note text size" }).tap()
await p2.screenshot({ path: `${OUT}phone-settings.png` })
await p2.goto(`${B}#${fileHash(NOTE)}`)
check("phone: the note is drawn at 120%", await until(async () => (await p2.evaluate(() => document.querySelector("[data-text-size]")?.style.zoom)) === "1.2", 8000), await p2.evaluate(() => document.querySelector("[data-text-size]")?.style.zoom))
await wait(500)
await p2.screenshot({ path: `${OUT}phone-note-120.png` })
const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check("phone: nothing wider than the screen", overflow <= 0, overflow)

await browser.close()
await api("DELETE", `file?path=${encodeURIComponent(NOTE)}`).catch(() => {})
await done()
