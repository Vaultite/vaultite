// Dictation's recognizers on speech files, as the app runs them: how soon words show, the final text, its WER when known.
// node tools/dictation_bench.ts [--engine apple|parakeet|soniox|both] [--last] [<audio>[=<said>]...]   (soniox: its key here)
import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { dictationSwift, parakeetModel } from "../electron/dictation-build.ts"

const argv = process.argv.slice(2)
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
const engineArg = flag("--engine") ?? "both"
const last = argv.includes("--last") && !!argv.splice(argv.indexOf("--last"), 1)
const SENTENCES = [
  "The quick brown fox jumps over the lazy dog.",
  "I want to meet Alice Park on Thursday at three, and then we can review the lighthouse project together.",
  "Remember to buy milk, eggs and bread before the store closes tonight.",
  "Streaming dictation shows each word as you speak and fixes it when the sentence ends.",
  "At Claude, can you summarize the meeting notes from yesterday and send them to the whole team?",
]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dictation-bench-"))

/** The files to hear, each with the words said in it when known. */
function inputs(): { file: string; said?: string }[] {
  const named = argv.map((a) => { const i = a.indexOf("="); return i > 0 ? { file: a.slice(0, i), said: a.slice(i + 1) } : { file: a } })
  if (last) {
    const logs = path.join(os.homedir(), "Library", "Logs")
    const kept = fs.readdirSync(logs).filter((d) => d.startsWith("Vaultite")).map((d) => path.join(logs, d, "dictation-last.wav"))
      .filter((f) => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    if (!kept.length) throw new Error("no kept dictation: turn on Dictation's Keep the last dictation's audio, then dictate")
    named.push({ file: kept[0] })
  }
  if (named.length) return named
  return SENTENCES.map((said, i) => {
    const file = path.join(tmp, `s${i}.aiff`)
    execFileSync("say", ["-o", file, said])
    return { file, said }
  })
}

const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'@ ]/gu, " ").split(/\s+/).filter(Boolean)
/** Word errors (substitutions, insertions, deletions) of `hyp` against `ref`, and `ref`'s length. */
function wer(ref: string, hyp: string): [number, number] {
  const r = words(ref), h = words(hyp)
  const d = Array.from({ length: r.length + 1 }, (_, i) => Array.from({ length: h.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)))
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1))
  return [d[r.length][h.length], r.length]
}

type Event = { type: string; at: number; text?: string; message?: string; settled?: number }
const hear = (bin: string, args: string[]) => new Promise<{ events: Event[]; code: number | null; err: string }>((done) =>
  execFile(bin, args, { timeout: 300_000, maxBuffer: 64 << 20 }, (e, out, err) => done({
    events: String(out).split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Event] } catch { return [] } }),
    code: e ? (typeof e.code === "number" ? e.code : 1) : 0, err: String(err).trim(),
  })))

// (DICTATION_HELPER: a helper built elsewhere, as one without Parakeet)
const bin = process.env.DICTATION_HELPER || await dictationSwift.build(path.join(os.tmpdir(), "vaultite-dictation-bench"))
const model = parakeetModel()
const engines = engineArg === "both" ? ["apple", "parakeet"] : [engineArg]
const files = inputs()
for (const engine of engines) {
  if (engine === "parakeet" && !model) { console.log("parakeet: no model on this Mac (Handy's or Hex's)"); continue }
  // (Soniox's key from this machine's data/config.json: vau dictation key)
  let cloud: string[] = []
  if (engine === "soniox") {
    const config = path.join(process.env.VAULTITE_LOCAL || path.join(import.meta.dirname, "..", "data"), "config.json")
    const key = fs.existsSync(config) ? JSON.parse(fs.readFileSync(config, "utf8")).dictation?.soniox : null
    if (!key) { console.log(`soniox: no key in ${config} (vau secret "Soniox API key" | vau dictation key)`); continue }
    cloud = ["--cloud", JSON.stringify({ url: "wss://stt-rt.soniox.com/transcribe-websocket", key, languages: ["en"] })]
  }
  let errors = 0, total = 0
  const firsts: number[] = []
  for (const { file, said } of files) {
    const args = ["--file", file, "--engine", engine === "soniox" ? "apple" : engine, "--language", "en-US", "--warm", "--words", "at Claude", ...(engine === "parakeet" ? ["--model", model!] : []), ...cloud]
    const { events, code, err } = await hear(bin, args)
    const speech = events.find((e) => e.type === "speech")?.at
    const first = events.find((e) => (e.type === "pending" || e.type === "final") && e.text?.trim())?.at
    const finals = events.filter((e) => e.type === "final").map((e) => e.text ?? "")
    const text = finals.reduce((all, t) => (all && !/^\s/.test(t) ? `${all} ${t}` : all + t), "").trim()
    const failed = events.filter((e) => e.type === "error" || e.type === "fallback")
    const settled = events.find((e) => e.type === "end")?.settled
    if (!events.length || failed.length) console.log(`  ${path.basename(file)}: the helper exited ${code}; ${failed.map((e) => e.message).join("; ")} ${err.slice(-800)}`)
    const lat = speech !== undefined && first !== undefined ? first - speech : null
    if (lat !== null) firsts.push(lat)
    let score = ""
    if (said) { const [e, n] = wer(said, text); errors += e; total += n; score = `, ${e}/${n} words wrong` }
    console.log(`${engine} ${path.basename(file)}: first words ${lat ?? "-"} ms after speech, final ${settled ?? "-"} ms after the stop${score}\n  ${JSON.stringify(text)}`)
  }
  firsts.sort((a, b) => a - b)
  console.log(`${engine}: first words ${firsts.length ? firsts[firsts.length >> 1] : "-"} ms (median)${total ? `, WER ${(100 * errors / total).toFixed(1)}% (${errors}/${total})` : ""}\n`)
}
fs.rmSync(tmp, { recursive: true, force: true })
