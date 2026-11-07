// Teach by showing (electron/teach.ts) in the desktop app, unseen: "watch me share the page" as a Talk key's words
// starts a lesson, the island counting steps; a click on a button, typing in a field and Return are its steps on their
// things, words heard hands-free its narration; "that's it" makes a draft skill. The screen is stubbed (a scripted copy
// hears no microphone and reads no Accessibility).   WRITES: throwaway vault only.   node web/qa/teach.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, SHOTS, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-teach-"))
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "nobody", jobs_agent: "nobody" })

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
// (a browser with a Share button and a Message field: what Accessibility would list near the pointer)
const w9 = { window: 9, bundle: "com.example.browser", name: "Example Browser", title: "Home — lighthouse.example.com", frame: { x: 0, y: 0, width: 1000, height: 800 } }
const share = { ax: "AXButton", label: "Share", frame: { x: 800, y: 40, width: 80, height: 30 }, inside: [{ ax: "AXToolbar", label: "Toolbar" }] }
const field = { x: 200, y: 300, width: 400, height: 30 }
const message = (value) => ({ ax: "AXTextField", label: "Message", frame: field, state: { value }, inside: [{ ax: "AXGroup", label: "Share dialog" }] })
await helper((h, a) => {
  h.stub("focus", { ...a.w, field: false, pid: 1 }); h.stub("window", a.w); h.stub("at", a.w)
  h.stub("near", { ok: true, elements: [{ ax: "AXToolbar", label: "Toolbar", frame: { x: 0, y: 30, width: 1000, height: 50 } }, a.share] })
  h.heard({ event: "front", ...a.w })
}, { w: w9, share })
await wait(1500)
const lesson = () => helper((h) => h.lesson())
const hint = () => helper((h) => h.scene()?.pill?.text ?? "")
const skill = path.join(VAULT, ".agents", "skills", "share-the-page", "SKILL.md")

// ---------- "watch me": on, the island shows it
check("\"watch me\" is the app's, never an ask", await helper((h) => h.teach("can you watch the build for me")) === false && await helper((h) => h.teach("Watch me share the page.")) === true)
check("…a lesson is on, counting steps", await until(async () => (await lesson())?.of === "lesson" && (await lesson())?.count === 0, 5000, 100), await lesson())
const island = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html#island")), 10000)
check("the island leads with it: Watching, 0", !!island && await until(() => island.evaluate(() => /Watching\s*0/.test(document.querySelector("[data-walk]")?.textContent ?? "")), 5000))
await island?.locator("[data-island]").hover()
check("…a hover lists it: 0 steps, Done, no undo", !!island && await until(() => island.evaluate(() => /0 steps/.test(document.querySelector("[data-walk-row]")?.textContent ?? "") &&
  !!document.querySelector('[aria-label="Done: make it a tour or a skill"]') && !document.querySelector('[aria-label="Scratch the last item"]')), 5000))

// ---------- a click on the button, typing in the field, Return; their words as they go
await helper((h) => h.teachSaid("First I open the share menu"))
await wait(300)
await helper((h) => h.heard({ event: "click", x: 840, y: 55, exchange: false }))
check("a click is a step, on the thing it was on", await until(async () => (await lesson())?.count === 1, 5000, 100), await lesson())
await helper((h, a) => { h.stub("focus", { ...a.w, editable: true, field: true, secure: false, role: "AXTextField", frame: a.field, pid: 1 }); h.stub("near", { ok: true, elements: [a.message] }) }, { w: w9, field, message: message("hello there") })
for (let i = 0; i < 3; i++) { await helper((h) => h.heard({ event: "typed" })); await wait(80) }
await wait(1700)
await helper((h) => h.heard({ event: "key", key: "enter" }))
check("typing in a field, read once still, and Return", await until(async () => (await lesson())?.count === 2, 5000, 100), await lesson())
await wait(200)
fs.mkdirSync(SHOTS, { recursive: true })
await island.screenshot({ path: path.join(SHOTS, "teach-island.png"), omitBackground: true }).catch(() => {})

// ---------- "that's it": a draft skill, the island lets it go
await helper((h) => h.teachSaid("That's it."))
check("\"that's it\" makes a draft skill", await until(() => fs.existsSync(skill), 20000, 200), await hint())
const text = fs.existsSync(skill) ? fs.readFileSync(skill, "utf8") : ""
check("…its steps their words on the things acted on, what each does, a draft",
  /^status: draft$/m.test(text) && /^app: com\.example\.browser$/m.test(text) && text.includes(`1. First, open the share menu. [ring "Share"] (do: click "Share")`) &&
  text.includes(`(do: type "hello there" in "Message"; press enter)`) && /"Share": \{"role":"button","inside":\["Toolbar"\]/.test(text), text.slice(text.indexOf("## Steps")))
check("…the lesson gone, a word on where it went", await until(async () => !(await lesson()) && /Saved a draft skill, Share the page/.test(await hint()), 5000, 100), [await lesson(), await hint()])

// ---------- from the last minutes: only with the timeline kept; a lesson forgotten by its ×
await helper((h) => h.teach("make what I just did a skill"))
check("\"make what I just did a skill\" with no timeline kept says how", await until(async () => /I wasn't watching/.test(await hint()), 3000, 100), await hint())
await helper((h) => h.teach("watch me"))
await until(async () => (await lesson())?.of === "lesson", 3000, 100)
await island.locator("[data-island]").hover()
await until(() => island.evaluate(() => !!document.querySelector('[aria-label="Stop watching and forget it"]')), 3000)
await island.evaluate(() => document.querySelector('[aria-label="Stop watching and forget it"]')?.click())
check("its × forgets the lesson", await until(async () => !(await lesson()) && /Forgot that lesson/.test(await hint()), 3000, 100), await hint())

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
