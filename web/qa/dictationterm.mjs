// Dictation into a terminal in a Mac's desktop app: pending words dimmed, settled ones bracketed pastes, the hint with nowhere to dictate.
// The recognizer stood in. WRITES only the throwaway vault.
//   node web/qa/dictationterm.mjs <vault copy>
// Paths: electron/dictation.ts, plugins/core/dictation/terminal.ts, web/src/core/dictation.ts
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PROMPT, ROOT, qa, terminalText, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("dictation is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-dictationterm-"))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })

await app.evaluate(({ ipcMain }) => {
  const g = globalThis
  for (const n of ["dictation:engines", "dictation:start", "dictation:stop", "dictation:cancel"]) ipcMain.removeHandler(n)
  const end = (reason) => { g.qaPage?.send("vaultite:dictation", { type: "end", reason }); g.qaPage = null }
  ipcMain.handle("dictation:engines", () => ({ apple: true, parakeet: false, locale: "en-US" }))
  ipcMain.handle("dictation:start", (e) => { g.qaPage = e.sender; setTimeout(() => e.sender.send("vaultite:dictation", { type: "start" }), 20); return { ok: true } })
  ipcMain.handle("dictation:stop", () => end("stop"))
  ipcMain.handle("dictation:cancel", () => end("cancel"))
  g.qaSay = (m) => g.qaPage?.send("vaultite:dictation", m)
})
const say = (m) => app.evaluate((_e, x) => globalThis.qaSay(x), m)
const fnKey = async () => {
  for (const down of [true, false]) {
    await app.evaluate(({ BaseWindow }, m) => { for (const w of BaseWindow.getAllWindows()) w.webContents?.send("vaultite:fn", m) }, { down })
    await wait(80)
  }
}
const listening = () => win.evaluate(() => !!document.querySelector(".dictation-pill:not([data-hint])"))
const dimmed = () => win.evaluate(() => document.querySelector("[data-term-pending]")?.textContent ?? "")
const flat = async () => (await terminalText(win)).replace(/\n/g, "")

await win.evaluate(() => { location.hash = `#view/terminal%2Fqadictation${Date.now().toString(36)}` })
await until(async () => PROMPT.test(await terminalText(win)), 20000)
await win.locator("[data-term]").click()
await win.keyboard.type("printf '\\e[?2004h'; cat -v")
await win.keyboard.press("Enter")
await wait(800)

await fnKey()
check("fn in a terminal listens", await until(listening, 3000))
await until(() => win.evaluate(() => document.querySelector(".dictation-pill")?.hasAttribute("data-ready")), 3000)
await say({ type: "speech" })
await say({ type: "pending", text: "@claude, remember to" })
check("words not settled show dimmed at the terminal's cursor", await until(async () => (await dimmed()) === "@claude, remember to", 3000), await dimmed())
const at = await win.evaluate(() => {
  const p = document.querySelector("[data-term-pending]")?.getBoundingClientRect(), pill = document.querySelector(".dictation-pill")?.getBoundingClientRect()
  const s = document.querySelector("[data-term-screen]")?.getBoundingClientRect()
  return p && pill && s ? { inside: p.top >= s.top && p.bottom <= s.bottom + 1, pillNear: Math.abs(pill.top - p.bottom) < 40 || Math.abs(pill.bottom - p.top) < 40 } : null
})
check("…on the terminal's screen, the pill beside them", !!at?.inside && at.pillNear, at)
check("…and not sent yet", !(await flat()).includes("claude"), (await terminalText(win)).slice(-300))
await say({ type: "final", text: "@claude, remember to buy milk\nand bread." })
await say({ type: "pause", ms: 700 })
await say({ type: "final", text: "then call Alice." })
await until(async () => (await flat()).includes("Alice"), 3000)
await wait(500)
const shown = await flat()
check("each settled chunk is a bracketed paste, a space between, a line break said as a space",
  shown.includes("^[[200~@claude, remember to buy milk and bread.^[[201~^[[200~ then call Alice.^[[201~"), (await terminalText(win)).slice(-400))
check("…and no Enter: the program never got a line", shown.match(/@claude/g)?.length === 1, (await terminalText(win)).slice(-400))
check("nothing dimmed is left as words settle", (await dimmed()) === "")
await fnKey()
check("fn again stops", await until(async () => !(await listening()), 3000))
await win.keyboard.press("Control+C")
await win.keyboard.type("exit")
await win.keyboard.press("Enter")

await win.evaluate(() => { location.hash = "" ; document.activeElement?.blur() })
await wait(500)
await win.evaluate(() => document.activeElement?.blur())
await fnKey()
const hint = await until(() => win.evaluate(() => {
  const h = document.querySelector(".dictation-pill[data-hint]"), r = h?.getBoundingClientRect()
  return h && r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth ? h.textContent : null
}), 3000)
check("fn with nothing focused says so in the pill's place, on screen", /Click where the words should go/.test(hint ?? ""), hint)
check("…and listens to nothing", !(await listening()))
check("…and the hint goes by itself", await until(() => win.evaluate(() => !document.querySelector(".dictation-pill[data-hint]")), 5000))

await app.close()
await done()
