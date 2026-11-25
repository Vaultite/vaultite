// The island by the notch (screenisland.tsx, island/Mark.tsx, island/Rows.tsx, island/Walk.tsx, island/style.ts), headless
// with a stand-in bridge over web/dist: its dots at rest, its card and what its buttons send. node web/qa/islandcard.mjs [pictures]
import fs from "node:fs"
import path from "node:path"
import { ROOT, SHOTS, qa, until } from "./lib/qa.mjs"

const { args: [PICTURES = SHOTS], browser, check, watch, done } = await qa(import.meta.url)
const DIST = path.join(ROOT, "web/dist"), W = 760, H = 600
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" }
fs.mkdirSync(PICTURES, { recursive: true })
const page = watch(await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: "dark" }))
await page.route("http://screen.test/**", (r) => {
  const f = path.join(DIST, new URL(r.request().url()).pathname)
  if (!fs.existsSync(f)) return r.fulfill({ status: 404 })
  r.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] ?? "application/octet-stream" })
})
await page.addInitScript(() => {
  globalThis.acts = []
  globalThis.vaultiteScreen = { holds() {}, near() {}, island: { on: (fn) => { globalThis.show = fn; return () => {} }, act: (act, id) => globalThis.acts.push(`${act} ${id}`), faces() {} } }
})
await page.goto("http://screen.test/screen.html#island")
await page.addStyleTag({ content: "html{background:linear-gradient(#5b7f9e,#3c5871) !important} body::before{content:'';position:absolute;inset:0 0 auto;height:32px;background:rgb(255 255 255/.16)} body::after{content:'';position:absolute;left:171px;top:0;width:179px;height:32px;background:#000;border-radius:0 0 10px 10px}" })
await until(() => page.evaluate(() => !!globalThis.show))
const show = (presences, o = {}) => page.evaluate((d) => globalThis.show(d), { presences, knock: null, walk: null, companion: { name: "Echo", tint: "orange", doing: "Hold fn⌃ to talk" }, answering: {},
  spot: { x: 350, y: 0, bar: 32, align: "left", attached: true }, left: 350, width: W, ...o })
const P = (id, who, state, o = {}) => ({ id, who, tint: "teal", state, since: Date.now() - 120_000, ...o })
const rest = () => page.evaluate(() => ({ dots: [...document.querySelectorAll("[data-island-dot]")].map((d) => `${d.dataset.islandDot}:${d.textContent}`).join(), text: document.querySelector("[data-island]")?.textContent ?? "",
  arrows: document.querySelectorAll("[data-island-mark] svg").length, label: document.querySelector("[data-island-mark]")?.getAttribute("aria-label") ?? "" }))
const rests = (dots) => until(async () => (await rest()).dots === dots, 2000)
const shot = async (name, clip) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running")); await page.screenshot({ path: path.join(PICTURES, `island-${name}.png`), clip }) }
const BAR = { x: 150, y: 0, width: 320, height: 48 }

const working = [P("w1", "Inbox decisions", "working", { step: "Running npm test", terminal: "w1" }), P("w2", "Kitty images", "working", { tint: "pink", chat: "c2" }), P("w3", "Docs sweep", "working", { where: "Cloud" })]
const ready = [P("r1", "Tab list fix", "ready", { tint: "purple", line: "Ready to show you the tab list", open: "job:j1", job: "j1" })], ended = [P("d1", "Release notes", "done", { tint: "green" })]
const asks = [P("chat:a1", "Lighthouse migration", "needs you", { chat: "a1", ask: { id: "ask:1", what: "Claude wants to run a command\nnpm run migrate -- --target production" } })]
const needs = [...asks, P("q1", "Deploy", "needs you", { tint: "yellow", terminal: "q1", line: "Which account should it use?", knock: "k1" })]
const all = [...needs, ...ready, ...working, ...ended]

await show([])
check("rest: nothing at work, no dots", (await rest()).dots === "")
await show([...ready, ...ended])
check("rest: only ready and done, no dots", await until(async () => (await rest()).dots === "" && !(await rest()).text, 2000))
await show(working)
check("rest: only working, one muted dot with the count inside", await rests("working:3"), await rest())
await shot("rest-working", BAR)
await show(needs)
check("rest: only needing them, one amber dot", await rests("needs:2"), await rest())
await show(all)
check("rest: both, amber first then muted", await rests("needs:2,working:3"), await rest())
const r = await rest()
check("rest: no words and no arrows, only counts; a screen reader hears them", r.text === "23" && !r.arrows && r.label === "2 need you, 3 working", r)
const box = await page.evaluate(() => { const dots = [...document.querySelectorAll("[data-island-dot]")].map((d) => d.getBoundingClientRect()), tone = (k) => getComputedStyle(document.querySelector(`[data-island-dot="${k}"]`)).backgroundColor
  return { first: dots[0].left - 350, last: dots.at(-1).right - 350, size: dots.map((d) => d.height).join(), tones: tone("needs") !== tone("working") } })
check("rest: small, side by side, tight against the notch", box.first <= 6 && box.last <= 44 && box.size === "15,15" && box.tones, box)
await shot("rest-both", BAR)
await show(Array.from({ length: 140 }, (_, i) => P(`m${i}`, "Many", "working")))
check("rest: past 99 it says so", await rests("working:99+"))
await show(all, { walk: { state: "on", count: 4, of: "walk" } })
check("a QA walk leads the island, the dots beside it", await until(() => page.evaluate(() => document.querySelector("[data-walk-count]")?.textContent === "4" && document.querySelectorAll("[data-island-dot]").length === 2), 2000))

await show(all)
await page.locator("[data-island] .island").click()
const groups = await until(() => page.evaluate(() => { const g = [...document.querySelectorAll("[data-island-group]")].map((x) => x.textContent); return g.length && { groups: g.join("|"), done: document.querySelector("[data-island-done]")?.textContent } }), 2000)
check("a click opens its card: needs you, ready, working, the done folded", groups?.groups === "Needs you · 2|Ready for review · 1|Working · 3" && groups.done === "1 done›", groups)
const acts = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-island-row]")].map((x) => [x.dataset.islandRow, [...x.querySelectorAll("[data-island-action]")].map((b) => b.textContent).join()])))
const row = (id) => page.locator(`[data-island-row="${id}"]`)
const A = await acts()
check("each row has its actions: a permission's Approve and Decline, a question's Answer, a ready one's Settle", A["chat:a1"] === "Approve,Decline" && A.q1 === "Answer,Not now" && A.r1 === "Show me,Settle" && A.w1 === "", A)
check("what it asks is shown whole", (await row("chat:a1").locator("[data-island-ask] .island-ask").textContent()) === asks[0].ask.what)
check("a session elsewhere says where", /Cloud · 2m/.test(await row("w3").textContent()))
check("the companion and All agents are at its foot", await page.evaluate(() => document.querySelector("[data-island-companion]")?.textContent === "EchoHold fn⌃ to talk" && !!document.querySelector("[data-island-agents]")))
await shot("card")
const sent = async (act) => check(`sends: ${act}`, await until(() => page.evaluate((a) => globalThis.acts.at(-1) === a, act), 1000), await page.evaluate(() => globalThis.acts))
await row("chat:a1").locator('[data-island-action="Approve"]').click()
await sent("approve chat:a1")
await row("chat:a1").locator('[data-island-action="Decline"]').click()
await sent("deny chat:a1")
await row("r1").locator('[data-island-action="Settle"]').click()
await sent("settle r1")
await row("w2").locator("button").first().click()
await sent("open w2")
await row("q1").locator('[data-island-action="Not now"]').click()
await sent("later k1")
await page.locator("[data-island-companion]").click()
await sent("companion Echo")
await page.locator("[data-island-done]").click()
await row("d1").locator('[data-island-action="Settle"]').click()
await sent("settle d1")
await show(all, { answering: { "chat:a1": "approve" } })
check("while it's answered its buttons wait", await until(() => row("chat:a1").locator("button:disabled").allTextContents().then((t) => t.join() === "Approving…,Decline"), 2000))
await done()
