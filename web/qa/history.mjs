// The Browser's history, address bar and import in the desktop app (Electron), end to end on a throwaway vault,
// against made-up sites this script serves (lighthouse.test, harbor.test: 127.0.0.1): visits kept (a link's, a typed
// one's), a new web tab's address with the sites visited most, typing completing inline to a site with the list of
// suggestions over the page (frozen meanwhile), Esc, Enter, ⇧⌦ removing a history row; the History tab (search,
// several removed, Undo, Clear browsing history); ⌘Y; ⌘D; Import from Brave from tools/fixtures/browsers (visits once,
// bookmarks into Bookmarks.md, suggested in the address bar).
// WRITES: the throwaway vault only.
//   node web/qa/history.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-history-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- made-up sites ----------
const PAGES = {
  "lighthouse.test": { "/": "Lighthouse", "/docs/start": "Getting started · Lighthouse", "/docs/keys": "Keys · Lighthouse" },
  "harbor.test": { "/": "The Harbor News" },
}
const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? "").split(":")[0], title = PAGES[host]?.[new URL(req.url ?? "/", "http://x").pathname]
  res.writeHead(title ? 200 : 404, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>${title ?? "Not found"}</title><h1>${title ?? "Not found"}</h1><a id="docs" href="/docs/start">Docs</a>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const PORT = server.address().port
const at = (host, p = "/") => `http://${host}:${PORT}${p}`

// The Browser on (off by default).
const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"] }, null, 2) + "\n")
// The browsers to import from: a copy of the fixture's made-up Brave profiles.
const BROWSERS = path.join(TMP, "browsers")
fs.cpSync(path.join(ROOT, "tools/fixtures/browsers"), BROWSERS, { recursive: true })

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"),
  args: [ROOT, "--vault", VAULT, "--host-resolver-rules=MAP *.test 127.0.0.1"],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local"),
    VAULTITE_TEST_BROWSERS: BROWSERS },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const open = async (to) => { await ui({ action: "open", path: to, newTab: true }); await wait(500) }
const command = async (id) => { await ui({ action: "command", id }); await wait(700) }
const engine = (name, ...args) => win.evaluate(([name, args]) => window.vaultite.web.engine(name, ...args), [name, args])
const visits = async () => (await engine("history:list", {})).visits

/** The visible web page's address, if one is over the window. */
const visible = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.getURL() : null
})
const inPage = (code) => app.evaluate(({ BrowserWindow }, code) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v ? v.webContents.executeJavaScript(code) : null
}, code)
const address = () => win.locator("[data-web-page]:visible [data-web-address]")
/** The address field: what it shows and what of it is selected. */
const field = () => address().evaluate((el) => ({ value: el.value, sel: el.value.slice(el.selectionStart, el.selectionEnd), focused: document.activeElement === el }))
const rows = () => win.locator("[data-web-suggestions] [data-suggestion]").evaluateAll((l) => l.map((e) => `${e.dataset.suggestion} ${e.dataset.url}`))

// ---------- visits ----------
await open(`view:web/${at("lighthouse.test")}`)
check("a page opens (lighthouse.test, the host mapped to this script)", await until(async () => (await visible()) === at("lighthouse.test"), 15000), await visible())
await wait(500)
await inPage(`document.getElementById("docs").click()`)
await until(async () => (await visible()) === at("lighthouse.test", "/docs/start"), 10000)
await open(`view:web/${at("harbor.test")}`)
await until(async () => (await visible()) === at("harbor.test"), 15000)
check("visits kept: each page's, with its title", await until(async () => {
  const v = await visits()
  return v.length === 3 && v.some((x) => x.url === at("lighthouse.test", "/docs/start") && x.title === "Getting started · Lighthouse")
}, 10000), await visits())
check("… a link followed is a link, a page the app opened isn't typed", (await visits()).find((x) => x.url.endsWith("/docs/start"))?.how === "link"
  && (await visits()).every((x) => x.how !== "typed"), await visits())
check("… kept on this computer, not in the vault", fs.existsSync(path.join(TMP, "userData/web-history.sqlite")) && !fs.readdirSync(VAULT).some((f) => /history/i.test(f)), fs.readdirSync(path.join(TMP, "userData")))

// ---------- a new web tab ----------
await command("web:open")
check("Open web page: a new tab, its address ready to type", await until(async () => (await win.locator("[data-web-page]:visible [data-web-address]").count()) === 1 && (await field()).focused, 10000),
  await win.locator("[data-web-page]:visible [data-web-address]").count())
check("… with the sites visited most under it", await until(async () => (await win.locator("[data-web-start] [data-web-top]").count()) === 2, 10000),
  await win.locator("[data-web-start]").innerText().catch(() => ""))

// ---------- typing completes inline ----------
await win.keyboard.type("light")
check("typing completes inline to the site, the rest selected", await until(async () => { const f = await field(); return f.value === `lighthouse.test:${PORT}` && f.sel === `house.test:${PORT}` }, 5000), await field())
check("… and the list: the site first, the search, then the history", await until(async () => { const r = await rows(); return r[0] === `url ${at("lighthouse.test")}` && r[1]?.startsWith("search ") && r.some((x) => x === `history ${at("lighthouse.test", "/docs/start")}`) }, 5000), await rows())
await win.keyboard.type("h")
check("… typing on keeps it", await until(async () => (await field()).value === `lighthouse.test:${PORT}` && (await field()).sel === `ouse.test:${PORT}`, 5000), await field())
await win.keyboard.press("Backspace")
check("… deleting drops the completion", await until(async () => (await field()).value === "lighth", 5000), await field())
await win.keyboard.press("Escape")
check("Esc: the list closes first", await until(async () => (await win.locator("[data-web-suggestions]").count()) === 0 && (await field()).focused, 5000), await field())
await win.keyboard.type("ouse")
await until(async () => (await field()).sel === `.test:${PORT}`, 5000)
await win.keyboard.press("Enter")
check("Enter: the completed site opens in the tab", await until(async () => (await visible()) === at("lighthouse.test"), 15000), await visible())
check("… a typed visit", await until(async () => (await visits())[0]?.how === "typed" && (await visits())[0]?.url === at("lighthouse.test"), 5000), (await visits())[0])
const marks = () => { try { return fs.readFileSync(path.join(VAULT, "Bookmarks.md"), "utf8") } catch { return "" } }
await win.keyboard.press("ControlOrMeta+d")
check("⌘D: the page bookmarked in Bookmarks.md", await until(() => marks().includes(`- [Lighthouse](${at("lighthouse.test")})`), 5000), marks())

// ---------- the list over a page ----------
await command("web:address")
await win.keyboard.type("harbor")
check("over a page: the list shows, the page frozen as its picture", await until(async () => (await rows()).length > 1 && (await visible()) === null, 5000), [await rows(), await visible()])
check("… an open tab of it to switch to", (await rows()).includes(`tab ${at("harbor.test")}`), await rows())
await win.keyboard.press("Escape")
await win.keyboard.press("Escape")
check("Esc twice: the list goes, the page is back", await until(async () => (await win.locator("[data-web-suggestions]").count()) === 0 && (await visible()) === at("lighthouse.test"), 5000), await visible())

// ---------- removing a history row from the list ----------
await command("web:address")
await win.keyboard.type("getting")
await until(async () => (await rows()).includes(`history ${at("lighthouse.test", "/docs/start")}`), 5000)
const docsRow = (await rows()).indexOf(`history ${at("lighthouse.test", "/docs/start")}`)
for (let i = 0; i < docsRow; i++) await win.keyboard.press("ArrowDown")
await win.keyboard.press("Shift+Delete")
check("⇧⌦ on a history row: it leaves the history and the list", await until(async () => !(await rows()).includes(`history ${at("lighthouse.test", "/docs/start")}`)
  && !(await visits()).some((v) => v.url.endsWith("/docs/start")), 5000), [await rows(), await visits()])
await win.keyboard.press("Escape")
await win.keyboard.press("Escape")

// ---------- the History tab ----------
// (Ctrl+H off a Mac, as Chrome there)
await win.keyboard.press(process.platform === "darwin" ? "Meta+y" : "Control+h")
check("⌘Y: the History tab, by day", await until(async () => (await win.locator("[data-web-history] [data-web-history-day]").count()) === 1, 10000),
  await win.locator("[role=tab][aria-selected=true]").textContent().catch(() => ""))
const historyRows = () => win.locator("[data-web-history] [data-web-history-row]").evaluateAll((l) => l.map((e) => e.dataset.webHistoryRow))
check("… a page once a day, newest first", await until(async () => JSON.stringify(await historyRows()) === JSON.stringify([at("lighthouse.test"), at("harbor.test")]), 5000), await historyRows())
await win.locator("[data-web-history] input[type=search]").fill("harbor")
check("search: only what matches", await until(async () => JSON.stringify(await historyRows()) === JSON.stringify([at("harbor.test")]), 5000), await historyRows())
await win.locator("[data-web-history] input[type=search]").fill("")
await until(async () => (await historyRows()).length === 2, 5000)
await win.locator("[data-web-history-row]").nth(0).click({ modifiers: ["ControlOrMeta"] })
await win.locator("[data-web-history-row]").nth(1).click({ modifiers: ["ControlOrMeta"] })
await win.locator("[data-web-history-row]").nth(1).click({ button: "right" })
await win.locator("[role^=menuitem]", { hasText: "Remove from history" }).click()
check("two selected, Remove from history: both go", await until(async () => (await historyRows()).length === 0 && (await visits()).length === 0, 5000), [await historyRows(), await visits()])
check("… the empty history says so", await until(async () => (await win.locator("[data-web-history-empty]").count()) === 1, 5000), null)
await win.locator("[data-sonner-toast] button", { hasText: "Undo" }).click()
check("Undo: they're back", await until(async () => (await historyRows()).length === 2 && (await visits()).length === 3, 5000), [await historyRows(), await visits()])
await win.locator("[data-web-clear-history]").click()
await win.locator("[role=option]", { hasText: "The last hour" }).click()
await win.locator("dialog[open] button", { hasText: "Clear" }).click()
check("Clear browsing history, the last hour: none left", await until(async () => (await visits()).length === 0 && (await historyRows()).length === 0, 5000), await visits())

// ---------- import from Brave ----------
await command("web:import-brave")
check("Import from Brave: its profiles, by name", await until(async () => (await win.locator("[role=option]").allTextContents()).join("|").includes("Alice"), 5000),
  await win.locator("[role=option]").allTextContents())
await win.locator("[role=option]", { hasText: "Alice" }).click()
check("… its visits (not frames', reloads, redirects' starts, hidden or file addresses)", await until(async () => (await visits()).length === 7, 10000), await visits())
check("… said so", await until(async () => (await win.locator("[data-sonner-toast]", { hasText: "Imported 7 visits and 3 bookmarks from Brave" }).count()) === 1, 5000),
  await win.locator("[data-sonner-toast]").allTextContents())
check("… its bookmarks in Bookmarks.md, by folder", marks().includes("type: bookmarks") && marks().includes("## Bookmarks bar\n- [Lighthouse](https://lighthouse.example/)\n\n### Reading\n- [The Harbor News](https://news.example.org/)")
  && marks().includes("## Other bookmarks\n- [Tide tables](https://tides.example.com/today)") && !marks().includes("file:"), marks())
await command("web:import-brave")
await win.locator("[role=option]", { hasText: "Alice" }).click()
await wait(1500)
check("importing again adds nothing twice", (await visits()).length === 7 && marks().split("lighthouse.example/").length === 2, [(await visits()).length, marks()])
check("imported history is suggested", (await engine("history:search", "lighthouse.ex", 8)).complete?.url === "https://lighthouse.example/", await engine("history:search", "lighthouse.ex", 8))
await command("web:open")
await until(async () => (await field()).focused, 5000)
await win.keyboard.type("tide")
check("bookmarks are suggested", await until(async () => (await rows()).includes("bookmark https://tides.example.com/today"), 5000), await rows())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
