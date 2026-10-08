// Every `![[ ]]` embed's menu (components/EmbedMenu.tsx): right-click on an audio player, a video, a PDF's header, a
// table and an embedded note's header shows what fits its kind (no Copy image or Reset size on audio, no Open in
// default app or Download on a note); right-click in a note's text leaves it alone; Reset size takes `|400` out,
// Remove embed takes the line out, Open in new tab opens it, Delete file trashes it; an embed inside an embedded note
// has no Remove embed (it isn't this note's); a finger held on a player's header on a phone opens the menu.
// WRITES a "Qa embeds" folder: throwaway server only.
//   node web/qa/embedmenus.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/embedmenus-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const DIR = "Qa embeds", NOTE = `${VAULT}/${DIR}/Embeds.md`, enc = encodeURIComponent
rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
mkdirSync(`${VAULT}/${DIR}`, { recursive: true })
// A second of silence as a WAV, a PDF of one page, bytes named .mp4 (the menu doesn't need it to play), a table.
const wav = Buffer.alloc(44 + 8000)
wav.write("RIFF", 0); wav.writeUInt32LE(36 + 8000, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34)
wav.write("data", 36); wav.writeUInt32LE(8000, 40); wav.fill(128, 44)
writeFileSync(`${VAULT}/${DIR}/Qa memo.wav`, wav)
writeFileSync(`${VAULT}/${DIR}/Qa clip.mp4`, Buffer.alloc(64))
writeFileSync(`${VAULT}/${DIR}/Qa doc.pdf`, "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
writeFileSync(`${VAULT}/${DIR}/Qa table.csv`, "name,count\napples,3\npears,5\n")
writeFileSync(`${VAULT}/${DIR}/Qa inner.md`, "---\norigin: ai\n---\n\nInner text to select.\n\n![[Qa memo.wav]]\n")
const body = "---\norigin: ai\n---\n\nTop line.\n\n![[Qa memo.wav]]\n\n![[Qa clip.mp4|300]]\n\n![[Qa doc.pdf|400]]\n\n![[Qa table.csv]]\n\n![[Qa inner]]\n\nBottom line.\n"
writeFileSync(NOTE, body)
const text = () => readFileSync(NOTE, "utf8")
const waitText = async (want) => { for (let i = 0; i < 40 && !want(text()); i++) await wait(100); return want(text()) }
try {
  // (tall enough for every embed at once: the editor draws only what's near the screen, and it measures that before
  // the embeds have their heights)
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 2000 }, colorScheme: "dark" })
  // (in every frame: a PDF's has no localStorage)
  await ctx.addInitScript(() => { try { localStorage.setItem("vaultite.editMode", "live") } catch { /* not the app's frame */ } })
  const page = watch(await ctx.newPage())
  await page.goto(`${B}#file/${enc(`${DIR}/Embeds.md`)}`)
  await page.waitForSelector("[data-pane] .vau-editor [data-embed-menu] audio", { timeout: 15000 })
  await page.waitForSelector("[data-pane] [data-format-embed]", { timeout: 15000 })
  await page.waitForSelector("[data-pane] .note-embed-body", { timeout: 15000 })
  await wait(500)
  const pane = page.locator("[data-pane]").first()
  const items = async () => page.locator("[role=menu] [role=menuitem]").allTextContents()
  const close = async () => { await page.keyboard.press("Escape"); await wait(150) }
  const menuOn = async (loc, what) => { await loc.click({ button: "right" }); await wait(200); const got = await items(); await page.screenshot({ path: `${OUT}${what}.png` }); return got }
  const has = (got, want) => want.every((x) => got.some((i) => i.startsWith(x)))
  const lacks = (got, no) => no.every((x) => !got.some((i) => i.startsWith(x)))

  // The top-level embeds (in this note): each with Remove embed.
  const audio = pane.locator(".cm-block-embed").filter({ has: page.locator("audio") }).first()
  let got = await menuOn(audio.locator("audio"), "audio")
  check("audio: open, download, move, copy path, remove, delete", has(got, ["Open in new tab", "Download", "Move file to…", "Copy path", "Reveal in file tree", "Remove embed", "Delete file"]), got)
  check("audio: nothing for images or sizes", lacks(got, ["Copy image", "Reset size"]), got)
  await close()
  got = await menuOn(audio.locator("button[data-hold-menu]"), "audio-header")
  check("audio: its header has the same menu", has(got, ["Open in new tab", "Remove embed"]), got)
  await close()
  const video = pane.locator(".cm-block-embed").filter({ has: page.locator("video") }).first()
  got = await menuOn(video.locator("video"), "video")
  check("video: Reset size (it has |300) and the file's items", has(got, ["Reset size", "Remove embed", "Open in new tab", "Delete file"]), got)
  await page.getByRole("menuitem", { name: "Reset size" }).click()
  check("Reset size takes |300 out", await waitText((t) => t.includes("\n![[Qa clip.mp4]]\n")), text())
  const pdf = pane.locator(".cm-block-embed").filter({ has: page.locator("iframe") }).first()
  got = await menuOn(pdf.locator("button[data-hold-menu]"), "pdf")
  check("PDF header: Reset size, Download, Remove embed", has(got, ["Reset size", "Download", "Remove embed", "Delete file"]), got)
  await close()
  const table = pane.locator("[data-format-embed]").first()
  got = await menuOn(table.locator("button[data-hold-menu]"), "table")
  check("table header: its menu", has(got, ["Open in new tab", "Remove embed", "Delete file"]), got)
  await close()
  got = await menuOn(table.locator("td, [role=cell], .cm-block-embed *").last(), "table-body")
  check("table body: its menu too", has(got, ["Remove embed"]), got)
  await close()

  // An embedded note: its header's menu; its text keeps the text's own.
  const inner = pane.locator(".note-embed").first()
  got = await menuOn(inner.locator(".note-embed-head"), "note")
  check("note header: open, move, remove, delete note", has(got, ["Open in new tab", "Move file to…", "Remove embed", "Delete note"]), got)
  check("note: no Download or default app", lacks(got, ["Download", "Open in default app", "Copy image"]), got)
  await close()
  await inner.locator(".note-embed-body p", { hasText: "Inner text" }).click({ button: "right" }); await wait(200)
  got = await items()
  check("note text: no embed menu", !got.includes("Remove embed"), got)
  await close()
  // An embed inside the embedded note: the file's items, nothing that changes this note.
  got = await menuOn(inner.locator("audio"), "nested")
  check("nested audio: its menu", has(got, ["Open in new tab", "Delete file"]), got)
  check("nested audio: no Remove embed", lacks(got, ["Remove embed"]), got)
  await close()

  // Remove embed and Delete file; Open in new tab.
  await menuOn(pdf.locator("button[data-hold-menu]"), "pdf-again")
  await page.getByRole("menuitem", { name: "Remove embed" }).click()
  check("Remove embed takes the PDF's line out", await waitText((t) => !t.includes("Qa doc.pdf") && t.includes("![[Qa clip.mp4]]\n\n![[Qa table.csv]]")), text())
  await menuOn(table.locator("button[data-hold-menu]"), "table-again")
  await page.getByRole("menuitem", { name: "Open in new tab" }).click(); await wait(600)
  check("Open in new tab opens the table", await page.locator("[role=tab][aria-selected=true]", { hasText: "Qa table" }).count() > 0 || (await page.evaluate(() => location.hash)).includes("Qa%20table"), await page.evaluate(() => location.hash))
  await page.goto(`${B}#file/${enc(`${DIR}/Embeds.md`)}`)
  await page.waitForSelector("[data-pane] .vau-editor [data-embed-menu] video", { timeout: 15000 }); await wait(400)
  await menuOn(page.locator("[data-pane] .cm-block-embed video").first(), "video-delete")
  await page.getByRole("menuitem", { name: "Delete file" }).click(); await wait(800)
  check("Delete file trashes the video", !existsSync(`${VAULT}/${DIR}/Qa clip.mp4`))
  await ctx.close()

  // A phone: a finger held on the audio's header opens its menu.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" })
  const p = watch(await phone.newPage())
  await p.goto(`${B}#view/files/file/${enc(`${DIR}/Embeds.md`)}`)
  await p.waitForSelector(".vau-editor [data-embed-menu] audio", { timeout: 15000 })
  await wait(600)
  const cdp = await phone.newCDPSession(p)
  const hold = async (loc) => {
    const b = await loc.boundingBox()
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] })
    await wait(700)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    await wait(300)
  }
  await hold(p.locator(".cm-block-embed button[data-hold-menu]").first())
  check("phone: holding an audio's header opens its menu", await p.getByRole("menuitem", { name: "Remove embed" }).count() === 1)
  await p.screenshot({ path: `${OUT}phone.png` })
  await phone.close()
} finally {
  await browser.close()
  rmSync(`${VAULT}/${DIR}`, { recursive: true, force: true })
}
await done()
