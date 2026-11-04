// The Browser's bookmark star, as Chrome's (plugins/core/web-viewer/Star.tsx), in the desktop app (Electron) against a
// page this script serves: outline, then filled with its card (name, folder, Remove), the … menu and ⌘D following it.
// WRITES: the throwaway vault only (its Bookmarks.md).
//   node web/qa/bookmarkstar.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-bookmarkstar-"))
keepAwake(300)

const NOTE = path.join(VAULT, "Bookmarks.md")
fs.writeFileSync(NOTE, "---\ntype: bookmarks\n---\n\n## Reading\n- [Tide tables](https://tides.example.com/)\n")
const note = () => fs.readFileSync(NOTE, "utf8")

const server = http.createServer((_, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end("<!doctype html><title>Lighthouse field notes</title><h1>Lighthouse field notes</h1>")
})
await new Promise((r) => server.listen(0, "127.0.0.1", r))
const URL_ = `http://127.0.0.1:${server.address().port}/notes`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
await fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: URL_, newTab: true }) })

const star = win.locator("[data-web-page] [data-web-star]:visible")
const menu = () => win.locator("[role=menu]:visible").first()
const menuText = () => menu().innerText().catch(() => "")
check("a page not bookmarked: an outline star at the end of the address bar", await until(async () => (await star.getAttribute("data-web-star").catch(() => null)) === "off", 20000),
  await win.locator("[data-web-address-bar]").innerHTML().catch(() => ""))
const bar = await win.locator("[data-web-page] [data-web-address-bar]:visible").boundingBox(), at = await star.boundingBox()
check("… last in the field, at its right end", !!bar && !!at && bar.x + bar.width - (at.x + at.width) < 8, { bar, at })
// (the star names a bookmark with the page's title as it is then: before it has one, its address)
check("(the page's title has come)", await until(() => win.locator("[data-tab-strip] [role=tab]", { hasText: "Lighthouse field notes" }).count(), 20000))

await star.click()
check("clicked: filled at once, its card says Bookmark added", await until(async () => (await star.getAttribute("data-web-star")) === "on" && /Bookmark added/.test(await menuText()), 5000), await menuText())
check("… and it's a line in the bookmarks note, at its top", await until(() => /^- \[Lighthouse field notes\]\(http:\/\/127\.0\.0\.1:\d+\/notes\)$/m.test(note()) && note().indexOf("/notes)") < note().indexOf("## Reading"), 5000), note())
const name = win.locator("[data-menu-field] input:visible")
check("… its name in a field, ready to type", (await name.inputValue()) === "Lighthouse field notes" && await name.evaluate((e) => e === document.activeElement), await name.inputValue())
await name.fill("Keeper's notes")
await win.keyboard.press("Enter")
check("renamed, saved as the card closes", await until(() => note().includes(`- [Keeper's notes](${URL_})`), 5000) && !(await menu().isVisible().catch(() => false)), note())

await star.click()
check("clicked again: its card to edit, with Remove", await until(async () => /Edit bookmark/.test(await menuText()) && /Remove/.test(await menuText()), 5000), await menuText())
await win.getByRole("menuitem", { name: /^Folder/ }).hover()
await win.getByRole("menuitemradio", { name: "Reading" }).click()
check("a folder picked: the card closes, its line moves under that heading", await until(() => /## Reading\n(- .*\n)*- \[Keeper's notes\]/.test(note()), 5000) && note().match(/Keeper's notes/g)?.length === 1
  && !(await menu().isVisible().catch(() => false)), note())

await win.locator("[data-web-page] [data-web-more]:visible").click()
check("the … menu says Edit bookmark… with ⌘D", await until(async () => /Edit bookmark…/.test(await menuText()), 3000), await menuText())
await win.getByRole("menuitem", { name: "Edit bookmark…" }).click()
check("… which opens the star's card", await until(async () => /Edit bookmark/.test(await menuText()) && await name.isVisible(), 3000), await menuText())
await win.getByRole("menuitem", { name: "Remove" }).click()
check("Remove: the outline again, its line gone, its folder kept", await until(async () => (await star.getAttribute("data-web-star")) === "off" && !note().includes("/notes)"), 5000)
  && note().includes("## Reading\n- [Tide tables]"), note())

await win.evaluate(() => (document.activeElement)?.blur?.())
await win.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D")
check("⌘D: bookmarked, with its card", await until(async () => (await star.getAttribute("data-web-star")) === "on" && /Bookmark added/.test(await menuText()), 5000), [await menuText(), note()])
await win.keyboard.press("Escape")
check("… kept as it was named", await until(() => note().includes(`- [Lighthouse field notes](${URL_})`), 5000), note())

await app.close()
server.close()
await done()
