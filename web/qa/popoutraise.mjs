// Pop-out windows in the desktop app (core/windows.ts, electron main.ts' window:raise): a tab held over another of the
// app's windows brings it to the front after a moment, keyboard left alone; let go, it lands there. WRITES: the vault.
//   node web/qa/popoutraise.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, command, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-popoutraise-"))
const app = await _electron.launch({ executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") } })
try {
  const win = watch(await app.firstWindow())
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const hash = (p, f) => p.evaluate((h) => { location.hash = h }, `#file/${encodeURIComponent(f)}`)
  await command(win, "Close all other tabs"); await hash(win, "Start here.md"); await wait(500)
  await command(win, "Open new tab"); await hash(win, "ME.md"); await wait(500)
  await command(win, "Open new tab"); await hash(win, "Notes"); await wait(500)
  const popped = app.waitForEvent("window")
  await command(win, "Move current tab to new window")
  await popped; await wait(1500)
  const pop = app.windows().find((w) => /popout=/.test(w.url()))
  await pop.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
  // The pop-out right of the main window, over its right edge; each window's raises and focus logged.
  await app.evaluate(({ BaseWindow }) => {
    globalThis.__log = []
    const pages = BaseWindow.getAllWindows().map((w) => [w, w.contentView?.children?.[0]?.webContents?.getURL?.() ?? ""])
    for (const [w, url] of pages) {
      const name = /popout=/.test(url) ? "popout" : "main"
      for (const m of ["moveTop", "focus"]) { const f = w[m].bind(w); w[m] = (...a) => { globalThis.__log.push({ m, name }); return f(...a) } }
    }
    const main = pages.find(([, u]) => u.startsWith("http") && !/popout=/.test(u))[0], p = pages.find(([, u]) => /popout=/.test(u))[0]
    main.setBounds({ x: 40, y: 40, width: 1100, height: 760 }); p.setBounds({ x: 900, y: 140, width: 900, height: 600 })
  })
  await wait(500)
  const mb = await win.evaluate(() => ({ x: screenX, y: screenY, top: outerHeight - innerHeight }))
  const pb = await pop.evaluate(() => ({ x: screenX, y: screenY, top: outerHeight - innerHeight }))
  const t = await pop.locator("[data-tab-id]").first().boundingBox()
  await pop.mouse.move(t.x + 20, t.y + t.height / 2); await pop.mouse.down()
  await pop.mouse.move(t.x + 40, t.y + t.height / 2, { steps: 3 })
  // over the main window's pane, left of the pop-out: (screen 500, 400) as the pop-out's page sees it
  const body = await win.locator("[data-pane-body]:visible").first().boundingBox()
  const sx = mb.x + body.x + body.width / 3, sy = mb.y + mb.top + body.y + body.height / 2
  const px = sx - pb.x, py = sy - pb.y - pb.top
  await app.evaluate(() => { globalThis.__log = [] })
  const t0 = Date.now()
  await pop.mouse.move(px, py, { steps: 6 })
  await wait(150)
  const early = await app.evaluate(() => globalThis.__log.filter((x) => x.m === "moveTop" && x.name === "main").length)
  check("not raised at once (a drag passing over doesn't shuffle windows)", early === 0, early)
  check("the main window shows where it would land", await until(() => win.locator("[data-drop-zone]").count(), 3000))
  await wait(450)
  const log = await app.evaluate(() => globalThis.__log)
  check("held a moment over the main window, it comes to the front", log.some((x) => x.m === "moveTop" && x.name === "main"), log)
  check("…without taking the keyboard (the drag goes on in the pop-out)", !log.some((x) => x.m === "focus"), log)
  // back over the pop-out: it comes forward again
  const back = await pop.locator("[data-pane-body]:visible").first().boundingBox()
  await pop.mouse.move(back.x + back.width - 120, back.y + 100, { steps: 4 }); await wait(500)
  const log2 = await app.evaluate(() => globalThis.__log)
  check("back over the pop-out, it comes forward again", log2.some((x) => x.m === "moveTop" && x.name === "popout"), log2)
  check("…and the main window's drop zone goes", await until(async () => (await win.locator("[data-drop-zone]").count()) === 0, 2000))
  // over the main window again till it's in front, then onto its part over the pop-out: let go there, it lands in it
  await pop.mouse.move(px, py, { steps: 4 }); await wait(500)
  const cx = 1000 - pb.x, cy = sy - pb.y - pb.top
  await pop.mouse.move(cx, cy, { steps: 3 }); await wait(200)
  check("(held inside the pop-out's bounds, where the main window is in front of it)", cx > 0 && cx < 900)
  check("…the main window still shows where it would land", (await win.locator("[data-drop-zone]").count()) > 0)
  check("…and the pop-out none of its own", (await pop.locator("[data-drop-zone]").count()) === 0)
  const gone = pop.waitForEvent("close", { timeout: 5000 }).then(() => true, () => false)
  await pop.mouse.up()
  check("let go there, it lands in the main window (on its pane's right edge: a split)", await until(async () => (await win.locator("[data-pane-body]:visible").count()) === 2, 4000))
  check("…and the emptied pop-out closes", await gone)
  // The other way: a main window's tab held over a pop-out, it comes forward, shows where it'd land, and takes it.
  await command(win, "Close pane"); await wait(400)
  await command(win, "Close all other tabs"); await wait(300)
  await command(win, "Open new tab"); await hash(win, "Notes"); await wait(500)
  const popped2 = app.waitForEvent("window")
  await command(win, "Move current tab to new window"); await popped2; await wait(1500)
  const pop2 = app.windows().find((w) => /popout=/.test(w.url()))
  await pop2.waitForSelector("[data-tab-strip] [data-tab-id]", { timeout: 15000 })
  await app.evaluate(({ BaseWindow }) => {
    globalThis.__log = []
    for (const w of BaseWindow.getAllWindows()) {
      if (!/popout=/.test(w.contentView?.children?.[0]?.webContents?.getURL?.() ?? "")) continue
      for (const m of ["moveTop", "focus"]) { const f = w[m].bind(w); w[m] = (...a) => { globalThis.__log.push({ m, name: "popout" }); return f(...a) } }
      w.setBounds({ x: 900, y: 140, width: 900, height: 600 })
    }
  })
  await wait(500)
  const pb2 = await pop2.evaluate(() => ({ x: screenX, y: screenY, top: outerHeight - innerHeight }))
  const body2 = await pop2.locator("[data-pane-body]:visible").first().boundingBox()
  await wait(800); await command(win, "Open new tab"); await wait(400); await hash(win, "Start here.md"); await wait(500)
  const t2 = await win.locator("[data-tab-id]").nth(1).boundingBox()
  await win.mouse.move(t2.x + 20, t2.y + t2.height / 2); await win.mouse.down()
  await win.mouse.move(t2.x + 40, t2.y + t2.height / 2, { steps: 3 })
  // the pop-out's pane's right edge, right of the main window
  const qx = pb2.x + body2.x + body2.width - 20 - mb.x, qy = pb2.y + pb2.top + body2.y + body2.height / 2 - mb.y - mb.top
  await win.mouse.move(qx, qy, { steps: 6 })
  check("held over a pop-out, a main window's tab shows there where it'd land (a split on the right)", await until(() => pop2.locator("[data-drop-zone='right']").count(), 3000))
  await wait(450)
  const log3 = await app.evaluate(() => globalThis.__log)
  check("…the pop-out comes to the front", log3.some((x) => x.m === "moveTop" && x.name === "popout"), log3)
  await win.mouse.up(); await wait(800)
  check("let go, it lands there: the pop-out's tab split", await until(async () => (await pop2.locator("[data-pane-body]:visible").count()) === 2, 4000))
  check("…and it left the main window", (await win.locator("[data-tab-id]").count()) === 1)
  check("…and the pop-out gets the keyboard", (await app.evaluate(() => globalThis.__log)).some((x) => x.m === "focus" && x.name === "popout"))
} finally { await app.close() }
await done()
