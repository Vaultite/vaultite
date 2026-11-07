// A QA walk (electron/walk.ts) in the desktop app, unseen: "start a QA walk" as a Talk key's words starts it; each
// sentence heard is an item tied to the thing under the pointer, "scratch that" drops the last, the island counts them, and
// "done" sends them, saved in Captures by project (no jobs' agent here, so no job). The words come as the recognizer's
// would (a scripted copy hears no microphone); the walk leads the island by the notch, its buttons in its list.
// WRITES: throwaway vault only.   node web/qa/walk.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, SHOTS, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-walk-"))
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "nobody", jobs_agent: "nobody" })
fs.mkdirSync(path.join(VAULT, "Projects"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Projects", "Lighthouse.md"), "---\ntype: project\nrepo: example/lighthouse\nlinks:\n- {label: site, url: 'https://lighthouse.example.com'}\n---\n")

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
// (a browser over the site, its Share button under the pointer wherever it is: frames as big as any screen)
const w9 = { window: 9, bundle: "com.example.browser", name: "Example Browser", title: "Home — lighthouse.example.com", frame: { x: 100, y: 100, width: 900, height: 600 } }
const big = (n) => ({ x: -n, y: -n, width: 2 * n, height: 2 * n })
await helper((h, a) => {
  h.stub("focus", { ...a.w, field: false, pid: 1 }); h.stub("window", a.w); h.stub("at", a.w)
  h.stub("text", { ok: true, text: "Address and search bar: lighthouse.example.com" })
  h.stub("near", { ok: true, elements: [{ ax: "AXToolbar", label: "Toolbar", frame: a.t }, { ax: "AXButton", label: "Share", frame: a.s, inside: [{ ax: "AXToolbar", label: "Toolbar" }] }] })
}, { w: w9, t: big(30000), s: big(20000) })
await wait(1500)
const walk = () => helper((h) => h.island().walk ?? null)
const say = (text) => helper((h, t) => h.walkSaid(t), text)

// ---------- "start a QA walk" (a Talk key's words): on, the island shows it
check("\"start a QA walk\" is the app's, never an ask", await helper((h) => h.talkSaid("How does a QA walk work?")) === false && await helper((h) => h.talkSaid("Start a QA walk.")) === true)
check("…on: it says so, words only here (no screen recording)", await until(async () => (await walk())?.count === 0 && /words only/.test((await walk())?.note ?? ""), 5000, 100), await walk())
const island = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html#island")), 10000)
check("the island leads with it: QA walk, 0, its note", !!island && await until(() => island.evaluate(() => /QA walk\s*0/.test(document.querySelector("[data-walk]")?.textContent ?? "") &&
  /words only/.test(document.querySelector("[data-walk-note]")?.textContent ?? "")), 5000), island && await island.evaluate(() => document.querySelector("[data-island]")?.outerHTML))
// (its buttons are in the list a hover opens, as a session's are)
await island?.locator("[data-island]").hover()
check("…a hover lists it with Done, 0 items", !!island && await until(() => island.evaluate(() => /0 items/.test(document.querySelector("[data-walk-row]")?.textContent ?? "") &&
  !!document.querySelector('[aria-label="Done: send the walk"]')), 3000))

// ---------- each sentence an item, tied to the thing under the pointer; scratch that drops the last
await say("The share button does nothing")
await wait(300)
await say("when I click it.")
check("a sentence heard in pieces is one item, the island counting it and naming it",
  await until(async () => (await walk())?.count === 1 && /^Noted: The share button does nothing when I click it/.test((await walk())?.note ?? ""), 5000, 100), await walk())
check("…drawn there too", await until(() => island.evaluate(() => document.querySelector("[data-walk-count]")?.getAttribute("data-walk-count") === "1" &&
  /^Noted: The share button/.test(document.querySelector("[data-walk-row]")?.textContent?.replace(/^.*?items?/, "") ?? "")), 5000))
await say("Scratch that.")
check("\"scratch that\" drops it", await until(async () => (await walk())?.count === 0 && /^Scratched/.test((await walk())?.note ?? ""), 5000, 100), await walk())
await say("The toolbar icons are not aligned")
check("words with no end wait for a pause, then they're an item", !((await walk())?.count) && await until(async () => (await walk())?.count === 1, 5000, 100), await walk())
await say("This menu. It opens twice.")
check("a short sentence goes with the next: one item", await until(async () => (await walk())?.count === 2, 5000, 100), await walk())
await wait(300)
fs.mkdirSync(SHOTS, { recursive: true })
await island.screenshot({ path: path.join(SHOTS, "walk-island.png"), omitBackground: true }).catch(() => {})
await island.evaluate(() => document.querySelector('[aria-label="Scratch the last item"]').click())
check("its undo scratches the last", await until(async () => (await walk())?.count === 1, 3000, 100), await walk())
const st = await helper((h) => h.walk("status"))
check("how it goes (vau companion walk): on, its items, what was said last", st?.on === true && st.items === 1 && /toolbar icons/i.test(st.last?.[0] ?? ""), st)

// ---------- done: sent, saved by project with what was pointed at
const notes = () => (fs.existsSync(path.join(VAULT, "Captures")) ? fs.readdirSync(path.join(VAULT, "Captures")).filter((f) => f.endsWith("QA walk.md")) : [])
await say("Done.")
check("\"done\" ends it: sent, and the island says where it went", await until(async () => notes().length === 1 && (await walk())?.state === "told", 30000, 100), { walk: await walk(), notes: notes() })
const note = notes()[0] ? fs.readFileSync(path.join(VAULT, "Captures", notes()[0]), "utf8") : ""
check("…saved by project (the site's), each item with what the pointer was on, and the job it went to",
  note.includes("## Lighthouse") && note.includes('1. The toolbar icons are not aligned (button "Share" in "Toolbar")') && !/share button does nothing/i.test(note) && /QA walk: Lighthouse \(1\)|not sent/.test(note), note)
check("it's over", !(await helper((h) => h.walk("status")))?.on)

// ---------- started by its op; its close asks once more before discarding what was noted
await helper((h) => h.walk("start"))
await say("The sidebar flickers when it opens.")
check("started again by its op, an item noted", await until(async () => (await walk())?.count === 1, 5000, 100))
await island.locator("[data-island]").hover()
await until(() => island.evaluate(() => !!document.querySelector('[aria-label="End the walk without sending it"]')), 3000)
await island.evaluate(() => document.querySelector('[aria-label="End the walk without sending it"]').click())
check("its close asks before discarding", await until(() => island.evaluate(() => /Discard 1 item/.test(document.querySelector("[data-walk-row]")?.textContent ?? "")), 3000) && (await walk())?.count === 1, await island.evaluate(() => document.querySelector("[data-walk-row]")?.outerHTML))
await island.evaluate(() => [...document.querySelectorAll("[data-walk-row] button")].find((b) => /Discard/.test(b.textContent)).click())
check("…then ends it, sending nothing", await until(async () => !(await helper((h) => h.walk("status")))?.on && notes().length === 1, 3000, 100))

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
