// The companion's drawings over the screen (web/src/screendraw: screendraw/Draw.ts, screendraw/layout.ts, screendraw/ink.ts,
// screendraw/index.ts, in web/src/screen.tsx's page), headless with a stand-in bridge over a made-up screen: marks drawn
// in beats, labels clear of what they name and on screen, cards on calm space, Keep, Clear and actions. Reads only
// web/dist (npm run build first): no app, no window on screen. Pictures go to web/qa/shots/screendraw-*.png.
// node web/qa/screendraw.mjs
import fs from "node:fs"
import path from "node:path"
import { ROOT, SHOTS, qa, until } from "./lib/qa.mjs"

const { browser, check, watch, done } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist"), W = 1280, H = 800
fs.mkdirSync(SHOTS, { recursive: true })
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" }
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
    const f = path.join(DIST, new URL(r.request().url()).pathname)
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
  check(`${name}: the pad has its title, its grid, a bar chart with its labels, its sketches and ink`, pad.title === "Quarterly sales" && pad.grid && pad.axis === "Q1,Q2,Q3,Q4" && pad.lines >= 8 && pad.ink >= 2, pad)
  const fg = await page.evaluate(() => { const c = getComputedStyle(document.querySelector("[data-mark=list]")); return [c.color, c.backgroundColor] })
  check(`${name}: cards follow the theme (readable text on their background)`, name === "dark" ? /rgb\((2[0-5]\d|1[6-9]\d)/.test(fg[0]) : /rgb\(([0-9]|[1-9]\d), /.test(fg[0]), fg)
  await page.screenshot({ path: path.join(SHOTS, `screendraw-pad-${name}.png`) })
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
}

await done()
