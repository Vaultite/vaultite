// Shields in the desktop app (Electron), end to end on a throwaway vault, against a made-up site this script serves on
// 127.0.0.1 and a small filter list of its own (VAULTITE_ADBLOCK_LISTS: no network): an ad script's request never
// reaches the site and the page's Shields button counts it, a site's hiding rule, a generic one (on an element added
// later) and a procedural one (:has-text) hide their elements, a scriptlet runs before the page's own first script; "Shields for 127.0.0.1" off in the
// button's menu reloads the page with nothing blocked and keeps the site in the plugin's settings, on again blocks
// again; the Shields setting off blocks nothing anywhere.
// WRITES: the throwaway vault only.
//   node web/qa/adblock.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-adblock-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- a made-up site with an ad, things to hide and a scriptlet's target ----------
let adHits = 0
const server = http.createServer((req, res) => {
  const u = new URL(req.url ?? "/", "http://127.0.0.1")
  if (u.pathname.startsWith("/ads/")) { adHits++; res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("document.documentElement.dataset.ad = 'ran'") }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>News</title>
<p id="flag"></p><script>document.getElementById("flag").textContent = String(window.adsAllowed)</script>
<div class="ad-box" id="box">An ad</div><p id="story">The story</p>
<div class="promo" id="promo">Sponsored: a boat</div><div class="promo" id="promo2">More stories</div>
<script src="/ads/banner.js"></script>
<script>addEventListener("load", () => setTimeout(() => { const d = document.createElement("div"); d.className = "sponsor-slot"; d.id = "late"; d.textContent = "Sponsored"; document.body.append(d) }, 300))</script>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}/`

const LISTS = path.join(TMP, "lists")
fs.mkdirSync(LISTS)
fs.writeFileSync(path.join(LISTS, "filters.txt"), ["/ads/banner.js$script", "127.0.0.1##.ad-box", "##.sponsor-slot", "127.0.0.1##.promo:has-text(Sponsored)", "127.0.0.1##+js(vaultite-flag, adsAllowed, no)"].join("\n"))
fs.writeFileSync(path.join(LISTS, "resources.json"), JSON.stringify({ redirects: [], scriptlets: [
  { name: "vaultite-flag.js", aliases: [], body: "function vaultiteFlag(name, value) { window[name] = value }", dependencies: [] },
] }))

const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"],
  disabled: (plugins.disabled ?? []).filter((x) => x !== "web-viewer") }, null, 2) + "\n")
const dataFile = path.join(VAULT, ".vaultite/plugins/web-viewer/data.json")

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local"),
    VAULTITE_ADBLOCK_LISTS: LISTS },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus() })
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })

/** What the visible page shows: the scriptlet's flag, whether its ad ran, and what's hidden. */
const seen = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  return v?.webContents.executeJavaScript(`(() => { const shown = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display !== "none" : null }
    return { url: location.href, flag: document.getElementById("flag")?.textContent, ad: document.documentElement.dataset.ad ?? "", box: shown("box"), story: shown("story"), late: shown("late"), promo: shown("promo"), promo2: shown("promo2") } })()`) ?? null
})
const reload = () => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())?.webContents.reload()
})
const blocked = (s) => s?.flag === "no" && s.ad === "" && s.box === false && s.story === true && s.late === false && s.promo === false && s.promo2 === true
const open = (s) => s?.flag === "undefined" && s.ad === "ran" && s.box === true && s.late === true && s.promo === true
const button = win.locator("[data-web-shields]")

// The lists are built as the app starts: a page opened before then loads unblocked, and blocks once reloaded.
await ui({ action: "open", path: `view:web/${SITE}` })
check("a page opens", await until(async () => (await seen())?.url === SITE, 20000), await seen())
await until(async () => { await reload(); await wait(1200); return blocked(await seen()) }, 20000, 500)
const before = adHits
await reload()
check("Shields: the scriptlet ran first, the ad's request was blocked, the hiding rules hide (a procedural one too)", await until(async () => blocked(await seen()), 10000), await seen())
check("… the ad never reached the site", adHits === before, adHits - before)
check("… the bar's Shields button counts it", await until(async () => (await button.getAttribute("data-count").catch(() => "")) === "1", 10000),
  [await button.getAttribute("data-count").catch(() => null), await button.getAttribute("data-web-shields").catch(() => null)])

// ---------- Shields down for the site, from its menu ----------
await button.click()
const item = win.locator("[role^=menuitem]", { hasText: /^Shields for 127\.0\.0\.1/ })
check("the menu says what was blocked and has the site's switch", await until(async () => (await item.count()) === 1, 5000)
  && (await win.getByText("1 request blocked on this page").count()) === 1, await win.locator("[role=menu]").innerText().catch(() => ""))
await item.click()
check("Shields down: the page reloads with nothing blocked", await until(async () => open(await seen()), 10000), await seen())
check("… the site kept in the plugin's settings", await until(() => JSON.parse(fs.readFileSync(dataFile, "utf8")).shieldsDown?.includes("127.0.0.1"), 5000),
  fs.existsSync(dataFile) && fs.readFileSync(dataFile, "utf8"))
check("… and the button says so", await until(async () => (await button.getAttribute("data-web-shields")) === "down", 5000), await button.getAttribute("data-web-shields"))
await button.click()
await win.locator("[role^=menuitem]", { hasText: /^Shields for 127\.0\.0\.1/ }).click()
check("Shields up again: blocked again", await until(async () => blocked(await seen()), 10000), await seen())
check("… the site out of the settings", await until(() => !JSON.parse(fs.readFileSync(dataFile, "utf8")).shieldsDown?.length, 5000), fs.readFileSync(dataFile, "utf8"))

// ---------- the setting ----------
await setting({ shields: false })
await wait(1500)
await reload()
check("Shields off: nothing blocked anywhere", await until(async () => open(await seen()), 10000), await seen())
await setting({ shields: null })
await wait(1500)
await reload()
check("… on again: blocked", await until(async () => blocked(await seen()), 10000), await seen())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
