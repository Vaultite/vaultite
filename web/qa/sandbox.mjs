// The sandbox in the desktop app (electron/sandbox.ts): opened from a vault window (the palette's command calls
// window.vaultite.openSandbox), it's made in userData/Sandbox and opens in its own window on the tour; opened again
// while that window is open it's only brought forward (nothing remade); closed and opened again it's made afresh, on
// a new port (fresh tabs). Manage vaults lists it as the sandbox. WRITES: a throwaway userData and vault only.
//   node web/qa/sandbox.mjs <vault copy> [packaged app binary]
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, BIN], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-sandbox-"))
const USER = path.join(TMP, "userData")
const BOX = path.join(USER, "Sandbox")

const app = await _electron.launch({
  executablePath: BIN ?? path.join(ROOT, "node_modules/.bin/electron"), args: BIN ? ["--vault", VAULT] : [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: USER, VAULTITE_LOCAL: path.join(TMP, "local") },
})
const first = await app.firstWindow()
await first.waitForSelector("[role=tree]", { timeout: 60000 })
const boxWindow = () => app.windows().find((w) => { try { return /127\.0\.0\.1/.test(w.url()) && w !== first } catch { return false } })

await first.evaluate(() => window.vaultite.openSandbox())
const box = await until(boxWindow, 30000)
check("opening the sandbox opens a window of its own", !!box)
await box.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(box.url()).origin
check("its server serves userData/Sandbox", (await (await fetch(`${origin}/api/vault`)).json()).path === BOX)
check("it's marked as a sandbox", fs.existsSync(path.join(BOX, ".vaultite/sandbox.json")))
check("it starts on the tour", !!(await until(() => box.locator("h1", { hasText: "Start here" }).count(), 30000)))
const made = fs.statSync(path.join(BOX, ".vaultite/sandbox.json")).mtimeMs
fs.writeFileSync(path.join(BOX, "Notes/Mine.md"), "a note written in the sandbox\n")

await first.evaluate(() => window.vaultite.openSandbox())
await wait(1000)
check("opening it again while it's open remakes nothing", fs.existsSync(path.join(BOX, "Notes/Mine.md")) && fs.statSync(path.join(BOX, ".vaultite/sandbox.json")).mtimeMs === made)
check("and opens no second window", app.windows().filter((w) => /127\.0\.0\.1/.test(w.url())).length === 2)
const list = await first.evaluate(() => window.vaultite.vaults())
check("Manage vaults lists it as the sandbox", list.vaults.some((v) => v.path === BOX && v.sandbox), list)

await box.close()
await until(() => !boxWindow(), 10000)
await first.evaluate(() => window.vaultite.openSandbox())
const again = await until(boxWindow, 30000)
await again?.waitForSelector("[role=tree]", { timeout: 60000 })
check("closed and opened again, it's made afresh", !fs.existsSync(path.join(BOX, "Notes/Mine.md")))
check("on a new port (fresh tabs)", again && new URL(again.url()).origin !== origin, again?.url())

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
