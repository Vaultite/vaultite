// The menu-bar helper reloaded onto a new code root in the running app (electron/helperload.ts), as the store's updates
// do for a commit only it runs: two copies of this tree stand in for two roots. Each reload leaves the process holding
// what it held before (ipcMain's and screen's listeners, app's will-quit, windows, timers: electron/helperscope.ts), it
// waits while a Talk key's press is under way, and the reloaded helper still uses the main process's dictation
// (electron/helper.ts' HelperHost). Stopped, it holds none of it. WRITES: throwaway vault only.
//   node web/qa/helperreload.mjs <vault copy>
import { _electron } from "playwright-core"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, done, skip } = await qa(import.meta.url, { chrome: false, live: true })
if (process.platform !== "darwin") await skip("the helper is a Mac's")
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-helperreload-"))
// (what dictation "hears": the words in a file, whether or not this Mac has a recognizer)
const WORDS = path.join(TMP, "said.txt")
fs.writeFileSync(WORDS, "What does this paragraph say")
fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "companion"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "companion", "data.json"), JSON.stringify({ agent: "nobody", sounds: false, voice: "off" }))
fs.mkdirSync(path.join(VAULT, ".vaultite", "plugins", "dictation"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite", "plugins", "dictation", "data.json"), JSON.stringify({ engine: "apple", language: "en-US" }))

// (a root as the store makes one: its own files, the packages shared; APFS clones, so cheap)
const roots = ["a", "b"].map((c) => {
  const dir = path.join(TMP, `root-${c}`)
  fs.mkdirSync(dir)
  for (const f of ["electron", "core", "plugins", "package.json"]) execFileSync("cp", ["-cR", path.join(ROOT, f), dir])
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"))
  return { dir, commit: c.repeat(40) }
})

const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: "1", VAULTITE_HELPER: "1", VAULTITE_DICTATION_TEXT: WORDS, VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local") },
})
try {
  const win = watch(await app.firstWindow(), { console: true })
  await win.waitForSelector("[role=tree]", { timeout: 60000 })
  const helper = (fn, arg) => app.evaluate((_e, [f, a]) => globalThis.vaultiteHelper && new Function("h", "a", `return (${f})(h, a)`)(globalThis.vaultiteHelper, a), [String(fn), arg])
  const slot = (fn, arg) => app.evaluate((_e, [f, a]) => new Function("s", "a", `return (${f})(s, a)`)(globalThis.vaultiteHelperSlot, a), [String(fn), arg])
  /** What the process holds that the helper adds to. */
  const held = () => app.evaluate(({ app, BrowserWindow, ipcMain, screen }) => ({
    ipc: Object.fromEntries(ipcMain.eventNames().map((n) => [String(n), ipcMain.listenerCount(n)]).filter(([, c]) => c).sort(([a], [b]) => a.localeCompare(b))),
    screen: ["display-added", "display-removed", "display-metrics-changed"].reduce((n, e) => n + screen.listenerCount(e), 0),
    quit: app.listenerCount("will-quit"),
    windows: BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length,
    timers: process.getActiveResourcesInfo().filter((r) => r === "Timeout").length,
  }))
  /** What differs between two of held()'s. */
  const diff = (a, b) => ({ ...Object.fromEntries([...new Set([...Object.keys(a.ipc), ...Object.keys(b.ipc)])].filter((k) => a.ipc[k] !== b.ipc[k]).map((k) => [`ipc ${k}`, [a.ipc[k] ?? 0, b.ipc[k] ?? 0]])),
    ...Object.fromEntries(["screen", "quit", "windows", "timers"].filter((k) => a[k] !== b[k]).map((k) => [k, [a[k], b[k]]])) })
  const same = (a, b, timers = 1) => JSON.stringify(a.ipc) === JSON.stringify(b.ipc) && a.screen === b.screen && a.quit === b.quit && a.windows === b.windows && a.timers <= b.timers + timers
  check("the helper runs with the app", await helper(() => true))
  await wait(2500) // (its settings read, its overlay up)
  const running = await held()
  await slot((s) => s.stop())
  await wait(1500)
  const stopped = await held()
  check("stopped, it holds no listener, window or timer of its", stopped.quit < running.quit && stopped.screen < running.screen && Object.keys(stopped.ipc).length < Object.keys(running.ipc).length, diff(running, stopped))
  check("…and started again in the same copy, all of it back", await slot((s) => s.start()) && await until(async () => same(await held(), running), 8000), diff(running, await held()))

  for (const r of roots) {
    await slot((s, r) => s.reload(r.dir, r.commit), r)
    await slot((s) => s.done())
    check(`reloaded onto ${r.commit.slice(0, 7)}: it runs that root's code`, await slot((s) => s.commit()) === r.commit && await helper(() => true))
    await wait(2500)
    const now = await held()
    check("…the process holds what it held before: the old copy's listeners, windows and timers gone", same(now, running), diff(running, now))
  }

  // ---------- a reload waits while a Talk key's press is under way; the reloaded copy dictates through the main process's
  const chord = (on) => helper((h, o) => h.heard({ event: "chord", name: "control_option", on: o }), on)
  await chord(true)
  check("held, the reloaded helper's companion listens", await until(() => helper((h) => h.scene()?.summon?.state === "listening"), 8000), await helper((h) => h.scene()?.summon))
  check("…its words come from the main process's dictation", await until(() => helper((h) => /paragraph/i.test(h.scene()?.summon?.words ?? "")), 30000, 200), await helper((h) => h.scene()?.summon))
  const overlays = () => app.windows().filter((p) => p.url().endsWith("/screen.html"))
  const drawn = () => Promise.all(overlays().map((p) => p.evaluate(() => document.body.textContent).catch(() => "")))
  check("…and its overlay draws them on the screen", await until(async () => (await drawn()).some((t) => /paragraph/i.test(t)), 15000, 200),
    { overlays: overlays().length, text: (await drawn()).map((t) => t.slice(0, 200)) })
  await slot((s, r) => s.reload(r.dir, r.commit), roots[0])
  await wait(6000)
  check("…a reload asked meanwhile waits", await slot((s) => s.commit()) === roots[1].commit)
  await chord(false)
  // (its ask answered, what follows ended too: Esc for the exchange, the box its answer opened closed; again should
  // the answer come after)
  check("…and goes once the press is over", await until(async () => {
    await helper((h) => h.heard({ event: "esc" }))
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith("#panel")) w.close() })
    return (await slot((s) => s.commit())) === roots[0].commit
  }, 60000, 1000), { commit: await slot((s) => s.commit()), busy: await slot((s) => s.busy()) })

  await slot((s) => s.stop())
  await wait(1500)
  check("stopped after its reloads, it holds no more than stopped before", same(await held(), stopped), diff(stopped, await held()))
} finally {
  await app.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
