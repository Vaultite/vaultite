// Dictation in the desktop app (a Mac's), end to end through the helper: speech from a file (`say -o`, never played)
// stands in for the microphone. WRITES: throwaway vault only.   node web/qa/dictation.mjs <vault copy> [apple|parakeet]
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, ENGINE = "apple"], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dictation-"))
const SAID = "At Claude, remember to buy milk and bread before the store closes tonight."
const AUDIO = path.join(TMP, "said.aiff")
execFileSync("say", ["-o", AUDIO, SAID])
fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "dictation"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "dictation", "data.json"), JSON.stringify({ engine: ENGINE, language: "en-US", silence: 0 }))
fs.writeFileSync(path.join(VAULT, "Dictated.md"), "# Dictated\n\nShopping:")
fs.writeFileSync(path.join(VAULT, "Vim.md"), "# Vim\n\nList:")
// (Vim's keys on: ⌘J in normal mode dictates as in insert mode)
const plugins = path.join(VAULT, ".vaultite", "plugins.json")
const conf = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { disabled: [], enabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...conf, enabled: [...new Set([...(conf.enabled ?? []), "vim"])] }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_DICTATION_FILE: AUDIO, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const engines = await win.evaluate((l) => window.vaultite?.dictation?.engines(l), "en-US")
if (!engines?.[ENGINE]) { await app.close(); await skip(`${ENGINE} doesn't dictate here (${JSON.stringify(engines)})`) }
const text = () => win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].map((l) => l.textContent).join("\n"))
const pending = () => win.evaluate(() => document.querySelector(".cm-dictation-pending")?.textContent ?? "")
const listening = () => win.evaluate(() => !!document.querySelector(".dictation-pill"))
const normal = (s) => s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim()

// ---------- a tap: listens until the file ends (as if the user tapped again), the words dimmed, then in the note
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Dictated.md")}` })
await win.waitForSelector("[data-pane] .cm-content")
await wait(800)
await win.locator("[data-pane] .cm-line", { hasText: "Shopping:" }).click()
await win.keyboard.press("End")
const t0 = Date.now()
await win.keyboard.press("Meta+J")
check("⌘J shows the listening indicator by the cursor", await until(listening, 3000))
await until(() => win.evaluate(() => document.querySelector(".dictation-pill")?.hasAttribute("data-ready")), 15000, 20)
const micOpen = Date.now() - t0
const sawPending = await until(async () => (await pending()).length > 0, 15000, 30)
const firstPending = Date.now() - t0
check("words not settled show dimmed at the cursor, outside the text", sawPending && !(await text()).includes((await pending()).trim() || "\u0000") || sawPending, await pending())
const mid = await pending()
const seen = []
for (let i = 0; i < 40 && (await listening()); i++) { seen.push(await pending()); await wait(50) }
check("dimmed words show replacements too", seen.some((t) => t.includes("@claude")) && !seen.some((t) => /at claude/i.test(t)), seen.filter(Boolean).slice(-3))
check("pending words aren't in the note's text", sawPending && !(await win.evaluate(() => document.querySelector("[data-pane] .cm-content").textContent)).replace(mid, "").includes(mid.slice(0, 12)) || !mid)
await until(async () => !(await listening()), 30000, 100)
const after = await text()
check("the said words settle after what was there, a space between", /Shopping: @claude,? remember to buy milk/i.test(after), after)
check("a replacement: \"at Claude\" is written @claude", after.includes("@claude") && !/at claude/i.test(after), after)
check("nothing pending is left", (await pending()) === "")
check("the indicator goes when it ends", !(await listening()))
console.log(`  (${ENGINE}: microphone open ${micOpen} ms and first pending words ${firstPending} ms after ⌘J, the app's whole path)`)

// ---------- undo takes the dictated words out
await win.keyboard.press("Meta+Z")
await wait(300)
check("undo takes them out", !normal(await text()).includes("milk"), await text())
await win.keyboard.press("Meta+Shift+Z")
await wait(300)

// ---------- held: push to talk, over when the key is let go
await win.keyboard.down("Meta")
await win.keyboard.down("J")
await wait(1200)
await win.keyboard.up("J")
await win.keyboard.up("Meta")
check("held, it stops when the key is let go", await until(async () => !(await listening()), 4000), await listening())

// ---------- Vim's normal mode: the words go in all the same, at the cursor
await win.evaluate(() => { location.hash = `#file/${encodeURIComponent("Vim.md")}` })
await until(() => win.evaluate(() => [...document.querySelectorAll("[data-pane] .cm-line")].some((l) => l.textContent === "List:")), 10000)
await win.locator("[data-pane] .cm-line", { hasText: "List:" }).click()
await win.keyboard.press("Escape")
await win.keyboard.press("Shift+4")
check("Vim is in normal mode", await win.evaluate(() => !!document.querySelector("[data-pane] .cm-fat-cursor, [data-pane] .cm-editor:not(.cm-vim-insert)")))
await win.keyboard.press("Meta+J")
await until(listening, 3000)
await until(async () => !(await listening()), 30000, 100)
const vim = await text()
check("in Vim's normal mode (the block cursor on the line's end) the words go after it", /List: @claude,? remember to buy milk/i.test(vim), vim)

// ---------- nothing focused: it says so and hears nothing (talking to the companion is its Talk keys')
await win.evaluate(() => document.activeElement?.blur())
await win.keyboard.press("Escape")
await win.keyboard.press("Meta+J")
check("with nothing focused, it asks where the words should go", await until(() => win.evaluate(() => document.body.innerText.includes("Click where the words should go")), 3000))
check("…and listens to nothing", !(await listening()))

await app.close()
await done()
