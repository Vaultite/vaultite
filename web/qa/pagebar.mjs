// The Browser's page bar hidden (setting `pageBar`), in the desktop app (Electron), against a made-up page this script
// serves on 127.0.0.1: the page fills its tab; the bar slides over it once the pointer rests at the page's top, and
// goes once the pointer has left it; the address focused keeps it out; a new tab has it out; the bar's right-click
// shows it again.
// WRITES: the throwaway vault only.
//   node web/qa/pagebar.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-pagebar-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "300"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Long read</title><body style="margin:0;background:#202020;color:#ddd"><p style="margin:0;padding:8px">Top line</p><div style="height:2000px"></div>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const open = async (to) => { await ui({ action: "open", path: to, newTab: true }); await wait(500) }

/** The visible page's bounds (window CSS px) and its bar's state. */
const look = () => app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0], z = w.webContents.getZoomFactor()
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  if (!v) return null
  const b = v.getBounds()
  return { top: b.y / z, left: b.x / z, width: b.width / z }
}).then(async (page) => ({ page, ...(await win.evaluate(() => {
  const view = [...document.querySelectorAll("[data-web-page]")].find((e) => e.getBoundingClientRect().width > 0)
  const bar = view?.querySelector("[data-web-bar]")
  return { viewTop: view?.getBoundingClientRect().top, bar: bar?.getAttribute("data-web-bar-hidden") ?? "shown", barBottom: bar?.getBoundingClientRect().bottom }
})) }))
/** The pointer moved in the visible page, at (x, y) in its own CSS px. */
const moveInPage = (x, y) => app.evaluate(({ BaseWindow }, [x, y]) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((c) => c.webContents && c.webContents !== w.webContents && c.getVisible())
  v?.webContents.sendInputEvent({ type: "mouseMove", x, y })
}, [x, y])

// ---------- shown: the bar above the page ----------
await open(`view:web/${SITE}/read`)
check("a web page under its bar", await until(async () => { const l = await look(); return l.page && l.bar === "shown" && l.page.top >= l.barBottom - 1 }, 15000), await look())

// ---------- hidden: the page fills its tab ----------
await setting({ pageBar: "hidden" })
check("hidden: the page fills its tab, the bar slid out", await until(async () => { const l = await look(); return l.bar === "in" && l.page && Math.abs(l.page.top - l.viewTop) <= 1 && l.barBottom <= l.viewTop + 1 }, 8000), await look())

// ---------- the pointer at the page's top brings it ----------
await moveInPage(400, 200)
await moveInPage(400, 1)
check("the pointer resting at the page's top slides the bar in", await until(async () => (await look()).bar === "out", 4000), await look())
if (process.env.SHOTS) await win.screenshot({ path: path.join(process.env.SHOTS, "pagebar-out.png") })
check("… over the page, which stays where it is", await until(async () => { const l = await look(); return Math.abs(l.page.top - l.viewTop) <= 1 && l.barBottom > l.viewTop + 20 }, 3000), await look())
await win.locator("[data-web-bar]:visible").hover()
await wait(600)
check("… stays while the pointer is on it", (await look()).bar === "out", await look())
const box = await win.locator("[data-web-box]:visible").boundingBox()
await win.mouse.move(box.x + 300, box.y + 400)
await win.mouse.move(box.x + 320, box.y + 420)
check("… and goes once it's left", await until(async () => (await look()).bar === "in", 4000), await look())

// ---------- brushing past the top doesn't ----------
await moveInPage(400, 1)
await moveInPage(400, 200)
await wait(500)
check("the pointer passing the top: the bar stays away", (await look()).bar === "in", await look())

// ---------- the address focused keeps it out ----------
await win.locator("[data-web-address]").first().focus()
check("the address focused (⌘L): the bar is out", await until(async () => (await look()).bar === "out", 3000), await look())
await win.evaluate(() => document.activeElement?.blur())
check("… and goes when the keyboard leaves it", await until(async () => (await look()).bar === "in", 3000), await look())

// ---------- a new tab: its address to type ----------
await open("view:web")
check("a new tab has the bar out", await until(async () => (await look()).bar === "out", 5000), await look())
await win.keyboard.press(process.platform === "darwin" ? "Meta+W" : "Control+W")
await wait(500)

// ---------- its right-click shows it again ----------
await moveInPage(400, 1)
await until(async () => (await look()).bar === "out", 4000)
const bar = await win.locator("[data-web-bar]:visible").boundingBox()
await win.locator("[data-web-address]:visible").click({ button: "right" })
// (the field's menu opens once the clipboard's read)
const items = await until(async () => { const t = await win.locator("[role=menu] [role^=menuitem]").allInnerTexts(); return t.length ? t : null }, 3000) ?? []
check("the bar's right-click (its address, most of it): Always show page bar", items.some((t) => t.startsWith("Always show page bar")), items)
await win.locator("[role=menu] [role^=menuitem]", { hasText: "Always show page bar" }).click()
check("… the bar's back above the page", await until(async () => { const l = await look(); return l.bar === "shown" && l.page.top >= l.barBottom - 1 }, 8000), await look())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
