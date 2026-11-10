// A new web build reaches open pages at once (core/webbuild.ts, Live.newWeb): one in view offers Reload, one hidden
// reloads into it by itself (web/src/core/builds.ts), unless something would be lost (sound playing: unsaved.ts), then
// once it isn't. Starts its own throwaway server on a copy of web/dist it rebuilds; writes nothing else.
//   node web/qa/livebuild.mjs
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, freePort, launch, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"
const { check, done } = await qa(import.meta.url, { chrome: false })

const DIST = path.join(ROOT, "web", "dist")
if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("livebuild: no web/dist (npm run build)"); process.exit(1) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vau-livebuild-"))
// The build served: a copy of web/dist's pages, its files linked (a rebuild here never touches the checkout's).
const dist = path.join(tmp, "dist")
fs.mkdirSync(path.join(dist, "assets"), { recursive: true })
for (const f of fs.readdirSync(DIST)) if (f !== "assets" && f !== "index.html") fs.symlinkSync(path.join(DIST, f), path.join(dist, f))
for (const f of fs.readdirSync(path.join(DIST, "assets"))) fs.symlinkSync(path.join(DIST, "assets", f), path.join(dist, "assets", f))
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8")
fs.writeFileSync(path.join(dist, "index.html"), html)
const entry = /<script type="module"[^>]*\ssrc="\.\/assets\/([^"]+\.js)"/.exec(html)[1]
/** A new build: the same app under another entry's name (nothing imports the entry), as a rebuild writes it. */
let builds = 0
const rebuild = () => {
  const name = entry.replace(/-[^-]+\.js$/, `-QaNewer${++builds}.js`)
  fs.copyFileSync(path.join(DIST, "assets", entry), path.join(dist, "assets", name))
  fs.writeFileSync(path.join(dist, "index.html"), html.replace(`./assets/${entry}`, `./assets/${name}`))
  return name
}

const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", path.join(tmp, "vault")], { encoding: "utf8" })
if (made.status !== 0) { console.error(`livebuild: couldn't make the sandbox\n${made.stderr || made.stdout}`); process.exit(1) }
const port = await freePort()
let log = ""
const server = testServer({
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: path.join(tmp, "vault"), VAULTITE_LOCAL: path.join(tmp, "local"), VAULTITE_WEB_DIST: dist },
})
server.stdout.on("data", (b) => { log += b })
server.stderr.on("data", (b) => { log += b })
const base = `http://127.0.0.1:${port}/`
let up = false
for (let i = 0; i < 120 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${base}api/state`)).ok } catch { await wait(250) } }
function stop() {
  if (server.exitCode === null) server.kill()
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  fs.rmSync(tmp, { recursive: true, force: true })
}
if (!up) { console.error(`livebuild: the server didn't start\n${log.slice(-2000)}`); stop(); process.exit(1) }

// (sound that plays without a tap, on muted speakers: --mute-audio)
const browser = await launch({ args: ["--autoplay-policy=no-user-gesture-required"] })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // Each page's visibility is the test's to set (headless pages are all in view): __show(false) hides it.
  await ctx.addInitScript(() => {
    let state = sessionStorage.getItem("qa.hidden") ? "hidden" : "visible"
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => state })
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => state === "hidden" })
    window.__show = (on) => { state = on ? "visible" : "hidden"; if (on) sessionStorage.removeItem("qa.hidden"); else sessionStorage.setItem("qa.hidden", "1"); document.dispatchEvent(new Event("visibilitychange")) }
  })
  const open = async () => {
    const page = await ctx.newPage()
    await page.goto(base)
    await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 30000 })
    return page
  }
  const running = (page) => page.evaluate(() => document.querySelector('script[type="module"][src*="assets/"]')?.src.split("/").pop())
  const reloads = (page) => { let n = 0; page.on("framenavigated", (f) => { if (f === page.mainFrame()) n++ }); return () => n }
  const offered = (page) => page.evaluate(() => !!document.querySelector("[data-sonner-toaster]")?.textContent.includes("A new version of Vaultite is ready"))

  const shown = await open(), hidden = await open(), playing = await open()
  await hidden.evaluate(() => window.__show(false))
  // (a page playing sound, hidden: a reload would stop it)
  await playing.evaluate(async () => {
    const rate = 8000, n = rate * 2, b = new ArrayBuffer(44 + n), v = new DataView(b)
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true)
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
    const a = Object.assign(document.createElement("audio"), { src: URL.createObjectURL(new Blob([b], { type: "audio/wav" })), loop: true, id: "qa-sound" })
    document.body.append(a)
    await a.play()
    window.__show(false)
  })
  check("the sound plays", await playing.evaluate(() => !document.getElementById("qa-sound").paused))
  await wait(1500) // (each connected)
  const shownLoads = reloads(shown), hiddenLoads = reloads(hidden), playingLoads = reloads(playing)
  const newer = rebuild()
  const t = Date.now()
  check("a page in view hears of the new build within seconds, with no reconnect", await until(() => offered(shown), 8000, 100), await shown.evaluate(() => document.body.innerText.slice(0, 300)))
  console.log(`  (told in ${Date.now() - t} ms)`)
  check("a hidden one reloads into it by itself", await until(() => hiddenLoads() > 0, 10000, 100))
  await hidden.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 30000 })
  check("and runs it", await running(hidden) === newer, await running(hidden))
  check("and isn't offered it again", !(await offered(hidden)))
  await wait(500)
  check("the one in view doesn't reload: it offers Reload", shownLoads() === 0)
  check("one playing sound waits", playingLoads() === 0)
  await playing.evaluate(() => document.getElementById("qa-sound").pause())
  check("and reloads once it stopped", await until(() => playingLoads() > 0, 10000, 100))
  await shown.evaluate(() => window.__show(false))
  check("the one in view, put away, reloads into it a moment later", await until(() => shownLoads() > 0, 8000, 100))
  await shown.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 30000 })
  check("and runs it", await running(shown) === newer, await running(shown))
  await shown.evaluate(() => window.__show(true))

  // Once a build: one it reloaded for already (a reload that didn't bring it: a cache in the way) is offered, no loop.
  const stuck = await open()
  const third = entry.replace(/-[^-]+\.js$/, `-QaNewer${builds + 1}.js`)
  await stuck.evaluate((b) => { sessionStorage.setItem("vaultite.reloadedInto", b); window.__show(false) }, third)
  const stuckLoads = reloads(stuck)
  rebuild()
  check("a hidden page it reloaded for once already is offered it", await until(() => offered(stuck), 8000, 100))
  await wait(3500)
  check("and doesn't reload again", stuckLoads() === 0)
} finally {
  await browser.close()
  stop()
}
await done()
