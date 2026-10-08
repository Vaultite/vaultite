// Export to PDF and the audio recorder in the desktop app (Electron), on a throwaway vault: Export to PDF saves the note
// as a PDF where the save dialog says (the dialog answered here) and the window is back as it was; recording works with
// a fake microphone when macOS already decided about the microphone for Electron (otherwise its prompt would wait for
// a click: skipped, and said so). WRITES: throwaway vault only.
//   node web/qa/media-desktop.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-media-desktop-"))

fs.mkdirSync(path.join(VAULT, "Qa media"), { recursive: true })
fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/audio-recorder"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/audio-recorder/data.json"), '{"auto": false}\n') // (no whisper run here)
fs.writeFileSync(path.join(VAULT, "Qa media", "Printed.md"), "---\ntype: note\n---\n\n## A heading\n\nSome text with $x^2$ math.\n\n- one\n- two\n")
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"),
  args: [ROOT, "--vault", VAULT, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win)
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
const palette = async (name) => {
  await win.keyboard.press("ControlOrMeta+P"); await wait(300)
  await win.keyboard.type(name); await wait(300)
  await win.keyboard.press("Enter"); await wait(600)
}

// Export to PDF: the save dialog answered with a path here.
const pdf = path.join(TMP, "Printed.pdf")
await app.evaluate(({ dialog }, pdf) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf }) }, pdf)
await win.goto(`${origin}/#file/${encodeURIComponent("Qa media/Printed.md")}`); await wait(1500)
await palette("Export to PDF")
check("Export to PDF saves the file the dialog names", await until(() => fs.existsSync(pdf) && fs.statSync(pdf).size > 5000, 15000), fs.existsSync(pdf) && fs.statSync(pdf).size)
check("a PDF", fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 5).toString() === "%PDF-")
check("then the window is as it was", await until(async () => (await win.locator("#vau-print").count()) === 0, 10000) && await win.title() !== "Printed")
check("a toast says where it went", await until(async () => (await win.getByText("Saved Printed.pdf").count()) > 0, 10000))

// Recording, when macOS already answered for the microphone.
const mic = await app.evaluate(({ systemPreferences }) => systemPreferences.getMediaAccessStatus("microphone"))
if (mic !== "granted") console.log(`skip recording: macOS's microphone permission for Electron is "${mic}" (a prompt would wait for a click)`)
else {
  fs.writeFileSync(path.join(VAULT, "Qa media", "Memo.md"), "Before\n")
  await win.goto(`${origin}/#file/${encodeURIComponent("Qa media/Memo.md")}`); await wait(1500)
  await palette("Start recording audio")
  check("recording in the desktop app", await until(async () => (await win.locator("[data-recorder=recording]").count()) === 1, 10000))
  await wait(2000)
  await win.getByRole("button", { name: "Stop recording" }).click()
  check("saved and embedded", await until(() => /!\[\[Recording [^\]]+\]\]/.test(fs.readFileSync(path.join(VAULT, "Qa media", "Memo.md"), "utf8")), 10000))
}

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
