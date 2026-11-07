// The Browser on the web platform's surfaces a daily browser needs, in the desktop app (Electron), against pages this
// script serves on 127.0.0.1 (and localhost, another site): a click in a frame from another site opens its popup (with
// window.opener); window.open('') sent on, and a blob: page, open as tabs; a page asking to stay gets Chrome's "Leave
// site?" (and "Reload site?"), never a navigation silently dropped, while closing its tab never asks; a site's HTTP
// sign-in and prompt() ask in a sheet; getDisplayMedia shares the tab picked; a misspelled word's menu has its
// guesses; a no to opening another app isn't kept; a frame from another site keeps its cookies; a PDF shows in the tab.
// WRITES: the throwaway vault only.
//   node web/qa/webcompat.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webcompat-"))

// ---------- made-up pages ----------
const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:18px/1.6 system-ui;margin:40px}a,button,textarea{display:block;margin:10px 0;font-size:18px}iframe{width:420px;height:120px}</style></head><body>${body}</body></html>`
let PORT = 0
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64")
const server = http.createServer((req, res) => {
  const u = req.url ?? "/"
  const send = (html, type = "text/html; charset=utf-8") => { res.writeHead(200, { "Content-Type": type }); res.end(html) }
  if (u.startsWith("/child")) return send(page("Child", `<h1>Child</h1><script>document.title = "child opener=" + !!window.opener; window.opener && window.opener.postMessage("hi", "*")</script>`))
  if (u.startsWith("/inner")) return send(page("Inner", `<button id="b" onclick="window.open('http://127.0.0.1:${PORT}/child')">Sign in with Lighthouse</button>
<script>addEventListener("message", (e) => parent.postMessage("frame " + e.data, "*"))</script>`))
  if (u.startsWith("/framed")) return send(page("Framed", `<iframe id="f" src="http://localhost:${PORT}/inner"></iframe><script>addEventListener("message", (e) => { document.title = "got " + e.data })</script>`))
  if (u.startsWith("/blank")) return send(page("Blank", `<button id="b" onclick="const w = window.open(''); setTimeout(() => { w.location = '/child' }, 300)">Sign in</button>
<button id="blob" onclick="window.open(window.URL.createObjectURL(new Blob(['<title>From a blob</title><h1>Receipt</h1>'], { type: 'text/html' })))">Receipt</button>
<script>addEventListener("message", (e) => { document.title = "got " + e.data })</script>`))
  if (u.startsWith("/leave")) return send(page("Leave", `<textarea id="i">Draft</textarea><a id="a" href="/one">Somewhere else</a>
<script>addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "" })</script>`))
  if (u.startsWith("/one")) return send(page("One", "<h1>One</h1>"))
  if (u.startsWith("/ask")) return send(page("Ask", `<button id="b" onclick="document.title = 'said ' + prompt('Your name?', 'Alice')">Name</button>
<a id="zoom" href="zoommtg://zoom.us/join?confno=1">Join the call</a>
<button id="share" onclick="navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { document.title = 'sharing ' + s.getVideoTracks().length; s.getTracks().forEach((t) => t.stop()) }, (e) => { document.title = 'not shared ' + e.name })">Present</button>`))
  if (u.startsWith("/tone")) return send(page("Tone", `<h1>Tone</h1><script>window.tone = () => { const c = new AudioContext(), o = c.createOscillator(); o.connect(c.destination); o.start(); setTimeout(() => c.close(), 3000) }</script>`))
  if (u.startsWith("/room")) return send(page("Room", `<button id="share" onclick="navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(async (s) => {
  const c = new AudioContext(), a = c.createAnalyser(), d = new Float32Array(a.fftSize); let peak = 0
  if (s.getAudioTracks().length) c.createMediaStreamSource(s).connect(a)
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); a.getFloatTimeDomainData(d); for (const x of d) peak = Math.max(peak, Math.abs(x)) }
  const v = document.createElement('video'); v.muted = true; v.srcObject = s; await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 500))
  document.title = 'shared video ' + s.getVideoTracks().length + ' sound ' + s.getAudioTracks().length + (peak > 0.01 ? ' heard' : ' silent') + ' ' + (v.videoWidth > 0 ? 'frames' : 'no frames'); setTimeout(() => s.getTracks().forEach((t) => t.stop()), 2000)
}, (e) => { document.title = 'not shared ' + e.name })">Share</button>`))
  if (u.startsWith("/auth")) {
    if (req.headers.authorization === basic("alice", "pw")) return send(page("Signed in", "<h1>In</h1>"))
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Lighthouse"', "Content-Type": "text/plain" }); return res.end("")
  }
  if (u.startsWith("/storage")) return send(page("Storage", `<iframe id="f" src="http://localhost:${PORT}/3p"></iframe>`))
  if (u.startsWith("/3p")) return send(page("3p", `<script>document.cookie = "tp=1; SameSite=None; Secure"; window.__c = document.cookie</script>`))
  if (u.startsWith("/doc.pdf")) return send("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF", "application/pdf")
  send(page("Home", "<h1>Home</h1>"))
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
PORT = server.address().port
const at = (p) => `http://127.0.0.1:${PORT}${p}`

const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))

// ---------- the app ----------
const DOWNLOADS = path.join(TMP, "Downloads")
fs.mkdirSync(DOWNLOADS)
// (VAULTITE_SOUND: a driven app's --mute-audio silences a shared tab's sound for the call too; the shared tab is muted
// itself, below, so nothing reaches the speakers)
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_SOUND: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
// (Electron answers the pages' own dialogs: Playwright mustn't try to as well)
const quietDialogs = (pg) => pg.on("dialog", () => {})
app.context().pages().forEach(quietDialogs)
app.context().on("page", quietDialogs)
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
// (native boxes and menus aren't shown: what they'd ask is kept, and answered from a queue, else cancelled)
await app.evaluate(({ app: a, BaseWindow, BrowserWindow, dialog, Menu, shell }, dl) => {
  Object.assign(globalThis, { __opened: [], __asked: [], __answers: [], __menu: null })
  shell.openExternal = async (u) => { globalThis.__opened.push(u) }
  a.setPath("downloads", dl)
  const answer = (o) => { globalThis.__asked.push(o.message); return globalThis.__answers.shift() ?? { response: o.cancelId ?? 1, checkboxChecked: !!o.checkboxChecked } }
  dialog.showMessageBox = async (w, o) => answer(o ?? w)
  dialog.showMessageBoxSync = (w, o) => answer(o ?? w).response
  const build = Menu.buildFromTemplate.bind(Menu)
  Menu.buildFromTemplate = (items) => { const m = build(items); m.popup = () => { globalThis.__menu = items }; return m }
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow)); w.setBounds({ x: 40, y: 40, width: 1280, height: 800 })
}, DOWNLOADS)
const asked = () => app.evaluate(() => globalThis.__asked)
/** The next questions' answers (any left from before are dropped). */
const answerNext = (...r) => app.evaluate((_e, r) => { globalThis.__answers = r }, r)
const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const menuClick = (label) => app.evaluate(({ Menu, BaseWindow, BrowserWindow }, label) => {
  const find = (items) => { for (const i of items) { if (i.label === label) return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow)))
}, label)
/** The web pages over the window: address, title, shown. */
const pages = () => app.evaluate(({ BaseWindow, BrowserWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
  return w.contentView.children.filter((v) => v.webContents && v.webContents !== w.webContents)
    .map((v) => ({ url: v.webContents.getURL(), title: v.webContents.getTitle(), visible: v.getVisible() && v.getBounds().x > -1000 }))
})
const shown = async () => (await pages()).find((p) => p.visible)
const tabCount = () => win.evaluate(() => JSON.parse(localStorage.getItem("vaultite.tabs")).tabs.length)
/** In the main process, on the page on screen: a person's click on `sel` (another button: its menu), one in a frame
 *  from another site (routed there as the Mac's input is: sendInputEvent never reaches one), the right-click menu Blink
 *  would ask for, or what its first frame sets. */
const onShown = (what, ...args) => app.evaluate(async ({ BaseWindow, BrowserWindow }, [what, args]) => {
  const w = BaseWindow.getAllWindows().find((x) => !(x instanceof BrowserWindow))
  const wc = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && x.getBounds().x > -1000).webContents
  const box = (frame, sel) => frame.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left, r.top, r.height] })()`)
  if (what === "click") {
    const [sel, button] = args, [l, t, h] = await box(wc, sel), x = Math.round(l + 12), y = Math.round(t + h / 2)
    for (const type of ["mouseMove", "mouseDown", "mouseUp"]) wc.sendInputEvent({ type, x, y, button, clickCount: 1 })
  } else if (what === "frame click") {
    const [frameSel, sel] = args, [fx, fy] = await box(wc, frameSel), [l, t, h] = await box(wc.mainFrame.frames[0], sel), x = l + 10, y = t + h / 2
    if (!wc.debugger.isAttached()) wc.debugger.attach("1.3")
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type, x: fx + x, y: fy + y, button: "left", clickCount: 1 })
    wc.debugger.detach()
  } else if (what === "menu") wc.emit("context-menu", {}, args[0])
  else if (what === "frame value") return wc.mainFrame.frames[0]?.executeJavaScript(args[0])
}, [what, args])
const clickInPage = (sel, button = "left") => onShown("click", sel, button)
const clickInFrame = (frameSel, sel) => onShown("frame click", frameSel, sel)
/** The question sheet over the window (electron/browser/sheet.ts): its text, if one's up. */
const sheetText = () => app.evaluate(({ BrowserWindow }) => {
  const s = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith("data:text/html"))
  return s ? s.webContents.executeJavaScript("document.body.innerText") : null
})
/** Answer it: the fields' values, typed, then its button. */
const answerSheet = (values) => app.evaluate(({ BrowserWindow }, values) => {
  const s = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().startsWith("data:text/html"))
  // (submitted once this call has returned: the answer closes the sheet, and a call whose page closes under it never ends)
  return s.webContents.executeJavaScript(`(() => { for (const [k, v] of Object.entries(${JSON.stringify(values)})) document.getElementById(k).value = v; setTimeout(() => document.querySelector("form").requestSubmit(), 50) })()`)
}, values)
const open = async (p) => {
  await ui({ action: "open", path: at(p), newTab: true })
  check(`(${p} is shown)`, await until(async () => (await shown())?.url === at(p), 20000), await pages())
  await wait(500)
}
/** The share menu's items (electron/browser/screenshare.ts), once it's asked; and a click on one, by its label. */
const shareMenu = () => app.evaluate(() => (globalThis.__menu ?? []).map((i) => i.label).filter(Boolean))
const pickInMenu = (label) => app.evaluate((_e, label) => { const i = (globalThis.__menu ?? []).find((x) => x.label === label); globalThis.__menu = null; i?.click() }, label)
const titled = (t, ms = 8000) => until(async () => (await pages()).some((p) => p.title === t), ms)
const ofZoom = async () => (await asked()).filter((m) => /open zoommtg: links/.test(m)).length

// ---------- popups: a click in a frame from another site ("Sign in with Google") ----------
await open("/framed")
let n = await tabCount()
await clickInFrame("#f", "#b")
check("a click in a frame from another site: its window.open opens, with window.opener", await titled("child opener=true"), [await tabCount() - n, await pages()])
check("… which reaches its frame (postMessage)", await titled("got frame hi", 5000), await pages())

// ---------- window.open('') sent on, and a blob: page ----------
await open("/blank")
n = await tabCount()
await clickInPage("#b")
check("window.open('') sent on by its opener: a tab at that address, with window.opener", await until(async () => (await shown())?.url === at("/child") && (await shown()).title === "child opener=true", 8000)
  && (await tabCount()) === n + 1, [await tabCount() - n, await pages()])
check("… which reaches the page (postMessage)", await titled("got hi", 5000), await pages())
await open("/blank")
await clickInPage("#blob")
check("window.open of a blob: page: a tab of it", await until(async () => (await shown())?.title === "From a blob", 8000), await pages())

// ---------- a page asking to stay ----------
await open("/leave")
await clickInPage("#i")
await answerNext({ response: 1 })
await clickInPage("#a")
check("a link away from a page asking to stay: Chrome's question", await until(async () => (await asked()).includes("Leave site?"), 5000), await asked())
check("… Cancel stays", (await shown())?.url === at("/leave"), await shown())
await answerNext({ response: 0 })
await clickInPage("#a")
check("… Leave goes", await until(async () => (await shown())?.url === at("/one"), 8000), await shown())
await open("/leave")
await clickInPage("#i")
await app.evaluate(() => { globalThis.__menu = null })
await clickInPage("#a", "right")
await until(() => app.evaluate(() => !!globalThis.__menu), 5000)
await answerNext({ response: 1 })
await app.evaluate(() => globalThis.__menu.find((i) => i.label === "Reload").click())
check("its Reload asks \"Reload site?\"", await until(async () => (await asked()).includes("Reload site?"), 5000), await asked())
const before = (await asked()).length
await menuClick("Close tab")
await wait(1500)
check("closing its tab never asks", (await asked()).length === before && !(await pages()).some((p) => p.url === at("/leave")), [await asked(), await pages()])

// ---------- HTTP sign-in ----------
await ui({ action: "open", path: at("/auth"), newTab: true })
const signIn = await until(sheetText, 15000)
check("a site's HTTP sign-in: asked in a sheet, saying where (never in the site's own words)", /Sign in/.test(signIn ?? "") && signIn.includes(`127.0.0.1:${PORT} asks for a username and password`) && !/Lighthouse/.test(signIn), signIn)
await answerSheet({ username: "alice", password: "pw" })
check("… and signed in with what's typed", await titled("Signed in", 10000), await pages())

// ---------- prompt(), sharing the screen, a misspelled word, another app's link ----------
await open("/ask")
await clickInPage("#b")
const said = await until(sheetText, 8000)
check("prompt(): asked in a sheet with its message", /127\.0\.0\.1 says/.test(said ?? "") && /Your name\?/.test(said), said)
await answerSheet({ value: "Bea" })
check("… answering what's typed", await titled("said Bea"), await pages())
await app.evaluate(() => { globalThis.__menu = null })
await clickInPage("#share")
check("getDisplayMedia: asked what to share, in a menu", await until(async () => (await shareMenu()).some((m) => /wants to share/.test(m)), 5000), await shareMenu())
await pickInMenu("This tab")
check("… and shares the tab picked", await titled("sharing 1"), await pages())

// ---------- sharing another tab, with its sound (a movie into a call) ----------
await open("/tone")
await open("/room")
await app.evaluate(() => { globalThis.__menu = null })
await clickInPage("#share")
check("a call's share offers the other tabs", await until(async () => (await shareMenu()).includes("Tone") && (await shareMenu())[1] === "A tab, with its sound", 5000), await shareMenu())
await pickInMenu("Tone")
// (its tone starts once it's shared, in a tab muted (a call still hears a muted tab), and ends before the share does:
// nothing reaches the speakers)
await app.evaluate(({ webContents }) => { const w = webContents.getAllWebContents().find((x) => x.getTitle() === "Tone"); w?.setAudioMuted(true); return w?.executeJavaScript("tone()") })
check("… sharing it: its picture and its sound, while it's hidden behind the call", await until(async () => (await pages()).some((p) => /^shared video 1 sound 1 heard frames$/.test(p.title)), 12000), (await pages()).map((p) => p.title))
await open("/ask")
// (Blink marks a misspelling only in a focused window, which a quiet one never is: the menu's told one, as Blink would)
await app.evaluate(() => { globalThis.__menu = null })
await onShown("menu", { x: 60, y: 60, linkURL: "", linkText: "", srcURL: "", mediaType: "none", isEditable: true, selectionText: "Lighthuose",
  misspelledWord: "Lighthuose", dictionarySuggestions: ["Lighthouse", "Lighthouses"], editFlags: {} })
const spell = await app.evaluate(() => (globalThis.__menu ?? []).map((i) => i.label ?? i.role ?? i.type))
check("a misspelled word's menu: its guesses first, then Add to dictionary", spell[0] === "Lighthouse" && spell[1] === "Lighthouses" && spell[2] === "Add to dictionary", spell)
await answerNext({ response: 1, checkboxChecked: true })
await clickInPage("#zoom")
await until(async () => (await ofZoom()) === 1, 5000)
await answerNext({ response: 0, checkboxChecked: true })
await clickInPage("#zoom")
check("another app's link: a no isn't kept, so it asks again", await until(async () => (await ofZoom()) === 2, 5000), await asked())
check("… and a yes opens it", await until(() => app.evaluate(() => globalThis.__opened.some((u) => u.startsWith("zoommtg:"))), 5000))
await clickInPage("#zoom")
await wait(1000)
check("… kept: it opens again without asking", (await ofZoom()) === 2 && (await app.evaluate(() => globalThis.__opened.filter((u) => u.startsWith("zoommtg:")).length)) === 2, await asked())

// ---------- what already works as in Chrome ----------
await open("/storage")
const cookie = await until(() => onShown("frame value", "window.__c"), 5000)
check("a frame from another site keeps its cookies", cookie === "tp=1", cookie)
await ui({ action: "open", path: at("/doc.pdf"), newTab: true })
check("a PDF shows in its tab, not downloaded", await until(async () => (await shown())?.url === at("/doc.pdf"), 10000) && !fs.readdirSync(DOWNLOADS).length, [await shown(), fs.readdirSync(DOWNLOADS)])

await app.close().catch(() => {})
server.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
