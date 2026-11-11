// A page playing where its tab can't be seen, in the desktop app (Electron): folded into a tab group, the group's chip
// (the tab bar) and its row (the sidebar) show a speaker (plugins/core/web-viewer/soundmarks.ts), whose menu shows the
// tab, pauses it (electron/web.ts `pause`, its media paused in the page) and plays it again; a split's row in the
// sidebar shows the speaker in its pane's cell. The made-up page's tone is too low and deep to hear.
// WRITES: the throwaway vault only.
//   node web/qa/soundmarks.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { ROOT, command, qa, until, wait, keepAwake, uiAt } from "./lib/qa.mjs"

const { args: [VAULT], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-soundmarks-"))
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
  const ui = (body) => uiAt(origin)(body)
  const look = (o) => fetch(`${origin}/api/config/appearance`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) })
  const SHOTS = process.env.SHOTS
  const shot = async (name) => { if (SHOTS) await win.screenshot({ path: path.join(SHOTS, `soundmarks-${name}.png`) }) }
  /** Whether the made-up page's audio is paused (null: no such page). */
  const paused = () => app.evaluate(({ webContents }, site) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith(site))
    return wc ? wc.executeJavaScript("document.querySelector('audio')?.paused ?? null") : null
  }, SITE)
  const menuItems = () => win.locator("[role=menu] [role^=menuitem]").allInnerTexts()
  const item = (label) => win.locator("[role=menu] [role^=menuitem]", { hasText: new RegExp(`^${label}`) }).first()

  // The page in a tab, a note's tab after it (on screen), the page's tab in a group of its own, folded.
  await ui({ action: "open", path: `view:web/${SITE}/radio`, newTab: true })
  const chipOf = (label) => win.locator("[data-tab-strip] [data-tab-id]", { has: win.locator("[role=tab]", { hasText: label }) }).first()
  check("the page plays: a speaker on its tab", await until(async () => (await chipOf("Radio").locator("svg.lucide-volume-2").count()) === 1, 20000),
    [await win.locator("[data-tab-strip]").innerText(), await paused()])
  await shot("playing")
  const note = fs.readdirSync(path.join(VAULT, "Notes")).find((f) => f.endsWith(".md"))
  await ui({ action: "open", path: `Notes/${note}`, newTab: true }); await wait(800)
  await chipOf("Radio").click({ button: "right" })
  await item("Add tab to new group").click(); await wait(400)
  await win.keyboard.press("Escape"); await wait(300)
  const chip = win.locator("[data-group-chip]").first()
  await chip.click()
  check("its group folds", await until(async () => (await chip.getAttribute("aria-expanded")) === "false", 3000))
  const chipMark = chip.locator("[data-icon-action]")
  check("the folded group's chip shows a speaker", await until(async () => (await chipMark.count()) === 1 && /Playing: Radio/.test(await chipMark.getAttribute("aria-label")), 5000),
    await chip.innerHTML())
  await shot("chip")
  await chipMark.click(); await wait(300)
  const items = await menuItems()
  check("…its menu: Show tab, Pause, Mute tab", ["Show tab", "Pause", "Mute tab"].every((l) => items.some((t) => t.startsWith(l))), items)
  check("…and the group stays folded", (await chip.getAttribute("aria-expanded")) === "false")
  await item("Pause").click()
  check("Pause pauses the page's media", await until(async () => (await paused()) === true, 5000), await paused())
  check("…the mark says paused", await until(async () => /Paused: Radio/.test(await chipMark.getAttribute("aria-label") ?? ""), 5000))
  await chipMark.click(); await wait(300)
  check("…its menu has Play", (await menuItems()).some((t) => t.startsWith("Play")), await menuItems())
  await item("Play").click()
  check("Play starts it again", await until(async () => (await paused()) === false, 5000), await paused())
  check("…the speaker is back", await until(async () => /Playing: Radio/.test(await chipMark.getAttribute("aria-label") ?? ""), 8000))

  // The tabs in the sidebar: the group's row has it too.
  await look({ tabBar: false })
  if (!(await win.locator("[data-tabs-panel]").count())) await command(win, "Show tabs in the sidebar")
  const row = win.locator("[data-group-row]").first()
  check("the sidebar's folded group row shows the speaker", await until(async () => (await row.locator("button[aria-label^='Playing: Radio']").count()) === 1, 8000))
  await shot("row")
  await row.locator("button[aria-label^='Playing: Radio']").click(); await wait(300)
  await item("Show tab").click()
  check("…Show tab shows it", await until(async () => (await win.locator("[data-web-page]:visible").count()) === 1, 5000))

  // A split: the page beside the note, its cell in the split's row shows its speaker.
  await command(win, "Split right"); await wait(300)
  await ui({ action: "open", path: `Notes/${note}` }); await wait(800)
  const cell = win.locator("[data-tabs-panel] [data-split-map] [data-pane-half]", { has: win.locator("svg.lucide-volume-2") })
  check("a split's row shows the speaker in the playing pane's cell", await until(async () => (await cell.count()) === 1, 8000),
    await win.locator("[data-tabs-panel] [data-split-map]").innerHTML().catch(() => ""))
  await shot("split")

  console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
} finally {
  await app.close()
  server.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
