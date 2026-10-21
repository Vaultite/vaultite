// Settings > Permissions in the desktop app (Electron) on a Mac, on a throwaway vault: the vault folder read by the app
// and its terminals, no signature row (only an ad hoc build has one), every permission lined up with its state, read without a single macOS prompt (no button is
// pressed: each would ask macOS or open System Settings), and `app.permissions` answering the same. Elsewhere it's
// skipped: the section is a Mac's only. WRITES: throwaway vault only.
//   node web/qa/permissions-desktop.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") await skip("Permissions are macOS's: a Mac's only")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-permissions-desktop-"))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
// (wide enough for Settings' sections beside the list: narrower, a section is a sheet over it)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 900))
// (a press would ask macOS or open System Settings: here it only says so)
await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler("app:permission"); ipcMain.handle("app:permission", (_e, id) => { throw new Error(`pressed ${id}`) }) })

await win.goto(`${origin}/#settings`)
await win.waitForSelector('[data-settings-nav="permissions"]', { timeout: 20000 })
await win.click('[data-settings-nav="permissions"]')
const section = win.locator('[data-settings-section="permissions"]')
check("Permissions: the vault folder, read by the app and its terminals", await until(async () =>
  (await section.locator('[data-settings-row="permission-vault"]').innerText().catch(() => "")).includes("The app and its terminals can read it"), 20000),
await section.innerText().catch(() => ""))
check("no signature row from source (only an ad hoc or unsigned build's)", await section.locator('[data-settings-row="permission-signing"]').count() === 0)
const ends = await section.locator("[data-permission-state]").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
check("every state's dot lines up", ends.length > 1 && new Set(ends).size === 1, ends)
const rows = await section.locator('[data-settings-row^="permission-"]').evaluateAll((els) => els.map((e) => ({
  row: e.getAttribute("data-settings-row"), state: e.querySelector("[data-permission-state]")?.getAttribute("data-permission-state"),
  button: e.querySelector("button")?.textContent ?? null })))
const ids = rows.map((r) => r.row.replace("permission-", ""))
check("every permission has its row and a state", ["microphone", "camera", "accessibility", "screen", "input", "automation", "desktop", "documents", "downloads", "full-disk"]
  .every((id) => ids.includes(id)) && rows.every((r) => r.state), rows)
check("one not allowed (or unknown) offers its way, one allowed none", rows
  .every((r) => (r.state === "allowed") === (r.button === null)), rows)
check("the folders aren't read on their own: Unknown, with Check", rows.filter((r) => /desktop|documents|downloads/.test(r.row))
  .every((r) => r.state === "unknown" && r.button === "Check"), rows)
await win.screenshot({ path: path.join(TMP, "permissions.png") })
console.log(`screenshot: ${path.join(TMP, "permissions.png")}`)

// vau permissions answers what the page shows (the same op).
const r = await (await fetch(`${origin}/api/ops/app.permissions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json()
check("app.permissions in the desktop app: macOS's permissions and the signature too", r.vault?.app?.ok === true && r.mac?.signing?.kind === "source" &&
  r.mac.permissions.length === rows.length - 1, r)

await wait(300)
await app.close()
if (!process.env.KEEP) fs.rmSync(TMP, { recursive: true, force: true })
await done()
