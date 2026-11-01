// Audio recorder (a fake microphone; QA_TRANSCRIBE=1 for real whisper), Slides and Export to PDF, desktop and phone.
// WRITES "Qa media", recordings in Attachments/, turns Slides on (put back): throwaway only.
//   node web/qa/media.mjs <base url> <vault path> [out dir]
import fs from "node:fs"
import { SHOTS, palette, qa, until, wait, command } from "./lib/qa.mjs"
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
const MEMO = "Qa media/Memo.md", SLASH = "Qa media/Slash.md", DECK = "Qa media/Deck.md", LAYOUTS = "Qa media/Layouts.md"
const THEMED = { night: "Qa media/Night.md", serif: "Qa media/Serif.md", other: "Qa media/Other theme.md" }

for (const p of [MEMO, SLASH, DECK, LAYOUTS, ...Object.values(THEMED), "Qa media/pic.png"]) await del(p)
// (Slides is off until turned on)
const plugins = async (method, body) => (await fetch(`${B}api/config/plugins`, { method, headers: json, body: body && JSON.stringify(body) })).json()
const pluginsBefore = await plugins("GET")
await plugins("PATCH", { enabled: [...new Set([...(pluginsBefore.enabled ?? []), "slides"])] })
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
  await command(page, "Switch to live preview", 600) // (already in it: the view switch offers reading view)
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
check("Start recording audio: the bar says recording", await until(async () => await bar(page).getAttribute("data-recorder") === "recording", 10000))
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
  await palette(pp, "Start recording audio", 600)
  // (its full bar once it records: "Starting…" is a smaller one, and getUserMedia is slow under load)
  await until(async () => await bar(pp).getAttribute("data-recorder").catch(() => null) === "recording", 15000); await wait(300)
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
await fetch(`${B}api/upload?path=${encodeURIComponent("Qa media/pic.png")}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(png, "base64") })
await put(DECK, "---\ntype: note\n---\n\n# Quarterly plan\nA short deck\n\n---\n\n## Why now\n\n- Customers asked for it\n- The math: $e^{i\\pi} + 1 = 0$\n\n```ts\nconst answer = 42\n---\n```\n\nnote: Say why now\n\n---\n\n## _A picture_\n\n![[pic.png|360]]\n")
for (const [scheme, vp] of [["light", { width: 1280, height: 800 }], ["dark", { width: 1280, height: 800 }]]) {
  page = await open({ viewport: vp, colorScheme: scheme })
  await page.goto(`${B}#file/${enc(DECK)}`); await wait(1500)
  await palette(page, "Start presentation", 600); await wait(800)
  const deck = page.locator("[data-presentation]")
  const count = () => page.locator("[data-slide-count]").innerText()
  check(`slides (${scheme}): three slides, the first shown`, await deck.count() === 1 && await count() === "1 / 3", await count().catch(() => ""))
  check("a title slide", await page.locator("[data-deck-slide] .print-title, [data-deck-slide] h1, [data-deck-slide] .h1").count() >= 1)
  await page.screenshot({ path: `${OUT}media-slides-title-${scheme}.png` })
  await page.keyboard.press("ArrowRight"); await wait(500)
  check("→ next: math drawn, a --- inside code isn't a split",
    await count() === "2 / 3" && await page.locator("[data-deck-slide] .katex").count() >= 1 && (await page.locator("[data-deck-slide]").innerText()).includes("const answer = 42\n---"))
  await page.screenshot({ path: `${OUT}media-slides-2-${scheme}.png` })
  const notesOf = () => page.locator("[data-slide-notes]")
  check("speaker notes (note:) stay off the slide", !(await page.locator("[data-deck-slide]").innerText()).includes("Say why now") && await notesOf().count() === 0)
  await page.keyboard.press("s"); await wait(400)
  check("S shows them beside it", (await notesOf().innerText().catch(() => "")).includes("Say why now"))
  check("the next slide's name is plain text", (await page.locator("[data-slide-notes] [data-next-slide]").innerText().catch(() => "")) === "Next: A picture")
  await page.screenshot({ path: `${OUT}media-slides-notes-${scheme}.png` })
  await page.keyboard.press("s"); await wait(300)
  await page.keyboard.press("End"); await wait(800)
  const img = page.locator("[data-deck-slide] img")
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

// css: files and a theme that's a file: the deck's, live, never the app's.
{
  const CSS_DECK = "Qa media/Styled.md", SHEET = "Qa media/css/deck.css"
  fs.mkdirSync(`${VAULT}/.obsidian/plugins/obsidian-advanced-slides/css`, { recursive: true })
  fs.writeFileSync(`${VAULT}/.obsidian/plugins/obsidian-advanced-slides/css/qa-theme.css`, ":root { --r-main-color: rgb(4, 5, 6); }\n.reveal p { font-style: italic; }\n")
  await put(SHEET, ".reveal h2 { color: rgb(1, 2, 3); }\n.reveal .slides section { background-image: url(../pic.png); }\n")
  await put(CSS_DECK, "---\ntheme: css/qa-theme.css\ncss: [css/deck.css]\n---\n\n## Styled\n\nSome text\n")
  page = await open({ viewport: { width: 1280, height: 800 } })
  await page.goto(`${B}#file/${enc(CSS_DECK)}`); await wait(1500)
  await palette(page, "Start presentation", 600); await wait(1200)
  const look = () => page.evaluate(() => {
    const h = document.querySelector("[data-deck-slide] h2"), p = document.querySelector("[data-deck-slide] p"), d = document.querySelector("[data-deck]")
    return { h2: h && getComputedStyle(h).color, p: p && getComputedStyle(p).fontStyle, main: d && getComputedStyle(d).color, bg: d && getComputedStyle(d).backgroundImage,
      app: getComputedStyle(document.querySelector("#root h2, #root p") ?? document.body).fontStyle }
  })
  const l1 = await look()
  check("css: a deck's stylesheet styles its slides", l1.h2 === "rgb(1, 2, 3)" && l1.bg.includes("pic.png"), l1)
  check("css: a theme that's a file, from Advanced Slides' folder", l1.main === "rgb(4, 5, 6)" && l1.p === "italic" && l1.app !== "italic", l1)
  await page.screenshot({ path: `${OUT}media-slides-css.png` })
  await put(SHEET, ".reveal h2 { color: rgb(7, 8, 9); }\n")
  await until(async () => (await look()).h2 === "rgb(7, 8, 9)", 8000).catch(() => {})
  check("css: a changed stylesheet shows at once", (await look()).h2 === "rgb(7, 8, 9)", await look())
  await page.keyboard.press("Escape"); await wait(400)
  check("css: gone with the presentation", await page.evaluate(() => [...document.querySelectorAll("style")].every((s) => !s.textContent.includes("rgb(7, 8, 9)"))))
  await page.close()
  for (const p of [CSS_DECK, SHEET]) await del(p)
}

// Export as HTML: one file that presents itself, its image inside it.
{
  page = await open({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  await page.goto(`${B}#file/${enc(DECK)}`); await wait(1500)
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), palette(page, "Export slides as HTML", 600)])
  const file = `${OUT}media-slides-export.html`
  await dl.saveAs(file)
  check("export: saved as the note's name", dl.suggestedFilename() === "Deck.html", dl.suggestedFilename())
  const html = fs.readFileSync(file, "utf8")
  check("export: images inside the file, no app code", html.includes("data:image/png") && !html.includes("api/raw") && !/<script[^>]*src=/.test(html), html.length)
  const pp = await open({ viewport: { width: 1280, height: 800 } })
  await pp.goto(`file://${file}`); await wait(800)
  const cnt = () => pp.locator(".slide-count").innerText()
  check("export: it presents itself, from the first slide", await cnt() === "1 / 3" && await pp.locator("section.on h1").count() === 1, await cnt())
  await pp.screenshot({ path: `${OUT}media-slides-export-1.png` })
  await pp.keyboard.press("ArrowRight"); await wait(300)
  check("export: → goes on; math drawn, notes off the slide", await cnt() === "2 / 3" && await pp.locator("section.on .katex").count() >= 1 && !(await pp.locator("section.on .slide-fit").innerText()).includes("Say why now"))
  await pp.keyboard.press("s"); await wait(300)
  check("export: S shows the notes", (await pp.locator("section.on aside").innerText()).includes("Say why now"))
  await pp.screenshot({ path: `${OUT}media-slides-export-2.png` })
  await pp.keyboard.press("End"); await wait(300)
  check("export: the image shows", await pp.locator("section.on img").evaluate((i) => i.complete && i.naturalWidth > 0))
  await pp.close(); await page.close()
}
// Export as HTML keeps a deck's layouts: its grids placed, its splits side by side.
{
  page = await open({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
  await put(LAYOUTS, "<grid drag=\"40 30\" drop=\"bottomright\" bg=\"rgb(0, 128, 0)\">\nPlaced\n</grid>\n")
  await page.goto(`${B}#file/${enc(LAYOUTS)}`); await wait(1500)
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), palette(page, "Export slides as HTML", 600)])
  const file = `${OUT}media-slides-export-layouts.html`
  await dl.saveAs(file)
  const pp = await open({ viewport: { width: 1280, height: 800 } })
  await pp.goto(`file://${file}`); await wait(800)
  const r = await pp.evaluate(() => { const g = [...document.querySelectorAll("section.on *")].find((e) => getComputedStyle(e).backgroundColor === "rgb(0, 128, 0)"), c = document.querySelector("section.on [data-slide-canvas]").getBoundingClientRect(), b = g?.getBoundingClientRect()
    return b && { right: Math.round(c.right - b.right), bottom: Math.round(c.bottom - b.bottom), w: Math.round((b.width / c.width) * 100) } })
  check("export: a grid keeps its place on the slide", r && Math.abs(r.right) <= 2 && Math.abs(r.bottom) <= 2 && Math.abs(r.w - 40) <= 1, r)
  await pp.screenshot({ path: `${OUT}media-slides-export-layouts.png` })
  await pp.close(); await page.close()
}

// ---------- slides themes: reveal's themes in the app's colours ----------
const themedDeck = (theme, extra = "") => `---\ntheme: ${theme}\n---\n\n${extra}# Launch plan\nA short deck\n\n---\n\n## Why now\n\n- Customers asked for **it**\n- A [link](https://example.com) and \`code\`\n`
await put(THEMED.night, themedDeck("night"))
await put(THEMED.serif, themedDeck("serif", "<style>.reveal { --r-link-color: rgb(1, 2, 3); }</style>\n\n"))
await put(THEMED.other, themedDeck("css/my-theme.css"))
const lookOf = (page) => page.evaluate(() => {
  const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  const lum = (c) => { x.fillStyle = c; x.fillRect(0, 0, 1, 1); const [r, g, b] = x.getImageData(0, 0, 1, 1).data; return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }
  const deck = document.querySelector("[data-deck]"), h = deck.querySelector("h1, h2"), p = deck.querySelector(".note-prose"), a = deck.querySelector(".note-prose a")
  const hs = getComputedStyle(h), bg = getComputedStyle(deck).backgroundColor
  return { theme: deck.dataset.deckTheme ?? null, font: hs.fontFamily, text: getComputedStyle(p).fontFamily, transform: hs.textTransform, weight: hs.fontWeight, spacing: hs.letterSpacing,
    bg, bgLum: lum(bg), headLum: lum(hs.color), link: a && getComputedStyle(a).color, bar: getComputedStyle(document.querySelector("[data-slide-progress]")).backgroundColor }
})
const looks = {}
for (const scheme of ["light", "dark"]) {
  page = await open({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  for (const [name, path] of Object.entries(THEMED)) {
    await page.goto("about:blank"); await page.goto(`${B}#file/${enc(path)}`); await wait(1500)
    await palette(page, "Start presentation", 600); await wait(600)
    looks[`${name}-${scheme}`] = await lookOf(page)
    await page.screenshot({ path: `${OUT}media-slides-${name}-${scheme}.png` })
    await page.keyboard.press("ArrowRight"); await wait(400)
    looks[`${name}-${scheme}`].link = (await lookOf(page)).link
    await page.screenshot({ path: `${OUT}media-slides-${name}-2-${scheme}.png` })
    await page.keyboard.press("Escape"); await wait(400)
  }
  const night = looks[`night-${scheme}`], serif = looks[`serif-${scheme}`], other = looks[`other-${scheme}`]
  check(`slides theme night (${scheme}): Montserrat headings, heavy, tight, as written`, night.theme === "night" && night.font.startsWith("Montserrat") && night.transform === "none" && night.weight === "800" && parseFloat(night.spacing) < 0, night)
  check(`slides theme night (${scheme}): dark, light headings, a gold link that's also the progress bar`, night.bgLum < 0.12 && night.headLum > 0.6 && !!night.link && night.link === night.bar, night)
  check(`slides theme serif (${scheme}): Palatino headings and text, light, dark headings`, serif.theme === "serif" && /Palatino/.test(serif.font) && /Palatino/.test(serif.text) && serif.transform === "none" && serif.bgLum > 0.75 && serif.headLum < 0.35, serif)
  check(`slides theme serif (${scheme}): the deck's own --r-* win over the theme's`, serif.link === "rgb(1, 2, 3)", serif.link)
  check(`slides theme as a CSS file (${scheme}): the app's look`, other.theme === null && other.transform === "none" && !/Palatino|Montserrat/.test(other.font), other)
  await page.close()
}
check("slides themes: the same in the app's light and dark (the scheme's tokens in the theme's tone)", ["night", "serif"].every((n) => JSON.stringify(looks[`${n}-light`]) === JSON.stringify(looks[`${n}-dark`])), looks)
// Every theme, its second slide, for a look: the deck is rewritten under a running presentation.
for (const scheme of ["light", "dark"]) {
  await put(THEMED.night, themedDeck("default"))
  page = await open({ viewport: { width: 1280, height: 800 }, colorScheme: scheme })
  await page.goto(`${B}#file/${enc(THEMED.night)}`); await wait(1500)
  await palette(page, "Start presentation", 600); await wait(600); await page.keyboard.press("ArrowRight"); await wait(2500)
  const all = ["default", "white", "league", "beige", "sky", "night", "serif", "simple", "solarized", "blood", "moon", "dracula", "black-contrast", "white-contrast", "consult", "mattropolis"]
  const drawn = []
  for (const t of all) {
    const want = t === "default" ? "black" : t, now = () => page.evaluate(() => document.querySelector("[data-deck]").dataset.deckTheme)
    // (written again if the open editor misses it: what's under test is the theme, not the live reload)
    for (let n = 0; n < 3 && (await now()) !== want; n++) {
      if (t !== "default" || n) await put(THEMED.night, themedDeck(t, `<!-- ${n} -->\n`))
      await until(async () => (await now()) === want, 5000).catch(() => {})
    }
    await wait(300)
    drawn.push(await now())
    await page.screenshot({ path: `${OUT}media-slides-theme-${t}-${scheme}.png` })
  }
  check(`slides themes (${scheme}): each draws as itself`, drawn.join() === all.join().replace("default", "black"), drawn)
  await page.keyboard.press("Escape"); await wait(300); await page.close()
}

// ---------- slides: Advanced Slides' layouts (its docs' decks) ----------
await put(LAYOUTS, `---\ntype: note\n---\n\n<split even gap="1">\n\n![[pic.png]]\n![[pic.png]]\n![[pic.png]]\n</split>\n\n---\n\n## Two to one\n\n<split left="2" right="1" gap="2">\n\n**Lorem Ipsum** is simply dummy text of the printing and typesetting industry, the standard since the 1500s.\n\nInto electronic typesetting, $e^{i\\pi} + 1 = 0$, remaining essentially unchanged.\n</split>\n\n---\n\n<grid drag="60 55" drop="5 10" bg="red">\n60 x 55\n</grid>\n\n<grid drag="25 55" drop="-5 10" bg="green">\n25 x 55\n</grid>\n\n<grid drag="90 20" drop="5 -10" bg="gray">\n90  x 20\n</grid>\n\n---\n\n<grid drag="40 30" drop="topleft" bg="coral" align="left" pad="0 20px">\n### Top left\n- one\n- two\n</grid>\n\n<grid drop="right" border="4px solid white" rotate="-5">\n<split even>\nA\n\nB\n</split>\n</grid>\n\n### Noise <!-- element drag="40 20" drop="bottomleft" bg="rgb(0,0,0)" -->\n\n<grid drag="30 25" drop="center" bg="green" frag="1" animate="fadeIn">\nLater\n</grid>\n\n---\n\n::: block <!-- element style="background-color: rgb(255, 0, 0); padding: 8px" -->\n\nRed block\n\n::: block\nNested, *in* Markdown\n:::\n:::\n\nAfter it\n`)
for (const [scheme, vp, phone] of [["light", { width: 1280, height: 800 }], ["dark", { width: 1280, height: 800 }], ["dark", { width: 390, height: 844 }, true]]) {
  page = await open({ viewport: vp, colorScheme: scheme, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
  const tag = phone ? "phone" : scheme
  await page.goto(`${B}#file/${enc(LAYOUTS)}`); await wait(1500)
  await palette(page, "Start presentation", 600); await wait(800)
  const near = (a, b) => Math.abs(a - b) < 2
  const imgs = await page.locator("[data-slide-box=split] img").evaluateAll((is) => is.map((i) => { const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, ok: i.complete && i.naturalWidth > 0 } }))
  check(`layouts (${tag}): <split even>: its images side by side, a third each`, imgs.length === 3 && imgs.every((r) => r.ok && near(r.y, imgs[0].y) && near(r.w, imgs[0].w)) && imgs[0].x < imgs[1].x && imgs[1].x < imgs[2].x, imgs)
  await page.screenshot({ path: `${OUT}media-layouts-split-${tag}.png` })
  await page.keyboard.press("ArrowRight"); await wait(600)
  const cols = await page.locator("[data-slide-box=split] > .note-body > .note-body-md > p").evaluateAll((ps) => ps.map((p) => { const r = p.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } }))
  check(`layouts (${tag}): left="2" right="1": two columns, the left twice as wide, math drawn`, cols.length === 2 && near(cols[0].y, cols[1].y) && cols[1].x > cols[0].x
    && Math.abs(cols[0].w / cols[1].w - 2) < 0.1 && await page.locator("[data-slide-box] .katex").count() === 1, cols)
  await page.screenshot({ path: `${OUT}media-layouts-ratio-${tag}.png` })
  await page.keyboard.press("ArrowRight"); await wait(600)
  // (in the slide's own px: offsets, before it's scaled and rotated)
  const place = (sel) => page.locator(sel).evaluateAll((es) => es.map((e) => {
    const c = e.closest("[data-slide-canvas]")
    return { x: e.offsetLeft / c.offsetWidth, y: e.offsetTop / c.offsetHeight, w: e.offsetWidth / c.offsetWidth, h: e.offsetHeight / c.offsetHeight, bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }
  }))
  const c = await page.locator("[data-slide-canvas]").evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  const g = await place("[data-slide-box=grid]")
  const pct = (a, b) => Math.abs(a - b) < 0.005
  check(`layouts (${tag}): grids are placed on a slide of Advanced Slides' shape, on screen`, Math.abs(c.w / c.h - 960 / 700) < 0.01 && c.x >= 0 && c.x + c.w <= vp.width + 1 && c.y >= 0 && c.y + c.h <= vp.height, c)
  check(`layouts (${tag}): drop x y from the top left, negative from the right and bottom, drag their size`, g.length === 3
    && pct(g[0].x, 0.05) && pct(g[0].y, 0.1) && pct(g[0].w, 0.6) && pct(g[0].h, 0.55) && pct(g[1].x + g[1].w, 0.95) && pct(g[2].y + g[2].h, 0.9)
    && g[0].bg === "rgb(255, 0, 0)" && g[2].bg === "rgb(128, 128, 128)", { c, g })
  await page.screenshot({ path: `${OUT}media-layouts-grid-${tag}.png` })
  await page.keyboard.press("ArrowRight"); await wait(600)
  const [tl, right, later] = await place("[data-slide-box=grid]"), [noise] = (await place("[data-slide-canvas] :is(h3, .h3)")).slice(-1)
  check(`layouts (${tag}): named drops (topleft, right at the default 50 x 100, center), an annotation's drop and bg`, pct(tl.x, 0) && pct(tl.y, 0) && pct(right.x, 0.5) && pct(right.w, 0.5) && pct(right.h, 1)
    && pct(later.x, 0.35) && pct(later.y, 0.375) && pct(noise.x, 0) && pct(noise.y + noise.h, 1) && pct(noise.w, 0.4) && noise.bg === "rgb(0, 0, 0)" && noise.color === "rgb(245, 245, 247)", { tl, right, later, noise })
  check(`layouts (${tag}): a split inside a grid, side by side`, await page.locator("[data-slide-box=grid] [data-slide-box=split] p").evaluateAll((ps) => ps.length === 2 && ps[0].offsetTop === ps[1].offsetTop && ps[0].offsetLeft < ps[1].offsetLeft))
  const frag = page.locator("[data-slide-box].fragment")
  check(`layouts (${tag}): frag="1": the grid comes in on the next step`, !(await frag.getAttribute("class")).includes("visible"))
  await page.keyboard.press("ArrowRight"); await wait(900)
  check(`layouts (${tag}): ...then it's in`, (await frag.getAttribute("class")).includes("visible") && await page.locator("[data-slide-count]").innerText() === "4 / 5")
  await page.screenshot({ path: `${OUT}media-layouts-grid2-${tag}.png` })
  await page.keyboard.press("ArrowRight"); await wait(600)
  const blocks = await page.locator("[data-slide-box=block]").evaluateAll((bs) => bs.map((b) => ({ cls: b.className, bg: getComputedStyle(b).backgroundColor, text: b.innerText, em: !!b.querySelector("em") })))
  check(`layouts (${tag}): ::: block is a box, its annotation its style, a block in it drawn as Markdown`, blocks.length === 2 && blocks[0].bg === "rgb(255, 0, 0)" && blocks[0].text.includes("Red block")
    && blocks[1].text.includes("Nested") && blocks[1].em && !(await page.locator("[data-deck-slide]").innerText()).includes(":::"), blocks)
  await page.screenshot({ path: `${OUT}media-layouts-block-${tag}.png` })
  await page.close()
}

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

await plugins("PATCH", { enabled: pluginsBefore.enabled ?? [] })
await done()
