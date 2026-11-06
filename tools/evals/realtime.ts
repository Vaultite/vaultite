// The realtime voice on the real APIs, key let go to first audio, vs the pipeline (--pipeline alone: no OpenAI key needed).
//   node tools/evals/realtime.ts [--config <file>] [--openai-key <file>] [--models a,b] [--claude] [--summoned sonnet] [--pipeline]
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { freePort, stopTerminals, testServer, waitFor } from "../test/lib.ts"
import { realtimeFront, type TurnLog } from "../../electron/realtimefront.ts"
import { cloudVoice } from "../../electron/tts.ts"
import { chunker, speakable } from "../../plugins/core/companion/spoken.ts"

const argv = process.argv.slice(2)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
// (the keys this machine keeps (vau voice key): its app's data/config.json, Vaultite Main's, or the one named)
const CONFIG = [opt("--config") ?? opt("--voice-keys"), process.env.VAULTITE_LOCAL && path.join(process.env.VAULTITE_LOCAL, "config.json"),
  path.join(os.homedir(), "Library", "Application Support", "Vaultite Main", "local", "config.json"), path.join(import.meta.dirname, "..", "..", "data", "config.json")]
  .filter((f): f is string => !!f && fs.existsSync(f)).find((f) => { try { return !!JSON.parse(fs.readFileSync(f, "utf8")).companion } catch { return false } })
const stored = CONFIG ? JSON.parse(fs.readFileSync(CONFIG, "utf8")) : {}, keyFile = opt("--openai-key")
const KEY = keyFile ? fs.readFileSync(keyFile, "utf8").trim() : String(stored.companion?.openai ?? "")
const PIPELINE = argv.includes("--pipeline"), SUMMONED = opt("--summoned") ?? "sonnet"
if (!KEY && !PIPELINE) { console.error(`no OpenAI key: none in ${CONFIG ?? "this machine's config"} (vau secret "OpenAI API key" | vau voice key --provider openai), nor --openai-key (--pipeline needs none)`); process.exit(2) }
const MODELS = PIPELINE ? [] : (opt("--models") ?? "gpt-realtime-2.1-mini").split(","), CLAUDE = argv.includes("--claude") || PIPELINE
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-realtime-eval-")), OUT = opt("--out") ?? path.join(tmp, "out")
fs.mkdirSync(OUT, { recursive: true })
type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "companion", "summoned-2026-11-05.json"), "utf8")).asks as Any[]
const ask = (id: string) => fixture.find((a) => a.id === id)!
type Case = { id: string; kind: "talk" | "look"; said: string; voice: string; at?: Any }
const CASES: Case[] = [
  { id: "hi", kind: "talk", said: "Hey, how's it going?", voice: "Samantha" },
  { id: "sum", kind: "talk", said: "Quick one: what's twelve times fifteen?", voice: "Samantha" },
  { id: "oi", kind: "talk", said: "Oi, tudo bem? Como você está hoje?", voice: "Luciana" },
  { id: "tab-groups", kind: "look", said: ask("tab-groups").text, voice: "Samantha", at: ask("tab-groups") },
  { id: "rooms-explain", kind: "look", said: ask("rooms-explain").text, voice: "Samantha", at: ask("rooms-explain") },
  { id: "finder-pt", kind: "look", said: "O que é essa pasta aqui?", voice: "Luciana", at: ask("finder-folder") },
]
/** A case's speech, 16-bit at 16 kHz (the mic's, as dictation's tap gives it). */
function speech(c: Case) {
  const f = path.join(tmp, `${c.id}.wav`)
  execFileSync("say", ["-v", c.voice, "-o", f, "--file-format=WAVE", "--data-format=LEI16@16000", c.said])
  const b = fs.readFileSync(f)
  let i = 12
  while (i < b.length - 8 && b.toString("ascii", i, i + 4) !== "data") i += 8 + b.readUInt32LE(i + 4)
  return b.subarray(i + 8, i + 8 + b.readUInt32LE(i + 4))
}
const wav = (pcm: Buffer, rate = 24_000) => {
  const h = Buffer.alloc(44)
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
const SETTLE = 100
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN }
const ms = (x?: number) => (x === undefined || !Number.isFinite(x) ? "-" : String(Math.round(x)))

// ---------- the higher model: the summoned session on a sandbox server (as tools/evals/summoned.ts), or a canned answer
let server: ReturnType<typeof testServer> | null = null, port = 0, ws: WebSocket | null = null
const VAULT = path.join(tmp, "vault"), shot = path.join(tmp, "screens", "display-1-1.png")
const call = async (id: string, params: object = {}): Promise<Any> => (await fetch(`http://127.0.0.1:${port}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify(params) })).json()
const heard = new Set<(m: Any) => void>()
async function startClaude() {
  fs.mkdirSync(path.dirname(shot), { recursive: true })
  fs.copyFileSync(path.join(import.meta.dirname, "companion", "screen.png"), shot)
  const S = await import("../../core/sandbox.ts")
  S.makeSandbox(VAULT, S.localToday())
  port = await freePort()
  server = testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "local") } })
  if (!await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/state`)).ok, 60_000)) throw new Error("the sandbox server didn't start")
  await fetch(`http://127.0.0.1:${port}/api/config/plugin/companion`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "quiet", agent: "claude", summoned_model: SUMMONED }) })
  ws = new WebSocket(`ws://127.0.0.1:${port}/api/companion/live?screen=1`)
  await new Promise((r, j) => { ws!.once("open", r); ws!.once("error", j) })
  ws.on("message", (d) => { const m = JSON.parse(String(d)); for (const f of heard) f(m) })
  ws.send(JSON.stringify({ t: "summoning" }))
  const id = await waitFor(async () => (await call("companion.status")).summoned?.id as string | null, 30_000, 200)
  if (!id || !await waitFor(async () => (await call("claude-code.chat-list")).sessions?.find((s: Any) => s.id === id)?.state === "idle", 120_000, 200)) throw new Error("its summoned session didn't start")
  // (one ask first, so its prompt is cached, as in use)
  await moment({ text: "hi, just checking you're there", sx: 700, sy: 500 })
}
/** An ask on screen to the summoned session; resolves with the time its first sentence was written, and its words. */
function moment(a: Any, extra: Any = {}, onSay?: (id: string, text: string, t: number) => void, onAgent?: (state: string) => void) {
  const t0 = Date.now()
  return new Promise<{ sentence: number; text: string }>((done) => {
    let first = 0, text = "", busy = false
    const c = chunker()
    const f = (m: Any) => {
      if (m.t === "note" && m.note.kind === "say" && m.note.answers && m.note.answers.t >= t0 - 50) {
        text = m.note.text
        if (!first && c.feed(speakable(text)).length) first = Date.now() - t0
        onSay?.(m.note.id, m.note.text, m.note.answers.t)
      }
      if (m.t === "agent" && m.agent.name === "Claude") {
        onAgent?.(m.agent.state)
        if (m.agent.state === "thinking") busy = true
        if (busy && m.agent.state === "watching") { heard.delete(f); done({ sentence: first || Date.now() - t0, text }) }
      }
    }
    heard.add(f)
    ws!.send(JSON.stringify({ t: "moment", kind: "ask", agent: "Claude", text: a.text, app: a.app ?? "com.example.mail", window: 9, title: a.title ?? "Lighthouse Mail", sx: a.sx, sy: a.sy,
      ...(a.screen ? { screen: a.screen } : {}), shot, shotAt: { x: 0, y: 0, width: 1440, height: 900 }, ...(a.under ? { under: a.under } : {}), ...(a.near?.length ? { near: a.near } : {}), voice: true, ...extra }))
  })
}

// ---------- the pipeline's voice: ElevenLabs, its first audio for a sentence
const voiceKeys = stored
const eleven = voiceKeys.companion?.elevenlabs ? cloudVoice({ provider: "elevenlabs", url: "wss://api.elevenlabs.io", key: voiceKeys.companion.elevenlabs, model: "eleven_flash_v2_5", voice: "nPczCjzI2devNBz1zQrb", speed: 1 }) : null
let pieces = 0
function ttsFirst(text: string) {
  if (!eleven) return Promise.resolve(NaN)
  const t0 = Date.now()
  return new Promise<number>((done) => {
    let got = false
    eleven.make({ n: ++pieces, text, language: "en" }, { audio: () => { if (!got) { got = true; done(Date.now() - t0) } }, end: () => { if (!got) done(NaN) }, fail: () => done(NaN) })
  })
}

const rows: string[] = []
let code = 0
try {
  if (CLAUDE) await startClaude()
  eleven?.warm?.()
  for (const model of MODELS) {
    const logs: (TurnLog & { id: string })[] = []
    let out: Buffer[] = [], current: Case | null = null
    const front = realtimeFront({
      config: async () => ({ url: "wss://api.openai.com/v1/realtime", key: KEY, model, voice: "cedar" }),
      name: () => "Claude",
      player: { stream: () => ({ pcm: (b) => out.push(b), end: () => {} }), stop: () => {} },
      look: ({ question, talk }) => {
        const c = current!
        if (!CLAUDE) {
          // (a canned answer, written as a model would: a word at a time)
          const text = c.id === "finder-pt" ? "Essa é a pasta Impostos, no seu Desktop. Quer que eu abra?" : "That's your tab groups. Each one keeps a set of tabs together, like Work. Want me to open one?"
          let i = 0
          const words = text.split(" "), tick = setInterval(() => { i++; front.text("canned", words.slice(0, i).join(" ")); if (i >= words.length) { clearInterval(tick); front.agent("thinking"); front.agent("watching") } }, 40)
          return
        }
        void moment({ ...c.at, text: question }, { front: "realtime", ...(talk.length ? { talk } : {}) }, (id, text, t) => { if (front.owns(t)) front.text(id, text) }, (st) => front.agent(st))
      },
      answered: () => {}, fallback: (h) => console.log(`  ${current?.id}: fell back to the pipeline (${h})`), state: () => {},
      log: (t) => logs.push({ ...t, id: current!.id }),
    })
    for (const c of CASES) {
      current = c; out = []
      const pcm = speech(c)
      front.warm()
      front.press()
      for (let i = 0; i < pcm.length; i += 3200) { front.audio(pcm.subarray(i, i + 3200)); if (i === 3200 * 3) front.speech(); await sleep(100) }
      const app = c.at ? (c.at.title as string).split(" - ").at(-2) ?? c.at.app : "Notes"
      front.release(`(Where they are: ${app}, its window "${(c.at?.title ?? "Groceries").slice(0, 120)}".)`)
      // (dictation's words settle a moment after the stop: Soniox's, about 100 ms by tools/dictation_bench.ts)
      await sleep(SETTLE)
      front.heard(c.said)
      const done = await waitFor(() => logs.find((l) => l.id === c.id) ?? null, 60_000, 50)
      await sleep(400)
      fs.writeFileSync(path.join(OUT, `${model}-${c.id}.wav`), wav(Buffer.concat(out)))
      if (!done) { rows.push(`${model} ${c.id}: no answer`); continue }
      rows.push(`${model.padEnd(22)} ${c.kind.padEnd(5)} ${c.id.padEnd(14)} first ${ms(done.firstMs).padStart(5)} ms  answer ${ms(done.answerMs).padStart(5)} ms  $${done.cost.toFixed(4)}  in ${done.usage.reduce((n, u) => n + (u.input_tokens ?? 0), 0)} out ${done.usage.reduce((n, u) => n + (u.output_tokens ?? 0), 0)} tokens${done.failed ? `  failed: ${done.failed}` : ""}`)
    }
    front.close()
    const talk = logs.filter((l) => l.kind === "talk"), look = logs.filter((l) => l.kind === "look")
    rows.push(`${model}: talk first audio median ${ms(med(talk.map((l) => l.firstMs!)))} ms, $${(talk.reduce((n, l) => n + l.cost, 0) / Math.max(1, talk.length)).toFixed(4)} an ask; look first audio ${ms(med(look.map((l) => l.firstMs!)))} ms, answer ${ms(med(look.map((l) => l.answerMs!)))} ms, $${(look.reduce((n, l) => n + l.cost, 0) / Math.max(1, look.length)).toFixed(4)} an ask (the realtime part)`)
  }
  // ---------- the pipeline, the same asks: the summoned session's first sentence, then ElevenLabs' first audio for it
  if (CLAUDE) {
    const firsts: Record<string, number[]> = { talk: [], look: [] }
    for (const c of CASES) {
      const r = await moment(c.at ? { ...c.at, text: c.said } : { text: c.said, sx: 700, sy: 500, app: "com.apple.Notes", title: "Groceries" })
      const sentence = chunker().feed(speakable(r.text + " x"))[0] ?? r.text
      const tts = await ttsFirst(sentence)
      firsts[c.kind].push(SETTLE + r.sentence + tts)
      rows.push(`pipeline ${c.kind.padEnd(5)} ${c.id.padEnd(14)} first sentence ${ms(r.sentence)} ms + voice ${ms(tts)} ms (+ ${SETTLE} ms dictation) = ${ms(SETTLE + r.sentence + tts)} ms: ${JSON.stringify(r.text.slice(0, 100))}`)
    }
    rows.push(`pipeline: talk first audio median ${ms(med(firsts.talk))} ms; look ${ms(med(firsts.look))} ms`)
  }
} catch (e) { console.error(`realtime eval: ${(e as Error).stack}`); code = 2 } finally {
  console.log(rows.join("\n"))
  console.log(`(its words: ${OUT})`)
  eleven?.close()
  const sock = ws as WebSocket | null
  sock?.close()
  if (server) {
    await call("companion.stop", { all: true }).catch(() => {})
    server.kill()
    stopTerminals(port)
    const keeper = spawnSync("pgrep", ["-f", `vaultite-chatd1-vaultite-${port}\\.sock`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
    for (const pid of keeper) try { process.kill(Number(pid)) } catch { /* gone */ }
  }
}
process.exit(code)
