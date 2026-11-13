// Region capture: a drag with ⌃⌥ held makes a box; Record, Stop and Just now send it; the timeline answers agents.
// Needs the desktop app; WRITES only the throwaway vault.
//   node web/qa/capture.mjs <vault copy>
// Paths: electron/capture.ts, tools/test/vault/captures.ts
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-capture-"))
const AUDIO = path.join(TMP, "said.aiff")
execFileSync("say", ["-o", AUDIO, "Record this."])
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
conf("companion", { agent: "nobody", jobs_agent: "nobody", timeline: true })

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_CAPTURE: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
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
await chord(true)
check("held, its cursor comes, listening", await until(() => helper((h) => h.scene()?.summon?.state === "listening"), 8000))
await ink("down", 300, 250); await ink("move", 450, 330)
check("a drag with the key held grows a box as it goes, the pointer leaving no trail", await until(async () => (await region())?.rect?.width === 150 && (await helper((h) => h.scene()?.summon?.drag)), 3000), await region())
await ink("move", 700, 450); await ink("up", 700, 450)
const box = await region()
check("let go of the drag, the box stays where it was drawn", JSON.stringify(box?.rect) === '{"x":300,"y":250,"width":400,"height":200}', box)
const overlay = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html")), 10000)
check("the overlay draws it, with Record and Just now", !!overlay && await until(() => overlay.evaluate(() => !!document.querySelector('[data-region="idle"]') && !!document.querySelector('[aria-label="Record this box"]') &&
  !!document.querySelector('[aria-label^="Send the last"]')), 5000))

await chord(false)
await overlay.evaluate(() => document.querySelector('[aria-label="Record this box"]').click())
check("Record records the box", await until(async () => !!(await region())?.recording, 120000, 300), { region: await region(), hint: await helper((h) => h.scene()?.pill) })
check("recording, the box shows it (its time and Stop)", await until(() => overlay.evaluate(() => !!document.querySelector('[data-region="recording"]') && !!document.querySelector('[aria-label="Stop recording and send"]')), 5000))
await wait(2500)
await overlay.evaluate(() => document.querySelector('[aria-label="Stop recording and send"]').click())
const hint = () => helper((h) => (h.scene()?.pill?.hint ? h.scene().pill.text : ""))
const notes = () => (fs.existsSync(path.join(VAULT, "Captures")) ? fs.readdirSync(path.join(VAULT, "Captures")).filter((f) => f.endsWith(".md")) : [])
let said = ""
check("Stop sends it: with nothing said to do and no job on it, saved in Captures, and it says so",
  await until(async () => { said ||= await hint(); return notes().length === 1 && /^Saved in Captures/.test(said) }, 120000, 100), { said, notes: notes() })
const first = notes()[0], folder = first && path.join(VAULT, "Captures", first.replace(/\.md$/, ""))
const clip = folder && path.join(folder, "clip.mp4")
const probe = clip && fs.existsSync(clip) ? execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,duration", "-of", "json", clip]).toString() : ""
const stream = probe ? JSON.parse(probe).streams?.[0] : null
check("…its clip is the box at the display's pixels, as long as it recorded, with frames and a note embedding it",
  !!stream && stream.width % 400 === 0 && stream.width / stream.height === 2 && Number(stream.duration) >= 2 && fs.readdirSync(folder).some((f) => f.endsWith(".png")) &&
  fs.readFileSync(path.join(VAULT, "Captures", first), "utf8").includes("clip.mp4]]"), { first, stream })
check("the box stays for the next one", !!(await region()) && !(await region()).recording)

await wait(1000) // (a second recorded for Just now to send)
await overlay.evaluate(() => document.querySelector('[aria-label^="Send the last"]').click())
check("Just now sends the last seconds kept, saved beside the first", await until(() => notes().length === 2, 120000, 300), { notes: notes(), said: await hint() })
await helper((h) => h.heard({ event: "click", x: 320, y: 260, exchange: false }))
const port = new URL(win.url()).port
const tl = await fetch(`http://127.0.0.1:${port}/api/ops/screen.timeline`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ last: 25, kinds: ["box", "click"], clip: true }) }).then((r) => r.json())
const lines = tl.lines ?? []
check("the timeline's last seconds: the click, and its clip saved when asked",
  lines.some((l) => /clicked at 320,260/.test(l)) && !!tl.clip && fs.existsSync(tl.clip), tl)
const apart = () => overlay.evaluate(() => {
  const b = document.querySelector("[data-region]").getBoundingClientRect(), p = document.querySelector("[data-region-pill]").getBoundingClientRect()
  return { apart: p.right <= b.left || p.left >= b.right || p.bottom <= b.top || p.top >= b.bottom, box: [b.left, b.top, b.width, b.height], pill: [p.left, p.top, p.width, p.height] }
})
check("its pill sits outside the box", (await apart()).apart, await apart())
const grip = await overlay.evaluate(() => { const r = document.querySelector('[aria-label="Move the box"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
const before = (await region()).rect
await overlay.mouse.move(grip.x, grip.y); await overlay.mouse.down()
await overlay.mouse.move(grip.x - 150, grip.y - 150, { steps: 4 }); await overlay.mouse.move(grip.x - 400, grip.y - 400, { steps: 4 }); await overlay.mouse.up()
const moved = (await region()).rect
check("dragged by its grip (right of its close), the box moves", moved.x < before.x && moved.y < before.y && moved.width === before.width, { before, moved })
check("at the screen's top left, its pill goes outside it still (below)", await until(async () => (await apart()).apart, 2000), await apart())
await overlay.evaluate(() => document.querySelector('[aria-label="Close the box"]').click())
check("its close takes the box away", await until(async () => !(await region()), 3000))

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
