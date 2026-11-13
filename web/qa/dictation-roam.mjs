// Dictation that follows you: its words in a box while the user moves between apps and tabs, landing where they should.
// Needs the desktop app (the screen helper stood in); speech from a kept press's audio or `say -o`, never played.
// WRITES only the throwaway vault.
//   node web/qa/dictation-roam.mjs <vault copy> [shots dir]
import { _electron } from "playwright-core"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, SHOTS], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-roam-"))
const secs = (f) => { try { return Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [f], { encoding: "utf8" }))?.[1] ?? 0) } catch { return 0 } }
const peak = (f) => { const m = /max_volume: (-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? ""); return m ? Number(m[1]) : -99 }
function keptAudio() {
  const app = process.env.ROAM_APP ?? "Vaultite Main", dir = path.join(os.homedir(), "Library", "Application Support", app, "talk")
  const all = [path.join(os.homedir(), "Library", "Logs", app, "dictation-last.wav"), ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => path.join(dir, f)) : [])]
  return all.filter(fs.existsSync).map((f) => ({ f, s: secs(f) })).filter((x) => x.s >= 1.5 && peak(x.f) >= -20).sort((a, b) => b.s - a.s)[0]
}
const AUDIO = path.join(TMP, "said.wav")
const kept = process.env.ROAM_SAY ? null : keptAudio()
if (kept) execFileSync("ffmpeg", ["-v", "error", "-stream_loop", String(Math.ceil(16 / kept.s)), "-i", kept.f, "-ar", "16000", "-ac", "1", AUDIO])
else {
  const said = path.join(TMP, "said.aiff")
  execFileSync("say", ["-o", said, "Remember to call the plumber about the kitchen sink, and then ask whether the part they ordered has come in yet, because the leak is getting worse by the day."])
  execFileSync("afconvert", [said, AUDIO, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
}
console.log(`  (speech: ${kept ? "a kept press's audio, looped" : "say -o"}, ${secs(AUDIO).toFixed(0)} s)`)
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "nobody" })
fs.writeFileSync(path.join(VAULT, "Roam one.md"), "# Roam one\n\nFirst:")
fs.writeFileSync(path.join(VAULT, "Roam two.md"), "# Roam two\n\nSecond:")

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
check("the helper runs with the app", await helper(() => true))
const engines = await win.evaluate((l) => window.vaultite?.dictation?.engines(l), "en-US")
if (!engines?.apple) { await app.close(); await skip(`Apple's recognizer doesn't dictate here (${JSON.stringify(engines)})`) }
await wait(1500)

const stub = (op, v) => helper((h, [o, x]) => h.stub(o, x), [op, v])
const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "fn_control", on: o }), on)
const tap = async () => { await chord(true); await wait(60); await chord(false) }
const pill = () => helper((h) => h.scene()?.pill ?? null)
const box = async () => { const p = await pill(); return p && !p.hint ? `${p.text} ${p.pending ?? ""}`.trim() : "" }
const hint = () => helper((h) => { const p = h.scene()?.pill; return p?.hint ? p.text : "" })
const asked = () => helper((h) => h.screenAsked())
let seen = 0
const fresh = async () => { const all = await asked(); const out = all.slice(seen); seen = all.length; return out }
const typed = (l, op = "insert") => l.filter((m) => m.op === op && m.text).map((m) => m.text)
const landed = () => until(async () => !(await pill()) || !!(await hint()), 60000, 100)
const words = async () => { await until(async () => (await box()).split(" ").length >= 3, 30000, 50); return box() }
const inboxFiles = () => { const d = path.join(VAULT, "Inbox"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".md")) : [] }

const Notes = { bundle: "com.example.notes", name: "Example Notes", pid: 1, window: 9, title: "Draft" }, Mail = { bundle: "com.example.mail", name: "Example Mail", pid: 2, window: 7, title: "New" }
const Finder = { bundle: "com.example.finder", name: "Example Finder", pid: 3, window: 5, title: "Home" }
const overlay = () => app.windows().find((p) => p.url().endsWith("/screen.html"))
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await overlay()?.screenshot({ path: path.join(SHOTS, name), omitBackground: true }).catch(() => {}) } }

await stub("focus", { ...Notes, field: true, before: "So:" })
await stub("insert", { ok: true, how: "ax" })
await stub("kept", { ok: false, why: "gone" })
await fresh()
await tap()
check("it keeps its field for later", await until(async () => (await asked()).some((m) => m.op === "focus" && m.keep === true), 3000))
const said = await words()
check("the words stream into the box as they're said", said.length > 0)
check("the overlay draws them, under the menu bar", await until(() => overlay()?.evaluate(() => { const b = document.querySelector(".dictation-box"); return !!b && b.getBoundingClientRect().top < 60 && !!b.querySelector(".dictation-words")?.textContent }), 5000))
await shot("dictation-box.png")
await stub("focus", { ...Mail, field: true, before: "" })
await landed()
let got = await fresh()
check("stopped in another app: into the field in front then", typed(got).length === 1 && !typed(got, "copy").length && typed(got)[0].length > said.length / 2, typed(got).map((t) => t.length))
check("…and it says where", (await hint()) === "In Example Mail", await hint())
await wait(2500)

await stub("focus", { ...Notes, field: true, before: "" })
await stub("kept", { ok: true, before: "So:", name: "Example Notes", how: "ax" })
await tap()
await words()
await stub("focus", { ...Finder, field: false })
await landed()
got = await fresh()
check("no field in front: into the one it began in, where it is", got.some((m) => m.op === "kept" && m.do === "insert" && m.text?.startsWith(" ")) && !typed(got).length && !typed(got, "copy").length, got.filter((m) => m.op === "kept").map((m) => m.do))
check("…and it says so", (await hint()) === "Back in Example Notes", await hint())
await wait(2500)

await stub("focus", { ...Notes, field: true, before: "" })
await stub("kept", { ok: false, why: "gone" })
const before = inboxFiles().length
await tap()
await words()
await stub("focus", { ...Finder, field: false })
await landed()
got = await fresh()
check("no field anywhere: on the clipboard", typed(got, "copy").length === 1, got.map((m) => m.op))
check("…and a capture in the inbox", await until(() => inboxFiles().length === before + 1, 5000), inboxFiles())
check("…from dictation, only kept", fs.readFileSync(path.join(VAULT, "Inbox", inboxFiles().sort((a, b) => fs.statSync(path.join(VAULT, "Inbox", b)).mtimeMs - fs.statSync(path.join(VAULT, "Inbox", a)).mtimeMs)[0]), "utf8").includes("from: Dictation"))
check("…and it says so", (await hint()) === "Copied, and in your inbox", await hint())
await wait(2500)

await stub("focus", { ...Finder, field: false })
await tap()
check("no field at the start: it still listens", !!(await words()))
await stub("focus", { ...Mail, field: true, before: "" })
await landed()
got = await fresh()
check("…landing in the field clicked meanwhile", typed(got).length === 1, got.map((m) => m.op))
await wait(2500)

await stub("focus", { ...Notes, field: true, secure: true })
await tap()
await wait(800)
check("a password field at the start: nothing heard", !(await pill()))
await wait(300)

await stub("focus", { ...Notes, field: true, before: "" })
await fresh()
await tap()
await wait(100)
await tap()
check("a double tap goes hands-free", await until(async () => (await pill())?.free === true, 8000), await pill())
const hands = await words()
check("…the box says so and streams the same", !!hands && await until(() => overlay()?.evaluate(() => document.querySelector(".dictation-free")?.textContent === "Hands-free"), 5000))
await shot("dictation-hands-free.png")
await tap()
check("…the next tap stops it", await landed())
got = await fresh()
check("…and its words land the same way", typed(got).length === 1, got.map((m) => m.op))
await wait(2500)

await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Roam one.md")}` })
const line = (t) => win.locator("[data-pane] .cm-line", { hasText: t })
await line("First:").click()
await win.keyboard.press("End")
const fn = (k) => app.evaluate(({ BaseWindow }, m) => { for (const w of BaseWindow.getAllWindows()) w.webContents?.send("vaultite:fn", m) }, k)
const note = () => win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
const pagePill = () => win.evaluate(() => !!document.querySelector(".dictation-pill:not([data-hint])"))
await stub("focus", { ...Finder, field: false })
await stub("kept", { ok: false, why: "gone" })
await fresh()
await fn({ down: true }); await wait(60); await fn({ down: false })
check("in a note, its own session: the pill by the cursor, no box", await until(pagePill, 5000) && !(await pill()))
await until(async () => (await win.evaluate(() => document.querySelector(".cm-dictation-pending")?.textContent ?? "")).length > 0 || /First:\s*\S/.test(await note()), 30000, 50)
await win.evaluate(() => dispatchEvent(new Event("blur")))
check("out of the window it goes on, in the box", await until(async () => !!(await pill()) && !(await pagePill()), 5000), await pill())
check("…nothing dimmed left in the note", await until(() => win.evaluate(() => !document.querySelector(".cm-dictation-pending")?.textContent), 3000))
const inNote = await note()
await landed()
got = await fresh()
check("stopped with no field: back in the note it began in", (await until(async () => (await note()).length > inNote.length, 5000)) && !typed(got, "copy").length && !typed(got).length, { copied: typed(got, "copy").length })
await wait(2500)

const started = await note()
await line("First:").click()
await win.keyboard.press("Control+End").catch(() => {})
await fn({ down: true }); await wait(60); await fn({ down: false })
await until(pagePill, 5000)
await wait(600)
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Roam two.md")}` })
await line("Second:").click()
await win.keyboard.press("End")
check("to another tab: it goes on, in the box", await until(async () => !!(await pill()) && !(await pagePill()), 5000), await pill())
await stub("page", { ok: true })
await landed()
check("…and lands where the keyboard is then", await until(async () => /Second:\s*\S/.test(await note()), 5000), (await note()).length)
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Roam one.md")}` })
await line("First:").waitFor({ timeout: 5000 })
const backNote = await note()
check("…not in the note it began in, past what was settled before it left", backNote.length < started.length + 400, { was: started.length, now: backNote.length })
await wait(2500)

await line("First:").click()
await fn({ down: true }); await wait(60); await fn({ down: false })
await until(pagePill, 5000)
await win.evaluate(() => dispatchEvent(new Event("blur")))
await until(async () => !!(await pill()), 5000)
const again = await win.evaluate(() => window.vaultite.dictation.start({ engine: "apple", language: "en-US", silence: 0 }))
check("⌘J while it roams stops it rather than starting another", again?.code === "roaming", again)
check("…the box goes", await landed())

await wait(2500)
await line("First:").click()
await fn({ down: true }); await wait(60); await fn({ down: false }); await wait(100); await fn({ down: true }); await wait(60); await fn({ down: false })
check("in the window, a double tap: hands-free, its pill says so", await until(() => win.evaluate(() => document.querySelector(".dictation-pill .dictation-pending")?.textContent === "Hands-free"), 8000))
await win.evaluate(() => dispatchEvent(new Event("blur")))
check("…out of the window, still hands-free in the box", await until(async () => (await pill())?.free === true, 5000), await pill())
await tap()
check("…the next press stops it", await landed())

await wait(2500)
await line("First:").click()
await fn({ down: true })
await until(pagePill, 5000)
await win.evaluate(() => dispatchEvent(new Event("blur")))
check("held out of the window: on in the box", await until(async () => !!(await pill()), 5000))
const letGo = Date.now()
await chord(false)
check("…let go, it stops", await landed() && Date.now() - letGo < 5000, Date.now() - letGo)

await stub("page", {})
await stub("focus", { ...Notes, field: true, before: "" })
await wait(2500)
await fresh()
await tap()
await words()
await helper((h) => h.heard({ event: "chord", name: "control_option", on: true }))
check("a Talk key while dictating: the words said so far land, not lost", await until(async () => typed(await asked()).length > 0, 5000))
await helper((h) => h.heard({ event: "chord", name: "control_option", on: false }))
await helper((h) => h.heard({ event: "esc" }))

await wait(2000)
const list = await win.evaluate(() => fetch("/api/ops/dictation.history", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json()))
const ways = (list.items ?? []).filter((x) => x.kind === "dictation").map((x) => x.landing)
check("Dictations: the ones that roamed are kept, landed in an app, copied, or typed in a note", list.here === true && ways.includes("front") && ways.includes("clipboard") && ways.includes("in"), { here: list.here, ways })
check("…an app's, by its name", list.items.some((x) => x.landing === "front" && /Example (Notes|Mail)/.test(x.where?.name ?? "")), list.items.map((x) => x.where))
check("…nothing heard in a password field", !list.items.some((x) => /password/i.test(x.where?.name ?? "")))

await app.close().catch(() => {})
fs.rmSync(TMP, { recursive: true, force: true })
await done()
