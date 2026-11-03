// The menu-bar helper (electron/helper.ts) in the desktop app, unseen: fn with no field asks the companion about the app in
// front (speech from a file), its cursor goes there over the screen, closing the window keeps the server and reopening
// takes it back. The screen helper is stood in for. WRITES: throwaway vault only.   node web/qa/helper.mjs <vault copy>
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

// ---------- fn with no field: dictation, the pill, then an ask about the app in front
const frame = { x: 100, y: 120, width: 800, height: 600 }
await helper((h, f) => { h.stub("focus", { field: false, bundle: "com.example.notes", name: "Example Notes", pid: 1, window: 0, title: "Draft" }); h.stub("window", { window: 9, bundle: "com.example.notes", name: "Example Notes", title: "Draft", frame: f }) }, frame)
await wait(1500) // (its settings and the companion's socket, read as it starts)
await helper((h) => h.heard({ event: "fn", down: true }))
await wait(100)
await helper((h) => h.heard({ event: "fn", down: false }))
check("a tap of fn shows the pill", await until(() => helper((h) => !!h.scene()?.pill), 5000), await helper((h) => h.scene()))
const overlay = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html")), 10000)
check("the screen's overlay draws it", !!overlay && await until(() => overlay.evaluate(() => !!document.querySelector(".dictation-pill")), 5000))
const ask = await until(() => helper((h) => h.asked().find((m) => m.kind === "ask")), 30000, 200)
check("let go of, what was said asks the companion about the app in front", !!ask && ask.app === "com.example.notes" && /milk/i.test(ask.text ?? ""), ask)
check("the pill goes when it stops", await until(() => helper((h) => !h.scene()?.pill), 5000))

// ---------- its cursor over the screen, at the window it was asked about
const at = await until(() => helper((h) => h.scene()?.agents?.[0]), 10000, 200)
check("the companion's cursor goes to that window, by its title bar", !!at && at.sx === frame.x + frame.width / 2 && at.sy === frame.y + 12, at)
check("the overlay draws its cursor and name", !!overlay && await until(() => overlay.evaluate((n) => document.body.textContent.includes(n), at?.name ?? "?"), 5000))
check("the overlay paints nothing else: it's see-through", !!overlay && await overlay.evaluate(() => getComputedStyle(document.documentElement).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(document.body).backgroundColor === "rgba(0, 0, 0, 0)"))

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
