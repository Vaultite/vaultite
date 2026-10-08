// The desktop app (Electron) loads a vault window's page again when its process dies (electron/web.ts `revive`): the
// renderer is killed (SIGKILL, by its own pid, like a stray `pkill` or the Mac short of memory) twice, and each time
// the window must draw the app again in a new renderer, not stay gray. Its server killed: a new one on its port, the
// app drawn, no error box. A page in a loop: the Wait / Reload box, whose Reload draws it again. One that keeps
// crashing: the Reload / Close window box, never a gray window. (The boxes are answered by stand-ins.)
// WRITES: the throwaway vault only.
//   node web/qa/revive.mjs <vault copy>
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ROOT, qa, wait } from "./lib/qa.mjs"
const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-revive-"))

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  await app.firstWindow()
  const opened = Date.now()
  // The boxes the app shows, answered with `__answer` (0: the first button).
  await app.evaluate(({ dialog }) => {
    globalThis.__boxes = []
    dialog.showMessageBox = async (a, b) => { globalThis.__boxes.push((b ?? a).message); return { response: globalThis.__answer ?? 0, checkboxChecked: false } }
    dialog.showErrorBox = (title) => { globalThis.__boxes.push(`error: ${title}`) }
  })
  const boxes = () => app.evaluate(() => globalThis.__boxes)
  const answer = (n) => app.evaluate((_e, n) => { globalThis.__answer = n }, n)
  // The vault window's renderer, and how much of the app it draws (0 while gray).
  const state = () => app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().startsWith("http://127.0.0.1"))
    if (!w || w.webContents.isCrashed()) return { pid: 0, drawn: 0 }
    const drawn = await w.webContents.executeJavaScript("document.querySelectorAll('#root *').length").catch(() => 0)
    return { pid: w.webContents.getOSProcessId(), drawn }
  })
  const drawnBy = async (not) => {
    for (let i = 0; i < 120; i++) {
      const s = await state().catch(() => ({ pid: 0, drawn: 0 }))
      if (s.pid && s.pid !== not && s.drawn > 20) return s
      await wait(250)
    }
    return state()
  }
  let s = await drawnBy(0)
  check(`the window draws the app (${s.drawn} elements, renderer ${s.pid})`, s.drawn > 20)
  for (const round of [1, 2]) {
    if (!(s.pid > 0)) break // no renderer to kill (and pid 0 would be this script's own process group)
    process.kill(s.pid, "SIGKILL")
    const t = Date.now()
    const after = await drawnBy(s.pid)
    check(`killed ${round}: drawn again by a new renderer ${after.pid} (${after.drawn} elements) in ${Date.now() - t} ms`,
      after.pid !== s.pid && after.drawn > 20)
    s = after
  }

  // Its server killed (a crash), once it's been up more than 10 s: a new one on the same port.
  const port = await app.evaluate(({ BrowserWindow }) => new URL(BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1")).webContents.getURL()).port)
  const listener = () => { try { return Number(execFileSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"]).toString().trim().split("\n")[0]) } catch { return 0 } }
  await wait(Math.max(0, 11_000 - (Date.now() - opened)))
  const server = listener()
  if (server > 0) process.kill(server, "SIGKILL")
  let again = 0
  for (let i = 0; i < 240 && !(again && again !== server); i++) { await wait(250); again = listener() }
  check(`its server killed: a new one on port ${port} (${server} -> ${again})`, server > 0 && again > 0 && again !== server)
  await wait(3000)
  s = await drawnBy(0)
  check("… the window is still there and draws the app", s.drawn > 20, s)
  check("… with no error box", !(await boxes()).some((b) => b.startsWith("error:")), await boxes())

  // A page in a loop: the box, and Reload draws it again (the hang is told after Chromium's own wait).
  await answer(1)
  const hung = s.pid
  void app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1")).webContents.executeJavaScript("for (;;) {}").catch(() => {}) })
  // (Chromium tells of a hang only when input goes unanswered: a key now and then, as a person would press)
  // (a click and a letter: a lone modifier isn't input it waits on)
  const poke = () => app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().startsWith("http://127.0.0.1"))?.webContents
    for (const e of [{ type: "mouseDown", x: 5, y: 5, button: "left", clickCount: 1 }, { type: "mouseUp", x: 5, y: 5, button: "left", clickCount: 1 }, { type: "keyDown", keyCode: "a" }, { type: "keyUp", keyCode: "a" }]) wc?.sendInputEvent(e)
  }).catch(() => {})
  let asked = false
  for (let i = 0; i < 240 && !asked; i++) { if (i % 4 === 0) await poke(); await wait(250); asked = (await boxes()).some((b) => /isn't responding/.test(b)) }
  check("a page in a loop: asked to wait or reload", asked, await boxes())
  s = await drawnBy(hung)
  check(`… Reload: drawn again by a new renderer ${s.pid}`, s.pid !== hung && s.drawn > 20, s)

  // Crashing again and again: the one it's left at, the box says so; Reload draws it.
  // (killed until it's left: three a minute are reloaded, however many of those were before)
  await answer(0)
  let said = false
  for (let k = 0; k < 4 && !said && s.pid > 0; k++) {
    const was = s.pid
    process.kill(was, "SIGKILL")
    for (let i = 0; i < 12 && !said; i++) { await wait(250); said = (await boxes()).some((b) => /keeps stopping/.test(b)) }
    if (!said) s = await drawnBy(was)
  }
  check("a page that keeps crashing: the box says so", said, await boxes())
  const last = s.pid
  s = await drawnBy(last)
  check("… Reload draws it again", s.pid !== last && s.drawn > 20, s)
} finally {
  await app.close().catch(() => {})
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
