// An embed in a folded callout loads only once opened, and an embed's held height follows the width it's drawn at.
// WRITES Qa folded embeds/: throwaway server only.
//   node web/qa/foldedembeds.mjs <base url> <vault path>
// Paths: editor/livePreview.ts, core/richmd.ts, core/heights.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const DIR = "Qa folded embeds", REPORT = `${DIR}/Report.md`, HOST = `${DIR}/Host.md`, OTHER = `${DIR}/Other.md`, enc = encodeURIComponent
const filler = (n, what) => Array.from({ length: n }, (_, i) => `${what} ${i + 1}, a line long enough to wrap once or twice in a pane of an ordinary width.\n`).join("\n")
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
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
const callout = () => page.evaluate(() => {
  const c = [...document.querySelectorAll("[data-pane] .cm-block-callout")].find((e) => e.getClientRects().length)
  return c ? { open: !!c.querySelector("details")?.open, videos: c.querySelectorAll("video").length, links: c.querySelectorAll("[data-md-embed] a[data-wiki]").length } : null
})

await page.goto(`${B}#file/${enc(REPORT)}`)
await page.waitForSelector("[data-pane] .cm-content", { timeout: 15000 })
await until(() => page.$("[data-pane] .cm-block-embed video"), 5000)
await wait(1200)

await scrollTo(2600)
await wait(800)
const left = await scroller()
await go(OTHER)
await page.evaluate(() => {
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

for (let y = 2600; !(await callout()) && y < 12000; y += 500) { await scrollTo(y); await wait(250) }
await page.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-block-callout")].find((e) => e.getClientRects().length)?.scrollIntoView({ block: "center" }))
await wait(500)
const shut = await callout()
check("editor, folded: its video isn't loaded", shut && !shut.open && shut.videos === 0, shut)
await page.locator("[data-pane] .cm-block-callout summary").first().click()
const opened = await until(async () => { const c = await callout(); return c?.open && c.videos === 1 ? c : null }, 3000)
check("editor, opened: its video is drawn", opened, await callout())
await page.locator("[data-pane] .cm-block-callout summary").first().click()
await wait(400)

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

const WIDE = `${DIR}/Wide.md`
writeFileSync(`${VAULT}/${DIR}/Long.md`, `# Long\n\n${Array.from({ length: 8 }, (_, i) => `Paragraph ${i + 1} goes on long enough to wrap over several lines, so that the narrower the pane it is drawn in, the taller it gets, line after line after line.`).join("\n\n")}\n`)
writeFileSync(`${VAULT}/${WIDE}`, "# Wide\n\nAbove the note.\n\n![[Long]]\n\nBelow the note.\n")
const longAt = () => page.evaluate(() => { const e = [...document.querySelectorAll("[data-pane] .cm-block-embed .note-embed")].find((x) => x.getClientRects().length); return e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null })
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
await wait(3000) // (past the longest hold)
await visit(820)
const again = await longHold()
check("narrow and wide draw it at different heights (the case to test)", narrow && wide && narrow.h - wide.h > 40, { narrow, wide })
check("drawn at a width never seen: let go once loaded, not held at another width's height", unseen.why === "ready" && unseen.after < 1000, unseen)
check("drawn narrow again: held at its narrow height, not the wide one it had last", again.held !== undefined && again.natural !== undefined && Math.abs(again.held - again.natural) <= 2, again)

rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
await done()
