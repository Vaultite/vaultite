// The Browser's bookmarks bar (plugins/core/web-viewer/BookmarksBar.tsx), in the desktop app against a page this script
// serves: ⇧⌘B and the bar's menu switch it, its folders made, renamed and opened, a bookmark dragged onto a folder.
// WRITES: the throwaway vault only (its Bookmarks.md). RECORD=<dir>: a video of the window there too.
//   node web/qa/bookmarksbar.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-bookmarksbar-"))
keepAwake(300)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const slow = process.env.RECORD ? 900 : 0

const NOTE = path.join(VAULT, "Bookmarks.md")
fs.writeFileSync(NOTE, "---\ntype: bookmarks\n---\n\n- [Tide tables](https://tides.example.com/)\n- [Lighthouse log](https://lighthouse.example.com/)\n- [Harbor map](https://harbor.example.com/)\n\n## Reading\n- [Field guide](https://guide.example.com/)\n")
const note = () => fs.readFileSync(NOTE, "utf8")

const server = http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end("<!doctype html><title>Lighthouse field notes</title><body style='font:16px system-ui;padding:40px'><h1>Lighthouse field notes</h1>")
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const URL_ = `http://127.0.0.1:${server.address().port}/notes`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
  ...(process.env.RECORD ? { recordVideo: { dir: process.env.RECORD, size: { width: 1280, height: 800 } } } : {}),
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: URL_, newTab: true }) })

const bar = win.locator("[data-web-page] [data-web-marks]:visible").first()
const menu = () => win.locator("[role=menu]:visible").last()
const menuText = () => menu().innerText().catch(() => "")
check("(the page is open)", await until(() => win.locator("[data-web-page] [data-web-star]:visible").count(), 30000))
check("a page: no bookmarks bar till it's asked for", !(await bar.count()))

await win.evaluate(() => (document.activeElement)?.blur?.())
await win.keyboard.press(process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B")
check("⇧⌘B: the bar, the note's top links then its folders", await until(async () => (await bar.count()) > 0
  && (await bar.locator("[data-web-mark], [data-web-mark-folder]").allInnerTexts()).join("|") === "Tide tables|Lighthouse log|Harbor map|Reading", 5000),
  await bar.innerText().catch(() => ""))
await wait(slow)

await bar.click({ position: { x: 900, y: 14 }, button: "right" })
check("its menu: New folder…, Open bookmarks, Always show bookmarks bar checked, the page bar's", await until(async () => {
  const t = await menuText()
  return /New folder…/.test(t) && /Open bookmarks/.test(t) && /Always show bookmarks bar/.test(t) && /Hide page bar/.test(t)
}, 3000), await menuText())
check("… its switch a check that's on", (await win.getByRole("menuitemcheckbox", { name: /Always show bookmarks bar/ }).getAttribute("aria-checked").catch(() => null)) === "true")
await wait(slow)
await win.getByRole("menuitem", { name: "New folder…" }).click()
await win.keyboard.type("Boats", { delay: slow ? 80 : 0 })
await wait(slow)
await win.keyboard.press("Enter")
check("New folder…: its heading in the note, a folder in the bar", await until(async () => /\n## Boats\n?$/.test(note()) && await bar.locator('[data-web-mark-folder="Boats"]').count() > 0, 5000), note())
await wait(slow)

const from = await bar.locator('[data-web-mark="https://harbor.example.com/"]').boundingBox(), to = await bar.locator('[data-web-mark-folder="Boats"]').boundingBox()
await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
await win.mouse.down()
await win.mouse.move(from.x + from.width / 2 + 20, from.y + 10, { steps: 4 })
await win.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
await wait(slow || 150)
await win.mouse.up()
check("a bookmark dragged onto a folder: its line under that heading, gone from the bar", await until(async () => /## Boats\n- \[Harbor map\]/.test(note())
  && !(await bar.locator('[data-web-mark="https://harbor.example.com/"]').count()), 5000), note())
await wait(slow)

await bar.locator('[data-web-mark-folder="Boats"]').click()
check("a folder clicked: its bookmarks in a menu", await until(async () => /Harbor map/.test(await menuText()), 3000), await menuText())
await wait(slow * 1.5)
await win.keyboard.press("Escape")

const a = await bar.locator('[data-web-mark="https://lighthouse.example.com/"]').boundingBox(), b = await bar.locator('[data-web-mark="https://tides.example.com/"]').boundingBox()
await win.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
await win.mouse.down()
await win.mouse.move(a.x + a.width / 2 - 20, a.y + 10, { steps: 4 })
await win.mouse.move(b.x + 6, b.y + b.height / 2, { steps: 12 })
await wait(slow || 150)
await win.mouse.up()
check("dragged along the bar: before the other in the note", await until(() => note().indexOf("Lighthouse log") < note().indexOf("Tide tables"), 5000), note())

await bar.locator('[data-web-mark-folder="Boats"]').click({ button: "right" })
await win.getByRole("menuitem", { name: "Rename…" }).click()
await win.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A")
await win.keyboard.type("Harbors")
await win.keyboard.press("Enter")
check("Rename…: its heading renamed", await until(() => note().includes("## Harbors\n- [Harbor map]"), 5000), note())

await win.locator("[data-web-page] [data-web-star]:visible").click()
await win.getByRole("menuitem", { name: /^Folder/ }).hover()
check("the star's card: every folder, and New folder…", await until(async () => /Harbors/.test(await menuText()) && /New folder…/.test(await menuText()), 3000), await menuText())
await win.keyboard.press("Escape")
await win.keyboard.press("Escape")

await win.evaluate(() => (document.activeElement)?.blur?.())
await win.keyboard.press(process.platform === "darwin" ? "Meta+Shift+B" : "Control+Shift+B")
check("⇧⌘B again: the bar's gone", await until(async () => !(await bar.count()), 5000))
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: "view:web/", newTab: true }) })
check("… but a new tab's page has it, as Chrome's", await until(async () => (await bar.count()) > 0 && /Harbors/.test(await bar.innerText()), 8000))

await app.close()
server.close()
await done()
