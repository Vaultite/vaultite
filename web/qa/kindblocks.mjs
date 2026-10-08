// A kind's blocks (core/blocks.ts onTop, livePreview.ts kindBlocks) are drawn on top of its files without a fence: a
// person's profile reading and editing, a workout log's fields and sets, a page preview; </> on one writes its fence
// at the body's top (the file's own from then on, drawn once); a fence further down moves it there. WRITES to the
// vault: throwaway server only.
//   node web/qa/kindblocks.mjs <base url> [out dir]
import { SHOTS, qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = SHOTS], browser, check, watch, noErrors, done } = await qa(import.meta.url)
const enc = encodeURIComponent
const post = (path, body) => fetch(`${B}api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const read = async (p) => (await (await fetch(`${B}api/file?path=${enc(p)}`)).json()).text

const DIR = "Qa kindblocks"
const PERSON = `${DIR}/Kim Lee.md`, MOVED = `${DIR}/Ola Berg.md`, LOG = `${DIR}/2026-10-01 Push.md`
for (const p of [PERSON, MOVED, LOG]) await fetch(`${B}api/file?path=${enc(p)}`, { method: "DELETE" })
await post("file", { path: PERSON, text: "---\ntype: person\nrelation: friend\ncontext: From the climbing gym\n---\n\nLikes tea.\n" })
await post("file", { path: MOVED, text: "---\ntype: person\nrelation: friend\ncontext: Neighbour\n---\n\nFirst line.\n\n```block-person\n```\n" })
await post("file", { path: LOG, text: "---\ntype: log\narea: workouts\ndate: 2026-10-01\ntitle: Push\nexercises:\n- name: Bench Press\n  sets:\n  - {type: normal, weight_kg: 50, reps: 8}\n---\n\nFelt strong.\n" })
await wait(800)

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
check("reading: a person without a fence has its profile drawn", await card.isVisible() && (await card.innerText()).includes("From the climbing gym"))
check("…on top of its text", await above(card, tea))
await page.screenshot({ path: `${OUT}kindblocks-read.png` })

await open(PERSON, true)
check("editing: drawn on top too", await card.isVisible() && await above(card, tea))
check("…and the file still has no fence", !(await read(PERSON)).includes("```"))
await card.hover(); await wait(300)
await card.locator(".cm-block-source").click(); await wait(600)
let t = await read(PERSON)
for (let i = 0; i < 10 && !t.includes("```block-person"); i++) { await wait(300); t = await read(PERSON) }
check("</> writes its fence at the body's top", /---\n\n```block-person\n```\n\nLikes tea\./.test(t), t)
check("…its Markdown showing", (await page.locator(".vau-editor .cm-line", { hasText: "```block-person" }).count()) > 0)
await page.locator(".cm-block-foot").getByRole("button", { name: "Done" }).click(); await wait(600)
check("Done: drawn once, from its fence", (await page.locator(".cm-block-block").count()) === 1)
await page.screenshot({ path: `${OUT}kindblocks-placed.png` })

await open(MOVED, false)
const first = page.locator(".vau-editor .cm-line", { hasText: "First line." })
check("a fence further down draws it there, not on top", (await page.locator(".cm-block-block").count()) === 1 && await above(first, page.locator(".cm-block-block").first()))

await open(LOG, false)
const blocks = page.locator(".cm-block-block")
check("a workout log: its fields and its area's sets, on top", (await blocks.count()) === 2 && (await blocks.nth(1).innerText()).includes("Bench Press")
  && await above(blocks.nth(1), page.locator(".vau-editor .cm-line", { hasText: "Felt strong." })))
await page.screenshot({ path: `${OUT}kindblocks-log.png` })

noErrors()
await done()
