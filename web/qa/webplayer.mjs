// The Browser's players and full screen in the desktop app (Electron), against pages this script serves on 127.0.0.1
// (a video drawn from a canvas, no files): a page's own full screen fills the window and Esc brings it back; "Open as
// player" moves the page, playing on and not loaded again, into a window titled "Vaultite player" (full screen, or a
// window with playerFullScreen off) that it fills, its video full screen in it, drawn while the window is hidden; its
// tab says so; Esc, closing the window and Bring back return it to its tab; closing the tab closes its player; a video
// in an embedded frame fills it; the agents' op; picture in picture. Full screen takes a Space of the screen a moment.
// WRITES: the throwaway vault only.
// Pictures of the player (screencapture: the native page is in them) go to [out dir].
//   node web/qa/webplayer.mjs <vault copy> [out dir]
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, OUT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webplayer-"))
const awake = process.platform !== "darwin" ? null
  : (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake?.kill())

// ---------- made-up pages: a film in the page, and one in an embedded player of another site ----------
const FILM = `<canvas id="c" width="320" height="180" hidden></canvas><script>
const c = document.getElementById("c"), x = c.getContext("2d"); let n = 0
setInterval(() => { x.fillStyle = "hsl(" + (n++ * 5 % 360) + ",60%,50%)"; x.fillRect(0, 0, 320, 180) }, 40)
const v = document.getElementById("v"); v.srcObject = c.captureStream(25); v.play()
window.__token = Math.random(); window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick) }; tick()
</script>`
const MOVIE = `<!doctype html><title>Lighthouse, the film</title><style>body{margin:0;background:#1d1f21;color:#d6d3cc;font:16px sans-serif}
#player{width:480px;height:270px;margin:40px;position:relative}#player video{width:100%;height:100%;background:#000}#caption{position:absolute;bottom:8px;left:0;right:0;text-align:center}</style>
<h1>Lighthouse, the film</h1><div id="player"><video id="v" muted></video><div id="caption">The keeper climbs the stairs</div></div>
<button id="full" onclick="document.getElementById('player').requestFullscreen()">Full screen</button>${FILM}`
const EMBED = `<!doctype html><title>Embedded</title><style>body{margin:0}video{width:100vw;height:100vh;background:#000}</style><video id="v" muted></video>${FILM}`
const html = (res, body) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body) }
const other = http.createServer((_q, res) => html(res, EMBED))
await new Promise((ok) => other.listen(0, "127.0.0.1", ok))
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/framed")) return html(res, `<!doctype html><title>Framed</title><h1>Framed</h1>
<iframe id="f" src="http://localhost:${other.address().port}/" width="560" height="315" allowfullscreen></iframe>`)
  if (req.url?.startsWith("/text")) return html(res, "<!doctype html><title>Text</title><p>No video here.</p>")
  html(res, MOVIE)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}`

// ---------- the app ----------
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
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}

/** Where the film's page is: the vault window or its player, its bounds, and that window's. */
const where = () => app.evaluate(({ BaseWindow }) => {
  const players = BaseWindow.getAllWindows().filter((x) => x.getTitle() === "Vaultite player").length
  for (const w of BaseWindow.getAllWindows()) {
    const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && /^http:\/\/127\.0\.0\.1:\d+\/(movie|framed|text)/.test(x.webContents.getURL()))
    if (v) { const [width, height] = w.getContentSize(); return { in: w.getTitle() === "Vaultite player" ? "player" : "vault", bounds: v.getBounds(), content: { width, height }, full: w.isFullScreen(), wc: v.webContents.id, players } }
  }
  return { in: null, players }
})
const inPage = (code) => app.evaluate(({ webContents }, code) => {
  const wc = webContents.getAllWebContents().find((w) => /^http:\/\/127\.0\.0\.1:\d+\/(movie|framed|text)/.test(w.getURL()))
  return wc ? wc.executeJavaScript(code) : null
}, code)
const fills = (w) => w?.bounds && w.bounds.x === 0 && w.bounds.y === 0 && w.bounds.width === w.content.width && w.bounds.height === w.content.height
const playing = async () => { const a = await inPage("document.getElementById('v').currentTime"); await wait(600); const b = await inPage("document.getElementById('v').currentTime"); return b > a }
const key = (k) => app.evaluate(({ webContents }, k) => {
  const wc = webContents.getAllWebContents().find((w) => /^http:\/\/127\.0\.0\.1:\d+\/(movie|framed|text)/.test(w.getURL()))
  wc.sendInputEvent({ type: "keyDown", keyCode: k }); wc.sendInputEvent({ type: "keyUp", keyCode: k })
}, k)
/** A picture of the player window, into OUT. */
const shot = async (name) => {
  if (!OUT || process.platform !== "darwin") return
  const b = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player")?.getBounds())
  try { if (b) execFileSync("screencapture", ["-x", "-o", `-R${b.x},${b.y},${b.width},${b.height}`, path.join(OUT, `${name}.png`)], { stdio: "ignore" }) } catch (e) { console.log(`(no picture: ${e.message})`) }
}
const more = async (label) => {
  await win.locator("[data-web-more]").first().click(); await wait(300)
  await win.getByRole("menuitem", { name: label }).click(); await wait(300)
}

await ui({ action: "open", path: `view:web/${SITE}/movie`, newTab: true })
await until(async () => (await where()).in === "vault", 15000)
await inPage("new Promise((r) => setTimeout(r, 500))")
const token = await inPage("window.__token")
const pane = await where()
check("the film plays in its tab", await playing())

// ---------- a page's own full screen fills the window ----------
await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => /\/movie/.test(w.getURL())).executeJavaScript("document.getElementById('player').requestFullscreen()", true))
const full = await until(async () => { const w = await where(); return w.full && fills(w) ? w : null }, 5000)
check("a page's full screen fills the window, full screen", full, await where())
await wait(1200) // (the Mac's animation into its Space)
check("… still filling it once the window is full screen", fills(await where()), await where())
await key("Escape")
const back = await until(async () => { const w = await where(); return !w.full && w.bounds?.width === pane.bounds.width && w.bounds?.height === pane.bounds.height ? w : null }, 6000)
check("Esc: back in its pane, the window as it was", back, { now: await where(), pane })
await wait(1000)

// ---------- Open as player: full screen ----------
await more("Open as player")
const inPlayer = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 6000)
check("Open as player: the page fills a window titled Vaultite player", inPlayer, await where())
check("… the same page, not loaded again", inPlayer?.wc === pane.wc && (await inPage("window.__token")) === token)
check("… full screen on a Space of its own", await until(async () => (await where()).full, 4000))
check("… its video's player full screen in it (the site's captions with it)", await until(() => inPage("document.fullscreenElement?.id === 'player'"), 4000))
check("… playing on", await playing())
check("… its tab says where it is", await until(() => win.locator("[data-web-away]").count(), 3000))
await wait(1200)
check("… filling the window once it's full screen", fills(await where()), await where())
await shot("player-full")
await key("Escape")
const home = await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 && w.bounds?.width === pane.bounds.width ? w : null }, 6000)
check("Esc: back in its tab, the player closed", home, await where())
check("… the same page, playing on, out of full screen", (await inPage("window.__token")) === token && await playing() && (await inPage("!document.fullscreenElement")))
check("… the tab shows the page again", (await win.locator("[data-web-away]").count()) === 0)
await wait(1500)

// ---------- a window (playerFullScreen off), drawn while hidden; closing it brings the page back ----------
// (through the agents' op, which reads the setting on the server: the app's copy of it comes when the file's change does)
await setting({ playerFullScreen: false }); await wait(1000)
const tab = (await op("tabs")).find?.((t) => t.url.includes("/movie"))?.tab
await op("player", { tab })
const windowed = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 6000)
await wait(2000)
check("playerFullScreen off: a window of its own the page fills", windowed && !windowed.full, windowed)
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player").setSize(800, 450))
await wait(500); await shot("player-window")
check("… and fills it as it's resized", await until(async () => { const w = await where(); return fills(w) && w.content.width === 800 }, 3000), await where())
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player").minimize())
await wait(1500)
const f0 = await inPage("window.__frames"); await wait(1000); const f1 = await inPage("window.__frames")
check("… minimized, the page still draws (never throttled: a call keeps sharing it)", f1 - f0 > 20 && (await inPage("document.visibilityState")) === "visible", { frames: f1 - f0, vis: await inPage("document.visibilityState") })
check("… and plays", await playing())
await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player").restore())
await wait(500)
// (⌘W: the menu's Close tab, with the player in front)
await app.evaluate(({ BaseWindow, Menu }) => {
  const find = (items) => { for (const i of items) { if (i.label === "Close tab") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player"))
})
check("closing the player (⌘W) brings the page back to its tab", await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000), await where())
check("… the same page, playing on", (await inPage("window.__token")) === token && await playing())

// ---------- Bring back, from the tab ----------
await more("Open as player")
await until(async () => (await where()).in === "player", 5000)
await win.locator("[data-web-away-back]").click()
check("the tab's Bring back brings it back", await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000), await where())

// ---------- the agents' op ----------
const r = await op("player", { tab })
check("browser player: an agent opens a tab as a player", r.tab === tab && await until(async () => (await where()).in === "player", 5000), r)
await wait(1500)
await op("player", { tab, off: true })
check("browser player --off brings it back", await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000), await where())

// ---------- picture in picture ----------
await more("Picture in picture")
check("Picture in picture: its video in a window over every other", await until(() => inPage("document.pictureInPictureElement?.id === 'v'"), 4000))
await more("Picture in picture")
check("… and back", await until(() => inPage("!document.pictureInPictureElement"), 4000))

// ---------- closing the tab closes its player ----------
await more("Open as player")
await until(async () => (await where()).in === "player", 5000)
await ui({ action: "command", id: "tab:close" })
check("closing its tab ends the page and its player", await until(async () => (await where()).players === 0 && !(await inPage("1")), 6000), await where())

// ---------- a video in an embedded player of another site ----------
await ui({ action: "open", path: `view:web/${SITE}/framed`, newTab: true })
await until(async () => (await where()).in === "vault", 15000)
await wait(1500)
await more("Open as player")
check("an embedded player fills the player", await until(() => inPage("document.fullscreenElement?.id === 'f'"), 5000), await inPage("document.fullscreenElement?.tagName ?? null"))
await key("Escape")
await until(async () => (await where()).players === 0, 5000)

// ---------- no video: the page itself ----------
await ui({ action: "open", path: `view:web/${SITE}/text`, newTab: true })
await until(async () => (await where()).in === "vault", 15000)
await wait(1000)
await more("Open as player")
check("no video: the page itself fills the player", await until(async () => { const w = await where(); return w.in === "player" && fills(w) }, 5000) && (await inPage("!document.fullscreenElement")))
await key("Escape")
await until(async () => (await where()).players === 0, 5000)

check("no page errors", !errs.filter((e) => !/favicon|ERR_/.test(e)).length, errs.slice(0, 5))
await app.close()
// (and its terminal keeper, which outlives the app: CLAUDE.md, Running and verifying)
const port = new URL(origin).port
try { const pid = fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8").trim(); if (/^\d+$/.test(pid)) process.kill(Number(pid)) } catch { /* none */ }
try { execFileSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" }) } catch { /* none */ }
server.close(); other.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
