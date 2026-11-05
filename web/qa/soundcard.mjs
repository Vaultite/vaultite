// A page playing where its tab can't be seen, in the desktop app (Electron): a card in a corner names it
// (plugins/core/web-viewer/SoundCard.tsx), with Pause (its media paused in the page, then Play), Mute and Show tab (the
// tab in front, the card gone); its X closes it for that page till it plays again; the setting turns it off. The
// made-up page's tone is too low and deep to hear. SHOTS=<dir> keeps pictures, gruvbox dark.
// WRITES: the throwaway vault only.
//   node web/qa/soundcard.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait, keepAwake } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-soundcard-"))
keepAwake(300)

// (a looping second of a 20 Hz tone, near silent: an <audio> the page plays, as a video's would)
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
  res.end(`<!doctype html><title>Radio</title><body><script>const r = 8000, n = r, b = new ArrayBuffer(44 + n * 2), d = new DataView(b), str = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0))); str(0, "RIFF"); d.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt "); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, r, true); d.setUint32(28, r * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); str(36, "data"); d.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 20 / r) * 40, true); const a = document.createElement("audio"); a.loop = true; a.src = URL.createObjectURL(new Blob([b], { type: "audio/wav" })); document.body.append(a); a.play()</script>`)
})
await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok) })
const SITE = `http://127.0.0.1:${server.address().port}`

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_SOUND: "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const origin = new URL(win.url()).origin
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: 40, y: 40, width: 1280, height: 800 }) })
  const ui = (body) => fetch(`${origin}/api/ui`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const look = (o) => fetch(`${origin}/api/config/appearance`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
  const SHOTS = process.env.SHOTS
  const shot = async (name) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `soundcard-${name}.png`) }) }
  /** The made-up page's audio: run `code` in it (null: no such page). */
  const inPage = (code) => app.evaluate(({ webContents }, [site, code]) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(site))
    return wc ? wc.executeJavaScript(code) : null
  }, [SITE, code])
  const paused = () => inPage("document.querySelector('audio')?.paused ?? null")
  const muted = () => app.evaluate(({ webContents }, site) => webContents.getAllWebContents().find((w) => w.getURL().startsWith(site))?.isAudioMuted() ?? null, SITE)
  const card = win.locator("[data-sound-card]")
  const title = () => card.locator("[data-sound-card-title]").innerText().catch(() => "")
  const gone = (ms = 5000) => until(async () => (await card.count()) === 0, ms)

  await look({ scheme: "gruvbox", theme: "dark" })
  // The page in a tab, on screen: no card.
  await ui({ action: "open", path: `view:web/${SITE}/radio`, newTab: true })
  check("the page plays", await until(async () => (await paused()) === false, 20000), await paused())
  await wait(1500)
  check("no card while its tab is on screen", (await card.count()) === 0)
  // A note's tab in front: the page plays out of sight.
  const note = fs.readdirSync(path.join(VAULT, "Notes")).find((f) => f.endsWith(".md"))
  await ui({ action: "open", path: `Notes/${note}`, newTab: true })
  check("its tab in the background: the card shows", await until(async () => (await card.count()) === 1, 8000))
  check("…saying it plays in a hidden tab, naming the page", /Playing in a hidden tab/.test(await title()) && /Radio/.test(await card.innerText()), await card.innerText().catch(() => ""))
  check("…in the bottom right corner, clear of the status bar", await card.evaluate((el) => { const r = el.getBoundingClientRect(); return r.right > innerWidth / 2 && r.bottom < innerHeight - 30 }))
  check("…a float, the page under it still taking the pointer", (await card.getAttribute("data-floats")) === "")
  await wait(400)
  await shot("playing")

  await card.locator("[data-sound-pause]").click()
  check("Pause pauses the page's media", await until(async () => (await paused()) === true, 5000), await paused())
  check("…the card stays, offering Play", await until(async () => (await card.locator("[data-sound-play]").count()) === 1 && /Paused in a hidden tab/.test(await title()), 5000), await title())
  await shot("paused")
  await card.locator("[data-sound-play]").click()
  check("Play starts it again", await until(async () => (await paused()) === false, 5000), await paused())
  check("…and Pause is back", await until(async () => (await card.locator("[data-sound-pause]").count()) === 1, 5000))

  await card.locator("[data-sound-mute]").click()
  check("Mute mutes the tab", await until(async () => (await muted()) === true, 5000), await muted())
  check("…the card stays, offering Unmute", await until(async () => (await card.locator("[data-sound-mute][aria-label='Unmute tab']").count()) === 1, 5000))
  await card.locator("[data-sound-mute]").click()
  check("Unmute unmutes it", await until(async () => (await muted()) === false, 5000), await muted())

  await card.locator("[data-sound-show]").click()
  check("Show tab brings its tab to the front", await until(async () => (await win.locator("[data-web-page]:visible").count()) === 1, 5000))
  check("…and the card goes", await gone())
  check("…the page playing on", (await paused()) === false)

  // Out of sight again: back; closed with its X it stays away while the page plays on.
  await ui({ action: "open", path: `Notes/${note}`, newTab: true })
  check("out of sight again: the card is back", await until(async () => (await card.count()) === 1, 8000))
  await card.locator("[data-sound-close]").click()
  check("X closes it", await gone(2000))
  await wait(2000)
  check("…and it stays closed while the page plays on", (await card.count()) === 0 && (await paused()) === false)
  // Paused in the page and played again: shown again.
  await inPage("document.querySelector('audio').pause()")
  await until(async () => (await paused()) === true, 3000); await wait(1500)
  check("…still closed while it's paused", (await card.count()) === 0)
  await inPage("document.querySelector('audio').play()")
  check("…and back once it plays again", await until(async () => (await card.count()) === 1, 10000))

  // The setting off: no card.
  const data = path.join(VAULT, ".vaultite/plugins/web-viewer/data.json")
  const was = fs.existsSync(data) ? JSON.parse(fs.readFileSync(data, "utf8")) : {}
  fs.mkdirSync(path.dirname(data), { recursive: true })
  fs.writeFileSync(data, JSON.stringify({ ...was, soundCard: false }))
  check("the setting off: the card goes", await gone(10000))

  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
