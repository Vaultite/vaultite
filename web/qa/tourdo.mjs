// A tour played in do mode (plugins/core/companion/tours.ts) on Vaultite's own window, in the desktop app unseen: its
// steps' words and marks shown, its (do: click …) done on the thing named, a click that can't be done never told as
// done; and asked for by name with the Talk key (a stand-in Soniox hears it), it plays and the press ends with it.
// WRITES: throwaway vault only.   node web/qa/tourdo.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-tourdo-"))
const AUDIO = path.join(TMP, "said.aiff"), LOCAL = path.join(TMP, "local"), ASK = "Open my errands."
execFileSync("say", ["-o", AUDIO, ASK])
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("companion", { agent: "nobody", jobs_agent: "nobody", voice: "off" })
conf("dictation", { engine: "soniox", language: "en-US" })
const cloud = await standInSoniox(ASK)
fs.mkdirSync(path.join(VAULT, "Guides"), { recursive: true })
fs.writeFileSync(path.join(VAULT, "Errands.md"), "# Errands\n\n- [ ] Compare the two flights\n")
fs.writeFileSync(path.join(VAULT, "Guides", "Open errands.md"), `---
type: tour
app: vaultite
ask: ["open my errands"]
---
1. Your notes are down the left [ring "Errands"]. (do: click "Errands")
2. It's open in its tab [point "Errands"].
`)
fs.writeFileSync(path.join(VAULT, "Guides", "Press nothing.md"), `---
type: tour
app: vaultite
---
1. This one can't be pressed [ring "Errands"]. (do: click "A button nowhere")
`)

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: LOCAL, VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_SONIOX_URL: cloud.url },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const port = new URL(win.url()).port
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
await wait(2500)
const op = (name, body) => fetch(`http://127.0.0.1:${port}/api/ops/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
const r = await op("companion.tour", { path: "Guides/Open errands.md", mode: "do", wait: true })
console.log("  ", JSON.stringify(r).slice(0, 1500))
const hash = await win.evaluate(() => decodeURIComponent(location.hash))
check("do mode clicks the note named: it opens", /Errands\.md/.test(hash), hash)
check("the tour plays through, each step on its own (no model)", r.json?.result?.ended === "done" && (r.json.result.steps ?? []).every((s) => s.how !== "model"), r.json)
const none = await op("companion.tour", { path: "Guides/Press nothing.md", mode: "do", wait: true })
check("a click it can't do isn't told as done", none.json?.result?.ended !== "done" && none.json?.result?.steps?.[0]?.how !== "played", none.json)

// ---------- asked for by name with the Talk key (its voice off: words by the pointer), it plays; the press ends with it
await win.evaluate(() => { location.hash = "" })
await wait(1000)
const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "control_option", on: o }), on)
await chord(true)
await until(() => helper((h) => /errands/i.test(h.scene()?.summon?.words ?? "")), 30000, 100)
await wait(400)
await chord(false)
const playing = () => op("companion.tour", {}).then((x) => x.json?.playing ?? null)
check("said by name, the tour plays, not the model (guide mode: it waits for the click)", await until(async () => (await playing())?.title === "Open errands", 15000, 200), await playing())
await win.locator("[role=treeitem]", { hasText: "Errands" }).first().click()
check("…their click on what it rings plays it on to its end", await until(async () => !(await playing()), 30000, 300), await playing())
check("…and once it's played the press is over: its cursor isn't left thinking", await until(async () => !(await helper((h) => ["thinking", "sending"].includes(h.scene()?.summon?.state))), 20000, 300),
  { summon: await helper((h) => h.scene()?.summon), presses: await helper((h) => h.presses().slice(-6)) })
await app.close()
cloud.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()

/** Soniox stood in: every session hears `said`, its words growing as audio comes, final at its finalize. */
async function standInSoniox(said) {
  const { WebSocketServer } = await import("ws")
  fs.mkdirSync(LOCAL, { recursive: true })
  fs.writeFileSync(path.join(LOCAL, "config.json"), JSON.stringify({ dictation: { soniox: "qa-key" } }))
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" })
  await new Promise((r) => wss.on("listening", r))
  const parts = said.split(" ").map((w, i) => (i ? " " : "") + w)
  wss.on("connection", (ws) => {
    let bytes = 0, config = false
    ws.on("message", (d, binary) => {
      if (binary) { bytes += d.length; ws.send(JSON.stringify({ tokens: parts.slice(0, Math.min(parts.length, Math.ceil(bytes / 16000))).map((text) => ({ text, is_final: false })) })); return }
      if (!config) { config = true; return }
      if (JSON.parse(d.toString()).type !== "finalize") return
      ws.send(JSON.stringify({ tokens: [...parts.map((text) => ({ text, is_final: true, start_ms: 0, end_ms: bytes / 32 })), { text: "<fin>", is_final: true }] }))
    })
  })
  return { url: `ws://127.0.0.1:${wss.address().port}/`, close: () => wss.close() }
}
