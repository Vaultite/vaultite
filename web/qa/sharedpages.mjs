// HTML pages' shared state (vau.shared()): two views of one page, in two browsers (two devices), see each other's
// changes and each other, and it's kept. WRITES fixtures (QA/ in the vault): throwaway server only.
//   node web/qa/sharedpages.mjs <base url> <vault path>
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { qa, until } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const temp = (p) => [realpathSync("/tmp"), realpathSync(tmpdir())].some((t) => realpathSync(p).startsWith(t + "/"))
if (!temp(VAULT)) { console.error("sharedpages: the vault must be a throwaway one in a temporary folder"); process.exit(2) }
mkdirSync(`${VAULT}/QA`, { recursive: true })
const NAME = `QA shared ${Date.now().toString(36)}.html`
writeFileSync(`${VAULT}/QA/${NAME}`, `<!doctype html><html><head><title>QA shared</title></head><body><p id="out"></p>
<script type="module">
window.__t = { changes: [] }
const room = await vau.shared()
window.room = room
__t.ready = true
room.on("change", (state, keys, by) => __t.changes.push({ keys, by }))
</script></body></html>
`)
const side = `${VAULT}/.vaultite/artifacts/QA/${NAME}.shared.json`

const view = async (label, viewport) => {
  const ctx = await browser.newContext({ viewport })
  const page = watch(await ctx.newPage(), { label })
  await page.goto(`${B}#file/${encodeURIComponent("QA/" + NAME)}`)
  const frame = await until(async () => {
    const f = page.frames().find((x) => x.url().includes("frame=1"))
    return f && (await f.evaluate(() => window.__t?.ready)) ? f : null
  }, 20000, 250)
  return { ctx, page, frame, get: (fn) => frame.evaluate(fn) }
}
const desk = await view("desktop", { width: 1280, height: 860 })
const phone = await view("phone", { width: 390, height: 844 })
check("both views open the page", !!desk.frame && !!phone.frame)

const people = (v) => v.get(() => window.room.people.length)
check("each sees the other here", await until(async () => (await people(desk)) === 2 && (await people(phone)) === 2, 5000), [await people(desk), await people(phone)])
const deskId = await desk.get(() => window.room.me.id)

await desk.get(() => window.room.set({ round: 1, "answer:a": "C4" }))
check("a change on one shows on the other, by whom", await until(() => phone.get(() => window.room.state.round === 1 && window.__t.changes.some((c) => c.keys.includes("round") && c.by)), 5000) &&
  (await phone.get(() => window.__t.changes.at(-1).by)) === deskId, await phone.get(() => window.__t.changes))
await phone.get(() => window.room.set("answer:a", null))
check("...and back, a key deleted", await until(() => desk.get(() => !("answer:a" in window.room.state)), 5000))

// The same key from both at once: both end on the same value.
await Promise.all([desk.get(() => window.room.set("race", "desk")), phone.get(() => window.room.set("race", "phone"))])
const race = await until(async () => { const [a, b] = [await desk.get(() => window.room.state.race), await phone.get(() => window.room.state.race)]; return a === b ? a : null }, 5000)
check("set at once, both end the same", race === "desk" || race === "phone", race)

check("kept beside the page", await until(() => existsSync(side) && JSON.parse(readFileSync(side, "utf8")).round === 1, 5000))
await phone.page.reload()
const back = await until(async () => {
  const f = phone.page.frames().find((x) => x.url().includes("frame=1"))
  return f && (await f.evaluate(() => window.__t?.ready && window.room.state.round === 1 && window.room.people.length === 2)) ? f : null
}, 20000, 250)
check("a view opened again gets the state and who's here", !!back)
await phone.ctx.close()
check("one closing, the other hears it", await until(async () => (await people(desk)) === 1, 5000))
await desk.ctx.close()
await done()
