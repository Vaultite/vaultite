// Control as the dictation key: a double tap goes hands-free and the next ends it, dictated in the window before or not.
// Needs the desktop app (the screen helper and Soniox stood in); WRITES only the throwaway vault.
//   node web/qa/controlkey.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-controlkey-"))
const AUDIO = path.join(TMP, "said.aiff"), LOCAL = path.join(TMP, "local")
execFileSync("say", ["-o", AUDIO, "Remember to call the plumber about the kitchen sink, and then ask whether the part has come in yet, because the leak is getting worse."])
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "soniox", language: "en-US", keys: ["left_control"] })
conf("companion", { agent: "nobody" })
fs.writeFileSync(path.join(VAULT, "Said.md"), "# Said\n\nAsked:")
const cloud = await standInSoniox("call the plumber about the kitchen sink")

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: LOCAL, VAULTITE_SONIOX_URL: cloud.url },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
const Notes = { window: 7, bundle: "com.example.notes", name: "Example Notes", title: "Draft", frame: { x: 100, y: 100, width: 800, height: 600 }, pid: 1 }
await helper((h, w) => { h.stub("focus", { ...w, field: true, before: "" }); h.stub("window", w); h.stub("at", w) }, Notes)
await wait(1500)
const control = (on) => helper((h, o) => h.heard({ event: "mod", code: 59, on: o, alone: true, at: Date.now() }), on)
const tap = async () => { await control(true); await wait(80); await control(false) }
const double = async () => { await tap(); await wait(150); await tap() }
const pill = () => helper((h) => h.scene()?.pill ?? null)
const listening = async () => { const p = await pill(); return !!p && !p.hint }
const open = () => cloud.seen.filter((c) => !c.closed).length

async function handsFree(label) {
  await double()
  check(`${label}: a double tap of Control goes hands-free`, await until(async () => (await pill())?.free === true, 15000), await pill())
  await wait(2500)
  check(`${label}: …still listening a while after`, (await pill())?.free === true && open() === 1, { pill: await pill(), open: open() })
  const sessions = cloud.seen.length
  await double()
  check(`${label}: the next double tap ends it`, await until(async () => !(await listening()) && open() === 0, 8000), { pill: await pill(), open: open() })
  await wait(2000)
  check(`${label}: …and nothing starts again`, !(await listening()) && cloud.seen.length === sessions, { pill: await pill(), sessions: cloud.seen.length - sessions })
}
await handsFree("in another app")

await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Said.md")}` })
await win.locator("[data-pane] .cm-line", { hasText: "Asked:" }).click()
await helper((h) => h.stub("keyboard", {}))
await control(true)
check("held while the window has the keyboard, the window dictates, as ⌘J", await until(() => win.evaluate(() => !!document.querySelector(".dictation-pill")), 8000), await helper((h) => h.scene()?.pill))
await wait(700)
await control(false)
await until(() => win.evaluate(() => !document.querySelector(".dictation-pill")), 20000, 200)
await helper((h) => h.stub("keyboard", null))
await wait(1000)
await handsFree("after the window dictated")

await app.close()
cloud.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()

async function standInSoniox(said) {
  const { WebSocketServer } = await import("ws")
  fs.mkdirSync(LOCAL, { recursive: true })
  fs.writeFileSync(path.join(LOCAL, "config.json"), JSON.stringify({ dictation: { soniox: "qa-key" } }))
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  await new Promise((r) => wss.on("listening", r))
  const seen = [], parts = said.split(" ").map((w, i) => (i ? " " : "") + w)
  wss.on("connection", (ws) => {
    const c = { closed: false }
    seen.push(c)
    let bytes = 0, config = false, sent = 0
    ws.on("message", (d, binary) => {
      if (binary) {
        bytes += d.length
        const n = Math.min(parts.length, Math.ceil(bytes / 16000))
        if (n > sent) { sent = n; ws.send(JSON.stringify({ tokens: parts.slice(0, n).map((text) => ({ text, is_final: false })) })) }
        return
      }
      if (!config) { config = true; return }
      if (JSON.parse(d.toString()).type !== "finalize") return
      ws.send(JSON.stringify({ tokens: [...parts.map((text) => ({ text, is_final: true, start_ms: 0, end_ms: bytes / 32 })), { text: "<fin>", is_final: true }] }))
    })
    ws.on("close", () => { c.closed = true })
  })
  return { url: `ws://127.0.0.1:${wss.address().port}/`, seen, close: () => wss.close() }
}
