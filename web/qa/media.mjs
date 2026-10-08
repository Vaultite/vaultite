// Audio recorder, Slides and Export to PDF, in Chrome with a fake microphone (a beep; no prompt). Recording: "Start
// recording audio" shows the bar (time, level, pause, stop), Stop saves the file as an attachment and embeds it at the
// cursor on a line of its own, `/record` in a note does the same, and from a page that isn't a note a new note gets it;
// with a transcriber on the server (QA_TRANSCRIBE=1: real whisper takes a while) the transcript lands under it.
// Slides: Start presentation, the counter, keys, clicks, a swipe on a phone, Escape. Print: the note alone in light
// colours under print media, whatever the theme, as a PDF (Chrome's page.pdf). Screenshots light and dark, desktop and
// 390px. WRITES a "Qa media" folder and recordings in Attachments/: throwaway only.
//   node web/qa/media.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import { SHOTS, palette, qa, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = SHOTS], browser, check, watch, done } = await qa(import.meta.url, {
  chrome: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
})
const json = { "Content-Type": "application/json" }
const enc = encodeURIComponent
// Fixtures are the user's notes, written as the app writes them (a note an agent makes gets `origin: ai`: Provenance).
const put = (path, text) => fetch(`${B}api/file`, { method: "PUT", headers: { ...json, "X-Vaultite-Client": "app/qa" }, body: JSON.stringify({ path, text }) })
const read = async (path) => (await (await fetch(`${B}api/file?path=${enc(path)}`)).json()).text
const files = async () => (await (await fetch(`${B}api/files`)).json())
const del = (path) => fetch(`${B}api/file?path=${enc(path)}`, { method: "DELETE" })
const MEMO = "Qa media/Memo.md", SLASH = "Qa media/Slash.md", DECK = "Qa media/Deck.md"

for (const p of [MEMO, SLASH, DECK, "Qa media/pic.png"]) await del(p)
await put(MEMO, "---\ntype: note\n---\n\nBefore the recording.\n\nAfter it.\n")
await put(SLASH, "Say something:\n")
// Transcripts only when asked (QA_TRANSCRIBE=1): whisper takes a while for each recording.
fs.mkdirSync(`${VAULT}/.vaultite/plugins/audio-recorder`, { recursive: true })
fs.writeFileSync(`${VAULT}/.vaultite/plugins/audio-recorder/data.json`, JSON.stringify({ auto: !!process.env.QA_TRANSCRIBE }, null, 2) + "\n")

const open = async (opts) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, permissions: ["microphone"], ...opts })
  return watch(await ctx.newPage())
}
const bar = (page) => page.locator("[data-recorder]")
const editLine = (page, text) => page.locator(".vau-editor .cm-line", { hasText: text }).first()
async function liveView(page) {
  await palette(page, "Switch to live preview", 600)
  if (await page.getByText("No command matches").count()) { await page.keyboard.press("Escape"); await wait(300) }
}

// ---------- recording ----------
let page = await open({ viewport: { width: 1280, height: 860 } })
await page.goto(`${B}#file/${enc(MEMO)}`); await wait(1500)
const type = await page.evaluate(() => ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)))
console.log(`     (this Chrome records ${type})`)
await liveView(page)
await editLine(page, "Before the recording.").click(); await page.keyboard.press("End"); await wait(200)
await palette(page, "Start recording audio", 600)
// (the first getUserMedia of a fresh Chrome can take a few seconds: "Starting…" meanwhile)
for (let i = 0; i < 50 && await bar(page).getAttribute("data-recorder").catch(() => null) !== "recording"; i++) await wait(200)
check("Start recording audio: the bar says recording", await bar(page).getAttribute("data-recorder") === "recording")
await wait(2200)
check("the bar counts the time", /0:0[2-4]/.test(await bar(page).innerText()), await bar(page).innerText())
await page.screenshot({ path: `${OUT}media-recording.png` })
await page.getByRole("button", { name: "Pause recording" }).click(); await wait(300)
check("pause", await bar(page).getAttribute("data-recorder") === "paused")
await page.getByRole("button", { name: "Resume recording" }).click(); await wait(800)
await page.getByRole("button", { name: "Stop recording" }).click()
for (let i = 0; i < 30 && await bar(page).count(); i++) await wait(200)
check("stop: the bar goes once it's saved", await bar(page).count() === 0)
await wait(1500)
let text = await read(MEMO)
const rec = /\n!\[\[(Recording \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.(webm|m4a))\]\]\n/.exec(text)
check("the recording is embedded at the cursor, on a line of its own", rec && text.includes("Before the recording.\n![[Recording"), text)
const tree = await files()
const saved = rec && tree.others.find((o) => o.path === `Attachments/${rec[1]}`)
check("the file is in Attachments/", saved && saved.size > 2000, saved)
await page.waitForTimeout(500)
check("it plays in the note", await page.locator(".vau-editor audio, .vau-editor video").count() >= 1)
await page.screenshot({ path: `${OUT}media-embedded.png` })

// /record where the slash is
await page.goto(`${B}#file/${enc(SLASH)}`); await wait(1500)
await liveView(page)
await editLine(page, "Say something:").click(); await page.keyboard.press("End"); await page.keyboard.press("Enter")
await page.keyboard.type("/record"); await wait(500)
await page.keyboard.press("Enter"); await wait(1500)
check("/record starts recording", await bar(page).getAttribute("data-recorder") === "recording")
await page.getByRole("button", { name: "Stop recording" }).click(); await wait(3000)
text = await read(SLASH)
check("/record: the embed where the slash was", /(^|\n)Say something:\n!\[\[Recording [^\]]+\]\]\n/.test(text) && !text.includes("/record"), text)

// From a page that isn't a note: a new note for it, opened.
await page.goto(`${B}#plugins`); await wait(1200)
await palette(page, "Start recording audio", 600); await wait(1500)
await page.getByRole("button", { name: "Stop recording" }).click(); await wait(3500)
const fresh = (await files()).files.filter((f) => /(^|\/)Recording [^/]+\.md$/.test(f.path))
check("no note open: a new note with the recording", fresh.length >= 1 && /^!\[\[Recording /.test((await read(fresh[0].path)).replace(/^---[\s\S]*?---\n+/, "")), fresh.map((f) => f.path))
for (const f of fresh) await del(f.path)

if (process.env.QA_TRANSCRIBE) {
  const t = await (await fetch(`${B}api/audio-recorder/transcriber`)).json()
  console.log(`     (transcriber: ${JSON.stringify(t)})`)
  let got = ""
  for (let i = 0; i < 120 && !got.includes("> [!quote]- Transcript"); i++) { await wait(1000); got = await read(MEMO) }
  check("the transcript lands under the embed", got.includes(`![[${rec?.[1]}]]\n> [!quote]- Transcript\n> `), got)
}
await page.close()

// The bar on a phone, light and dark.
for (const scheme of ["light", "dark"]) {
  const pp = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme })
  await pp.goto(`${B}#file/${enc(MEMO)}`); await wait(1500)
  await palette(pp, "Start recording audio", 600); await wait(2000)
  const box = await bar(pp).boundingBox()
  check(`phone (${scheme}): the bar fits, 44px buttons`, box && box.x >= 8 && box.x + box.width <= 382 && box.height >= 44, box)
  await pp.screenshot({ path: `${OUT}media-recording-phone-${scheme}.png` })
  await pp.getByRole("button", { name: "Stop recording" }).click(); await wait(3000)
  await pp.close()
}

// ---------- slides ----------
const shot = await (await open({ viewport: { width: 320, height: 180 } }))
await shot.setContent(`<div style="width:320px;height:180px;background:linear-gradient(135deg,#4a90d9,#9b59b6)"></div>`)
const png = (await shot.screenshot()).toString("base64")
await shot.close()
await fetch(`${B}api/upload`, { method: "POST", headers: json, body: JSON.stringify({ path: "Qa media/pic.png", data: png }) })
await put(DECK, "---\ntype: note\n---\n\n# Quarterly plan\nA short deck\n\n---\n\n## Why now\n\n- Customers asked for it\n- The math: $e^{i\\pi} + 1 = 0$\n\n```ts\nconst answer = 42\n---\n```\n\n---\n\n## A picture\n\n![[pic.png|360]]\n")
for (const [scheme, vp] of [["light", { width: 1280, height: 800 }], ["dark", { width: 1280, height: 800 }]]) {
  page = await open({ viewport: vp, colorScheme: scheme })
  await page.goto(`${B}#file/${enc(DECK)}`); await wait(1500)
  await palette(page, "Start presentation", 600); await wait(800)
  const deck = page.locator("[data-presentation]")
  const count = () => page.locator("[data-slide-count]").innerText()
  check(`slides (${scheme}): three slides, the first shown`, await deck.count() === 1 && await count() === "1 / 3", await count().catch(() => ""))
  check("a title slide", await page.locator("[data-slide] .print-title, [data-slide] h1, [data-slide] .h1").count() >= 1)
  await page.screenshot({ path: `${OUT}media-slides-title-${scheme}.png` })
  await page.keyboard.press("ArrowRight"); await wait(500)
  check("→ next: math drawn, a --- inside code isn't a split",
    await count() === "2 / 3" && await page.locator("[data-slide] .katex").count() >= 1 && (await page.locator("[data-slide]").innerText()).includes("const answer = 42\n---"))
  await page.screenshot({ path: `${OUT}media-slides-2-${scheme}.png` })
  await page.keyboard.press("End"); await wait(800)
  const img = page.locator("[data-slide] img")
  check("End: the last slide, its image from the vault", await count() === "3 / 3" && await img.count() === 1 && await img.evaluate((i) => i.complete && i.naturalWidth > 0))
  await page.screenshot({ path: `${OUT}media-slides-3-${scheme}.png` })
  await page.mouse.click(100, 400); await wait(400)
  check("a click on the left third goes back", await count() === "2 / 3")
  await page.mouse.click(1000, 400); await wait(400)
  check("a click on the right goes on", await count() === "3 / 3")
  await page.keyboard.press("Escape"); await wait(500)
  check("Escape ends it", await deck.count() === 0)
  await page.close()
}
// A phone: swipes.
page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await page.goto(`${B}#file/${enc(DECK)}`); await wait(1500)
await palette(page, "Start presentation", 600); await wait(800)
const cdp = await page.context().newCDPSession(page)
const swipe = async (x0, x1) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: 400 }] })
  for (let k = 1; k <= 5; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * k) / 5, y: 400 }] })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await wait(400)
}
await swipe(320, 80)
check("phone: a swipe left goes on", await page.locator("[data-slide-count]").innerText() === "2 / 3")
await page.screenshot({ path: `${OUT}media-slides-phone.png` })
await swipe(80, 320)
check("phone: a swipe right goes back", await page.locator("[data-slide-count]").innerText() === "1 / 3")
await page.getByRole("button", { name: "End presentation" }).click(); await wait(400)
check("phone: the close button ends it", await page.locator("[data-presentation]").count() === 0)
await page.close()

// ---------- print ----------
for (const scheme of ["dark", "light"]) {
  page = await open({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  await page.goto(`${B}#file/${enc(DECK)}`); await wait(1500)
  await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1 } })
  await palette(page, "Print note", 600)
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__printed)); i++) await wait(150)
  check(`print (${scheme}): the browser's print, once the note is drawn`, await page.evaluate(() => window.__printed) === 1)
  await page.emulateMedia({ media: "print" })
  const look = await page.evaluate(() => {
    const root = document.getElementById("vau-print")
    const prose = root?.querySelector(".note-prose")
    return { app: getComputedStyle(document.getElementById("root")).display, title: root?.querySelector(".print-title")?.textContent,
      color: prose && getComputedStyle(prose).color, img: root?.querySelector("img")?.complete, title2: document.title }
  })
  check("printing: only the note, under its title (the PDF's name too)", look.app === "none" && look.title === "Deck" && look.title2 === "Deck", look)
  check("printing: dark text whatever the theme, images loaded", look.color === "rgb(28, 28, 30)" && look.img, look)
  await page.pdf({ path: `${OUT}media-print-${scheme}.pdf`, printBackground: true })
  await page.emulateMedia({ media: "screen" })
  await page.evaluate(() => dispatchEvent(new Event("afterprint"))); await wait(300)
  check("after printing: back as it was", await page.locator("#vau-print").count() === 0 && await page.evaluate(() => document.title) !== "Deck")
  await page.close()
}

await done()
