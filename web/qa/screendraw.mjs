// The companion's drawings over the screen (web/src/screendraw: screendraw/Draw.ts, screendraw/layout.ts, screendraw/ink.ts,
// screendraw/index.ts, in web/src/screen.tsx's page), headless with a stand-in bridge over a made-up screen: marks drawn
// in beats, labels clear of what they name and on screen, cards on calm space, Keep, Clear and actions. Reads only
// web/dist (npm run build first): no app, no window on screen. Needs ffmpeg. Pictures go to web/qa/shots/screendraw-*.png.
// node web/qa/screendraw.mjs
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, SHOTS, qa, until } from "./lib/qa.mjs"

const { browser, check, watch, done } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist"), W = 1280, H = 800
fs.mkdirSync(SHOTS, { recursive: true })
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".webm": "video/webm" }
// (a picture and two seconds of video with no sound, served as the server serves a card's: nothing can play aloud)
const MEDIA = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-screendraw-"))
const ff = (...a) => execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...a])
ff("-f", "lavfi", "-i", "testsrc=s=1600x1000", "-frames:v", "1", path.join(MEDIA, "shot.png"))
ff("-f", "lavfi", "-i", "testsrc=d=2:s=320x180:r=15", "-an", "-c:v", "libvpx", "-b:v", "100k", path.join(MEDIA, "clip.webm"))
// (a made-up app under the overlay, so the marks have things to mark: a toolbar, a sidebar, rows)
const SCREEN = {
  share: { x: 1100, y: 40, w: 96, h: 32, text: "Share" }, search: { x: 300, y: 40, w: 360, h: 32, text: "Search mail" },
  inbox: { x: 24, y: 110, w: 200, h: 34, text: "Inbox" }, sent: { x: 24, y: 150, w: 200, h: 34, text: "Sent" }, drafts: { x: 24, y: 190, w: 200, h: 34, text: "Drafts" },
  row1: { x: 260, y: 110, w: 700, h: 44, text: "Alice Park, Lighthouse invoice for October" }, row2: { x: 260, y: 160, w: 700, h: 44, text: "Bob Lee, Team offsite on Friday" },
  row3: { x: 260, y: 210, w: 700, h: 44, text: "Lighthouse, Your weekly report" }, list: { x: 260, y: 104, w: 700, h: 600, text: "" },
}
// (spots as the server sends them, checked: {x, y, w, h})
// (what the helper gives with an ask: the elements on screen, by id, with what they say)
const ELEMENTS = Object.fromEntries(Object.entries(SCREEN).filter(([, r]) => r.text).map(([k, r]) => [`el:${k}`, { x: r.x, y: r.y, w: r.w, h: r.h, label: r.text }]))
const R = (k) => ({ x: SCREEN[k].x, y: SCREEN[k].y, w: SCREEN[k].w, h: SCREEN[k].h })
const B = (x, y, w = 0, h = 0) => ({ x, y, w, h })

async function open(dark = false) {
  const page = watch(await browser.newPage({ viewport: { width: W, height: H }, colorScheme: dark ? "dark" : "light" }))
  await page.route("http://screen.test/**", (r) => {
    const at = new URL(r.request().url()).pathname, f = at.startsWith("/qa-media/") ? path.join(MEDIA, path.basename(at)) : path.join(DIST, at)
    if (!fs.existsSync(f)) return r.fulfill({ status: 404 })
    r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] ?? "application/octet-stream" })
  })
  await page.addInitScript(([screen, dark]) => {
    window.__acts = []; window.__grabs = []
    window.vaultiteScreen = { on(fn) { window.__scene = fn; return () => {} }, onAt() { return () => {} }, grab(on) { window.__grabs.push(on) }, drop() {}, open() {}, home() {}, menu() {}, stop() {},
      draw: { on(fn) { window.__draw = fn; return () => {} }, act(a) { window.__acts.push(a) } },
      panel: { on() { return () => {} }, size() {}, send() {}, close() {}, mic() {}, more() {} } }
    addEventListener("DOMContentLoaded", () => {
      const bg = document.createElement("div")
      bg.id = "fake-screen"
      bg.style.cssText = `position:fixed;inset:0;z-index:-1;font:14px system-ui;background:${dark ? "#1f1f22" : "#f4f4f6"};color:${dark ? "#ddd" : "#222"}`
      for (const [k, r] of Object.entries(screen)) {
        if (!r.text) continue
        const el = document.createElement("div")
        el.textContent = r.text
        el.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;display:flex;align-items:center;padding:0 12px;box-sizing:border-box;border-radius:8px;` +
          (k === "share" ? "background:#2563eb;color:white;justify-content:center;font-weight:600" : k.startsWith("row") ? `background:${dark ? "#2a2a2e" : "white"}` : `background:${dark ? "#2a2a2e" : "#e8e8ec"}`)
        bg.append(el)
      }
      document.body.append(bg)
    })
  }, [SCREEN, dark])
  await page.goto("http://screen.test/screen.html")
  await page.waitForFunction(() => !!window.__draw && !!window.__scene)
  // (the overlay's scene, nothing in it: the drawings draw under its cursors)
  await page.evaluate(() => window.__scene({ width: innerWidth, height: innerHeight, top: 25, agents: [], summon: null, ink: null, pill: null }))
  return page
}
const show = (page, d, here = {}) => page.evaluate(([d, here]) => window.__draw(d && { ...d, here: { width: innerWidth, height: innerHeight, origin: { x: 0, y: 0 }, home: true, top: 25, ...here } }), [d, here])
const rects = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, text: e.textContent, kind: e.getAttribute("data-mark-label") ?? e.getAttribute("data-mark") } }), sel)
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const onScreen = (r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H

// ---- marks on the screen, in beats with the words
const MARKS = {
  id: "d1", agent: "Claude", tint: "orange", t: Date.now(), caption: "Share is up here. Then pick who in the list. Your sent mail is below.",
  places: ELEMENTS,
  marks: [
    { type: "ring", at: { el: "share" }, label: "Share" },
    { type: "num", at: { el: "share" }, n: 1 },
    { type: "connect", from: { el: "share" }, to: R("row2"), label: "then pick who", beat: 1 },
    { type: "num", at: R("row2"), n: 2, beat: 1 },
    { type: "underline", at: B(270, 222, 220, 20), beat: 1 },
    { type: "check", at: R("row1"), beat: 1 },
    { type: "cross", at: R("row3"), beat: 1 },
    { type: "frame", at: B(16, 104, 216, 126), label: "Your folders", beat: 2 },
    { type: "point", at: R("sent"), label: "Sent", beat: 2 },
    { type: "strike", at: B(270, 172, 160, 20), beat: 2 },
    { type: "scroll", at: B(990, 420), dir: "down", beat: 2 },
    { type: "write", text: "Drafts are kept for 30 days", beat: 2 },
    { type: "button", label: "Share it for me", do: { ask: "Share it with Bob" }, beat: 2 },
    { type: "copy", text: "bob@lighthouse.test", label: "Copy Bob's address", beat: 2 },
  ],
}
const light = await open()
await show(light, MARKS)
await light.waitForSelector("[data-screendraw]")
const first = await light.evaluate(() => ({ beat: document.querySelector("[data-screendraw]").getAttribute("data-beat"), labels: [...document.querySelectorAll("[data-mark-label]")].map((e) => e.textContent), cards: document.querySelectorAll("[data-mark]").length }))
check("at first only the first sentence's marks: the ring (its label, the button's own word, left out) and its step", first.beat === "0" && first.labels.join() === "" && first.cards === 1, first)
const later = await until(() => light.evaluate(() => document.querySelector("[data-screendraw]")?.getAttribute("data-beat") === "2"), 9000)
check("the next beats come as the words are read, one after another", !!later)
await light.waitForTimeout(1800)
const labels = await rects(light, "[data-mark-label]")
check("every label is drawn, in a pill", labels.map((l) => l.text).sort().join() === ["then pick who", "Your folders", "Sent", "Scroll"].sort().join(), labels.map((l) => l.text))
const named = { "Your folders": { x: 16, y: 104, w: 216, h: 126 }, Sent: SCREEN.sent }
const covering = labels.filter((l) => named[l.text] && hit(l, named[l.text]))
check("no label covers what it names", !covering.length, covering)
check("every label is on screen, below the menu bar", labels.every((l) => onScreen(l) && l.y >= 25), labels)
const clash = labels.flatMap((a, i) => labels.slice(i + 1).filter((b) => hit(a, b)).map((b) => [a.text, b.text]))
check("labels never overlap each other", !clash.length, clash)
// (the other marks' strokes: the underline under row 3, the strike on row 2, the tick and the cross)
const strokes = [{ x: 264, y: 236, w: 232, h: 18 }, { x: 264, y: 172, w: 172, h: 20 }, { x: 960, y: 116, w: 36, h: 36 }, { x: 960, y: 216, w: 36, h: 36 }]
const onInk = labels.filter((l) => strokes.some((k) => hit(l, k)))
check("labels keep off the other marks' strokes", !onInk.length, onInk)
const cards = await rects(light, "[data-mark=write], .sd-chip")
const marked = [SCREEN.share, SCREEN.row1, SCREEN.row2, SCREEN.row3, { x: 16, y: 104, w: 216, h: 126 }, SCREEN.sent]
const things = Object.values(ELEMENTS)
check("cards go on calm space: clear of everything on screen, marked or not, on screen", cards.length === 3 && cards.every((c) => onScreen(c) && ![...marked, ...things].some((m) => hit(c, m))), cards)
const ink = await light.evaluate(() => ({ ink: document.querySelectorAll(".sd-ink").length, pen: [...document.querySelectorAll(".sd-pen")].every((p) => getComputedStyle(p).animationName === "sd-pen"),
  focus: [...document.querySelectorAll("[data-focus]")].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, anim: getComputedStyle(e).animationName } }) }))
check("strokes are ink (perfect-freehand), drawn as by a pen", ink.ink >= 12 && ink.pen, ink)
const fr = ink.focus[0]
check("a frame is a box round its area, opened by the pen, a glow as it lands", ink.focus.length === 1 && fr.x === 10 && fr.y === 98 && fr.w === 228 && fr.h === 138 && fr.anim === "sd-open, sd-land", ink.focus)
const done1 = await light.evaluate(() => [...document.querySelectorAll(".sd-pen")].every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.01))
check("…and every stroke ends fully drawn", done1)
await light.screenshot({ path: path.join(SHOTS, "screendraw-marks.png") })

// ---- what the user presses
await light.click("text=Copy Bob's address")
await light.click("text=Share it for me")
const acts = await light.evaluate(() => window.__acts)
check("a copy chip copies its text; a next-step button asks its follow-up", acts.some((a) => a.kind === "copy" && a.text === "bob@lighthouse.test" && a.id === "d1") && acts.some((a) => a.kind === "ask" && a.text === "Share it with Bob"), acts)
check("a chip takes the pointer while it's under it (the overlay lets it through elsewhere)", await light.evaluate(() => window.__grabs.includes(true)))
const tools = await light.evaluate(() => [...document.querySelectorAll(".sd-tool")].map((e) => e.textContent))
check("while it's up: Keep (it has words worth keeping) and Clear", tools.join() === "Keep,Clear", tools)
await light.click("text=Keep")
const keep = await light.evaluate(() => window.__acts.find((a) => a.kind === "keep"))
check("Keep sends the drawing with the places it found", keep?.id === "d1" && !!keep.places?.["el:share"], keep)
await show(light, { ...MARKS, kept: "Drawings/Share it.excalidraw" })
await light.waitForTimeout(100)
const kept = await light.evaluate(() => ({ text: document.querySelector("[data-kept]")?.textContent, beat: document.querySelector("[data-screendraw]").getAttribute("data-beat"), labels: document.querySelectorAll("[data-mark-label]").length }))
check("kept, it says where, and nothing is drawn again", kept.text === "Kept in Drawings/Share it" && kept.beat === "2" && kept.labels === 4, kept)
await light.click("text=Clear")
check("Clear asks for it to go", await light.evaluate(() => window.__acts.some((a) => a.kind === "clear" && a.id === "d1")))

// ---- another display: its own part, in its own points; the cards stay on the home display
await show(light, MARKS, { origin: { x: -W, y: 0 }, home: false })
await light.waitForTimeout(3500)
const other = await light.evaluate(() => ({ labels: document.querySelectorAll("[data-mark-label]").length, cards: document.querySelectorAll("[data-mark]").length, tools: document.querySelectorAll(".sd-tools").length }))
check("a display the marks aren't on draws none of them, nor the cards", other.labels === 0 && other.cards === 0 && other.tools === 0, other)

// ---- gone: it fades, then it's taken away
await show(light, MARKS)
await light.waitForTimeout(200)
await show(light, null)
await light.waitForTimeout(40)
const fading = await light.evaluate(() => !!document.querySelector(".sd-root.sd-leave"))
await light.waitForTimeout(400)
check("taken down, it fades out, then it's gone", fading && await light.evaluate(() => !document.querySelector("[data-screendraw]")))

// ---- a scratch pad, a sticky, a list; a spotlight; in the dark
const PAD = {
  id: "d2", agent: "Claude", tint: "blue", t: Date.now(), caption: "Here's how the quarters compare.", places: ELEMENTS,
  marks: [
    { type: "spotlight", at: R("row1") },
    { type: "paper", title: "Quarterly sales", grid: true, w: 420, h: 260, items: [
      { type: "chart", kind: "bar", x: 20, y: 20, w: 240, h: 200, values: [3, 5, 8, 6], labels: ["Q1", "Q2", "Q3", "Q4"] },
      { type: "arrow", from: [330, 60], to: [210, 70], label: "best" },
      { type: "text", x: 290, y: 90, text: "Q3: 8k" },
      { type: "ellipse", x: 290, y: 150, w: 110, h: 60, label: "goal 10k" },
      { type: "path", points: [[20, 240], [120, 236], [220, 242], [300, 238]] } ] },
    { type: "sticky", title: "Remember", text: "Q4 includes the Lighthouse deal." },
    { type: "list", title: "Next", numbered: true, items: ["Ask Alice for Q4", "Update the deck", "Send to Bob"] },
  ],
}
for (const [page, name] of [[light, "light"], [await open(true), "dark"]]) {
  await show(page, PAD)
  await page.waitForSelector("[data-mark=paper]")
  await page.waitForTimeout(2600)
  const parts = await rects(page, "[data-mark=paper], [data-mark=sticky], [data-mark=list]")
  const overlap = parts.flatMap((a, i) => parts.slice(i + 1).filter((b) => hit(a, b)).map((b) => [a.kind, b.kind]))
  const covered = parts.filter((p) => Object.values(ELEMENTS).some((e) => hit(p, e)))
  check(`${name}: the pad, the sticky and the list on calm space: on screen, apart, covering nothing on screen`, parts.length === 3 && parts.every(onScreen) && !overlap.length && !covered.length, { parts, overlap, covered })
  const pad = await page.evaluate(() => { const p = document.querySelector("[data-mark=paper]"); return { title: p.querySelector(".sd-title")?.textContent, grid: !!p.querySelector(".sd-grid"), axis: [...p.querySelectorAll(".sd-axis")].map((e) => e.textContent).join(), lines: p.querySelectorAll(".sd-line").length, ink: p.querySelectorAll(".sd-ink").length } })
  check(`${name}: the pad has its title, its grid, a bar chart with its labels, its sketches (its arrow one) and ink`, pad.title === "Quarterly sales" && pad.grid && pad.axis === "Q1,Q2,Q3,Q4" && pad.lines >= 10 && pad.ink >= 1, pad)
  const fg = await page.evaluate(() => { const c = getComputedStyle(document.querySelector("[data-mark=list]")); return [c.color, c.backgroundColor] })
  check(`${name}: cards follow the theme (readable text on their background)`, name === "dark" ? /rgb\((2[0-5]\d|1[6-9]\d)/.test(fg[0]) : /rgb\(([0-9]|[1-9]\d), /.test(fg[0]), fg)
  await page.screenshot({ path: path.join(SHOTS, `screendraw-pad-${name}.png`) })
  // (each page left open keeps its animations going: on a runner's software GPU they pile up)
  await page.close()
}

// ---- paced to the voice: a beat's marks wait for its sentence to be heard, and spread over it
{
  const page = await open()
  const t = await page.evaluate(() => Date.now())
  const PACED = { id: "dp", agent: "Claude", tint: "orange", t, caption: "Share is up here. Then pick who in the list.", places: ELEMENTS,
    marks: [{ type: "ring", at: { el: "share" } }, { type: "check", at: R("row1"), beat: 1 }, { type: "cross", at: R("row3"), beat: 1 }],
    spoken: [{ at: t, dur: 2500 }, null] }
  await show(page, PACED)
  await page.waitForSelector("[data-screendraw=dp]")
  const beat = () => page.evaluate(() => document.querySelector("[data-screendraw=dp]")?.getAttribute("data-beat"))
  // (its second sentence turns out to be heard later than the first's end: at 4.5 s)
  await page.waitForTimeout(300)
  await show(page, { ...PACED, spoken: [{ at: t, dur: 2500 }, { at: t + 4500, dur: 1600 }] })
  await page.waitForTimeout(2900)
  const waited = await beat()
  const came = await until(async () => (await beat()) === "1", 5000)
  const delays = await page.evaluate(() => [...document.querySelectorAll("[data-mark-i] .sd-pen")].map((e) => parseFloat(getComputedStyle(e).animationDelay) * 1000))
  check("paced: a beat waits for its sentence to be heard, then comes", waited === "0" && !!came, { waited })
  check("paced: its marks spread over the time it's said, not bunched", delays.length >= 3 && Math.max(...delays) - Math.min(...delays.slice(1)) >= 600, delays)
  await page.close()
}

// ---- a walkthrough while its words are being said: nothing before its sentence is heard; the earlier marks step back
{
  const page = await open()
  const TOUR = { id: "dw", agent: "Claude", tint: "orange", t: Date.now(), caption: "Your folders are here. You share from up here.", places: ELEMENTS, waits: true, spoken: [null, null],
    marks: [{ type: "frame", at: B(16, 104, 216, 126), label: "Folders" }, { type: "point", at: R("sent") }, { type: "ring", at: { el: "share" }, beat: 1 }] }
  await show(page, TOUR)
  await page.waitForSelector("[data-screendraw=dw]")
  await page.waitForTimeout(600)
  const before = await page.evaluate(() => document.querySelectorAll("[data-screendraw=dw] [data-mark-i]").length)
  const t1 = await page.evaluate(() => Date.now())
  await show(page, { ...TOUR, spoken: [{ at: t1 + 900, dur: 1200 }, null] })
  await page.waitForTimeout(500)
  const early = await page.evaluate(() => document.querySelectorAll("[data-screendraw=dw] [data-mark-i]").length)
  await page.waitForTimeout(700)
  const heard = await page.evaluate(() => document.querySelectorAll("[data-screendraw=dw] [data-mark-i]").length)
  check("walkthrough: while its words are being said, no mark shows before its sentence is heard", before === 0 && early === 0 && heard >= 2, { before, early, heard })
  await show(page, { ...TOUR, spoken: [{ at: t1 + 900, dur: 1200 }, { at: t1 + 2200, dur: 1000 }] })
  await page.waitForTimeout(1600)
  const past = await page.evaluate(() => ({ frame: [...document.querySelector("[data-focus]")?.parentElement?.classList ?? []].filter((c) => c !== "sd-move").join(" "), point: [...document.querySelectorAll("svg .sd-gone")].length, ring: document.querySelector("[data-screendraw=dw]")?.getAttribute("data-beat") }))
  check("walkthrough: as the next thing is named, the one before steps back and what pointed at it goes", past.frame === "sd-past" && past.point === 1 && past.ring === "1", past)
  await page.screenshot({ path: path.join(SHOTS, "screendraw-walkthrough.png") })
  await page.close()
}

// ---- frames side by side (a sidebar's sections): apart, each named by a small tag snug at it, none on another
{
  const page = await open()
  const rows = ["inbox", "sent", "drafts"]
  await show(page, { id: "df", agent: "Claude", tint: "orange", t: Date.now(), places: ELEMENTS, marks: rows.map((k, i) => ({ type: "frame", at: { el: k }, label: ["Mail in", "Mail out", "Unsent"][i] })) })
  await page.waitForSelector("[data-screendraw=df]")
  await page.waitForTimeout(1800)
  const boxes = await rects(page, "[data-focus]"), tags = await rects(page, "[data-mark-label]")
  const apart = boxes.every((a, i) => boxes.slice(i + 1).every((b) => !hit(a, b)))
  const gap = (l, f) => Math.hypot(Math.max(0, f.x - (l.x + l.w), l.x - (f.x + f.w)), Math.max(0, f.y - (l.y + l.h), l.y - (f.y + f.h)))
  const snug = tags.length === 3 && tags.every((t, i) => gap(t, boxes[i]) <= 4 && !hit(t, boxes[i]) && onScreen(t) && t.h <= 20)
  const clash = tags.some((a, i) => tags.slice(i + 1).some((b) => hit(a, b)))
  check("frames side by side never overlap; each label a small tag snug at its own frame, on screen, none on another", boxes.length === 3 && apart && snug && !clash, { boxes, tags })
  await page.screenshot({ path: path.join(SHOTS, "screendraw-frames.png") })
  await page.close()
}

// ---- svg: a dinosaur sketched, a logo clean, each path drawn by the pen, fills behind
const DINO = "M20 95 C20 70 45 55 75 55 C95 55 105 60 120 58 C135 30 140 12 160 10 C175 9 182 18 178 26 C172 22 165 22 160 30 C152 45 150 62 148 72 C160 78 172 88 190 92 C175 96 160 92 145 88 L145 108 L132 108 L130 92 C112 96 95 96 80 94 L80 110 L67 110 L64 92 C50 92 38 100 20 95 Z"
const LOGO = [{ d: "M50 8 a42 42 0 1 0 0.01 0 Z", color: "ink", width: 3 }, { d: "M30 62 L50 26 L70 62 Z", fill: "blue", color: "none" },
  { d: "M44 50 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z", fill: "#ffffff", color: "none" }]
{
  const page = await open()
  await show(page, { id: "dsvg", agent: "Claude", tint: "green", t: Date.now(), places: ELEMENTS, marks: [
    { type: "paper", id: "dino", title: "A dinosaur", w: 300, h: 200, items: [{ type: "svg", id: "rex", x: 12, y: 12, w: 276, h: 176, style: "sketch", viewBox: [0, 0, 200, 120], paths: [{ d: DINO, fill: "green" },
      { d: "M166 17 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 Z", fill: "ink" }, { d: "M100 58 L106 46 L112 58 M120 57 L127 44 L132 55", color: "ink" }] }] },
    { type: "paper", id: "logo", title: "The logo", w: 200, h: 200, items: [{ type: "svg", id: "mark", x: 12, y: 12, w: 176, h: 176, viewBox: [0, 0, 100, 100], paths: LOGO }] }] })
  await page.waitForSelector("[data-mark=paper]")
  const early = await page.evaluate(() => [...document.querySelectorAll("[data-item=rex] .sd-pen")].some((p) => parseFloat(getComputedStyle(p).strokeDashoffset) > 0.05))
  await page.waitForTimeout(4200)
  const svg = await page.evaluate(() => ({
    rex: [...document.querySelectorAll("[data-item=rex] path")].length, fills: document.querySelectorAll("[data-item=rex] .sd-fill").length,
    rexBox: (() => { const r = document.querySelector("[data-item=rex]").getBoundingClientRect(), p = document.querySelector("[data-card=dino] .sd-paper > div:last-child").getBoundingClientRect(); return { w: r.width, h: r.height, inside: r.left >= p.left - 4 && r.right <= p.right + 4 && r.top >= p.top - 4 && r.bottom <= p.bottom + 4 } })(),
    logo: document.querySelectorAll("[data-item=mark] .sd-svg").length, logoFill: document.querySelectorAll("[data-item=mark] .sd-svg-fill").length,
    drawn: [...document.querySelectorAll("[data-item] .sd-pen")].every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.01),
    filled: [...document.querySelectorAll("[data-item=mark] .sd-svg-fill")].every((p) => getComputedStyle(p).opacity === "1"),
    script: document.querySelectorAll("[data-screendraw] script, [data-screendraw] foreignObject").length }))
  check("svg: a dinosaur sketched by rough.js over its paths, filled, fitted inside its pad", early && svg.rex >= 6 && svg.fills >= 1 && svg.rexBox.inside && svg.rexBox.w > 200, svg)
  check("svg: a logo clean, its outline drawn by the pen and its fills coming in behind; every stroke ends drawn, nothing but paths", svg.logo === 3 && svg.logoFill === 2 && svg.drawn && svg.filled && svg.script === 0, svg)
  await page.screenshot({ path: path.join(SHOTS, "screendraw-svg.png") })
  await page.close()
}

// ---- Excalidraw's shapes on a pad: a flow, then changed in place by id (moved, recoloured, added, erased)
{
  const page = await open()
  const FLOW = { id: "dflow", agent: "Claude", tint: "orange", t: Date.now(), places: ELEMENTS, marks: [{ type: "paper", id: "flow", title: "Signing in", w: 460, h: 200, items: [
    { id: "in", type: "rect", x: 16, y: 70, w: 110, h: 56, label: "Sign in" }, { id: "ok", type: "diamond", x: 170, y: 48, w: 110, h: 100, label: "Valid?" },
    { id: "home", type: "rect", x: 330, y: 70, w: 110, h: 56, label: "Home", fill: "green" }, { id: "a1", type: "arrow", from: "in", to: "ok" },
    { id: "a2", type: "arrow", from: "ok", to: "home", label: "yes" }] }] }
  await show(page, FLOW)
  await page.waitForSelector("[data-mark=paper]")
  await page.waitForTimeout(2600)
  const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } }, sel)
  const [inB, okB, a1] = [await box("[data-item=in]"), await box("[data-item=ok]"), await box("[data-item=a1]")]
  const labels = await page.evaluate(() => [...document.querySelectorAll("[data-card=flow] .sd-plabel")].map((e) => e.textContent))
  check("flow: rect, diamond and arrows bound between them, the arrow from one's edge to the other's, labels inside", !!a1 && a1.x >= inB.x + inB.w - 2 && a1.x + a1.w <= okB.x + 12 &&
    labels.join() === "Sign in,Valid?,Home,yes", { inB, okB, a1, labels })
  const fillOf = () => page.evaluate(() => getComputedStyle(document.querySelector("[data-item=home] .sd-fill")).fill)
  const greenFill = await fillOf()
  const cardAt = await box("[data-card=flow]")
  // (a follow-up: Home moves down and turns blue, a retry step is added, Sign in is erased with what's bound to it)
  const t1 = Date.now(), items = FLOW.marks[0].items
  await show(page, { ...FLOW, past: false, marks: [{ ...FLOW.marks[0], items: [
    { ...items[0], gone: t1 }, items[1], { ...items[2], y: 120, fill: "blue" }, { ...items[3], gone: t1 }, items[4],
    { id: "err", type: "rect", x: 180, y: 4, w: 90, h: 30, label: "Retry", color: "red" }, { id: "a3", type: "arrow", from: "ok", to: "err", label: "no" }] }] })
  await page.waitForTimeout(80)
  const mid = await page.evaluate(() => ({ erase: [...document.querySelectorAll("[data-item=in] .sd-pen")].map((p) => getComputedStyle(p).animationName), added: !!document.querySelector("[data-item=err] .sd-pen"),
    moving: getComputedStyle(document.querySelector("[data-item=home] .sd-move")).transitionProperty }))
  await page.waitForTimeout(1600)
  const after = await page.evaluate(() => ({ home: document.querySelector("[data-item=home] .sd-move").style.transform, gone: [...document.querySelectorAll("[data-item=in] .sd-pen")].every((p) => parseFloat(getComputedStyle(p).strokeDashoffset) > 0.95),
    err: [...document.querySelectorAll("[data-item=err] .sd-pen")].every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.01), labels: [...document.querySelectorAll("[data-card=flow] .sd-plabel")].map((e) => e.textContent) }))
  const blueFill = await fillOf(), cardNow = await box("[data-card=flow]")
  check("flow changed in place: what's erased runs its pen backward (and what's bound to it), what moved slides there, what's added is drawn", mid.erase.every((n) => n === "sd-unpen") && mid.erase.length > 0 && mid.added && /transform/.test(mid.moving) && after.gone && after.err && after.home.includes("120px"), { mid, after })
  check("flow changed in place: recoloured (green to blue), the card where it was, nothing else drawn again", greenFill !== blueFill && /rgb\(165, 216, 255\)|#a5d8ff/.test(blueFill) && Math.abs(cardNow.x - cardAt.x) < 1 && Math.abs(cardNow.y - cardAt.y) < 1, { greenFill, blueFill, cardAt, cardNow })
  await page.screenshot({ path: path.join(SHOTS, "screendraw-flow.png") })
  await page.close()
}

// ---- picture and video cards: by the cursor or where put, sized to the display, opened, heard, dragged, dismissed
{
  const page = await open(true)
  const media = { png: "http://screen.test/qa-media/shot.png", webm: "http://screen.test/qa-media/clip.webm" }
  const D = { id: "dmedia", agent: "Claude", tint: "purple", t: Date.now(), places: ELEMENTS, marks: [
    { type: "image", id: "shot", src: "screenshot", url: media.png, name: "Screenshot 2026-11-06.png", px: [1600, 1000], caption: "Your latest screenshot", at: { area: "top-right" } },
    { type: "video", id: "clip", src: "screenshot", url: media.webm, name: "Screen Recording.mov" },
    { type: "image", id: "lost", src: "x.png", url: "http://screen.test/missing.png", name: "missing.png", at: { area: "bottom-left" } }] }
  await show(page, D, { pointer: { x: 640, y: 500 } })
  await page.waitForSelector("[data-mark=image][data-state=ok]")
  await page.waitForSelector("[data-mark=video][data-state=ok]", { timeout: 8000 })
  await page.waitForTimeout(900)
  const shot = await rects(page, "[data-card=shot]"), clip = await rects(page, "[data-card=clip]")
  const v = await page.evaluate(() => { const e = document.querySelector("[data-mark=video] video"); return { muted: e.muted, loop: e.loop, playing: !e.paused } })
  const lost = await page.evaluate(() => document.querySelector("[data-card=lost] [role=alert]")?.textContent)
  check("picture: in the corner it was put, on screen, at most 40% of the display, its caption below", shot.length === 1 && Math.abs(shot[0].x + shot[0].w - (W - 24)) < 2 && Math.abs(shot[0].y - (25 + 24)) < 2 &&
    shot[0].w <= W * 0.4 + 1 && onScreen(shot[0]), shot)
  check("video: by the cursor (the default), playing muted (a few times round, then it rests), on screen", clip.length === 1 && onScreen(clip[0]) && Math.hypot(clip[0].x + clip[0].w / 2 - 640, clip[0].y + clip[0].h / 2 - 500) < 520 && v.muted && !v.loop && v.playing, { clip, v })
  check("a picture that can't load says so, never a blank card", lost === "Couldn't load missing.png", lost)
  await page.click("[data-mark=video] video")
  check("video: pressed, it's heard", await page.evaluate(() => !document.querySelector("[data-mark=video] video").muted))
  await page.click("[data-mark=video] video")
  await page.click("[data-mark=image] img")
  await page.waitForSelector("[data-lightbox]")
  const big = await rects(page, "[data-lightbox] img")
  check("picture: pressed, it opens full size over the screen; pressed again, it goes", big[0]?.w > shot[0].w * 1.8, big)
  await page.click("[data-lightbox]")
  await page.waitForTimeout(100)
  check("…closed", await page.evaluate(() => !document.querySelector("[data-lightbox]")))
  // (dragged by the picture: it moves with the pointer, and the drag isn't a press)
  const s0 = (await rects(page, "[data-card=shot]"))[0]
  await page.mouse.move(s0.x + 60, s0.y + 60); await page.mouse.down(); await page.mouse.move(s0.x - 140, s0.y + 160, { steps: 8 }); await page.mouse.up()
  await page.waitForTimeout(100)
  const s1 = (await rects(page, "[data-card=shot]"))[0]
  check("a card drags anywhere on the screen, and dragging isn't pressing", Math.abs(s1.x - (s0.x - 200)) < 3 && Math.abs(s1.y - (s0.y + 100)) < 3 && await page.evaluate(() => !document.querySelector("[data-lightbox]")), { s0, s1 })
  await page.hover("[data-card=lost]")
  await page.click("[data-card=lost] .sd-x")
  const faded = await until(() => page.evaluate(() => getComputedStyle(document.querySelector("[data-card=lost]")).opacity === "0"), 3000)
  const acts = await page.evaluate(() => window.__acts.filter((a) => a.kind === "dismiss"))
  check("a card's × dismisses it: gone at once, the server told which", acts.length === 1 && acts[0].mark === "lost" && acts[0].id === "dmedia" && !!faded, acts)
  await page.screenshot({ path: path.join(SHOTS, "screendraw-media.png") })
  await page.close()
}

// ---- layers: two sessions' drawings side by side, each its own; one hidden and shown again as it was
{
  const page = await open()
  const mine = { id: "dl1", agent: "Claude", tint: "orange", t: Date.now(), places: ELEMENTS, marks: [{ type: "ring", id: "r", at: { el: "share" } }, { type: "sticky", id: "s", text: "Mine" }] }
  const theirs = { id: "dl2", agent: "Ada", tint: "blue", t: Date.now() + 1, places: ELEMENTS, marks: [{ type: "frame", id: "f", at: { el: "inbox" } }, { type: "sticky", id: "t", text: "Ada's" }] }
  const here = { width: W, height: H, origin: { x: 0, y: 0 }, home: true, top: 25 }
  const both = (a, b) => page.evaluate((ls) => window.__draw(ls), [a, b].filter(Boolean).map((d) => ({ ...d, here })))
  await both(mine, theirs)
  await page.waitForTimeout(1500)
  const two = await page.evaluate(() => ({ roots: [...document.querySelectorAll("[data-screendraw]")].map((e) => e.getAttribute("data-agent")), tools: [...document.querySelectorAll(".sd-tools")].map((e) => e.textContent), stickies: [...document.querySelectorAll("[data-mark=sticky]")].map((e) => e.textContent) }))
  check("layers: two sessions' drawings are both up, each in its own colour, each with its own Keep and Clear, named", two.roots.join() === "Claude,Ada" && two.stickies.sort().join() === "Ada's,Mine" && two.tools.length === 2 && two.tools.some((t) => t.startsWith("Ada")), two)
  await both(mine, { ...theirs, hidden: true })
  await page.waitForTimeout(400)
  const hid = await page.evaluate(() => ({ ada: getComputedStyle(document.querySelector("[data-agent=Ada]")).opacity, mine: getComputedStyle(document.querySelector("[data-agent=Claude]")).opacity, tools: document.querySelectorAll(".sd-tools").length }))
  await both(mine, theirs)
  await page.waitForTimeout(400)
  const back = await page.evaluate(() => ({ ada: getComputedStyle(document.querySelector("[data-agent=Ada]")).opacity, pens: [...document.querySelectorAll("[data-agent=Ada] .sd-pen")].every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.01) }))
  check("layers: one hidden is out of sight, the other untouched; shown again it's back as it was, nothing drawn again", hid.ada === "0" && hid.mine === "1" && hid.tools === 1 && back.ada === "1" && back.pens, { hid, back })
  await both(mine, null)
  await page.waitForTimeout(400)
  check("layers: one taken down leaves the other", await page.evaluate(() => [...document.querySelectorAll("[data-screendraw]")].map((e) => e.getAttribute("data-agent")).join()) === "Claude")
  await page.close()
}

// ---- a job's proof: a picture of the thing before laid over it, flipped with how it is now (its own layer, hidden and shown)
{
  const page = await open()
  const here = { width: W, height: H, origin: { x: 0, y: 0 }, home: true, top: 25 }
  const ring = { id: "dp1", agent: "Claude", tint: "orange", t: Date.now(), places: ELEMENTS, marks: [{ type: "ring", id: "r", at: { el: "share" } }] }
  const before = { id: "dp2", agent: "Claude (before)", tint: "orange", t: Date.now() + 1, places: ELEMENTS, marks: [
    { type: "image", id: "b", src: "x.png", url: "http://screen.test/qa-media/shot.png", px: [1600, 1000], over: true, caption: "Before", at: R("share") }] }
  const both = (a, b) => page.evaluate((ls) => window.__draw(ls), [a, b].filter(Boolean).map((d) => ({ ...d, here })))
  await both(ring, before)
  await page.waitForSelector("[data-mark=image][data-state=ok]")
  await page.waitForTimeout(500)
  const card = (await rects(page, "[data-card=b]"))[0], img = (await rects(page, "[data-card=b] img"))[0]
  const look = await page.evaluate(() => ({ tab: document.querySelector("[data-card=b] .sd-over-tab")?.textContent, below: !!document.querySelector("[data-card=b] .sd-media-caption"),
    through: getComputedStyle(document.querySelector("[data-card=b]")).pointerEvents, tools: [...document.querySelectorAll(".sd-tools")].map((e) => e.textContent) }))
  const s = SCREEN.share
  check("proof: its before picture lies over the thing, its size, its caption a tab above it, clicks passing through, no toolbar of its own",
    !!card && Math.abs(card.x - s.x) < 1 && Math.abs(card.y - s.y) < 1 && Math.abs(card.w - s.w) < 1 && Math.abs(img.h - s.h) < 1 && look.tab === "Before" && !look.below && look.through === "none" &&
    look.tools.length === 1 && !look.tools[0].includes("(before)"), { card, img, s, look })
  await page.screenshot({ path: path.join(SHOTS, "screendraw-before.png"), clip: { x: s.x - 160, y: s.y - 30, width: s.w + 200, height: s.h + 90 } })
  await both(ring, { ...before, hidden: true })
  await page.waitForTimeout(400)
  const flipped = await page.evaluate(() => ({ before: getComputedStyle(document.querySelector("[data-agent='Claude (before)']")).opacity, ring: getComputedStyle(document.querySelector("[data-agent=Claude]")).opacity }))
  await page.screenshot({ path: path.join(SHOTS, "screendraw-after.png"), clip: { x: s.x - 160, y: s.y - 30, width: s.w + 200, height: s.h + 90 } })
  await both(ring, before)
  await page.waitForTimeout(400)
  const back = await page.evaluate(() => getComputedStyle(document.querySelector("[data-agent='Claude (before)']")).opacity)
  check("proof: flipped, the before goes and the thing shows as it is now, its ring still up; flipped back, the before again", flipped.before === "0" && flipped.ring === "1" && back === "1", { flipped, back })
  await page.close()
}

// ---- choreography: rings shaped to their thing; a mark whose thing moved glides there, not drawn again; frames kept
{
  const page = await open()
  const layer = (places) => ({ id: "dc1", agent: "Claude", tint: "orange", t: Date.now(), places, marks: [
    { type: "ring", id: "r", at: { el: "row1" } }, { type: "ring", id: "o", at: B(1060, 300, 44, 40) }, { type: "underline", id: "u", at: { el: "inbox" } }] })
  // (frames counted at rest first, this machine's own rate, then through the moves; long tasks would drop frames)
  const rate = (fs) => { const g = fs.slice(1).map((t, i) => t - fs[i]).sort((a, b) => a - b); return { fps: Math.round((fs.length - 1) / ((fs.at(-1) - fs[0]) / 1000)), p95: Math.round(g[Math.floor(g.length * 0.95)]) } }
  const rest = rate(await page.evaluate(() => new Promise((ok) => { const f = []; const tick = (t) => { f.push(t); if (f.length < 60) requestAnimationFrame(tick); else ok(f) }; requestAnimationFrame(tick) })))
  await show(page, layer(ELEMENTS))
  await page.waitForTimeout(1500)
  // (from here, once its code has loaded and it's drawn: the glides)
  await page.evaluate(() => { window.__frames = []; window.__long = []; new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => Math.round(e.duration)))).observe({ type: "longtask" })
    const tick = (t) => { window.__frames.push(t); requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } }, sel)
  const ring = await box("[data-mark-i='0']"), oval = await box("[data-mark-i='1']"), row = SCREEN.row1
  check("choreography: a ring round a wide row hugs it (a rounded box, a few points out); round a square-ish thing it's an ellipse round it",
    ring && ring.x < row.x && ring.x > row.x - 20 && ring.h < row.h + 34 && ring.w < row.w + 40 && oval && oval.w < 90 && oval.h < 90, { ring, oval })
  await page.screenshot({ path: path.join(SHOTS, "screendraw-rings.png") })
  const moved = { ...ELEMENTS, "el:row1": { ...ELEMENTS["el:row1"], y: ELEMENTS["el:row1"].y + 200 } }
  await show(page, layer(moved))
  await page.waitForTimeout(160)
  const mid = await box("[data-mark-i='0']")
  await page.waitForTimeout(700)
  const end = await box("[data-mark-i='0']")
  const drawn = await page.evaluate(() => [...document.querySelectorAll("[data-mark-i='0'] .sd-pen")].every((p) => Math.abs(parseFloat(getComputedStyle(p).strokeDashoffset)) < 0.01))
  check("choreography: a mark whose thing moved glides there (part way at first, then on it), its ink not drawn again",
    mid.y > ring.y + 2 && mid.y < ring.y + 196 && Math.abs(end.y - (ring.y + 200)) < 2 && Math.abs(end.x - ring.x) < 1 && drawn, { ring, mid, end })
  const still = await box("[data-mark-i='2']")
  await show(page, layer({ ...moved, "el:inbox": { ...ELEMENTS["el:inbox"], x: ELEMENTS["el:inbox"].x + 40 } }))
  await page.waitForTimeout(700)
  const slid = await box("[data-mark-i='2']")
  check("choreography: an underline follows its row sideways too", Math.abs(slid.x - still.x - 40) < 2 && Math.abs(slid.y - still.y) < 1, { still, slid })
  const busy = rate(await page.evaluate(() => window.__frames)), long = await page.evaluate(() => window.__long)
  console.log(`choreography: at rest ${rest.fps} fps (95th percentile frame ${rest.p95} ms); gliding ${busy.fps} fps (${busy.p95} ms); long tasks ${JSON.stringify(long)}`)
  // (frame rates vary with the machine's load: the check is the page's own work, no long task)
  check("choreography: gliding holds the main thread no longer than a frame's slack (no long task)", !long.some((d) => d > 80), { rest, busy, long })
  await page.close()
}

fs.rmSync(MEDIA, { recursive: true, force: true })
await done()
