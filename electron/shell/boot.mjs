// The desktop app's entry (package.json main): the shell. It sets the app's identity, picks the code to run (roots.mjs),
// keeps the record of how that went and imports the code's entry (<root>/electron/boot.ts). Node's and Electron's own only.
import { app, dialog } from "electron"
import module from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import * as roots from "./roots.mjs"

/** A run not ready by then (no window's server answering) failed: another root is tried, else it's said. */
const READY_WITHIN = 90_000

const bundle = path.resolve(import.meta.dirname, "..", "..")
const shell = roots.readShell(bundle)
// (before anything reads userData: each build named otherwise, Main, Dev, Nightly or a test release, keeps its own)
app.setName(shell.productName ?? "Vaultite")
// Windows: the id its Start menu shortcut carries (sign.cjs stamps it), so notifications are its.
if (process.platform === "win32" && shell.appId) app.setAppUserModelId(shell.appId)
if (process.env.VAULTITE_USER_DATA) app.setPath("userData", path.resolve(process.env.VAULTITE_USER_DATA))
const userData = app.getPath("userData")
// Node strips the code's types and compiles it once per file, kept here (an ES module can't turn it on for its own imports).
module.enableCompileCache?.(path.join(userData, "compile-cache"))

const dir = roots.stateDir(userData)
const choose = () => roots.pick({ bundle, packaged: app.isPackaged, platform: process.platform, shell, env: process.env,
  uid: process.getuid?.(), store: path.join(userData, "code.noindex"), bad: roots.badRoots(dir) })
roots.settle(dir, { bundle })
const picked = choose()
for (const p of picked.passed) roots.event(dir, { kind: "passed", root: p.root, commit: roots.commitOf(p.root), why: p.why, ran: picked.root })
const commit = roots.commitOf(picked.root)
roots.begin(dir, { pid: process.pid, root: picked.root, commit })
// (a quit, even before it was ready, leaves nothing to settle; app.exit() skips both, so it ends it itself)
app.on("will-quit", () => roots.ended(dir, process.pid))
process.on("exit", () => roots.ended(dir, process.pid))
// The CLI's one stable path, what shims, agents' MCP configs and the servers' children run (core/appentry.ts); a Dev
// instance's worktree is its root for its life, so its own bin/vau (its terminals run that worktree's vau).
process.env.VAULTITE_VAU_ENTRY = picked.from === "dev" ? path.join(picked.root, "bin", "vau") : path.join(bundle, "electron", "shell", "vau.mjs")

let isReady = false
/** It failed (`why`): recorded, and when another root can run now, the app starts again on it (true). */
function failed(why, kind = "failed") {
  roots.failed(dir, { root: picked.root, bundle, commit, why, kind })
  if (choose().root === picked.root) return false
  roots.ended(dir, process.pid)
  app.relaunch()
  app.exit(1)
  return true
}
const late = setTimeout(() => { if (!isReady) failed(`it wasn't ready within ${READY_WITHIN / 1000} s`, "late") }, READY_WITHIN)
late.unref?.()

/** What the code reads of the shell (electron/identity.ts). */
globalThis.vaultiteShell = {
  root: picked.root, bundleRoot: bundle, shell, from: picked.from,
  /** Its first window's server answers (or, with none, the launch is done): this root is good. */
  ready() {
    if (isReady) return
    isReady = true
    clearTimeout(late)
    roots.ready(dir, process.pid)
    setTimeout(() => roots.settled(dir, process.pid), roots.SETTLED_AFTER).unref?.()
  },
  failed,
  /** What happened since it was last asked (roots this run passed over, earlier runs that failed). */
  events: () => roots.unreported(dir),
}

try {
  await import(pathToFileURL(path.join(picked.root, "electron", "boot.ts")).href)
} catch (e) {
  const why = `its code didn't load: ${e instanceof Error ? e.message : String(e)}`
  console.error(`vaultite: ${picked.root}: ${why}`, e)
  if (!failed(why)) {
    // (nothing else to run: said, and the app ends rather than sit there without a window)
    if (!process.env.VAULTITE_QUIET) {
      await app.whenReady()
      dialog.showErrorBox(`${app.getName()} couldn't start`, `${why}\n\n${e instanceof Error && e.stack ? e.stack : ""}`)
    }
    roots.ended(dir, process.pid) // (said already: nothing for the next launch to settle)
    app.exit(1)
  }
}
