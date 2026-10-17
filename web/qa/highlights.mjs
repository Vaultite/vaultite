// Highlight colours (==🟢text==, web/src/core/highlights.ts): each of the six drawn in its tint with the emoji hidden,
// in live preview, reading and a note embed; the swatch on the highlight at the cursor changes its colour or takes it
// out; typing == suggests the colours; Format ▸ Highlight ▸ colours the selection. Screenshots light and dark.
// WRITES a "Qa highlights" folder: throwaway server only.
//   node web/qa/highlights.mjs <base url> <vault path> [out dir]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, SHOTS, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa highlights", NOTE = `${VAULT}/${DIR}/Colours.md`, enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
const START = "Plain ==default== and ==🔴red== ==🟠orange== ==🟡yellow== ==🟢green== ==🔵blue== ==🟣purple==. ^cols\n\nswatch ==🟢here== end\n\nword\n\n![[Colours#^cols]]\n\nsoft ==one\ntwo== end\n\n- ==x\n- y== list\n\nkeep %%hid\nden%% tail\n\n> %%\n> quoted\n> %%\n"
writeFileSync(NOTE, START)
const disk = () => readFileSync(NOTE, "utf8")
const saved = (want) => until(() => disk().includes(want), 4000)
const EMOJI = /[🔴🟠🟡🟢🔵🟣]/u
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2, colorScheme: "light" })
  await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${enc(`${DIR}/Colours.md`)}`)
  await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
  await wait(800)
  const ed = page.locator("[data-pane] .cm-content").first()
  const line = (n) => ed.locator(".cm-line").nth(n)

  // ---- drawn: live preview, the embed ----
  const colours = ["red", "orange", "yellow", "green", "blue", "purple"]
  const live = await page.evaluate((cs) => cs.map((c) => {
    const el = document.querySelector(`[data-pane] .cm-content .cm-line .cm-highlight.hl-${c}`)
    return el && { text: el.textContent, bg: getComputedStyle(el).backgroundColor }
  }), colours)
  check("live: each colour drawn with its class, the emoji not in it", live.every((x, i) => x && x.text === colours[i]), live)
  check("live: six different tints", new Set(live.map((x) => x?.bg)).size === 6, live.map((x) => x?.bg))
  check("live: no emoji shown off the cursor", !EMOJI.test(await line(0).innerText()), await line(0).innerText())
  check("live: plain ==default== has no colour class", await ed.locator(".cm-highlight", { hasText: "default" }).evaluate((el) => !/hl-/.test(el.className)))
  // a highlight runs over a soft line break (like ~~strike~~), never over list items
  const soft = await ed.locator(".cm-line").evaluateAll((ls) => ls.filter((l) => /^soft|^two/.test(l.textContent)).map((l) => [...l.querySelectorAll(".cm-highlight")].map((h) => h.textContent)))
  check("live: ==a\\nb== marks both lines of one paragraph, hides its marks", JSON.stringify(soft) === '[["one"],["two"]]', soft)
  check("live: ==x and y== in two list items are not a highlight", await ed.locator(".cm-line", { hasText: "list" }).locator(".cm-highlight").count() === 0)
  const cm = await ed.locator(".cm-line").evaluateAll((ls) => ls.filter((l) => /^den|quoted/.test(l.textContent.replace(/^>\s*/, ""))).map((l) => [l.textContent, l.classList.contains("cm-comment"), [...l.querySelectorAll(".cm-comment")].map((c) => c.textContent)]))
  check("live: a %%comment%% over a soft break is faint on its text only; a quoted %% block is faint whole", cm.length === 2 && cm[0][2].join().startsWith("den") && !cm[0][2].join().includes("tail") && cm[1][1], cm)
  const embed = page.locator("[data-pane] .note-embed").first()
  check("embed (Markdown to HTML): coloured marks, no emoji", await until(async () => (await embed.locator("mark.hl-green").count()) === 1)
    && !EMOJI.test(await embed.innerText()), await embed.innerText().catch(() => ""))
  await page.screenshot({ path: `${OUT}highlights-light.png` })
  await page.emulateMedia({ colorScheme: "dark" }); await wait(500)
  await page.screenshot({ path: `${OUT}highlights-dark.png` })
  const darkBg = await ed.locator(".cm-highlight.hl-blue").evaluate((el) => getComputedStyle(el).backgroundColor)
  check("dark: tints from the dark scheme's tokens", darkBg !== live[4]?.bg, [darkBg, live[4]?.bg])
  await page.emulateMedia({ colorScheme: "light" }); await wait(300)

  // ---- the swatch ----
  await ed.locator(".cm-highlight", { hasText: "here" }).click(); await wait(300)
  const swatch = ed.locator(".cm-hl-swatch")
  check("swatch: on the highlight at the cursor, in its colour", await swatch.count() === 1 && /hl-green/.test(await swatch.getAttribute("class")))
  check("swatch: the emoji shows with the marks there", EMOJI.test(await line(2).innerText()))
  await page.screenshot({ path: `${OUT}highlights-swatch.png`, clip: await line(2).boundingBox().then((b) => ({ x: b.x - 10, y: b.y - 6, width: 360, height: b.height + 12 })) })
  await swatch.click(); await wait(300)
  const menu = page.locator("[role=menu]").first()
  const names = await menu.locator("[role^=menuitem]").allTextContents()
  check("swatch: a click shows the colours, Default first, and Remove highlight; green ringed", ["Default", "Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Remove highlight"].every((n) => names.some((x) => x.startsWith(n)))
    && await menu.locator(".hl-dot.is-now.hl-green").count() === 1, names)
  await page.screenshot({ path: `${OUT}highlights-swatch-menu.png` })
  await menu.getByRole("menuitem", { name: "Blue" }).click()
  check("swatch: picking Blue changes the emoji in the text", await saved("swatch ==🔵here== end"), disk().split("\n")[2])
  await ed.locator(".cm-highlight", { hasText: "here" }).click(); await wait(200)
  await ed.locator(".cm-hl-swatch").click(); await wait(200)
  await page.locator("[role=menu]").first().getByRole("menuitem", { name: "Default" }).click()
  check("swatch: Default takes the emoji out", await saved("swatch ==here== end"), disk().split("\n")[2])
  await ed.locator(".cm-highlight", { hasText: "here" }).click(); await wait(200)
  await ed.locator(".cm-hl-swatch").click(); await wait(200)
  await page.locator("[role=menu]").first().getByRole("menuitem", { name: "Remove highlight" }).click()
  check("swatch: Remove highlight keeps the text", await saved("swatch here end"), disk().split("\n")[2])

  // ---- typing == ----
  await line(4).click(); await page.keyboard.press("End"); await page.keyboard.type(" ==")
  const list = page.locator(".cm-tooltip-autocomplete")
  check("==: the colours suggested, each with its dot", await until(async () => (await list.count()) === 1)
    && (await list.locator("li").allTextContents()).join() === "Red,Orange,Yellow,Green,Blue,Purple" && await list.locator(".hl-dot").count() === 6,
  await list.locator("li").allTextContents().catch(() => []))
  await page.screenshot({ path: `${OUT}highlights-suggest.png` })
  await page.keyboard.type("gr"); await wait(150)
  await page.keyboard.press("Enter"); await page.keyboard.type("go")
  check("==: a pick puts the emoji in, the cursor before the closing ==", await saved("word ==🟢go=="), disk().split("\n")[4])
  await page.keyboard.press("End"); await page.keyboard.type(" a == b")
  await wait(300)
  check("==: not offered for a closing == or after a space", await list.count() === 0)

  // ---- Format ▸ Highlight ▸ ----
  await line(4).click(); await page.keyboard.press("Home"); await page.keyboard.press("Shift+Alt+ArrowRight")
  await line(4).click({ button: "right", position: { x: 12, y: 10 } }); await wait(200)
  await page.getByRole("menuitem", { name: "Format" }).hover(); await wait(300)
  await page.locator("[role=menu]").nth(1).getByRole("menuitem", { name: "Highlight" }).hover(); await wait(400)
  const sub = await page.locator("[role=menu]").nth(2).locator("[role^=menuitem]").allTextContents()
  check("Format ▸ Highlight ▸ the colours, each with its dot", ["Default", "Red", "Purple"].every((n) => sub.some((x) => x.startsWith(n)))
    && await page.locator("[role=menu]").nth(2).locator(".hl-dot").count() === 7, sub)
  await page.screenshot({ path: `${OUT}highlights-format.png` })
  await page.locator("[role=menu]").nth(2).getByRole("menuitem", { name: "Orange" }).click()
  check("Format ▸ Highlight ▸ Orange highlights the selection", await saved("==🟠word=="), disk().split("\n")[4])

  // ---- reading ----
  await page.keyboard.press("ControlOrMeta+E"); await wait(800)
  check("reading: coloured, the emoji hidden", await ed.locator(".cm-highlight.hl-purple").count() === 1 && !EMOJI.test(await line(0).innerText()))
} finally {
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
}
await done()
