// The Browser's players and full screen in the desktop app (Electron), against pages this script serves on 127.0.0.1
// (a video drawn from a canvas, a video file, no files of the vault): a page's own full screen fills the window and Esc
// brings it back; "Open as player" moves the page, playing on and not loaded again, into a window titled "Vaultite
// player" with no title bar, at its video's aspect, the video filling it edge to edge (letterboxed when it's another
// shape), its controls showing with the pointer at its top (whatever its page does); one left with no page closes; the
// page's full screen and the window's are one; it reopens where it was; Bring back, closing it and the agents' op; a
// video in an embedded frame; picture in picture.
// YOUTUBE=1 adds a YouTube video (the network). Full screen is played at (VAULTITE_QUIET), never a Space taken.
// WRITES: the throwaway vault only. Frames of the player (its page and its bar, as drawn) go to [out dir].
//   node web/qa/webplayer.mjs <vault copy> [out dir]
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { app as appOf } from "./lib/app.mjs"
import { ROOT, qa, until, wait, keepAwake, uiAt } from "./lib/qa.mjs"
import { stopTerminals } from "../../tools/test/lib.ts"

const { args: [VAULT, OUT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
if (OUT) fs.mkdirSync(OUT, { recursive: true })
const MAC = process.platform === "darwin"
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-webplayer-"))
keepAwake(600)

// ---------- made-up pages: a film in the page, one in an embedded player of another site, a video file ----------
const FILM = `<canvas id="c" width="320" height="180" hidden></canvas><script>
const c = document.getElementById("c"), x = c.getContext("2d"); let n = 0
setInterval(() => { x.fillStyle = "hsl(" + (n++ * 5 % 360) + ",60%,50%)"; x.fillRect(0, 0, c.width, c.height) }, 40)
const v = document.getElementById("v"); v.srcObject = c.captureStream(25); v.play()
window.__token = Math.random(); window.__frames = 0; const tick = () => { window.__frames++; requestAnimationFrame(tick) }; tick()
</script>`
const MOVIE = `<!doctype html><title>Lighthouse, the film</title><style>body{margin:0;background:#1d1f21;color:#d6d3cc;font:16px sans-serif;height:3000px}
#player{width:480px;height:270px;margin:40px;position:relative}#player video{width:100%;height:100%;background:#000}#caption{position:absolute;bottom:8px;left:0;right:0;text-align:center}
header{position:fixed;top:0;left:0;right:0;height:56px;background:#333;z-index:2020}</style><header></header>
<h1>Lighthouse, the film</h1><div id="player"><video id="v" muted></video><div id="caption">The keeper climbs the stairs</div></div>
<button id="full" onclick="document.getElementById('player').requestFullscreen()">Full screen</button>${FILM}`
const EMBED = `<!doctype html><title>Embedded</title><style>body{margin:0}video{width:100vw;height:100vh;background:#000}</style><video id="v" muted></video>${FILM}`
const CLIP = path.join(TMP, "clip.webm")
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x2e86c1:d=60:s=320x240:r=15", "-c:v", "libvpx-vp9", "-b:v", "100k", CLIP])
const html = (res, body) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(body) }
const other = http.createServer((_q, res) => html(res, EMBED))
await new Promise((ok) => other.listen(0, "127.0.0.1", ok))
const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/framed")) return html(res, `<!doctype html><title>Framed</title><h1>Framed</h1>
<iframe id="f" src="http://localhost:${other.address().port}/" width="560" height="315" allowfullscreen></iframe>`)
  if (req.url?.startsWith("/text")) return html(res, "<!doctype html><title>Text</title><p>No video here.</p>")
  if (req.url?.startsWith("/clip")) { res.writeHead(200, { "Content-Type": "video/webm" }); return res.end(fs.readFileSync(CLIP)) }
  html(res, MOVIE)
})
await new Promise((ok) => server.listen(0, "127.0.0.1", ok))
const SITE = `http://127.0.0.1:${server.address().port}`
const OURS = /^http:\/\/127\.0\.0\.1:\d+\/(movie|framed|text|clip)|youtube\.com\/watch/

// ---------- the app ----------
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = await app.firstWindow(), vault = appOf(win)
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }); w.focus()
  // (the Mac's traffic lights as the player shows them)
  globalThis.__lights = []
  const vis = BaseWindow.prototype.setWindowButtonVisibility
  if (vis) BaseWindow.prototype.setWindowButtonVisibility = function (on) { if (this.getTitle() === "Vaultite player") globalThis.__lights.push(on); return vis.call(this, on) }
})
const ui = (body) => uiAt(origin)(body)
const setting = (o) => fetch(`${origin}/api/config/plugin/web-viewer`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
const op = async (id, params) => {
  const r = await fetch(`${origin}/api/ops/web-viewer.${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "mcp", "X-Vaultite-Agent": "claude-code" }, body: JSON.stringify(params ?? {}) })
  const j = await r.json().catch(() => ({}))
  return r.ok ? (j.result ?? j) : { error: j.error ?? r.status, status: r.status }
}

/** Where the test's page is: the vault window or its player, its bounds, that window's, and the player's bar. */
const where = () => app.evaluate(({ BaseWindow }, src) => {
  const re = new RegExp(src)
  const players = BaseWindow.getAllWindows().filter((x) => x.getTitle() === "Vaultite player").length
  for (const w of BaseWindow.getAllWindows()) {
    const v = w.contentView.children.find((x) => x.webContents && x.webContents !== w.webContents && x.getVisible() && re.test(x.webContents.getURL()))
    if (v) {
      const [width, height] = w.getContentSize(), bar = w.contentView.children.find((x) => x.webContents?.getURL().startsWith("data:"))
      return { in: w.getTitle() === "Vaultite player" ? "player" : "vault", bounds: v.getBounds(), content: { width, height }, frame: w.getBounds(), at: w.getContentBounds(),
        full: w.isFullScreen(), wc: v.webContents.id, players, bar: bar ? { shown: bar.getVisible(), bounds: bar.getBounds(), top: w.contentView.children.at(-1) === bar } : null }
    }
  }
  return { in: null, players }
}, OURS.source)
const inPage = (code) => app.evaluate(({ webContents }, [code, src]) => {
  const wc = webContents.getAllWebContents().find((w) => new RegExp(src).test(w.getURL()))
  return wc ? wc.executeJavaScript(code, true) : null
}, [code, OURS.source])
/** Whether the test's page is still open (asked of the main process: a page being closed may never answer a script). */
const pageOpen = () => app.evaluate(({ webContents }, src) => webContents.getAllWebContents().some((w) => !w.isDestroyed() && new RegExp(src).test(w.getURL())), OURS.source)
const fills = (w) => w?.bounds && w.bounds.x === 0 && w.bounds.y === 0 && w.bounds.width === w.content.width && w.bounds.height === w.content.height
const playing = async () => { const a = await inPage("document.querySelector('video').currentTime"); return !!await until(async () => (await inPage("document.querySelector('video').currentTime")) > a, 3000) }
const send = (events) => app.evaluate(({ webContents }, [events, src]) => {
  const wc = webContents.getAllWebContents().find((w) => new RegExp(src).test(w.getURL()))
  for (const e of events) wc.sendInputEvent(e)
}, [events, OURS.source])
const key = (k) => send([{ type: "keyDown", keyCode: k }, { type: "char", keyCode: k }, { type: "keyUp", keyCode: k }])
const player = (fn, arg) => app.evaluate(({ BaseWindow }, [fn, arg]) => {
  const w = BaseWindow.getAllWindows().find((x) => x.getTitle() === "Vaultite player")
  return w ? new Function("w", "arg", `return (${fn})(w, arg)`)(w, arg) : null
}, [fn.toString(), arg])
/** The player's page as drawn: its size and the colour at points across it (`pts`: fractions of it), saved to OUT as `name`. */
const frame = async (name, pts) => {
  const r = await app.evaluate(async ({ BaseWindow }, [src, pts]) => {
    const w = BaseWindow.getAllWindows().find((x) => x.getTitle() === "Vaultite player")
    const v = w?.contentView.children.find((x) => new RegExp(src).test(x.webContents?.getURL() ?? ""))
    if (!v) return null
    const img = await v.webContents.capturePage(), { width, height } = img.getSize(), px = img.toBitmap()
    const at = ([fx, fy]) => { const x = Math.min(width - 1, Math.round(fx * (width - 1))), y = Math.min(height - 1, Math.round(fy * (height - 1))), i = (y * width + x) * 4; return [px[i + 2], px[i + 1], px[i]] }
    return { width, height, colours: pts.map(at), png: img.toPNG().toString("base64") }
  }, [OURS.source, pts])
  if (r && OUT) fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.png, "base64"))
  return r
}
/** The frame once `ok` holds of its colours (within 3 s), else the last: frames at a new size may take a while to come,
 *  with a software renderer under load. */
const settled = async (name, pts, ok) => (await until(async () => { const f = await frame(name, pts); return f && ok(f.colours) ? f : null }, 3000)) ?? frame(name, pts)
const black = (c) => c && c.every((x) => x < 12)
const film = (c) => c && !black(c) && !(Math.abs(c[0] - 0x1d) < 6 && Math.abs(c[1] - 0x1f) < 6 && Math.abs(c[2] - 0x21) < 6) && Math.max(...c) - Math.min(...c) > 40
const near = (a, b, d = 2) => Math.abs(a - b) <= d
/** Resized in steps as a drag does, whether `sel` fills the page in the first frame drawn at each new size. */
const steady = async (sel) => {
  for (const width of [640, 700, 780, 860, 960, 900, 820, 740]) {
    await player((w, width) => w.setContentSize(width, Math.round(width * 9 / 16)), width)
    const ok = await inPage(`new Promise((r) => { const end = performance.now() + 1000; const tick = () => {
      if (innerWidth !== ${width} && performance.now() < end) return requestAnimationFrame(tick)
      const v = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()
      r(Math.abs(v.width - innerWidth) < 2 && Math.abs(v.height - innerHeight) < 2 && innerWidth === ${width} || JSON.stringify([v, innerWidth, innerHeight])) }; tick() })`)
    if (ok !== true) { console.log(`  (at ${width}: ${ok})`); return false }
  }
  return true
}
const more = async (label) => {
  await win.locator("[data-web-more]:visible").first().click()
  await win.getByRole("menuitem", { name: label }).click(); await vault.idle()
}
const back = async () => {
  await app.evaluate(({ BaseWindow, Menu }) => {
    const find = (items) => { for (const i of items) { if (i.label === "Close tab") return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }
    find(Menu.getApplicationMenu().items).click(undefined, BaseWindow.getAllWindows().find((w) => w.getTitle() === "Vaultite player"))
  })
  return until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000)
}

await ui({ action: "open", path: `view:web/${SITE}/movie`, newTab: true })
await until(async () => (await where()).in === "vault", 15000)
await until(() => inPage("document.querySelector('video')?.currentTime > 0"), 5000)
const token = await inPage("window.__token")
const pane = await where()
check("the film plays in its tab", await playing())

// ---------- a page's own full screen fills the window ----------
await inPage("document.getElementById('player').requestFullscreen()")
const full = await until(async () => { const w = await where(); return w.full && fills(w) ? w : null }, 5000)
check("a page's full screen fills the window, full screen", full, await where())
await key("Escape")
const home0 = await until(async () => { const w = await where(); return !w.full && w.bounds?.width === pane.bounds.width && w.bounds?.height === pane.bounds.height ? w : null }, 6000)
check("Esc: back in its pane, the window as it was", home0, { now: await where(), pane })
await vault.idle()

// ---------- Open as player: a window at its video's aspect, the video filling it ----------
const t0 = Date.now()
await more("Open as player")
const opened = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 6000)
console.log(`  (open as player: ${Date.now() - t0} ms, the menu's click included)`)
check("Open as player: the page fills a window titled Vaultite player", opened, await where())
check("… a window, not full screen", opened && !opened.full)
check("… no title bar: its page from the window's very top", opened && opened.frame.height === opened.content.height && opened.frame.y === opened.at.y, opened)
check("… at its video's aspect (16:9)", opened && near(opened.content.width / opened.content.height, 16 / 9, 0.02), opened?.content)
check("… the same page, not loaded again", opened?.wc === pane.wc && (await inPage("window.__token")) === token)
check("… playing on", await playing())
check("… its tab says where it is", await until(() => win.locator("[data-web-away]").count(), 3000))
check("… its video fills the page, the site's player around it (its captions as the site styles them), nothing of the page over it", await inPage(`(() => {
  const v = document.getElementById("v").getBoundingClientRect(), p = document.getElementById("player")
  return p.matches(":popover-open") && v.left === 0 && v.top === 0 && v.width === innerWidth && v.height === innerHeight && document.elementFromPoint(innerWidth / 2, 20) !== document.querySelector("header")
    && getComputedStyle(document.getElementById("caption")).color === "rgb(214, 211, 204)"
})()`))
const f1 = await settled("1-player", [[0.01, 0.01], [0.99, 0.01], [0.5, 0.5], [0.01, 0.99], [0.99, 0.99]], (c) => c.every(film))
check("… drawn edge to edge, no gap at any corner", f1 && f1.colours.every(film), f1?.colours)

// ---------- its controls show with the pointer at its top ----------
check("its controls are hidden at first", opened && !opened.bar?.shown && (!MAC || (await app.evaluate(() => globalThis.__lights)).at(-1) === false), opened?.bar)
const strip = (await where()).at
// (the pointer alone, no event from the page: the window watches it itself, whatever its page does)
await app.evaluate((_e, at) => { globalThis.qaPointer = at }, { x: strip.x + 200, y: strip.y + 10 })
const shown = await until(async () => { const w = await where(); return w.bar?.shown ? w : null }, 2000)
check("the pointer at its top shows its controls: a bar over the page, the width of the window", shown?.bar.top && shown.bar.bounds.width === shown.content.width && shown.bar.bounds.y === 0, shown?.bar)
if (MAC) check("… and the Mac's traffic lights", (await app.evaluate(() => globalThis.__lights)).at(-1) === true)
const barShot = await app.evaluate(async ({ BaseWindow }) => {
  const w = BaseWindow.getAllWindows().find((x) => x.getTitle() === "Vaultite player")
  const bar = w.contentView.children.find((x) => x.webContents?.getURL().startsWith("data:"))
  return { drag: await bar.webContents.executeJavaScript("getComputedStyle(document.body).webkitAppRegion"), png: (await bar.webContents.capturePage()).toPNG().toString("base64") }
})
if (OUT) fs.writeFileSync(path.join(OUT, "2-bar.png"), Buffer.from(barShot.png, "base64"))
check("… which drags the window", barShot.drag === "drag", barShot.drag)
await app.evaluate((_e, at) => { globalThis.qaPointer = at }, { x: strip.x + 200, y: strip.y + 200 })
check("the pointer leaving the top hides them", await until(async () => !(await where()).bar?.shown, 2000) && (!MAC || (await app.evaluate(() => globalThis.__lights)).at(-1) === false))
await app.evaluate(() => { globalThis.qaPointer = { x: -9999, y: -9999 } })

check("resized step by step, its video fills it at every step", await steady("#v"))

// ---------- resized to another shape: letterboxed, never the page showing ----------
await player((w) => w.setContentSize(800, 600))
check("resized, its page fills it", await until(async () => { const w = await where(); return fills(w) && w.content.width === 800 && w.content.height === 600 }, 3000), await where())
const boxed = (c) => black(c[0]) && film(c[1]) && black(c[2]) && film(c[3]) && film(c[4])
const f2 = await settled("3-letterbox", [[0.5, 0.02], [0.5, 0.5], [0.5, 0.98], [0.02, 0.5], [0.98, 0.5]], boxed)
check("… the video letterboxed in black, centred", f2 && boxed(f2.colours), f2?.colours)
const r0 = await player((w) => w.getContentBounds())

// ---------- the page's full screen and the window's are one ----------
check("the player holds the site's box over the page", await until(() => inPage("!!document.querySelector('[data-vaultite-player]:popover-open')"), 4000))
await inPage("document.querySelector('[data-vaultite-player]').requestFullscreen()")
const pf = await until(async () => { const w = await where(); return w.full && fills(w) && w.content.width > 800 ? w : null }, 4000)
check("the site's full screen takes the window full screen, the page filling it", pf, await where())
check("… its controls not shown there", pf && !pf.bar?.shown)
await inPage("document.exitFullscreen()")
const pr = await until(async () => { const w = await where(); return !w.full && w.in === "player" ? w : null }, 4000)
check("leaving it brings the window back as it was", pr && pr.at.width === r0.width && pr.at.height === r0.height && pr.at.x === r0.x && pr.at.y === r0.y, { pr: pr?.at, r0 })
check("… still a player, the video filling it", pr && fills(pr) && await until(() => inPage("document.getElementById('player').matches(':popover-open')"), 2000))
await player((w) => w.setFullScreen(true))
check("the window's full screen (its green button)", await until(async () => { const w = await where(); return w.full && fills(w) && w.content.width > 800 }, 3000), await where())
await key("Escape")
const pe = await until(async () => { const w = await where(); return !w.full && w.in === "player" ? w : null }, 4000)
check("… Esc leaves it, the window as it was, still a player", pe && pe.at.width === r0.width && pe.at.height === r0.height, pe?.at)
await inPage("window.__escs = 0; addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escs++ }, true)")
await key("Escape")
await until(() => inPage("window.__escs > 0"), 3000)
check("Esc in a window does nothing to it", (await where()).in === "player")
await player((w) => w.setFullScreen(true)); await until(async () => (await where()).full, 3000)
await inPage("document.getElementById('player').requestFullscreen()"); await until(() => inPage("!!document.fullscreenElement"), 3000)
await player((w) => w.setFullScreen(false))
check("the window leaving full screen takes the page's out too", await until(() => inPage("!document.fullscreenElement"), 3000) && !(await where()).full)
check("the site's own full screen button, from the window: full screen and back", await (async () => {
  await inPage("document.getElementById('full').click()") // (the page's button: inside the player, under the fill)
  // (the window goes full screen before the page is told it is: exitFullscreen before that throws)
  // (a window manager's full screen may take a while: a slow one fails this check, not the script)
  const a = await until(async () => (await where()).full && await inPage("!!document.fullscreenElement"), 6000)
  return !!a && await inPage("document.exitFullscreen().then(() => true, () => false)") && await until(async () => !(await where()).full, 3000)
})())

// ---------- its aspect follows the video ----------
await player((w) => w.setContentSize(960, 540)); await until(async () => { const w = await where(); return w.content.width === 960 && w.content.height === 540 }, 3000)
await inPage("document.getElementById('c').width = 240")
check("the video turning 4:3, the window follows, keeping its width", await until(async () => { const w = await where(); return w.content.width === 960 && near(w.content.height, 720) }, 4000), (await where()).content)

await inPage("(() => { const o = document.getElementById('v'), n = document.createElement('video'); n.id = 'v'; n.muted = true; n.srcObject = o.srcObject; o.replaceWith(n); n.play() })()")
check("its site replacing the video, the new one fills it", await until(() => inPage("(() => { const r = document.getElementById('v').getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight })()"), 4000))

// ---------- closing it: back in its tab; the next opens where it was ----------
await player((w) => w.setContentBounds({ x: 200, y: 160, width: 640, height: 480 })); await until(async () => JSON.stringify((await where()).at) === JSON.stringify({ x: 200, y: 160, width: 640, height: 480 }), 3000)
check("closing the player (⌘W) brings the page back to its tab", await back(), await where())
check("… the same page, playing on, its video back in the page", (await inPage("window.__token")) === token && await playing() && await inPage("!document.getElementById('player').hasAttribute('popover') && !document.querySelector('[data-vaultite-player]')"))
await more("Open as player")
const again = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 5000)
check("the next player opens where the last one was", again && again.at.x === 200 && again.at.y === 160 && again.at.width === 640 && again.at.height === 480, again?.at)
await win.locator("[data-web-away-back]").click()
check("the tab's Bring back brings it back", await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000), await where())
await inPage("document.getElementById('c').width = 320")

// ---------- minimized, it draws on ----------
const tab = (await op("tabs")).find?.((t) => t.url.includes("/movie"))?.tab
await op("player", { tab })
await until(async () => (await where()).in === "player", 5000)
await player((w) => w.minimize()); await until(() => player((w) => w.isMinimized()), 3000)
// (the frames drawn in a second: the check is its frame rate)
const fr0 = await inPage("window.__frames"); await wait(1000); const fr1 = await inPage("window.__frames")
check("minimized, the page still draws (never throttled: a call keeps sharing it)", fr1 - fr0 > 20 && (await inPage("document.visibilityState")) === "visible", { frames: fr1 - fr0 })
await player((w) => w.restore()); await until(async () => !(await player((w) => w.isMinimized())), 5000)
await op("player", { tab, off: true })
check("browser player --off brings it back", await until(async () => { const w = await where(); return w.in === "vault" && w.players === 0 }, 5000), await where())

// ---------- a player left with no page closes, its page back in its tab ----------
await op("player", { tab })
await until(async () => (await where()).in === "player", 5000)
await player((w) => { for (const v of w.contentView.children) if (!v.webContents?.getURL().startsWith("data:")) w.contentView.removeChildView(v) })
check("a player whose page left it without closing it closes itself", await until(async () => (await where()).players === 0, 4000), await where())
check("… its page back in its tab, still playing", await until(async () => (await where()).in === "vault", 3000) && await playing(), await where())

// ---------- full screen: the agents' flag and the setting ----------
await op("player", { tab, fullScreen: true })
check("browser player --full-screen opens it full screen", await until(async () => { const w = await where(); return w.in === "player" && w.full && fills(w) }, 5000), await where())
await back()
await setting({ playerFullScreen: true })
await op("player", { tab })
check("playerFullScreen on: full screen", await until(async () => { const w = await where(); return w.in === "player" && w.full }, 5000), await where())
await back()
await setting({ playerFullScreen: false })

// ---------- picture in picture ----------
// (quiet, the video is marked rather than put in the system's window over the user's work: electron/player.ts' PIP)
const inPip = "!!document.querySelector('#v[data-vaultite-pip]')"
await more("Picture in picture")
check("Picture in picture: its video in a window over every other", await until(() => inPage(inPip), 4000))
await more("Picture in picture")
check("… and back", await until(() => inPage(`!(${inPip})`), 4000))

// ---------- closing the tab closes its player ----------
await more("Open as player")
await until(async () => (await where()).in === "player", 5000)
await ui({ action: "command", id: "tab:close" })
check("closing its tab ends the page and its player", await until(async () => (await where()).players === 0 && !(await pageOpen()), 6000), await where())

// ---------- a video file ----------
await ui({ action: "open", path: `view:web/${SITE}/clip.webm`, newTab: true })
await until(async () => (await where()).in === "vault" && await inPage("document.querySelector('video')?.readyState >= 2"), 15000)
await more("Open as player")
const clip = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 5000)
check("a video file: a player at its aspect (4:3)", clip && near(clip.content.width / clip.content.height, 4 / 3, 0.02), clip?.content)
const f3 = await settled("4-file", [[0.01, 0.01], [0.99, 0.01], [0.5, 0.5], [0.01, 0.99], [0.99, 0.99]], (c) => c.every((x) => !black(x)))
check("… drawn edge to edge", f3 && f3.colours.every((c) => !black(c)), f3?.colours)
await back()
await ui({ action: "command", id: "tab:close" }); await until(async () => !(await pageOpen()), 6000)

// ---------- a video in an embedded player of another site ----------
await ui({ action: "open", path: `view:web/${SITE}/framed`, newTab: true })
await until(async () => (await where()).in === "vault", 15000)
await until(() => app.evaluate(({ webContents }, src) => {
  const wc = webContents.getAllWebContents().find((w) => new RegExp(src).test(w.getURL()))
  const f = wc?.mainFrame.framesInSubtree.find((x) => x.url.startsWith("http://localhost"))
  return f ? f.executeJavaScript("document.querySelector('video')?.readyState >= 2") : false
}, OURS.source), 10000)
await more("Open as player")
check("an embedded player fills the player", await until(() => inPage("(() => { const f = document.getElementById('f'), r = f.getBoundingClientRect(); return f.matches(':popover-open') && r.width === innerWidth && r.height === innerHeight })()"), 5000))
await back()
await ui({ action: "command", id: "tab:close" }); await until(async () => !(await pageOpen()), 6000)

// ---------- no video: the page itself ----------
await ui({ action: "open", path: `view:web/${SITE}/text`, newTab: true })
await until(async () => (await where()).in === "vault" && await inPage("document.readyState === 'complete'"), 15000)
await vault.idle()
await more("Open as player")
check("no video: the page itself fills the player", await until(async () => { const w = await where(); return w.in === "player" && fills(w) }, 5000) && (await inPage("!document.fullscreenElement")))
await back()
await ui({ action: "command", id: "tab:close" }); await until(async () => !(await pageOpen()), 6000)

// ---------- YouTube (YOUTUBE=1: the network) ----------
if (process.env.YOUTUBE) {
  const YT = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
  await ui({ action: "open", path: `view:web/${YT}`, newTab: true })
  // (an extension this Mac forces on may gate the site: out of this run's pages only)
  const gated = await until(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => /^chrome-extension:.*youtube/.test(w.getURL()))?.id), 8000)
  if (gated) await app.evaluate(({ webContents }, [id, to]) => {
    const wc = webContents.fromId(id), ext = new URL(wc.getURL()).host
    wc.session.extensions.removeExtension(ext)
    return wc.loadURL(to).catch(() => {})
  }, [gated, YT])
  const ready = await until(() => inPage("(() => { const v = document.querySelector('#movie_player video'); return !!v && v.readyState >= 2 && !v.paused })()"), 40000, 500)
  check("YouTube: its video plays in its tab", ready && await playing(), await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL())))
  const ytab = (await op("tabs")).find?.((t) => t.url.includes("youtube.com"))?.tab
  const y0 = Date.now()
  await op("player", { tab: ytab })
  const yt = await until(async () => { const w = await where(); return w.in === "player" && fills(w) ? w : null }, 8000)
  console.log(`  (YouTube as player: ${Date.now() - y0} ms)`)
  check("YouTube: a player at its aspect", yt && near(yt.content.width / yt.content.height, 16 / 9, 0.03), yt?.content)
  const fy = await settled("5-youtube", [[0.02, 0.1], [0.98, 0.1], [0.5, 0.5], [0.02, 0.9], [0.98, 0.9]], (c) => c.filter((x) => !black(x)).length >= 4)
  check("… its video filling it", await until(() => inPage("(() => { const r = document.querySelector('#movie_player video').getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 2 && Math.abs(r.height - innerHeight) < 2 && r.top === 0 })()"), 3000), await inPage("JSON.stringify([document.querySelector('#movie_player video').getBoundingClientRect(), innerWidth, innerHeight, document.querySelectorAll('#movie_player video').length])"))
  check("… drawn edge to edge", fy && fy.colours.filter((c) => !black(c)).length >= 4, fy?.colours)
    check("… resized step by step, its video fills it at every step, never waiting on YouTube's own layout", await steady("#movie_player video"))
  const ybox = (await where()).at
  await wait(2500) // (YouTube's keys answer a while after the resizes, by no sign it gives)
  await key("F")
  const fOk = await until(async () => (await where()).full, 4000) && await inPage("!!document.fullscreenElement")
  if (!fOk) console.log("  DIAG", await inPage("JSON.stringify({ act: document.activeElement?.tagName + '#' + document.activeElement?.id, fs: document.fullscreenElement?.tagName, ad: !!document.querySelector('.ad-showing'), paused: document.querySelector('#movie_player video').paused, state: document.getElementById('movie_player')?.getPlayerState?.() })"))
  check("… F: YouTube's full screen, the window's too", fOk)
  check("… its video filling the screen", await until(() => inPage("(() => { const r = document.querySelector('#movie_player video').getBoundingClientRect(); return Math.abs(r.width - innerWidth) < 2 || Math.abs(r.height - innerHeight) < 2 })()"), 3000))
  await settled("6-youtube-full", [[0.5, 0.5]], (c) => !black(c[0]))
  await key("F")
  const yb = await until(async () => { const w = await where(); return !w.full ? w : null }, 4000)
  check("… F again: the window as it was, its video filling it", yb && yb.at.width === ybox.width && yb.at.height === ybox.height && await until(() => inPage("document.querySelector('[data-vaultite-player]')?.matches(':popover-open')"), 2000), yb?.at)
  await settled("7-youtube-back", [[0.5, 0.5]], (c) => !black(c[0]))
  await back()
}

check("no page errors", !errs.filter((e) => !/favicon|ERR_|youtube|google/i.test(e)).length, errs.slice(0, 5))
await app.close()
// (and its terminal keeper, which outlives the app: CLAUDE.md, Running and verifying)
stopTerminals(new URL(origin).port)
server.close(); other.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
