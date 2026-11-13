// The companion on a call: answers are said aloud, but shown with a play button while another app has the mic.
// Needs the desktop app, the screen helper stood in for; WRITES only the throwaway vault.
//   node web/qa/helper-calls.mjs <vault copy>
// Paths: electron/helper.ts
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-helper-calls-"))
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("companion", { agent: "nobody", voice: "always", voice_front: "pipeline" })

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const port = new URL(win.url()).port
const answer = (text) => fetch(`http://127.0.0.1:${port}/api/ops/companion.say`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, as: "Nobody" }) }).then((r) => r.ok)
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
check("the helper runs with the app", await helper(() => true))
const w9 = { window: 9, bundle: "com.example.notes", name: "Example Notes", title: "Draft", frame: { x: 100, y: 120, width: 800, height: 600 } }
await helper((h, w) => { h.stub("focus", { ...w, field: false, pid: 1 }); h.stub("window", w); h.stub("at", w) }, w9)
await wait(1500)

const said = () => helper((h) => h.spoken().filter((m) => m.cmd === "say" && /couldn't start/i.test(m.text ?? "")).length)
const box = () => app.windows().find((p) => p.url().endsWith("/screen.html#panel"))
async function typedAsk(text) {
  await helper((h) => h.heard({ event: "chord", name: "control_option", on: true }))
  await wait(60)
  await helper((h) => h.heard({ event: "chord", name: "control_option", on: false }))
  const b = await until(box, 10000, 100)
  const field = "[data-companion-popover] input"
  await b?.waitForSelector(field, { timeout: 10000 })
  const sent = () => helper((h, t) => h.asked().some((m) => m.kind === "ask" && m.text === t), text)
  for (let i = 0; i < 5 && !(await sent()); i++) {
    await b?.fill(field, text)
    await b?.press(field, "Enter")
    await until(sent, 3000, 200)
  }
  check(`the ask goes: ${text}`, await sent())
  return b
}
const end = async () => { await helper((h) => h.heard({ event: "esc" })); await until(() => !box(), 5000, 100) }

await typedAsk("What's this window?")
check("off a call, its answer is said aloud", await until(async () => (await said()) >= 1, 20000, 200), await helper((h) => h.spoken().slice(-3)))
await end()

await helper((h) => h.stub("mics", { ok: true, users: [{ pid: 9001, bundle: "us.zoom.xos", app: "zoom.us", appBundle: "us.zoom.xos", chain: [1], input: true, output: true }] }))
check("another app on a call is heard as one", await until(() => helper((h) => h.asked().some((m) => m.t === "call" && m.call === "on a call in Zoom")), 5000, 200))
const before = await said(), cues = await helper((h) => h.asked().filter((m) => m.cue === "answer").length)
const b = await typedAsk("And now?")
check("the companion answers", await answer("The Share button is at the top right."))
check("on a call, its answer shows in its box", !!b && await until(() => b.evaluate(() => /Share button is at the top right/.test(document.body.textContent)), 20000, 200),
  [await b?.evaluate(() => document.body.textContent), await helper((h) => h.asked().slice(-4))])
check("…with a play button, its box saying why, naming the app", !!b && await until(() => b.evaluate(() => !!document.querySelector('[aria-label="Say it aloud"]') && document.querySelector("[data-companion-quiet]")?.textContent?.startsWith("Quiet: Zoom has your mic")), 5000, 200),
  await b?.evaluate(() => document.querySelector("[data-companion-quiet]")?.textContent))
await wait(1500)
check("…and nothing is said", (await said()) === before && !(await helper((h) => h.spoken().some((m) => m.cmd === "say" && /Share button/.test(m.text ?? "")))), await helper((h) => h.spoken().slice(-3)))
check("…nor its answer's cue played", (await helper((h) => h.asked().filter((m) => m.cue === "answer" && !m.quiet).length)) === cues, await helper((h) => h.asked().filter((m) => m.cue)))
await b?.click('[aria-label="Say it aloud"]')
check("its play button says it, on a call or not", await until(() => helper((h) => h.spoken().some((m) => m.cmd === "say" && /Share button/.test(m.text ?? ""))), 5000, 200), await helper((h) => h.spoken().slice(-3)))
await end()

await helper((h) => h.stub("mics", { ok: true, users: [] }))
check("the call over, it's told", await until(() => helper((h) => h.asked().some((m) => m.t === "call" && m.call === "")), 25000, 500))
const after = await said()
await typedAsk("Once more")
check("…and its answers are said aloud again", await until(async () => (await said()) > after, 15000, 200), await helper((h) => h.spoken().slice(-3)))
await end()

const fox = { ok: true, users: [{ pid: 9002, bundle: "org.mozilla.firefox", app: "Firefox", appBundle: "org.mozilla.firefox", chain: [1], input: true, output: false }] }
await helper((h, m) => h.stub("mics", m), fox)
check("a browser holding the mic is heard as a call", await until(() => helper((h) => h.asked().some((m) => m.t === "call" && m.call === "on a call in Firefox")), 5000, 200))
const b2 = await typedAsk("Is it quiet?")
check("the companion answers", await answer("The Export button is in the File menu."))
check("its box says Firefox has the mic", !!b2 && await until(() => b2.evaluate(() => document.querySelector("[data-companion-quiet]")?.textContent?.startsWith("Quiet: Firefox has your mic")), 20000, 200),
  await b2?.evaluate(() => document.body.textContent))
await b2?.click("[data-companion-quiet] button")
check("Not a call: its box says nothing of a call, and the answer kept quiet is said", await until(async () => !(await b2.evaluate(() => !!document.querySelector("[data-companion-quiet]")))
  && await helper((h) => h.spoken().some((m) => m.cmd === "say" && /Export button/.test(m.text ?? ""))), 5000, 200), await helper((h) => h.spoken().slice(-3)))
check("…and the server's told it's over", await until(() => helper((h) => h.asked().filter((m) => m.t === "call").at(-1)?.call === ""), 5000, 200))
await end()
const spoke = await said()
await typedAsk("Still there?")
check("while Firefox still holds the mic, answers are said aloud", await until(async () => (await said()) > spoke, 15000, 200), await helper((h) => h.spoken().slice(-3)))
await end()
await helper((h) => h.stub("mics", { ok: true, users: [] }))
await wait(5000) // (let go for longer than a blip)
await helper((h, m) => h.stub("mics", m), fox)
check("once it let go, its next hold counts again", await until(() => helper((h) => h.asked().filter((m) => m.t === "call").at(-1)?.call === "on a call in Firefox"), 5000, 200))

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
