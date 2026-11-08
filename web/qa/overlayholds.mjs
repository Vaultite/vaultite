// The companion's see-through windows over the screen (the island by the notch here: overlay.ts' take the same path,
// electron/overlaywin.ts) take the pointer only while it's over what they mark as pressable, as the main process sees the
// pointer: over the island's bar or card, never its see-through rest. Not even after what left it taking every click
// there (the clicks on a web page under it, "Work mode" and its field, went nowhere): a card gone under a still pointer,
// its page reloaded or crashed, the window hidden. The pointer is stood in for. WRITES: throwaway vault only.
//   node web/qa/overlayholds.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the island is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-overlayholds-"))
fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "companion"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "companion", "data.json"), JSON.stringify({ agent: "nobody", sounds: false, voice: "off" }))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_QA_STILL: "2500", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = watch(await app.firstWindow(), { console: true })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
  check("the helper runs with the app", await helper(() => true))
  // (the pointer, stood in for: where the main process reads it)
  const display = await app.evaluate(({ screen }) => {
    const real = screen.getCursorScreenPoint.bind(screen)
    screen.getCursorScreenPoint = () => globalThis.qaPointer ?? real()
    return screen.getDisplayNearestPoint(real()).bounds
  })
  // (a 15-inch Air's notch, and status items from 951 as on the M4: a knock's line has no room beside it, so it drops
  // into a card below the bar)
  const items = [951, 999, 1033, 1071].map((x) => ({ window: x, bundle: "com.apple.controlcenter", name: "Control Center", layer: 25, seen: true, vaultite: false, frame: { x: display.x + x, y: display.y, width: 38, height: 33 } }))
  await helper((h, a) => { h.stub("notch", { screens: [{ frame: a.d, notch: { x: a.d.x + 646, y: a.d.y, width: 179, height: 32 } }] }); h.stub("windows", { windows: a.items }) }, { d: display, items })
  const point = (p) => app.evaluate((_e, p) => { globalThis.qaPointer = p }, p)
  const island = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#island")); return w && { ...w.getBounds(), visible: w.isVisible() } })
  /** Whether the island takes the pointer now, and the boxes its page told. */
  const takes = () => app.evaluate(() => globalThis.vaultiteOverlayHolds?.().find((h) => h.url.endsWith("#island")) ?? null)
  const taking = (want, ms = 1500) => until(async () => (await takes())?.on === want, ms)

  // Sessions in the background: the island rests as its mark by the notch.
  const sessions = [{ id: "qa-n", who: "Lighthouse migration", tint: "teal", state: "needs you", since: Date.now() - 60_000, line: "Run it on prod?" },
    { id: "qa-w", who: "Inbox decisions", tint: "green", state: "working", since: Date.now() - 60_000 }]
  await helper((h, list) => h.knocks({ knocks: [], presences: list }), sessions)
  const page = await until(() => app.windows().find((p) => p.url().endsWith("/screen.html#island")), 10000)
  check("the island shows its mark", !!page && !!await until(async () => (await island())?.visible && page.evaluate(() => !!document.querySelector("[data-island-mark]")), 6000))
  const box = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, sel)
  const onScreen = async (p) => { const b = await island(); return { x: b.x + p.x, y: b.y + p.y } }
  const bar = await onScreen(await box(".island")), rest = await onScreen({ x: 600, y: 500 })
  check("its page tells its bar as what takes the pointer", !!(await until(async () => (await takes())?.boxes.length, 3000)), await takes())

  await point(rest)
  check("over its see-through rest it lets the pointer through", await taking(false))
  await point(bar)
  check("over its bar it takes the pointer", await taking(true), await takes())

  // A knock's card up under the pointer, then gone with it still: the window lets go with nothing heard in the page.
  const k = await (await fetch(`${new URL(win.url()).origin}/api/ops/companion.knock`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ line: "Ready to show you the footer", who: "Footer", hold: "15s" }) })).json()
  check("a knock's line comes up in a card below the bar", !!await until(() => page.evaluate(() => !!document.querySelector(".island-card [data-island-knock]")), 8000))
  const line = await onScreen(await box(".island-card [data-island-knock]"))
  await point(line)
  check("over a knock's card it takes the pointer", await taking(true))
  await helper((h, id) => h.island().knocks.find((x) => x.id === id) && h.knocks({ knocks: [], presences: h.island().presences }), k.id)
  check("its card gone under the still pointer: the window lets it through", await until(() => page.evaluate(() => !document.querySelector(".island-card")), 4000) && await taking(false, 2000), await takes())

  // Its page reloaded while it took the pointer: the new page has heard nothing, the window lets go all the same.
  await point(bar)
  check("over its bar again it takes the pointer", await taking(true))
  await point(rest)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#island"))
    // (as the old page's enters left it: taking, though the pointer's moved on)
    w.webContents.reload()
  })
  check("reloaded: it lets the pointer through over its rest", await taking(false, 3000))
  await until(() => page.evaluate(() => !!document.querySelector("[data-island-mark]")), 6000)
  await point(bar)
  check("…and takes it over its bar once drawn again", await taking(true, 3000), await takes())

  // Its page crashed while it took the pointer: nothing there to say so, the window lets go.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#island"))?.webContents.forcefullyCrashRenderer())
  check("its page crashed: it lets the pointer through, even over where its bar was", await taking(false, 3000), await takes())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#island"))?.webContents.reload())
  await until(() => page.evaluate(() => !!document.querySelector("[data-island-mark]")).catch(() => false), 8000)
  check("…its page back, it takes it over its bar again", await taking(true, 4000), await takes())

  // Hidden (nobody in the background) while it took the pointer: it takes none, and none once shown again elsewhere.
  await helper((h) => h.knocks({ knocks: [], presences: [] }))
  check("hidden: it takes no pointer", await until(async () => !(await island())?.visible, 4000) && await taking(false))
  await point(rest)
  await helper((h, list) => h.knocks({ knocks: [], presences: list }), sessions)
  check("shown again with the pointer over its rest: it lets it through", await until(async () => (await island())?.visible, 4000) && await taking(false) && (await wait(400), !(await takes()).on))
} finally {
  await app.close().catch(() => {})
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
