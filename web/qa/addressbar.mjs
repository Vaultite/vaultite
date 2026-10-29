// The Browser's address bar and ⌘T in the desktop app (Electron), against pages this script serves on 127.0.0.1 and
// localhost: what's typed stays on leaving the field and switching tabs (Esc reverts it); the chip shows where it opens
// (a site's rule) and changes while typing without losing it (⌥↓ too), the move keeping Back; a name with a port is an
// address; ⌘L from the app; Switch to tab from a new tab closes it; ⌘T completes a site and Enter (⇧Enter too) goes there.
// WRITES: the throwaway vault only.
//   node web/qa/addressbar.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-addressbar-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

const server = http.createServer((req, res) => {
  const name = (req.url ?? "/").slice(1).split(/[?#]/)[0] || "home"
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>${name[0].toUpperCase()}${name.slice(1)}</title><h1>${name}</h1>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}`, LOCAL = `localhost:${PORT}`

// (written before the app starts: what it reads then needs no file watching, which a busy Mac can drop)
const own = (rel, data) => { fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); fs.writeFileSync(path.join(VAULT, rel), JSON.stringify(data, null, 2) + "\n") }
own(".vaultite/plugins/web-viewer/data.json", { containers: [{ id: "personal", name: "Personal", color: "blue" }, { id: "work", name: "Work", color: "orange", sites: ["localhost"] }, { id: "agents", name: "Agents", color: "purple" }] })
own(".vaultite/newtab.json", { opens: "switcher" })

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const post = (url, body, method = "POST") => fetch(`${origin}/api/${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const open = async (to) => { await post("ui", { action: "open", path: to, newTab: true }); await wait(500) }

/** The visible web page: its address, its session's partition and its back history. */
const visible = () => app.evaluate(({ BaseWindow, session }) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  if (!v) return null
  const partition = ["persist:web", "persist:web-c-work", "persist:web-c-personal", "persist:web-c-agents"].find((p) => session.fromPartition(p) === v.webContents.session) ?? "?"
  const h = v.webContents.navigationHistory
  return { url: v.webContents.getURL(), title: v.webContents.getTitle(), partition, back: h.canGoBack(), past: h.getAllEntries().map((e) => e.url) }
})
const field = () => win.locator("[data-web-page] [data-web-address]:visible")
const value = () => field().inputValue()
const chip = () => win.locator("[data-web-page] [data-web-container]:visible")
const chipIs = async () => ({ id: await chip().getAttribute("data-web-container"), why: await chip().getAttribute("data-web-container-why") })
const typing = () => win.evaluate(() => !!document.activeElement?.matches("[data-web-address]"))
const tabs = () => win.locator("[role=tablist] [role=tab]").count()

// ---------- a draft is kept ----------
await open(`view:web/${SITE}/one`)
check("a page in no container", await until(async () => (await visible())?.url === `${SITE}/one`, 15000), await visible())
check("the address shows the page's (http shown, as it's not secure)", await until(async () => (await value()) === `${SITE}/one`, 5000), await value())
await field().click()
await win.keyboard.type("hello draft")
check("typing lists suggestions", await until(() => win.locator("[data-web-suggestions]").count().then((n) => n === 1), 3000), null)
await field().evaluate((el) => el.blur())
check("leaving the field keeps what's typed, the list closed", (await value()) === "hello draft" && (await win.locator("[data-web-suggestions]").count()) === 0, await value())
await open(`view:web/${SITE}/two`)
await until(async () => (await visible())?.url === `${SITE}/two`, 15000)
check("another tab: its own address", (await value()) === `${SITE}/two`, await value())
await win.locator("[role=tab]", { hasText: "One" }).first().click()
check("back on the tab: the draft is still there", await until(async () => (await value()) === "hello draft", 5000), await value())
await field().click()
check("… focused, it's selected whole", await win.evaluate(() => { const el = document.activeElement; return el?.matches("[data-web-address]") && el.selectionStart === 0 && el.selectionEnd === el.value.length }), null)
await win.keyboard.press("Escape")
await win.keyboard.press("Escape")
check("Esc (twice: the list, then the draft) puts the page's address back", await until(async () => (await value()) === `${SITE}/one`, 3000) && await typing(), await value())

// ---------- the chip shows where it opens, and changes while typing ----------
check("not typing: the chip is the tab's (none)", (await chipIs()).id === "", await chipIs())
await win.keyboard.type(`${LOCAL}/who`)
check("typing an address whose site opens in Work: the chip says Work, and why", await until(async () => { const c = await chipIs(); return c.id === "work" && /localhost always opens in Work/.test(c.why ?? "") }, 5000), { chip: await chipIs(), value: await value() })
await chip().click()
check("its menu opens, what's typed kept", await until(() => win.locator("[role=menu]").count().then((n) => n > 0), 3000) && (await value()) === `${LOCAL}/who`, await value())
const noneRow = await win.locator("[role=menu] [role^=menuitem]", { hasText: /^No container/ }).first().innerText()
check("… \"No container\" says it's the workspace's logins when there are workspaces, or is plain", /^No container( \(workspace logins\))?/.test(noneRow), noneRow)
await win.locator("[role^=menuitem]", { hasText: /^Personal/ }).click()
check("choosing Personal: the chip says Personal, what's typed still there", await until(async () => (await chipIs()).id === "personal", 3000) && (await value()) === `${LOCAL}/who`, { chip: await chipIs(), value: await value() })
check("… the keyboard back in the address", await until(typing, 3000), null)
if (!(await typing())) await field().click()
await win.keyboard.press("Alt+ArrowDown")
check("⌥↓: the next container (Work)", await until(async () => (await chipIs()).id === "work", 3000), await chipIs())
await win.keyboard.press("Alt+ArrowUp")
check("⌥↑: back to Personal", await until(async () => (await chipIs()).id === "personal", 3000) && (await value()) === `${LOCAL}/who`, { chip: await chipIs(), value: await value() })
await win.keyboard.press("Enter")
const moved = await until(async () => { const v = await visible(); return v?.url === `http://${LOCAL}/who` && v.partition === "persist:web-c-personal" && v.title === "Who" && v }, 15000)
check("Enter: it opens in Personal, the chosen one", !!moved, await visible())
check("… with its back history from before the move", !!moved && moved.back && moved.past.includes(`${SITE}/one`), moved)
check("… the address shows it, trimmed while not edited", await until(async () => (await value()) === `http://${LOCAL}/who`, 5000), await value())

// ---------- local names, ⌘L ----------
await win.locator("[role=tab][aria-selected=true]").click()
await win.keyboard.press(process.platform === "darwin" ? "Meta+L" : "Control+L")
check("⌘L with the keyboard in the app: the address", await until(typing, 3000), null)
// (on its own, whatever ⌘L did)
if (!(await typing())) await field().click()
await win.keyboard.type("nas:5000")
check("a name with a port is an address (http), not a search", await until(async () => (await win.locator("[data-suggestion]").first().getAttribute("data-url").catch(() => "")) === "http://nas:5000/", 3000),
  await win.locator("[data-suggestion]").evaluateAll((l) => l.map((e) => e.dataset.url)))
await win.keyboard.press("Escape")
await win.keyboard.press("Escape")

// ---------- Switch to tab from a new tab closes it ----------
const before = await tabs()
await open("view:web/")
await until(async () => (await tabs()) === before + 1, 5000)
await until(typing, 5000)
await win.keyboard.type("two")
const row = win.locator("[data-suggestion=tab]", { hasText: "Two" })
check("a new tab offers the open one", await until(() => row.count().then((n) => n > 0), 5000), await win.locator("[data-suggestion]").allInnerTexts())
await row.first().click()
check("… Switch to tab: there, and the new tab is gone", await until(async () => (await tabs()) === before && (await visible())?.url === `${SITE}/two`, 5000), { tabs: await tabs(), v: await visible() })

// ---------- ⌘T's launcher ----------
const SEARCH = '[role="dialog"][aria-label="Search"]'
const options = () => win.$$eval("#palette-results [role=option]", (els) => els.map((e) => e.textContent.trim()))
const newTab = () => app.evaluate(({ Menu, BaseWindow }) => {
  const find = (items) => { for (const i of items) { if (i.label === "New tab") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows()[0])
})
const t1 = await tabs()
await newTab()
await until(() => win.$(SEARCH), 8000)
await win.keyboard.type("loc")
check("⌘T: a site visited before completes inline", await until(async () => (await win.inputValue(`${SEARCH} input`)) === LOCAL, 5000), await win.inputValue(`${SEARCH} input`))
check("… its Open row first, then the search, the container where it opens shown", await until(async () => { const o = await options(); return o[0]?.startsWith(`Open ${LOCAL}`) && o[0].endsWith("Work") && /^Search the web/.test(o[1] ?? "") }, 5000), await options())
await win.keyboard.press("Alt+ArrowDown")
check("… ⌥↓ changes it", await until(async () => (await options())[0]?.endsWith("Agents"), 3000), await options())
await win.keyboard.press("Alt+ArrowUp")
await until(async () => (await options())[0]?.endsWith("Work"), 3000)
await win.keyboard.press("Enter")
check("… Enter goes to the site, in Work", await until(async () => { const v = await visible(); return v?.url === `http://${LOCAL}/` && v.partition === "persist:web-c-work" }, 10000) && (await tabs()) === t1 + 1, { v: await visible(), tabs: await tabs() })
const notes = () => fs.readdirSync(VAULT, { recursive: true }).filter((f) => String(f).includes("shifted"))
await newTab()
await until(() => win.$(SEARCH), 8000)
await win.keyboard.type(`${LOCAL}/shifted`)
await until(async () => (await options())[0]?.startsWith("Open"), 3000)
await win.keyboard.press("Shift+Enter")
check("⇧Enter on an address opens it, no note made of it", await until(async () => (await visible())?.url === `http://${LOCAL}/shifted`, 10000) && !notes().length, { v: await visible(), notes: notes() })

await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
