// Dictation that learns in other apps (electron/dictationfix.ts): words dictated into another app's field, the field
// followed a while (screen.swift `follow`, stood in: its text told as the user edits), a misheard word fixed there goes
// into the dictionary, said in the dictation box's place. Speech: the app's kept audio (talk/*.wav, the last dictation's)
// with speech in it, its first 15 s, else `say -o`; nothing is played, and its words are never printed. WRITES: throwaway vault only.
//   node web/qa/dictation-learn-apps.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-learn-apps-"))
const secs = (f) => { try { return Number(/estimated duration: ([\d.]+)/.exec(execFileSync("afinfo", [f], { encoding: "utf8" }))?.[1] ?? 0) } catch { return 0 } }
const peak = (f) => { const m = /max_volume: (-?[\d.]+) dB/.exec(spawnSync("ffmpeg", ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr ?? ""); return m ? Number(m[1]) : -99 }
/** The longest of the app's kept audio with speech in it (a missed press's is mostly room noise). */
function keptAudio() {
  const app = process.env.ROAM_APP ?? "Vaultite Main", dir = path.join(os.homedir(), "Library", "Application Support", app, "talk")
  const all = [path.join(os.homedir(), "Library", "Logs", app, "dictation-last.wav"), ...(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => path.join(dir, f)) : [])]
  return all.filter(fs.existsSync).map((f) => ({ f, s: secs(f) })).filter((x) => x.s >= 3 && peak(x.f) >= -20).sort((a, b) => b.s - a.s)[0]
}
const AUDIO = path.join(TMP, "said.wav")
const kept = process.env.ROAM_SAY ? null : keptAudio()
if (kept) execFileSync("ffmpeg", ["-v", "error", "-i", kept.f, "-t", "15", "-ar", "16000", "-ac", "1", AUDIO])
else {
  const said = path.join(TMP, "said.aiff")
  execFileSync("say", ["-o", said, "Remember to call the plumber about the kitchen sink, and ask whether the part they ordered has come in yet."])
  execFileSync("afconvert", [said, AUDIO, "-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
}
console.log(`  (speech: ${kept ? "a kept press's audio" : "say -o"}, ${secs(AUDIO).toFixed(0)} s)`)
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "nobody" })
const DICT = path.join(VAULT, "Dictionary.md")
fs.rmSync(DICT, { force: true })

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
await wait(1500) // (its settings, read as it starts)

const stub = (op, v) => helper((h, [o, x]) => h.stub(o, x), [op, v])
const heard = (m) => helper((h, x) => h.heard(x), m)
const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "fn_control", on: o }), on)
const tap = async () => { await chord(true); await wait(60); await chord(false) }
const pill = () => helper((h) => h.scene()?.pill ?? null)
const hint = () => helper((h) => { const p = h.scene()?.pill; return p?.hint ? p.text : "" })
const asked = () => helper((h) => h.screenAsked())
let seen = 0
const fresh = async () => { const all = await asked(); const out = all.slice(seen); seen = all.length; return out }
const dict = () => (fs.existsSync(DICT) ? fs.readFileSync(DICT, "utf8") : "")
const COMMON = new Set("about after again because before being could would should their there these those which while where other things really maybe something anything nothing".split(" "))
/** A word to "fix" in what was heard (not a sentence's first), as a name it was misheard for: one vowel changed, capitalized. */
function misheard(text, not = []) {
  const ws = [...text.matchAll(/\p{L}{5,}/gu)].filter((m) => m.index > 0 && !/[.!?]\s*$/.test(text.slice(0, m.index)) && !COMMON.has(m[0].toLowerCase()) && !not.includes(m[0].toLowerCase()))
  const m = ws.sort((a, b) => b[0].length - a[0].length)[0]
  if (!m) return null
  const w = m[0], v = [...w].map((c, i) => (/[aeiou]/i.test(c) && i > 0 ? i : -1)).filter((i) => i > 0).at(-1) ?? w.length - 1
  const to = (w[0].toUpperCase() + w.slice(1, v) + (w[v].toLowerCase() === "o" ? "a" : "o") + w.slice(v + 1))
  return { from: w, to, at: m.index, fixed: text.slice(0, m.index) + to + text.slice(m.index + w.length) }
}
/** Dictate into the stood-in field (its text `before` then the words): what went in, and the field followed then. */
async function dictateInto(app, before = "Notes:", says = true) {
  await stub("focus", { ...app, field: true, before })
  await stub("insert", { ok: true, how: "paste" })
  // (a paste lands a moment later: till then the field's text hasn't the words)
  await stub("follow", says ? { ok: true, value: before, caret: before.length, ...app } : { ok: false, why: "no-text" })
  await fresh()
  await tap()
  // (the file runs out, as if the user stopped: the words land, then the field's text is told as it is)
  const text = await until(async () => (await asked()).slice(seen).find((m) => m.op === "insert" && m.text)?.text, 60000, 30)
  if (text && says) await stub("follow", { ok: true, value: before + text, caret: (before + text).length, ...app })
  return text
}
const followed = () => until(async () => (await asked()).slice(seen).some((m) => m.op === "follow" && m.do === "start" && m.from === "front"), 3000, 30)

const Slack = { bundle: "com.example.chat", name: "Example Chat", pid: 4, window: 11, title: "general" }
// ---------- a misheard word fixed in another app's field: learned, said where the dictation box was
const text = await dictateInto(Slack)
check("the words land in the other app's field", !!text && text.split(" ").length >= 3, text?.length)
check("…and that field is followed, its text read where they went", await followed())
const fix = text && misheard(text)
if (!fix) { await app.close(); await skip("no word to fix in what was heard") }
await heard({ event: "follow", value: "Notes:" + fix.fixed.slice(0, fix.at + 2) + fix.fixed.slice(fix.at + fix.to.length) })
await heard({ event: "follow", value: "Notes:" + fix.fixed })
check("a word fixed there goes in the dictionary once the user's let it be", await until(() => dict().includes(`- ${fix.to}\n`), 8000, 100), { len: dict().length })
check("…the half-typed word before it isn't", !dict().includes(`- ${fix.to.slice(0, 2)}\n`))
check("…and it's said in the dictation box's place", await until(async () => (await hint()) === `Added “${fix.to}” to your dictionary`, 3000, 50))
await fresh()
await heard({ event: "follow", over: "left" })
check("its window left: no longer followed", await until(async () => (await asked()).slice(seen).some((m) => m.op === "follow" && m.do === "stop"), 3000, 50))

// ---------- fixed, then the message sent at once (the field cleared): the fix still counts
await wait(4500)
const again = await dictateInto(Slack, "")
// (another word if there's one; the same one again teaches what it's misheard as)
const fix2 = again && (misheard(again, [fix.from.toLowerCase()]) ?? misheard(again))
check("dictated again into the field, followed", !!fix2 && await followed())
if (fix2) {
  await heard({ event: "follow", value: fix2.fixed })
  await heard({ event: "follow", value: "" })
  const line = fix2.to === fix.to ? `- ${fix2.from}: ${fix2.to}\n` : `- ${fix2.to}\n`
  check("fixed and sent right away: still learned", await until(() => dict().includes(line), 5000, 100), { len: dict().length, same: fix2.to === fix.to })
}

// ---------- a private app's field: never followed, nor one that doesn't say its text
await wait(4500)
const before = dict()
await dictateInto({ bundle: "com.example.vault", name: "1Password", pid: 5, window: 13, title: "Note" })
await wait(1800)
check("a private app's field is never read", !(await asked()).slice(seen).some((m) => m.op === "follow" && m.do === "start"), (await asked()).slice(seen).map((m) => m.op))
await wait(2500)
await dictateInto(Slack, "Notes:", false)
await heard({ event: "follow", value: "anything" })
await wait(2500)
check("a field that doesn't say its text: skipped quietly, nothing learned", dict() === before && !(await pill())?.text?.startsWith("Added"))

await app.close().catch(() => {})
fs.rmSync(TMP, { recursive: true, force: true })
await done()
