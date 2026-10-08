// Web tabs show their sites' icons (electron/web.ts fetches them, web-viewer/icons.tsx draws them): a PNG, an SVG and
// a site's own /favicon.ico each on its tab; a site whose icon isn't an image, and one whose kept icon can't be drawn,
// keep the globe; a broken icons file in userData changes nothing; the icons are kept for the next launch.
// WRITES: the throwaway vault only.
//   node web/qa/webicons.mjs <vault copy> [first port for the sites, default 8871]
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"

const { args: [VAULT, PORT_ARG], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webicons-"))
const PORT = Number(PORT_ARG || 8871)
// (each its own port: icons are kept by host, port and all)
const SITES = { png: PORT, svg: PORT + 1, ico: PORT + 2, html: PORT + 3, bad: PORT + 4 }
const at = (k) => `http://127.0.0.1:${SITES[k]}/`
const host = (k) => `127.0.0.1:${SITES[k]}`

// (a 1x1 PNG, and an ICO holding it)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0]), Buffer.from(new Uint32Array([PNG.length, 22]).buffer), PNG])
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#c33"/></svg>`
const page = (title, head = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${title}</h1></body></html>`
const servers = Object.entries(SITES).map(([k, port]) => {
  const s = http.createServer((req, res) => {
    const u = req.url ?? "/"
    if (k === "png" && u === "/icon.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG) }
    if (k === "svg" && u === "/icon.svg") { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(SVG) }
    if (k === "ico" && u === "/favicon.ico") { res.writeHead(200, { "Content-Type": "image/x-icon" }); return res.end(ICO) }
    // (an icon that's an HTML page, as a site's error page is; no /favicon.ico)
    if (k === "html" && u === "/icon.png") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(page("Not found")) }
    if (u !== "/") { res.writeHead(404); return res.end() }
    const head = { png: `<link rel="icon" href="/icon.png">`, svg: `<link rel="icon" href="/icon.svg" type="image/svg+xml">`, html: `<link rel="icon" href="/icon.png">` }[k] ?? ""
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(page(`Site ${k}`, head))
  })
  s.listen(port, "127.0.0.1")
  return s
})

// A broken icons file, and one kept icon that isn't an image (the site it's for has none of its own).
const USER_DATA = path.join(TMP, "userData")
fs.mkdirSync(USER_DATA, { recursive: true })
fs.writeFileSync(path.join(USER_DATA, "web-icons.json"), JSON.stringify({ icons: { [host("bad")]: "data:image/png;base64,AAAAAAAA", [host("png")]: "not an icon", x: 5 } }))

const launch = async () => {
  const app = await _electron.launch({
    executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
    env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: USER_DATA, VAULTITE_LOCAL: path.join(TMP, "local") },
  })
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  return { app, win, origin: new URL(win.url()).origin }
}
const open = (origin, url) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "open", path: url, newTab: true }) })
/** What a tab named `title` shows: its icon's address (an image) or "globe" (lucide's), and whether it was drawn. */
const tabIcon = (win, title) => win.evaluate((title) => {
  const t = [...document.querySelectorAll("[role=tab]")].find((x) => x.textContent?.includes(title))
  if (!t) return null
  const img = t.querySelector("img")
  if (img) return { src: img.src.slice(0, 30), drawn: img.complete && img.naturalWidth > 0 }
  return t.querySelector("svg.lucide-globe") ? { src: "globe" } : { src: "other" }
}, title)
const drawn = (win, title, mime) => until(async () => { const i = await tabIcon(win, title); return !!i?.drawn && i.src.startsWith(`data:image/${mime}`) }, 15000)

let { app, win, origin } = await launch()
for (const k of Object.keys(SITES)) { await open(origin, at(k)); await until(async () => (await win.locator("[role=tab]", { hasText: `Site ${k}` }).count()) > 0, 10000) }
check("all five web tabs opened", await until(async () => (await win.locator("[role=tab]", { hasText: "Site " }).count()) === 5, 20000))
check("a page's PNG icon is on its tab", await drawn(win, "Site png", "png"), await tabIcon(win, "Site png"))
check("a page's SVG icon is on its tab", await drawn(win, "Site svg", "svg"), await tabIcon(win, "Site svg"))
check("a site's own /favicon.ico is on its tab", await drawn(win, "Site ico", ""), await tabIcon(win, "Site ico"))
await until(async () => (await tabIcon(win, "Site bad"))?.src === "globe", 5000)
check("an icon that's an HTML page: the globe", (await tabIcon(win, "Site html"))?.src === "globe", await tabIcon(win, "Site html"))
check("a kept icon that can't be drawn: the globe", (await tabIcon(win, "Site bad"))?.src === "globe", await tabIcon(win, "Site bad"))
const kept = await until(() => {
  try { const j = JSON.parse(fs.readFileSync(path.join(USER_DATA, "web-icons.json"), "utf8")); return ["png", "svg", "ico"].every((k) => j.icons[host(k)]?.startsWith("data:image/")) && !("x" in j.icons) } catch { return false }
}, 10000)
check("the icons are kept in userData (the broken entries gone)", kept, fs.readFileSync(path.join(USER_DATA, "web-icons.json"), "utf8").slice(0, 300))

// Next launch, the sites down: a tab shows its kept icon before (without) its page loading.
await app.close()
for (const s of servers) s.close()
;({ app, win, origin } = await launch())
await until(async () => (await win.locator("[role=tab]").count()) >= 5, 15000)
const byHost = await win.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => ({ text: t.textContent?.trim(), img: !!t.querySelector("img[src^='data:image/']") })))
check("next launch, sites unreachable: kept icons still on their tabs", byHost.filter((t) => t.img).length >= 3, byHost)

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
