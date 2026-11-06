// The menu-bar helper (electron/helper.ts) in the desktop app, unseen: fn⌃ with no field hears nothing; ⌃⌥ held summons
// the companion at the pointer, listening (speech from a file), and let go asks it about the window there, its answer's
// box open by it (said aloud) and its cursor riding beside the pointer over the screen; closing the window keeps the server and reopening takes it back.
// The screen helper is stood in for. WRITES: throwaway vault only.   node web/qa/helper.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-helper-"))
const AUDIO = path.join(TMP, "said.aiff")
execFileSync("say", ["-o", AUDIO, "What does this paragraph say about milk?"])
const conf = (id, v) => { fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", id), { recursive: true }); fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", id, "data.json"), JSON.stringify(v)) }
conf("dictation", { engine: "apple", language: "en-US" })
// (an agent that isn't here: the ask arrives, and no session starts)
conf("companion", { agent: "nobody" })

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const port = new URL(win.url()).port
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
check("the helper runs with the app", await helper(() => true))
const engines = await win.evaluate((l) => window.vaultite?.dictation?.engines(l), "en-US")
if (!engines?.apple) { await app.close(); await skip(`Apple's recognizer doesn't dictate here (${JSON.stringify(engines)})`) }

// ---------- fn with no field: nothing heard, a word where the pill shows
const frame = { x: 100, y: 120, width: 800, height: 600 }
const win9 = { window: 9, bundle: "com.example.notes", name: "Example Notes", title: "Draft", frame }
await helper((h, w) => { h.stub("focus", { ...w, field: false, pid: 1 }); h.stub("window", w); h.stub("at", w) }, win9)
await wait(1500) // (its settings and the companion's socket, read as it starts)
await helper((h) => h.heard({ event: "chord", name: "fn_control", on: true }))
await wait(100)
await helper((h) => h.heard({ event: "chord", name: "fn_control", on: false }))
check("fn⌃ with no field hears nothing: a word says so", await until(() => helper((h) => !!h.scene()?.pill?.hint), 5000), await helper((h) => h.scene()))
await wait(1500)
check("…and asks no one", !(await helper((h) => h.asked().some((m) => m.kind === "ask"))))

// ---------- ⌃⌥ held (a Talk key): the companion at the pointer, listening; let go, what was said is sent
const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "control_option", on: o }), on)
await chord(true)
const overlay = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html")), 10000)
check("held, its cursor comes to the pointer, listening", await until(() => helper((h) => h.scene()?.summon?.state === "listening"), 5000), await helper((h) => h.scene()?.summon))
check("…its words by it as they come", await until(() => helper((h) => /milk/i.test(h.scene()?.summon?.words ?? "")), 30000, 200), await helper((h) => h.scene()?.summon))
await chord(false)
const ask = await until(() => helper((h) => h.asked().find((m) => m.kind === "ask")), 30000, 200)
check("let go, what was said goes, about the window under the pointer", !!ask && ask.app === "com.example.notes" && ask.window === 9 && /milk/i.test(ask.text ?? ""), ask)
const box = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html#panel")), 10000)
check("its answer's box opens by it", !!box && !box.isClosed())

// ---------- its answer to an ask by voice, said aloud as it's written (a scripted copy plays nothing: it tells what it'd say)
// (its agent isn't here: what it answers is that it couldn't start)
const spoken = () => helper((h) => h.spoken().filter((m) => m.cmd === "say").map((m) => m.text).join(" "))
check("its answer to an ask by voice is said aloud", await until(async () => /^I couldn't start/.test(await spoken()), 8000, 200), await helper((h) => h.spoken()))

// ---------- its cursor over the screen: through the exchange, the summoned one, riding beside the pointer
const at = await until(() => helper((h) => (h.scene()?.summon?.follow ? h.scene().summon : null)), 10000, 200)
check("the companion's cursor rides beside the pointer through the exchange (its own place no cursor of its own)", !!at && !(await helper((h) => h.scene()?.agents?.length)), at)
check("the overlay draws its cursor and name", !!overlay && await until(() => overlay.evaluate((n) => document.body.textContent.includes(n), at?.name ?? "?"), 5000))
check("the overlay paints nothing else: it's see-through", !!overlay && await overlay.evaluate(() => getComputedStyle(document.documentElement).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)"))

await helper((h) => h.heard({ event: "esc" }))
check("Esc ends the exchange and silences its voice at once", await until(() => helper((h) => h.spoken().at(-1)?.cmd === "stop"), 3000), await helper((h) => h.spoken().slice(-2)))

// ---------- fn while the window has the keyboard: its ⌘J, into the note
fs.writeFileSync(path.join(VAULT, "Said.md"), "# Said\n\nAsked:")
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Said.md")}` })
await win.locator("[data-pane] .cm-line", { hasText: "Asked:" }).click()
await win.keyboard.press("End")
const fnKey = (k) => app.evaluate(({ BaseWindow }, m) => { for (const w of BaseWindow.getAllWindows()) w.webContents?.send("vaultite:fn", m) }, k)
await fnKey({ down: true })
await wait(100)
await fnKey({ down: false })
check("fn in the window dictates where its cursor is, as ⌘J", await until(() => win.evaluate(() => !!document.querySelector(".dictation-pill")), 5000))
await until(() => win.evaluate(() => !document.querySelector(".dictation-pill")), 30000, 100)
const note = await win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
check("its words land in the note", /Asked: what does this paragraph say about milk/i.test(note), note)

// ---------- a Talk key held while the window has the keyboard: the companion's box (by its cursor, or a thread), listening
const line = await win.locator("[data-pane] .cm-line", { hasText: "Asked:" }).boundingBox()
await win.mouse.move(line.x + 20, line.y + line.height / 2)
await fnKey({ talk: "listen" })
const into = await until(() => win.evaluate(() => { const f = document.activeElement; return !!document.querySelector(".dictation-pill") && !!f?.closest("[data-companion-popover], [data-companion-note], [data-companion-add], .cm-companion-draft, [data-companion-thread]") && (f.tagName === "INPUT" || f.tagName === "TEXTAREA" || f.isContentEditable) }), 8000)
check("a Talk key in the window opens the companion's box, listening in it", into, await win.evaluate(() => document.activeElement?.outerHTML.slice(0, 200)))
const left = await win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
await until(() => win.evaluate(() => !document.querySelector(".dictation-pill")), 30000, 100)
const after = await win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
check("…and nothing it hears goes in the note", after === left, { left, after })
const starts = () => helper((h) => h.spoken().filter((m) => m.cmd === "say" && /^I couldn't start/.test(m.text)).length)
check("…and its answer is said aloud, as on screen", await until(async () => (await starts()) >= 2, 10000, 200), await helper((h) => h.spoken()))

// ---------- closing the window keeps the server; the app clicked again opens it on the same one
const alive = () => fetch(`http://127.0.0.1:${port}/api/ops/screen.front`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.ok, () => false)
await app.evaluate(({ BaseWindow }) => { for (const w of BaseWindow.getAllWindows()) w.close() })
await wait(1500)
check("closed, the vault's server goes on", await alive())
const next = app.waitForEvent("window", { timeout: 60000 }).catch(() => null)
await app.evaluate(({ app }) => app.emit("activate"))
const again = await next
check("opened again, the window is the same server's", !!again && (await again.waitForURL(/127\.0\.0\.1/, { timeout: 30000 }).then(() => new URL(again.url()).port, () => "")) === port, again?.url())

await app.close()
check("quit, the server ends with it", await until(async () => !(await alive()), 10000))
fs.rmSync(TMP, { recursive: true, force: true })
await done()
