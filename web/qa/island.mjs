// The island by the notch (electron/island.ts, knockhelper.ts) in the desktop app, unseen: a session knocks, its line
// comes up right of the notch (a 15-inch MacBook Air's, Vorssaint's island over it as read there), waits its grace for
// Not now, is told and stays as the session's presence; Not now puts it off; another app's island wide moves ours to
// its right. The screen helper is stood in for. WRITES: throwaway vault only.   node web/qa/island.mjs <vault copy> [png]
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, PNG], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the island is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-island-"))
fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "companion"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "companion", "data.json"), JSON.stringify({ agent: "nobody", sounds: false, voice: "off" }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_QA_STILL: "2500", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
const win = watch(await app.firstWindow(), { console: true })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const port = new URL(win.url()).port
const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
const op = (id, body) => fetch(`http://127.0.0.1:${port}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())
check("the helper runs with the app", await helper(() => true))
// (as the M4's screen.swift read them: the notch, Vorssaint's island at rest over it and its corner window)
const notch = { x: 646, y: 0, width: 179, height: 32 }
const vors = (x, width, height = 32) => ({ window: 1, bundle: "com.vorssaint.utils", name: "Vorssaint", layer: 26, seen: true, vaultite: false, frame: { x, y: 0, width, height } })
// (on this display, as Electron has it here: the stand-in's notch is matched by the display's frame)
const display = await app.evaluate(({ screen }) => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds)
// (and its status items, Control Center's, from 951)
const items = [951, 999, 1033, 1071].map((x) => ({ window: x, bundle: "com.apple.controlcenter", name: "Control Center", layer: 25, seen: true, vaultite: false, frame: { x: display.x + x, y: 0, width: 38, height: 33 } }))
await helper((h, a) => { h.stub("notch", { screens: [{ frame: a.d, notch: { ...a.notch, x: a.d.x + 646 } }] }); h.stub("windows", { windows: [a.v, a.corner, ...a.items] }) },
  { d: display, notch, items, v: vors(display.x + 645, 179), corner: { ...vors(0, 40, 40), frame: { x: 0, y: 916, width: 40, height: 40 }, seen: false } })
await wait(1500)

const k = await op("companion.knock", { line: "Tests pass: ready for you to look", who: "Lighthouse", urgency: "normal" })
check("a session knocks", k.state === "waiting", k)
const island = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html#island")), 10000)
// (all read at once as it comes: its grace is a few seconds)
const came = !!island && await until(() => island.evaluate(() => { const k = document.querySelector("[data-island-knock]")
  return k && { text: k.textContent, later: !!document.querySelector("[data-island-later]"), grace: !!document.querySelector(".island-grace"), card: !!document.querySelector(".island-card [data-island-knock]") } }), 8000, 50)
check("at a pause its line comes up in the island", /Lighthouse.*ready for you/.test(came?.text ?? ""), came ?? await helper((h) => h.island()))
const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.getBounds())
check("…right of the notch, joined to it (its window tucked under it), at the top", bounds?.x === display.x + 646 + 179 - 14 - 330 && bounds?.y === display.y, bounds)
check("…with Not now, and its grace draining", came?.later && came.grace)
check("…below the bar, as the status items leave its line no room beside the notch", came?.card)
if (PNG) { await wait(400); fs.writeFileSync(PNG, (await island.screenshot({ omitBackground: true }))) }
check("its grace over, it's told: the island shows its session needing them", await until(() => helper((h) => h.island().knocks.find((x) => x.state === "told")), 6000) &&
  await until(() => island.evaluate(() => document.querySelector("[data-island-face][data-state='needs you']") && !document.querySelector("[data-island-knock]")), 4000))
if (PNG) { await wait(600); fs.writeFileSync(PNG.replace(/\.png$/, "-rest.png"), (await island.screenshot({ omitBackground: true }))) }
const told = await op("companion.knocks", {})
check("…and the server has it told", told.knocks.some((x) => x.id === k.id && x.state === "told"), told.knocks)

// ---------- a Talk key let go over a session by the notch: its words typed into its terminal
const term = await op("terminal.start", { command: "cat", name: "island-cat" })
const tid = term.id ?? term.terminal
check("a terminal to talk to", typeof tid === "string", term)
await op("companion.knock", { line: "Which branch?", who: "Cat", terminal: tid, urgency: "high" })
await until(() => helper((h) => h.island().knocks.find((x) => x.who === "Cat" && x.state === "told")), 10000)
const face = await until(() => island.evaluate((id) => { const r = document.querySelector(`[data-island-at="${id}"]`)?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, tid), 4000)
const wb = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.getBounds())
const at = face && wb ? { x: wb.x + face.x, y: wb.y + face.y } : null
check("the island tells where each session shows", !!at && (await helper((h, p) => h.island(p).at, at)) === tid, { at, wb, face })
check("words let go over it go to that session, not the companion", await helper((h, a) => h.islandSaid("use main", a.x, a.y), at))
check("…typed into its terminal", await until(async () => /use main/.test(JSON.stringify(await op("terminal.capture", { id: tid }))), 6000))
check("…and its knock is answered", await until(async () => (await op("companion.knocks", {})).knocks.find((x) => x.who === "Cat")?.state === "opened", 4000))
await op("terminal.end", { id: tid })

// ---------- Not now: off till their next break
const k2 = await op("companion.knock", { line: "Which account should the deploy use?", who: "Deploy", urgency: "high" })
await until(() => island.evaluate(() => document.querySelector("[data-island-knock]")?.textContent?.includes("Deploy")), 8000)
await island.evaluate(() => document.querySelector("[data-island-later]").click())
check("Not now puts it off", await until(async () => (await op("companion.knocks", {})).knocks.find((x) => x.id === k2.id)?.state === "later", 4000))
check("…and the island lets it go", await until(() => island.evaluate(() => !document.querySelector("[data-island-knock]")), 3000))

// ---------- many sessions: the list a hover opens fits the window, rounds its bottom and scrolls the rest
const before = await helper((h) => h.island().presences)
const H = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.getBounds().height)
const fake = (n) => Array.from({ length: n }, (_, i) => ({ id: `qa-${i}`, who: `Session ${i + 1}`, tint: ["orange", "teal", "purple", "green"][i % 4], state: i % 3 ? "working" : "needs you",
  since: Date.now() - i * 60_000, line: `Step ${i + 1} of the plan`, ...(i % 5 === 0 ? { knock: `qk-${i}` } : {}) }))
const card = () => island.evaluate(() => { const c = document.querySelector(".island-card"), l = c?.querySelector(".island-rows"); if (!c || !l) return null
  const r = c.getBoundingClientRect(), radius = getComputedStyle(c).borderBottomLeftRadius
  return { bottom: r.bottom, inner: innerHeight, radius, rows: l.querySelectorAll("[data-island-row]").length, scroll: l.scrollTop, room: l.clientHeight, full: l.scrollHeight, more: l.dataset.more ?? "" } })
for (const n of [1, 8, 30]) {
  await helper((h, list) => h.knocks({ knocks: [], presences: list }), fake(n))
  await until(() => island.evaluate(() => !!document.querySelector('[data-island-face="qa-0"]')), 4000)
  await island.locator("[data-island]").hover({ position: { x: 30, y: 10 } })
  const c = await until(async () => { const c = await card(); return c?.rows === n ? c : null }, 3000) ?? await card()
  check(`${n} sessions: the list holds them all`, c?.rows === n, c)
  check(`…ends inside its window, its bottom rounded`, !!c && c.bottom <= H - 8 && c.inner === H && parseFloat(c.radius) >= 16, { c, H })
  const over = !!c && c.full > c.room + 1
  check(n === 30 ? "…too many to fit: it scrolls, fading below" : "…no scroll it doesn't need", n === 30 ? over && c.more === "bottom" : !over && !c.more, c)
  if (PNG && n === 30) fs.writeFileSync(PNG.replace(/\.png$/, "-many.png"), await island.screenshot({ omitBackground: true }))
  if (n !== 30) continue
  // (the wheel and a trackpad's swipe are both wheel events, over the list while hovered)
  const box = await island.locator(".island-rows").boundingBox()
  const first = await island.evaluate(() => { const r = document.querySelector('[data-island-row="qa-0"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await island.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 40; i++) await island.mouse.wheel(0, 120)
  const end = await until(async () => { const c = await card(); return c && c.scroll + c.room >= c.full - 1 ? c : null }, 3000) ?? await card()
  check("…the wheel scrolls it to the last", !!end && end.scroll > 0 && end.scroll + end.room >= end.full - 1 && end.more === "top", end)
  check("…the last row shown whole", await island.evaluate(() => { const l = document.querySelector(".island-rows").getBoundingClientRect(), r = document.querySelector('[data-island-row="qa-29"]').getBoundingClientRect()
    return r.bottom <= l.bottom + 1 && r.top >= l.top }))
  const wb2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.getBounds())
  const there = await until(() => helper((h, p) => h.island(p).at, { x: wb2.x + first.x, y: wb2.y + first.y }), 2000)
  check("…a row scrolled out isn't where it was: what's shown there is", !!there && there !== "qa-0", there)
  check("…still open, still hovered", await island.evaluate(() => !!document.querySelector("[data-island][data-open]")))
  if (PNG) fs.writeFileSync(PNG.replace(/\.png$/, "-scrolled.png"), await island.screenshot({ omitBackground: true }))
  await island.mouse.move(600, 330)
}
await helper((h, a) => h.knocks({ knocks: h.island().knocks, presences: a }), before)

// ---------- another app's island wide over the notch: ours to its right, apart
await helper((h, a) => h.stub("windows", { windows: [a] }), { ...vors(display.x + 560, 350) })
const islandBounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.getBounds())
// (its window list is read again every 2 s with the pointer near the top, else every 10 s)
const moved = await until(async () => { const b = await islandBounds(); return b?.x === display.x + 560 + 350 + 6 - 330 ? b : null }, 14000) ?? await islandBounds()
check("Vorssaint wide: ours sits right of it", moved?.x === display.x + 560 + 350 + 6 - 330, moved)
await helper((h, a) => h.stub("windows", { windows: [a] }), { ...vors(display.x + 480, 510, 300) })
const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#island"))?.isVisible())
check("Vorssaint opened down: ours steps aside", await until(async () => (await visible()) === false, 14000))

await app.close()
fs.rmSync(TMP, { recursive: true, force: true })
await done()
