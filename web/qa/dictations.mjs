// The Dictations list in a Mac's desktop app: kept as they land, listed, searched, inserted again, Keep off, Clear.
// Speech from a kept press's audio or `say -o`, never played. WRITES only the throwaway vault.
//   node web/qa/dictations.mjs <vault copy> [shots dir]
import { _electron } from "playwright-core"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, palette, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, SHOTS], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dictations-"))
const secs = (f) => { try { return Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [f], { encoding: "utf8" }))?.[1] ?? 0) } catch { return 0 } }
const peak = (f) => { const m = /max_volume: (-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? ""); return m ? Number(m[1]) : -99 }
function keptAudio() {
  const app = process.env.QA_APP ?? "Vaultite Main", dir = path.join(os.homedir(), "Library", "Application Support", app, "talk")
  const all = [path.join(os.homedir(), "Library", "Logs", app, "dictation-last.wav"), ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => path.join(dir, f)) : [])]
  return all.filter(fs.existsSync).map((f) => ({ f, s: secs(f) })).filter((x) => x.s >= 2 && x.s <= 20 && peak(x.f) >= -20).sort((a, b) => b.s - a.s)[0]?.f
}
const kept = process.env.QA_SAY ? null : process.env.QA_AUDIO || keptAudio()
let AUDIO = path.join(TMP, "said.aiff")
if (kept) { AUDIO = path.join(TMP, "said.wav"); fs.copyFileSync(kept, AUDIO) }
else execFileSync("say", ["-o", AUDIO, "Remember to call the plumber about the kitchen sink before Friday."])
console.log(`  (speech: ${kept ? "a kept press of the app's" : "say -o"})`)

fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "dictation"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "dictation", "data.json"), JSON.stringify({ engine: "apple", silence: 0 }))
fs.writeFileSync(path.join(VAULT, "Shopping list.md"), "# Shopping list\n\nToday:")
const USER_DATA = path.join(TMP, "userData")
const t0 = Date.now() - 3600_000, d = new Date(t0), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
fs.mkdirSync(path.join(USER_DATA, "dictations"), { recursive: true })
fs.writeFileSync(path.join(USER_DATA, "dictations", `dictations-${day}.jsonl`), [
  { t: t0, id: "d-qa-lost", ev: "start", where: { kind: "app", name: "Mail", bundle: "com.apple.mail" } },
  { t: t0 + 2000, id: "d-qa-lost", ev: "words", text: "Dear Alice, the Lighthouse draft is attached." },
].map((l) => JSON.stringify(l)).join("\n") + "\n")

const keepers = () => spawnSync("pgrep", ["-f", path.join(ROOT, "plugins/core/terminal/termd/termd.ts")], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
const had = new Set(keepers())
const close = async () => { await app.close().catch(() => {}); for (const pid of keepers()) if (!had.has(pid)) try { process.kill(Number(pid)) } catch {} }
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: USER_DATA, VAULTITE_LOCAL: path.join(TMP, "local") },
})
for (const ev of ["uncaughtException", "unhandledRejection"]) process.prependListener(ev, () => void close())
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const engines = await win.evaluate((l) => window.vaultite?.dictation?.engines(l), "en-US")
if (!engines?.apple) { await close(); await skip(`Apple's recognizer doesn't dictate here (${JSON.stringify(engines)})`) }
await win.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {})
const text = () => win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
const listening = () => win.evaluate(() => !!document.querySelector(".dictation-pill:not([data-hint])"))
const rows = () => win.evaluate(() => [...document.querySelectorAll("[data-dictation]")].map((r) => ({ id: r.dataset.dictation, kind: r.dataset.dictationKind, landing: r.dataset.dictationLanding,
  text: r.querySelector("[data-dictation-text]")?.textContent ?? "", where: r.querySelector("[data-dictation-where]")?.textContent ?? "", status: r.querySelector("[data-dictation-status]")?.textContent ?? "" })))
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await win.screenshot({ path: path.join(SHOTS, name) }) } }
const dictate = async () => {
  await win.keyboard.press("Meta+J")
  await until(listening, 3000)
  return until(async () => !(await listening()), 60000, 100)
}

await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Shopping list.md")}` })
await win.waitForSelector("[data-pane] .cm-content")
await wait(800)
await win.locator("[data-pane] .cm-line", { hasText: "Today:" }).click()
await win.keyboard.press("End")
check("a dictation ends once its audio has", await dictate())
const said = (await text()).replace(/^[\s\S]*Today:\s*/, "").trim()
check("its words land in the note", said.length > 3, said.length)
const ids = await win.evaluate(() => window.vaultite && true)
await palette(win, "Show dictations")
check("Show dictations opens the list", await until(() => win.evaluate(() => !!document.querySelector("[data-dictations]")), 5000))
check("…with it, newest first, into the note it went to", await until(async () => { const r = await rows(); return r[0]?.where === "Shopping list" && r[0].landing === "in" && r[0].text.trim() === said }, 8000), (await rows()).map((r) => ({ ...r, text: r.text.length })))
const lost = (await rows()).find((r) => r.id === "d-qa-lost")
check("one the app closed on before it landed is kept, marked so", lost?.landing === "lost" && /Didn't land: the app closed/.test(lost.status) && lost.where === "Mail" && /Lighthouse draft/.test(lost.text), lost)
check("nothing of it is in the vault", !fs.readdirSync(VAULT).some((f) => /dictation/i.test(f)) && !JSON.stringify(fs.readdirSync(path.join(VAULT, ".vaultite"), { recursive: true })).includes("dictations-"))
check("…but in the app's data on this Mac", fs.readdirSync(path.join(USER_DATA, "dictations")).some((f) => fs.readFileSync(path.join(USER_DATA, "dictations", f), "utf8").includes(said.slice(0, 12))))
await win.locator("[data-dictation]").first().hover()
await shot("dictations.png")

await win.locator("[data-dictations-more]").click()
await win.locator("[role^=menuitem]", { hasText: "Dictation settings" }).click()
check("Settings > Dictation has the Dictations row, with how many", await until(() => win.evaluate(() => /Dictations\s*.*2 dictations/s.test(document.querySelector('[data-setting="dictations"]')?.textContent ?? "")), 5000),
  await win.evaluate(() => document.querySelector('[data-setting="dictations"]')?.textContent))
check("…Keep dictations and Clear dictations", await win.evaluate(() => /Keep dictations/.test(document.querySelector("dialog[open]")?.textContent ?? "") && !!document.querySelector('[data-setting="clear-dictations"]')))
await wait(800)
await shot("dictations-settings.png")
await win.locator('[data-setting="dictations"]').click()
check("…a click opens the list", await until(() => win.evaluate(() => !document.querySelector("dialog[open]") && !!document.querySelector("[data-dictations]")), 5000))

await win.locator("[data-dictations] input[type=search]").fill("lighthouse")
check("search finds by its words", await until(async () => { const r = await rows(); return r.length === 1 && r[0].id === "d-qa-lost" }, 3000), await rows())
check("…lit where they match", await until(() => win.evaluate(() => [...document.querySelectorAll("[data-dictation] mark")].some((m) => /lighthouse/i.test(m.textContent))), 3000))
await win.locator("[data-dictations] input[type=search]").fill("")
await win.locator("[data-dictations] [data-option=lost]").click()
check("Didn't land shows only those", await until(async () => { const r = await rows(); return r.length === 1 && r[0].id === "d-qa-lost" }, 3000), await rows())
await shot("dictations-lost.png")
await win.locator("[data-dictations] [data-option=all]").click()

await win.evaluate(() => { window.copied = []; navigator.clipboard.writeText = async (t) => { window.copied.push(t) } })
const lostRow = win.locator('[data-dictation="d-qa-lost"]')
await lostRow.hover()
await lostRow.locator("[data-dictation-copy]").click()
check("Copy copies its words", await until(() => win.evaluate(() => window.copied.at(-1) === "Dear Alice, the Lighthouse draft is attached."), 2000), await win.evaluate(() => window.copied))
await lostRow.locator("[data-dictation-insert]").click()
check("Insert again goes back to the note they were typing in, its words after the cursor",
  await until(async () => (await text()).includes(`${said} Dear Alice, the Lighthouse draft is attached.`), 5000), await text())
await shot("dictations-inserted.png")

const count = async () => (await rows()).length
await palette(win, "Show dictations")
await until(() => win.evaluate(() => !!document.querySelector("[data-dictations]")), 5000)
const before = await count()
await win.locator("[data-dictations-more]").click()
await win.locator("[role^=menuitem]", { hasText: "Keep dictations" }).click()
check("Keep dictations off: the list says so", await until(() => win.evaluate(() => /Keep dictations is off/.test(document.querySelector("[data-dictations-note]")?.textContent ?? "")), 5000))
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Shopping list.md")}` })
await win.waitForSelector("[data-pane] .cm-content")
await win.locator("[data-pane] .cm-line", { hasText: "Today:" }).click()
await win.keyboard.press("End")
await dictate()
await palette(win, "Show dictations")
await until(() => win.evaluate(() => !!document.querySelector("[data-dictations]")), 5000)
await wait(1500)
check("…and what's dictated meanwhile isn't kept", (await count()) === before, [await count(), before])
await win.locator("[data-dictations-more]").click()
await win.locator("[role=menuitem]", { hasText: "Clear dictations" }).click()
await win.locator("dialog[open] button", { hasText: "Clear" }).click()
check("Clear empties it", await until(async () => (await count()) === 0, 5000), await count())
check("…on disk too", !fs.readdirSync(path.join(USER_DATA, "dictations")).length)

await close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
