// The Mac's traffic lights in the desktop app with railless sidebars (Zen): beside the pinned sidebar, never mid-slide
// (the page's stand-ins slide in their place, exactly where they sit), put back after a focus change. Mac only (screencapture; SHOW=1 brings the window forward). WRITES: throwaway vault.
//   node web/qa/lights.mjs <vault copy> <out dir>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT, OUT_ARG = "/tmp/lights-shots"], check, watch, done } = await qa(import.meta.url, { chrome: false })
if (process.platform !== "darwin") { console.log("skipped: the traffic lights are a Mac's"); process.exit(0) }
const OUT = path.resolve(OUT_ARG)
// Half a button's height (points): macOS 26's 14pt frame, 16pt before it (electron/main.ts BUTTONS).
const HALF = Number(os.release().split(".")[0]) >= 25 ? 7 : 8
fs.mkdirSync(OUT, { recursive: true })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-lights-"))
// (a window on a sleeping display draws no frames)
const awake = (await import("node:child_process")).spawn("caffeinate", ["-u", "-d", "-t", "600"], { stdio: "ignore" })
process.on("exit", () => awake.kill())

fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/appearance.json"), JSON.stringify({ theme: "dark", rails: false }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = await app.firstWindow()
  watch(win, { console: true, fail: false })
  await win.waitForSelector("aside[data-side=left] [data-titlebar]", { timeout: 60000 })
  // Every call to the lights, in order (`at` the position in points, `shown` their visibility).
  await app.evaluate(({ app: a, BaseWindow }, show) => {
    const w = BaseWindow.getAllWindows()[0]
    if (show) a.focus({ steal: true })
    globalThis.__lights = []
    const pos = w.setWindowButtonPosition.bind(w), vis = w.setWindowButtonVisibility.bind(w)
    w.setWindowButtonPosition = (at) => { globalThis.__lights.push({ t: Date.now(), at }); pos(at) }
    w.setWindowButtonVisibility = (on) => { globalThis.__lights.push({ t: Date.now(), shown: on }); vis(on) }
    w.setBounds({ x: 40, y: 40, width: 1280, height: 800 })
    w.setAlwaysOnTop(true)
    w.focus()
  }, !!process.env.SHOW)
  const calls = () => app.evaluate(() => globalThis.__lights.splice(0))
  /** What the window has the lights as after `calls`: the last position and visibility. */
  const state = (cs) => ({ at: cs.findLast((c) => c.at)?.at, shown: cs.findLast((c) => "shown" in c)?.shown })
  const shot = async (name) => {
    const b = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].getBounds())
    execFileSync("screencapture", ["-x", "-R", `${b.x},${b.y},360,90`, path.join(OUT, `${name}.png`)])
  }
  /** Where the page wants them (points): right of their default place by the sidebar's left edge, on its top row. */
  const want = () => win.evaluate((half) => {
    const a = document.querySelector("aside[data-side=left]"), row = a.querySelector("[data-titlebar]").getBoundingClientRect()
    return { x: Math.round(16 + a.getBoundingClientRect().left), y: Math.round(row.top + row.height / 2 - half) }
  }, HALF)
  /** The sidebar's left edge and whether the stand-ins show, each frame from now on. */
  const record = () => win.evaluate(() => {
    const a = document.querySelector("aside[data-side=left]"), frames = window.__frames = []
    const tick = () => {
      const g = a.querySelector("[data-lights-ghost]")
      frames.push({ t: performance.timeOrigin + performance.now(), x: a.getBoundingClientRect().left, ghost: !!g?.hasAttribute("data-shown") })
      if (frames.length < 150) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const frames = () => win.evaluate(() => window.__frames)
  /** The frames it was on its way, from `from` to `to` (its left edge). */
  const moving = (fs, from, to) => fs.filter((f) => Math.abs(f.x - from) > 0.5 && Math.abs(f.x - to) > 0.5)
  const near = (a, b) => !!a && !!b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1
  const toggle = () => win.click("[data-sidebar-toggle='']")
  await wait(1000)

  // 1. Pinned: on its top row, shown (a resize sends the page's place again).
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1240, height: 800 }))
  await wait(600)
  const pinned = state(await calls())
  check("pinned: shown on the sidebar's top row", pinned.shown !== false && (pinned.at === undefined || near(pinned.at, await want())), { pinned, want: await want() })
  await shot("1-pinned")

  // 2. Hidden (no rails): gone, at once.
  await toggle()
  await win.mouse.move(640, 400)
  await until(() => win.evaluate(() => document.querySelector("aside[data-side=left]").getBoundingClientRect().right <= 0), 3000)
  await wait(300)
  const hid = await calls()
  check("hidden: the lights go, and nothing places them on the way", state(hid).shown === false && hid.findIndex((c) => c.shown === false) <= 0, hid)
  await shot("2-hidden")

  // 3. Slid in from the edge: nothing until it has arrived, then placed once and shown; the stand-ins meanwhile.
  const outAt = await win.evaluate(() => document.querySelector("aside[data-side=left]").getBoundingClientRect().left)
  await record()
  await win.mouse.move(1, 400)
  const t0 = Date.now()
  await until(() => win.evaluate(() => document.querySelector("aside[data-side=left]").dataset.peek === "true"), 3000)
  await wait(80)
  await shot("3-mid-slide")
  await wait(600)
  const slid = await calls()
  const first = slid.find((c) => c.shown === true), placed = slid.filter((c) => c.at)
  check("sliding in: never shown before it has arrived (its hover wait and its 200ms slide)", !!first && first.t - t0 >= 250, { slid, t0 })
  check("sliding in: placed at its top row, not a frame at a time", placed.length <= 2 && placed.every((c) => near(c.at, placed[0].at)) && near(state(slid).at, await want()), { placed, want: await want() })
  check("sliding in: shown in the end", state(slid).shown === true, slid)
  const inAt = await win.evaluate(() => document.querySelector("aside[data-side=left]").getBoundingClientRect().left)
  const ins = await frames(), inMoving = moving(ins, outAt, inAt)
  check("sliding in: the stand-ins slide with it", inMoving.length > 2 && inMoving.every((f) => f.ghost), inMoving)
  const lastGhost = ins.findLast((f) => f.ghost)
  check("sliding in: the stand-ins go only once the lights are back", !!first && !!lastGhost && lastGhost.t >= first.t && !ins.at(-1).ghost, { first, lastGhost })
  // Exactly where the Mac draws the lights: a 14pt circle filling its frame on macOS 26, 12pt in 14×16 before it.
  const ghostAt = await win.evaluate(() => { const r = document.querySelector("[data-lights-ghost] > i").getBoundingClientRect(); return { x: r.left, y: r.top, size: r.width } })
  const inset = HALF === 7 ? { x: 0, y: 0 } : { x: 1, y: 2 }, at = state(slid).at
  check("the stand-ins sit where the lights do", !!at && Math.abs(ghostAt.x - at.x - inset.x) < 0.5 && Math.abs(ghostAt.y - at.y - inset.y) < 0.5, { ghostAt, at })
  await shot("4-slid-in")

  // 4. Out again: the lights gone before it moves, the stand-ins in their place.
  await record()
  await win.mouse.move(800, 400)
  await until(() => win.evaluate(() => document.querySelector("aside[data-side=left]").dataset.peek === "false"), 3000)
  await wait(500)
  const out = await calls()
  check("sliding out: gone first, never placed on the way", out[0]?.shown === false && !out.some((c) => c.at), out)
  const outs = await frames(), outMoving = moving(outs, inAt, outAt)
  check("sliding out: it moves only once the lights are gone", outMoving.length > 2 && outMoving[0].t >= out[0]?.t, { gone: out[0], moved: outMoving[0] })
  check("sliding out: the stand-ins slide with it", outMoving.every((f) => f.ghost), outMoving)

  // 5. The Mac shows them again (as it may on a layout of its own): the window's next focus change puts them back.
  // (the window's events, not a real focus: a window behind others, as QA's is, may not get one)
  await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setWindowButtonVisibility(true); w.emit("blur"); w.emit("focus") })
  await wait(400)
  const again = await calls()
  check("a focus change puts them back as the page has them (hidden)", state(again).shown === false, again)
  await shot("5-after-focus")

  // 6. Pinned again (its toggle rides on it: slid in first): back on the top row, shown.
  await win.mouse.move(1, 400)
  await until(() => win.evaluate(() => document.querySelector("aside[data-side=left]").dataset.peek === "true"), 3000)
  await wait(500)
  await calls()
  await toggle()
  await wait(600)
  await wait(600)
  const back = state(await calls())
  check("pinned again: shown on its top row", back.shown === true && near(back.at, await want()), { back, want: await want() })
  await shot("6-pinned-again")
} finally {
  await app.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
