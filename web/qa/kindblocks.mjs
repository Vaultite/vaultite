// A kind's blocks are fences in its files (core/blocks.ts withKindBlocks): a new person or log made through the API
// (of an area with a block of its own: a made-up one, as Health's workouts are Health's) has them on top and draws them
// there, reading and editing; a file without one draws none. WRITES to the vault (Logs' areas put back): throwaway
// server only.
//   node web/qa/kindblocks.mjs <base url> [out dir]
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const post = async (path, body) => (await fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()
const read = async (p) => (await (await fetch(`${B}api/file?path=${enc(p)}`)).json()).text

const BARE = "Qa kindblocks/Ola Berg.md"
await fetch(`${B}api/file?path=${enc(BARE)}`, { method: "DELETE" })
await post("file", { path: BARE, text: "---\ntype: person\nrelation: friend\ncontext: Neighbour\n---\n\nNo fence here.\n" })
const person = await post("people", { name: "Kim Lee", relation: "friend", context: "From the climbing gym", notes: "Likes tea." })
const PERSON = `${person.id}.md`
// (an area whose block is Logs' own week-goals, so it draws with only the app's plugins)
const AREAS = ".vaultite/plugins/logs/data.json"
const areasBefore = await read(AREAS)
const put = (text) => fetch(`${B}api/file`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: AREAS, text }) })
const logs = JSON.parse(areasBefore || "{}")
await put(JSON.stringify({ ...logs, areas: [...(logs.areas ?? []), { slug: "qa-climbs", name: "Qa climbs", weekly_goal: 2, blocks: ["week-goals"] }] }, null, 2) + "\n")
await wait(500)
await post("logs", [{ area: "qa-climbs", date: "2026-10-01", source: "qa", ext_id: "qa-kindblocks", title: "Push", notes: "Felt strong." }])
const log = (await (await fetch(`${B}api/logs`)).json()).find((l) => l.ext_id === "qa-kindblocks")
const LOG = `${log.id}.md`
await wait(800)

check("a new person's file has its fence on top", /---\n\n```block-person\n```\n\nLikes tea\./.test(await read(PERSON)), await read(PERSON))
check("a new log's: its fields' and its area's", /---\n\n```block-log\n```\n\n```block-week-goals\n```\n\nFelt strong\./.test(await read(LOG)), await read(LOG))

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
const page = watch(await ctx.newPage())
const editing = async () => (await page.locator(".vau-editor .cm-content[contenteditable=true]").count()) > 0
const open = async (p, edit) => {
  await page.goto(`${B}#file/${enc(p)}`); await wait(1800)
  if (edit !== (await editing())) { await page.keyboard.press("ControlOrMeta+e"); await wait(800) }
}
const above = async (a, b) => (await a.boundingBox()).y < (await b.boundingBox()).y

await open(PERSON, false)
const card = page.locator(".cm-block-block").first()
const tea = page.locator(".vau-editor .cm-line", { hasText: "Likes tea." })
check("reading: its profile drawn from its fence, above its text", (await page.locator(".cm-block-block").count()) === 1
  && (await card.innerText()).includes("From the climbing gym") && await above(card, tea))
await page.screenshot({ path: `${OUT}kindblocks-read.png` })
await open(PERSON, true)
check("editing: the same", (await page.locator(".cm-block-block").count()) === 1 && await above(card, tea))

await open(BARE, false)
check("a person without a fence draws no profile", (await page.locator(".cm-block-block").count()) === 0
  && await page.locator(".vau-editor .cm-line", { hasText: "No fence here." }).isVisible())
await page.screenshot({ path: `${OUT}kindblocks-bare.png` })

await open(LOG, false)
const blocks = page.locator(".cm-block-block")
check("a log: its fields and its area's block", (await blocks.count()) === 2 && (await blocks.nth(1).innerText()).includes("Qa climbs")
  && await above(blocks.nth(1), page.locator(".vau-editor .cm-line", { hasText: "Felt strong." })))
await page.screenshot({ path: `${OUT}kindblocks-log.png` })

const phone = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage())
await phone.goto(`${B}#file/${enc(PERSON)}`); await wait(2000)
check("phone: its profile drawn once", (await phone.locator(".cm-block-block").count()) === 1)
await phone.screenshot({ path: `${OUT}kindblocks-phone.png` })

noErrors()
if (areasBefore) await put(areasBefore)
await done()
