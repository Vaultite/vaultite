// Dark pages in the desktop app's Browser: light sites darkened across loads and processes, dark and styled ones left be.
// Needs the desktop app; serves made-up sites locally, shots to web/qa/shots/darkpages-*.png. WRITES only the throwaway vault.
//   node web/qa/darkpages.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, SHOTS, qa, until, wait, keepAwake, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-darkpages-"))
keepAwake(600)

const PICTURE = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="60" height="60" fill="#ff0000"/><rect x="60" width="60" height="60" fill="#ffffff"/></svg>`)
const LIGHT = `<!doctype html><title>Light</title>
<style>body { margin: 0; font: 16px sans-serif; color: #222; background: #fff } header { position: fixed; top: 0; left: 0; right: 0; height: 40px; background: #f6f8fa }
main { padding: 60px 20px; height: 2000px } a { color: #0969da } #pic, #cv, #vid { display: block; margin: 10px 0 }</style>
<header>Header</header><main><h1 id="title">A light page</h1><p>Text with <a href="#">a link</a>.</p>
<img id="pic" width="120" height="60" src="data:image/svg+xml,${PICTURE}"><canvas id="cv" width="120" height="60"></canvas><video id="vid" width="120" height="60" muted></video></main>
<script>const c = document.getElementById("cv").getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, 120, 60); c.fillStyle = "#000"; c.fillRect(0, 0, 60, 60)</script>`
const NATIVE = `<!doctype html><title>Dark itself</title><meta name="color-scheme" content="light dark">
<style>body { margin: 0; font: 16px sans-serif; background: #fff; color: #222 } @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3 } }</style>
<main style="padding: 60px 20px"><h1>Dark of itself</h1><img id="pic" width="120" height="60" src="data:image/svg+xml,${PICTURE}"></main>`
const SLOW_HEAD = `<!doctype html><title>Slow</title><style>body { margin: 0; background: #fff; color: #222; font: 16px sans-serif }</style>`
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/late")) return void setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(LIGHT) }, 600)
  if (req.url.startsWith("/isolated")) return void (res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin" }), res.end(LIGHT))
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
  if (req.url.startsWith("/native")) return res.end(NATIVE)
  if (req.url.startsWith("/editor")) return res.end(`<!doctype html><title>Editor</title><body class="editor" style="margin: 0"><main style="padding: 60px 20px; height: 2000px"><h1>Editor</h1></main>`)
  if (req.url.startsWith("/framed")) return res.end(`<!doctype html><style>body { margin: 0; background: #fff }</style><iframe id="fr" src="http://[::1]:${PORT}/inner" style="border: 0; width: 600px; height: 300px; margin: 60px 20px"></iframe>`)
  if (req.url.startsWith("/inner")) return res.end(`<!doctype html><style>body { margin: 0; background: #fff; color: #222 }</style><p>Another site's frame</p>`)
  if (req.url.startsWith("/slow")) { res.write(SLOW_HEAD); setTimeout(() => res.end(`<main style="padding: 60px 20px; height: 2000px"><h1>Slow</h1><p>Words.</p></main>`), 900); return }
  res.end(LIGHT)
})
// (on every address: [::1] is another site to 127.0.0.1, so its frame is a process of its own)
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, ok) })
const PORT = server.address().port
const SITE = `http://127.0.0.1:${PORT}/`, STYLED = `http://localhost:${PORT}/`

const pluginsFile = path.join(VAULT, ".vaultite/plugins.json")
const plugins = fs.existsSync(pluginsFile) ? JSON.parse(fs.readFileSync(pluginsFile, "utf8")) : {}
fs.mkdirSync(path.dirname(pluginsFile), { recursive: true })
fs.writeFileSync(pluginsFile, JSON.stringify({ ...plugins, enabled: [...(plugins.enabled ?? []).filter((x) => x !== "web-viewer"), "web-viewer"],
  disabled: (plugins.disabled ?? []).filter((x) => x !== "web-viewer") }, null, 2) + "\n")
const APPEARANCE = path.join(VAULT, ".vaultite/appearance.json")
const look = fs.existsSync(APPEARANCE) ? JSON.parse(fs.readFileSync(APPEARANCE, "utf8")) : {}
const setLook = (l) => fs.writeFileSync(APPEARANCE, JSON.stringify({ ...look, ...l }, null, 2) + "\n")
setLook({ theme: "dark", scheme: "gruvbox" })
const STYLE = path.join(VAULT, ".vaultite/plugins/web-viewer/sites/localhost.css")
fs.mkdirSync(path.dirname(STYLE), { recursive: true })
const EDITOR_ONLY = "body.editor { background: rgb(10, 80, 10) }\n"
fs.writeFileSync(STYLE, EDITOR_ONLY)
const SETTINGS = path.join(VAULT, ".vaultite/plugins/web-viewer/data.json")
const settings = () => (fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, "utf8")) : {})
{ const { darkPages, darkPagesLook, darkPagesOff, unstyled, ...rest } = settings(); fs.writeFileSync(SETTINGS, JSON.stringify(rest, null, 2) + "\n") }

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
// (a view's colour has no getter: kept as it's set)
await app.evaluate(({ WebContentsView }) => {
  const set = WebContentsView.prototype.setBackgroundColor
  WebContentsView.prototype.setBackgroundColor = function (c) { this.qaColor = c; return set.call(this, c) }
})
const ui = (body) => uiAt(origin)(body)

const onView = (fn, arg) => app.evaluate(({ BaseWindow }, [fn, arg]) => {
  const w = BaseWindow.getAllWindows()[0]
  const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible())
  // eslint-disable-next-line no-new-func
  return v ? new Function("v", "arg", `return (${fn})(v, arg)`)(v, arg) : null
}, [String(fn), arg])
const inPage = (code) => onView((v, code) => v.webContents.executeJavaScript(code), code)
const pixels = async (points, shot) => {
  const got = await onView(async (v, [points, shot]) => {
    const img = await v.webContents.capturePage()
    if (img.isEmpty()) return null
    const { width } = img.getSize(), scale = width / v.getBounds().width, bmp = img.toBitmap()
    return { png: shot ? img.toPNG().toString("base64") : "",
      at: points.map(([x, y]) => { const i = (Math.round(y * scale) * width + Math.round(x * scale)) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]] }) }
  }, [points, !!shot])
  if (got?.png) fs.writeFileSync(shot, Buffer.from(got.png, "base64"))
  return got?.at ?? null
}
const near = (a, b, d = 12) => !!a && a.every((x, i) => Math.abs(x - b[i]) <= d)
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const GRUVBOX = hex("#1d2021"), NORD = hex("#2e3440")
const rect = (sel) => inPage(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)] })()`)
const filter = () => inPage("getComputedStyle(document.documentElement).filter")
const shotOf = (name) => path.join(SHOTS, `darkpages-${name}.png`)
fs.mkdirSync(SHOTS, { recursive: true })
const open = async (url) => {
  await ui({ action: "open", path: `view:web/${url}` })
  return until(async () => (await inPage("location.href")) === url && (await inPage("document.readyState")) === "complete", 20000)
}
const light = async (shot) => {
  const [px, py] = await rect("#pic"), [cx, cy] = await rect("#cv")
  const [bg, red, canvasWhite, canvasBlack] = await pixels([[900, 300], [px + 20, py + 30], [cx + 90, cy + 30], [cx + 20, cy + 30]], shot && shotOf(shot)) ?? []
  return { bg, red, canvasWhite, canvasBlack }
}

check("a light site opens", await open(SITE), await inPage("location.href"))
check("… darkened in the theme's colours: gruvbox's background", await until(async () => near((await light())?.bg, GRUVBOX), 10000), await light())
const l = await light("theme")
check("… its picture as it is, not inverted (red stays red)", l.red && l.red[0] > 150 && l.red[1] < 110 && l.red[2] < 110, l)
check("… its canvas goes with the page (white drawn dark, black light)", l.canvasWhite && l.canvasWhite[0] < 70 && l.canvasBlack[0] > 150, l)
check("… its video and picture take no filter of their own", (await inPage(`["#pic", "#vid"].map((s) => getComputedStyle(document.querySelector(s)).filter).join()`)) === "none,none",
  await inPage(`["#pic", "#vid"].map((s) => getComputedStyle(document.querySelector(s)).filter).join()`))
check("… the page says it prefers dark", await inPage("matchMedia('(prefers-color-scheme: dark)').matches"))
check("… its fixed header stays at the top as it scrolls", await (async () => {
  await inPage("scrollTo(0, 600)"); await wait(300)
  const top = await inPage("document.querySelector('header').getBoundingClientRect().top"); await inPage("scrollTo(0, 0)")
  return top === 0
})())
const viewColor = () => onView((v) => v.qaColor ?? null)
check("its view's colour (under what it leaves unpainted) is the theme's, not white", /^#1d2021$/i.test(await viewColor() ?? ""), await viewColor())

check("a light site framing another opens", await open(`${SITE}framed`))
const inner = async (shot) => (await pixels([[300, 250]], shot && shotOf(shot)))?.[0]
check("… the other site's frame is darkened too", await until(async () => near(await inner(), GRUVBOX), 10000), await inner())
await inner("frame")

check("a site with a dark look of its own opens", await open(`${SITE}native`))
const nativeBg = async (shot) => (await pixels([[900, 300]], shot && shotOf(shot)))?.[0]
check("… shows its own dark, untinted", await until(async () => near(await nativeBg(), hex("#0d1117"), 4), 10000), await nativeBg())
await nativeBg("native")
check("… and takes no filter", (await filter()) === "none", await filter())

const OTHER = `http://[::1]:${PORT}/late`
const goes = async (url) => {
  await inPage(`location.href = ${JSON.stringify(url)}`)
  return until(async () => (await inPage("location.href").catch(() => "")) === url && (await inPage("document.readyState").catch(() => "")) === "complete", 20000)
}
await open(SITE)
for (let i = 0; i < 3; i++) {
  check(`a link to the same site's next page loads (${i + 1})`, await goes(`${SITE}?next=${i}`))
  check(`… darkened, not tinted light (${i + 1})`, await until(async () => near((await light())?.bg, GRUVBOX), 5000), await light(i ? "" : "next"))
  check(`its address typed in loads (${i + 1})`, await open(`${SITE}?typed=${i}`))
  check(`… darkened, not tinted light (${i + 1})`, await until(async () => near((await light())?.bg, GRUVBOX), 5000), await light())
}
for (const [from, what] of [[`${SITE}native`, "a site dark of itself"], [SITE, "a light site"]]) {
  for (let i = 0; i < 3; i++) {
    await open(from)
    check(`from ${what}, a link to a light site elsewhere loads (${i + 1})`, await goes(OTHER))
    check(`… darkened, not tinted light (${i + 1})`, await until(async () => near((await light())?.bg, GRUVBOX), 5000), await light(i ? "" : "crosssite"))
    check(`… the page says it prefers dark (${i + 1})`, await inPage("matchMedia('(prefers-color-scheme: dark)').matches"))
  }
}
for (let i = 0; i < 2; i++) {
  await open(SITE)
  const url = `${SITE}isolated?${i}`
  check(`a page of the same site with a process of its own loads (${i + 1})`, await goes(url))
  check(`… darkened, not tinted light (${i + 1})`, await until(async () => near((await light())?.bg, GRUVBOX), 5000), await light(i ? "" : "isolated"))
}
for (let i = 0; i < 3; i++) {
  await open(SITE)
  const url = `${OTHER}?tab=${i}`
  await inPage(`{ const a = document.createElement("a"); a.href = ${JSON.stringify(url)}; a.target = "_blank"; a.textContent = "link"
    a.style.cssText = "position: fixed; z-index: 99; left: 0; top: 0; width: 200px; height: 100px; display: block"; document.body.append(a) }`)
  await wait(300)
  // (clicked as a person would: a page opens a tab only on the user's input)
  await onView((v) => { for (const type of ["mouseDown", "mouseUp"]) v.webContents.sendInputEvent({ type, x: 50, y: 50, button: "left", clickCount: 1 }) })
  check(`a link opening a light site elsewhere in a new tab loads (${i + 1})`, await until(async () => (await inPage("location.href").catch(() => "")) === url
    && (await inPage("document.readyState").catch(() => "")) === "complete", 20000), await inPage("location.href").catch(() => ""))
  check(`… darkened, not tinted light (${i + 1})`, await until(async () => near((await light())?.bg, GRUVBOX), 5000), await light(i ? "" : "newtab"))
}

const styledBg = async (shot) => (await pixels([[900, 300]], shot && shotOf(shot)))?.[0]
check("a styled site's styled page opens", await open(`${STYLED}editor`))
check("… shows its style alone, no dark pages", await until(async () => near(await styledBg(), [10, 80, 10], 4) && (await filter()) === "none", 10000), [await styledBg(), await filter()])
await styledBg("styled")
check("its page the style leaves light opens", await open(STYLED))
check("… darkened in the theme's colours", await until(async () => near(await styledBg(), GRUVBOX) && (await filter()) !== "none", 10000), [await styledBg(), await filter()])
await inPage("window.__styledKept = 1")
fs.writeFileSync(STYLE, "body { background: rgb(10, 80, 10) }\n")
check("… a style now making it dark: its style alone, no reload", await until(async () => near(await styledBg(), [10, 80, 10], 4) && (await filter()) === "none", 10000)
  && (await inPage("window.__styledKept ?? 0")) === 1, [await styledBg(), await filter()])
fs.writeFileSync(STYLE, EDITOR_ONLY)
check("… light again as the style goes: darkened again", await until(async () => near(await styledBg(), GRUVBOX) && (await filter()) !== "none", 10000), [await styledBg(), await filter()])

// (from its own site: leaving another's, Chromium drops the left page's auto dark a moment before the new one commits)
await open(SITE)
const frames = []
await ui({ action: "open", path: `view:web/${SITE}slow` })
const end = Date.now() + 3000
while (Date.now() < end) {
  const f = await pixels([[600, 300], [900, 500], [600, 700]]).catch(() => null)
  if (f) frames.push(f)
  if (frames.length > 3 && (await inPage("document.readyState").catch(() => "")) === "complete") break
  await wait(20)
}
const bright = frames.filter((f) => f.some((p) => p[0] + p[1] + p[2] > 600))
check("a slow site never shows a white frame while it loads", frames.length > 3 && !bright.length, { frames: frames.length, bright: bright.slice(0, 3) })
check("… and loaded, it's dark", near((await pixels([[600, 300]]))?.[0], GRUVBOX), await pixels([[600, 300]]))

check("the light site again", await open(SITE))
await until(async () => near((await light())?.bg, GRUVBOX), 10000)
const button = win.locator("[data-web-shields]")
const item = win.locator("[role^=menuitem]", { hasText: "Dark pages for 127.0.0.1" })
await until(() => button.count(), 10000)
await button.click()
check("the Shields menu has Dark pages for the site, on", await until(() => item.count(), 5000) && (await item.getAttribute("aria-checked")) === "true",
  await win.locator("[role=menu]").allInnerTexts().catch(() => []))
await inPage("window.__kept = 1")
await item.click()
check("turned off: the site as it makes itself, at once, kept in darkPagesOff", await until(async () => near((await light())?.bg, [255, 255, 255], 4), 10000)
  && (await filter()) === "none" && (settings().darkPagesOff ?? []).includes("127.0.0.1"), [await light(), settings().darkPagesOff])
check("… its view's colour white again", /^#ffffff$/i.test(await viewColor() ?? ""), await viewColor())
await button.click()
await item.click()
check("… and on again, no reload", await until(async () => near((await light())?.bg, GRUVBOX), 10000) && (await inPage("window.__kept")) === 1, await light())

setLook({ theme: "dark", scheme: "nord" })
check("another colour scheme: the page follows at once, no reload", await until(async () => near((await light())?.bg, NORD), 10000) && (await inPage("window.__kept")) === 1, await light())
await light("nord")
setLook({ theme: "light", scheme: "gruvbox" })
check("a light look: pages as their sites make them", await until(async () => near((await light())?.bg, [255, 255, 255], 4), 10000) && (await filter()) === "none", await light())
check("… the page's prefers-color-scheme left to the system", await inPage(`matchMedia("(prefers-color-scheme: dark)").matches`) === await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors))
setLook({ theme: "dark", scheme: "gruvbox" })
check("dark again: darkened again", await until(async () => near((await light())?.bg, GRUVBOX), 10000))

fs.writeFileSync(SETTINGS, JSON.stringify({ ...settings(), darkPagesLook: "dark" }, null, 2) + "\n")
check("plain dark: Chromium's dark, no tint", await until(async () => (await filter()) === "none" && near((await light())?.bg, [18, 18, 18], 10), 10000), [await filter(), await light()])
await light("dark")
fs.writeFileSync(SETTINGS, JSON.stringify({ ...settings(), darkPagesLook: null, darkPages: false }, null, 2) + "\n")
check("Dark pages off: pages as their sites make them", await until(async () => near((await light())?.bg, [255, 255, 255], 4), 10000), await light())

console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
await app.close()
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
