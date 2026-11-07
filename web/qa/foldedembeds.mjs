// Embeds and folds (editor/livePreview.ts, core/richmd.ts drawEmbeds, core/heights.ts): a `![[x]]` in a folded callout
// loads nothing until it's opened, and then shows, in the editor as in drawn Markdown (an embedded note); a note opened
// again where it was left loads nothing at its top on the way; an embed is held at its height for the width it's drawn
// at, not the one it had last in a pane of another width (a split).
// Writes Qa folded embeds/: throwaway server only.
//   node web/qa/foldedembeds.mjs <base url> <vault path>
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa folded embeds", REPORT = `${DIR}/Report.md`, HOST = `${DIR}/Host.md`, OTHER = `${DIR}/Other.md`, enc = encodeURIComponent
const filler = (n, what) => Array.from({ length: n }, (_, i) => `${what} ${i + 1}, a line long enough to wrap once or twice in a pane of an ordinary width.\n`).join("\n")
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
// (bytes named .mp4: a player is drawn for it, at 2:1 with no picture, so its height follows its width)
writeFileSync(`${VAULT}/${DIR}/Qa clip.mp4`, Buffer.alloc(64))
writeFileSync(`${VAULT}/${REPORT}`, `# Report\n\nThe top.\n\n![[Qa clip.mp4]]\n\n${filler(70, "Above")}\n> [!note]- Folded with a video\n> ![[Qa clip.mp4]]\n> After the video.\n\n${filler(40, "Below")}`)
writeFileSync(`${VAULT}/${DIR}/Folded.md`, "# Folded\n\n> [!note]- A section\n> ![[Qa clip.mp4]]\n> After the video.\n")
writeFileSync(`${VAULT}/${HOST}`, "# Host\n\nThe note below is embedded.\n\n![[Folded]]\n\nThe end.\n")
writeFileSync(`${VAULT}/${OTHER}`, "# Other\n\nSomewhere else.\n")

const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
const page = watch(await ctx.newPage())
const go = async (p) => { await page.evaluate((h) => { location.hash = h }, `#file/${enc(p)}`); await page.waitForSelector(`[data-pane] .cm-content`, { timeout: 15000 }); await wait(300) }
const scroller = () => page.evaluate(() => [...document.querySelectorAll("[data-pane]")].find((e) => e.getClientRects().length && e.scrollHeight > e.clientHeight + 50)?.scrollTop ?? null)
const scrollTo = (y) => page.evaluate((y) => { const el = [...document.querySelectorAll("[data-pane]")].find((e) => e.getClientRects().length && e.scrollHeight > e.clientHeight + 50); if (el) el.scrollTop = y }, y)
// The folded callout in the editor: whether it's open and the players drawn in it.
const callout = () => page.evaluate(() => {
  const c = [...document.querySelectorAll("[data-pane] .cm-block-callout")].find((e) => e.getClientRects().length)
  return c ? { open: !!c.querySelector("details")?.open, videos: c.querySelectorAll("video").length, links: c.querySelectorAll("[data-md-embed] a[data-wiki]").length } : null
})

await page.goto(`${B}#file/${enc(REPORT)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
await until(() => page.$("[data-pane] .cm-block-embed video"), 5000)
await wait(1200)

// 1. Opened again where it was left, far below its top's video: that video isn't loaded (the editor draws a note's top
// first, then goes to its place: its block is made and dropped a few ms later, before its player is drawn).
await scrollTo(2600)
await wait(800)
const left = await scroller()
await go(OTHER)
await page.evaluate(() => {
  // (every player made from now on, in the page or not: one drawn into a block already dropped is never in it)
  window.__videos = []
  const make = Document.prototype.createElement
  Document.prototype.createElement = function (tag, ...rest) { const el = make.call(this, tag, ...rest); if (String(tag).toLowerCase() === "video") window.__videos.push(el); return el }
  window.__vauTrace.heights = []
})
await go(REPORT)
await wait(2000)
const back = await page.evaluate(() => ({
  made: window.__videos.length,
  dropped: window.__videos.filter((v) => !v.isConnected).length,
}))
check("opened again at its place: back where it was left", Math.abs((await scroller()) - left) < 120, { left, now: await scroller() })
check("the video at its top isn't loaded on the way to its place", back.made === 0, back)

// 2. The editor: a folded callout's video isn't loaded; opened, it's drawn as a player (not a link).
// (scrolled down to it: the editor draws only what's near the screen)
for (let y = 2600; !(await callout()) && y < 12000; y += 500) { await scrollTo(y); await wait(250) }
await page.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-block-callout")].find((e) => e.getClientRects().length)?.scrollIntoView({ block: "center" }))
await wait(500)
const shut = await callout()
check("editor, folded: its video isn't loaded", shut && !shut.open && shut.videos === 0, shut)
await page.locator("[data-pane] .cm-block-callout summary").first().click()
const opened = await until(async () => { const c = await callout(); return c?.open && c.videos === 1 ? c : null }, 3000)
check("editor, opened: its video is drawn", opened, await callout())
// (shut again for the next visit: the editor keeps a callout as it was left)
await page.locator("[data-pane] .cm-block-callout summary").first().click()
await wait(400)

// 3. Drawn Markdown (a note embedded in another, as sheets, previews and the Companion draw Markdown): the same.
await go(HOST)
await page.waitForSelector("[data-pane] [data-embed] details", { timeout: 10000 })
await wait(800)
const inner = () => page.evaluate(() => {
  const e = [...document.querySelectorAll("[data-pane] [data-embed]")].find((x) => x.getClientRects().length && x.querySelector("details"))
  return e ? { open: !!e.querySelector("details").open, videos: e.querySelectorAll("video").length } : null
})
const foldedIn = await inner()
check("embedded note, folded: its video isn't loaded", foldedIn && !foldedIn.open && foldedIn.videos === 0, foldedIn)
await page.locator("[data-pane] [data-embed] details > summary").first().click()
check("embedded note, opened: its video is drawn", await until(async () => { const i = await inner(); return i?.open && i.videos === 1 ? i : null }, 3000), await inner())

// 4. An embed's height follows its width (a note's text wraps). Seen only in a narrow pane, then drawn wide: not held
// at its narrow height (an empty gap under it, up to 4 s). Seen at both, drawn narrow again: held at its narrow height,
// not the wide one it had last.
const WIDE = `${DIR}/Wide.md`
writeFileSync(`${VAULT}/${DIR}/Long.md`, `# Long\n\n${Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} goes on long enough to wrap over several lines, so that the narrower the pane it is drawn in, the taller it gets, line after line after line.`).join("\n\n")}\n`)
writeFileSync(`${VAULT}/${WIDE}`, "# Wide\n\nAbove the note.\n\n![[Long]]\n\nBelow the note.\n")
// (the note's own box, not its block's: that may be held at another height)
const longAt = () => page.evaluate(() => { const e = [...document.querySelectorAll("[data-pane] .cm-block-embed .note-embed")].find((x) => x.getClientRects().length); return e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null })
// The note's hold on the last visit: the height it was held at (put right for its width) and how it let go.
const longHold = () => page.evaluate(() => {
  const all = (window.__vauTrace.heights ?? []).filter((e) => e.key.includes(":embed:Long:"))
  const last = (why) => all.filter((e) => e.why === why).pop()
  const at = last("width") ?? last("hold"), out = all.filter((e) => e.why !== "hold" && e.why !== "width").pop()
  return { held: at?.held, natural: out?.natural, why: out?.why, after: out?.after }
})
const visit = async (width) => {
  await page.setViewportSize({ width, height: 900 })
  await go(OTHER)
  await page.evaluate(() => { window.__vauTrace.heights = [] })
  await go(WIDE)
  await until(() => page.$("[data-pane] .cm-block-embed .note-embed-body"), 5000)
  await wait(1500)
}
await visit(820)
const narrow = await longAt()
await visit(1500)
const wide = await longAt(), unseen = await longHold()
// (past the longest hold: its wide height is the latest kept, whatever let it go)
await wait(3000)
await visit(820)
const again = await longHold()
check("narrow and wide draw it at different heights (the case to test)", narrow && wide && narrow.h - wide.h > 40, { narrow, wide })
check("drawn at a width never seen: let go once loaded, not held at another width's height", unseen.why === "ready" && unseen.after < 1000, unseen)
check("drawn narrow again: held at its narrow height, not the wide one it had last", again.held !== undefined && again.natural !== undefined && Math.abs(again.held - again.natural) <= 2, again)

rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await done()
