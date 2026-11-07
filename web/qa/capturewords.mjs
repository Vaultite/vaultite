// Region capture by voice (electron/capture.ts): with a box up, "record this" records it, "stop" sends it and "that,
// just now" sends the last seconds, each said with ⌃⌥ held (a stand-in Soniox hears them). WRITES: throwaway vault only.
//   node web/qa/capturewords.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-capturewords-"))
const AUDIO = path.join(TMP, "said.aiff"), LOCAL = path.join(TMP, "local")
execFileSync("say", ["-o", AUDIO, "One two three four."])
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "soniox", language: "en-US" })
conf("companion", { agent: "nobody", jobs_agent: "nobody", timeline: true })
const cloud = await standInSoniox()

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_CAPTURE: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: LOCAL, VAULTITE_SONIOX_URL: cloud.url },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
const w9 = { window: 9, bundle: "com.example.browser", name: "Example Browser", title: "Lighthouse", frame: { x: 100, y: 100, width: 900, height: 600 } }
await helper((h, w) => { h.stub("focus", { ...w, field: false, pid: 1 }); h.stub("window", w); h.stub("at", w) }, w9)
await wait(1500)
const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "control_option", on: o }), on)
const ink = (phase, x, y) => helper((h, m) => h.heard({ event: "ink", ...m }), { phase, x, y })
const region = () => helper((h) => h.scene()?.region ?? null)
const words = () => helper((h) => h.scene()?.summon?.words ?? "")
const notes = () => (fs.existsSync(path.join(VAULT, "Captures")) ? fs.readdirSync(path.join(VAULT, "Captures")).filter((f) => f.endsWith(".md")) : [])
/** Held, `said` heard (its words by the cursor), then let go. */
async function say(said, drag) {
  cloud.next.push(said)
  await chord(true)
  await until(() => helper((h) => h.scene()?.summon?.state === "listening"), 8000)
  if (drag) { await ink("down", 300, 250); await ink("move", 700, 450); await ink("up", 700, 450) }
  const heard = await until(async () => (await words()).includes(said.split(" ")[0]), 15000, 100)
  await wait(400)
  await chord(false)
  return heard
}

// (a first press warms the recognizer up: the stand-in hands out words by session, and a slow first one would shift them)
cloud.next.push("")
await chord(true)
await until(() => cloud.seen.length > 0, 60000, 200)
await wait(500)
await chord(false)
await wait(2000)
check("held over a box drawn, 'record this' is heard", await say("Record this.", true), await words())
check("…and records the box, not an ask", await until(async () => !!(await region())?.recording, 120000, 300), { region: await region(), presses: await helper((h) => h.presses().slice(-6)) })
await wait(2500)
check("held again, 'stop' is heard", await say("Stop."), await words())
check("…and sends it: saved in Captures", await until(async () => notes().length === 1 && !(await region())?.recording, 60000, 200), { notes: notes(), region: await region(), presses: await helper((h) => h.presses().slice(-8)) })
await wait(1500)
check("'that, just now' sends the last seconds, saved beside it", await say("That, just now.") && await until(() => notes().length === 2, 60000, 300), { notes: notes(), presses: await helper((h) => h.presses().slice(-8)) })
check("none of them was an ask", !(await helper((h) => h.asked().some((m) => m.kind === "ask"))), await helper((h) => h.asked()))
console.log("  soniox sessions:", JSON.stringify(cloud.seen.map((c) => c.said)))

await app.close()
cloud.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()

/** Soniox stood in: each session hears the next words queued (`next`), growing as audio comes, final at its finalize. */
async function standInSoniox() {
  const { WebSocketServer } = await import("ws")
  fs.mkdirSync(LOCAL, { recursive: true })
  fs.writeFileSync(path.join(LOCAL, "config.json"), JSON.stringify({ dictation: { soniox: "qa-key" } }))
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  await new Promise((r) => wss.on("listening", r))
  const seen = [], next = []
  wss.on("connection", (ws) => {
    const c = { said: next.shift() ?? "", closed: false }
    seen.push(c)
    const parts = c.said.split(" ").map((w, i) => (i ? " " : "") + w)
    let bytes = 0, said = false, config = false
    // (its answers a moment late, as over a network: the last words come after the key is let go)
    const send = ws.send.bind(ws)
    ws.send = (m) => setTimeout(() => ws.readyState === 1 && send(m), 300)
    ws.on("message", (d, binary) => {
      if (binary) {
        bytes += d.length
        const n = Math.min(parts.length, Math.ceil(bytes / 16000))
        if (!said && n) ws.send(JSON.stringify({ tokens: parts.slice(0, n).map((text) => ({ text, is_final: false })) }))
        return
      }
      if (!config) { config = true; return }
      if (JSON.parse(d.toString()).type !== "finalize") return
      ws.send(JSON.stringify({ tokens: [...(said ? [] : parts.map((text) => ({ text, is_final: true, start_ms: 0, end_ms: bytes / 32 }))), { text: "<fin>", is_final: true }] }))
      said = true
    })
    ws.on("close", () => { c.closed = true })
  })
  return { url: `ws://127.0.0.1:${wss.address().port}/`, seen, next, close: () => wss.close() }
}
