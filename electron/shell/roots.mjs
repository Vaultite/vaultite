// Which code root the app runs (boot.mjs, vau.mjs), and the record of how each fared: the attempts, the roots gone bad
// and what happened (userData/shell). No Electron: tools/test_shell.ts runs it.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fingerprint } from "./print.mjs"

/** What a shell may run besides its bundle (a new shell each: this file is one of its inputs): Vaultite Dev a worktree
 *  (VAULTITE_CODE_ROOT, electron/dev.ts); Main its store's roots (storeIn: where its marker is). */
export const ENABLED = Object.freeze({ dev: true, store: true })
export { MARKER, STORE, storeIn } from "./store.mjs"
/** A run that dies within this of becoming ready crashed starting; two such in a row make its root bad. */
export const SETTLED_AFTER = 60_000

/** The same folder, however each is spelled (/tmp is /private/tmp on a Mac). */
const sameDir = (a, b) => { const real = (p) => { try { return fs.realpathSync(p) } catch { return path.resolve(p) } }; return !!a && !!b && real(a) === real(b) }
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null } }
const writeJson = (file, v) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(v, null, 2) + "\n")
  fs.renameSync(`${file}.${process.pid}.tmp`, file)
}

/** The shell's stamp in the bundle (electron/shell.json: stamp.ts, sign.cjs), {} when there's none. */
export function readShell(bundle) {
  const s = readJson(path.join(bundle, "electron", "shell.json"))
  return s && typeof s === "object" && !Array.isArray(s) ? s : {}
}
/** The commit the code at `root` is (its electron/build.json), null when it doesn't say. */
export function commitOf(root) {
  const c = readJson(path.join(root, "electron", "build.json"))?.commit
  return typeof c === "string" && c ? c : null
}

/** Electron's userData for an app named `name`, for a process without Electron's app (vau.mjs). */
export function userDataOf(name, env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.VAULTITE_USER_DATA) return path.resolve(env.VAULTITE_USER_DATA)
  const p = platform === "win32" ? path.win32 : path.posix
  if (platform === "darwin") return p.join(home, "Library", "Application Support", name)
  if (platform === "win32") return p.join(env.APPDATA || p.join(home, "AppData", "Roaming"), name)
  return p.join(env.XDG_CONFIG_HOME || p.join(home, ".config"), name)
}

/** Why the code at `root` can't run in this shell (null: it can): it must be there, inside `store` when given, the user's,
 *  writable by nobody else, and built for this shell (the same fingerprint). */
export function rootProblem(root, o) {
  let real
  try { real = fs.realpathSync(root) } catch { return "it isn't there" }
  if (o.store) {
    let store
    try { store = fs.realpathSync(o.store) } catch { return "there's no store" }
    if (!real.startsWith(store + path.sep)) return "it isn't in the store"
  }
  const st = fs.statSync(real)
  if (o.uid != null && st.uid !== o.uid) return "it isn't the user's"
  // (Windows has no such modes, and runs only its bundle)
  if (process.platform !== "win32" && st.mode & 0o022) return "others can write to it"
  if (!o.fingerprint) return "this app has no shell fingerprint"
  let print
  try { print = fingerprint(real) } catch (e) { return `its shell's inputs can't be read (${e.message})` }
  return print === o.fingerprint ? null : "it needs another build of the app (its shell fingerprint differs)"
}

/** The code root to run, `from` where, and those passed over with why. A release, Windows and a run from source: the
 *  bundle (or its own folder). Once ENABLED: Dev VAULTITE_CODE_ROOT, Main its store's current then good; else the bundle. */
export function pick(o) {
  const enabled = o.enabled ?? ENABLED, passed = []
  const bundle = { root: o.bundle, from: o.packaged ? "bundle" : "checkout", passed }
  if (!o.packaged || o.shell.release || o.platform === "win32") return bundle
  const take = (root, from, store) => {
    const bad = o.bad?.[root]
    const why = bad ? `it failed before: ${bad.why}` : rootProblem(root, { store, fingerprint: o.shell.fingerprint, uid: o.uid })
    if (!why) return { root, from, passed }
    passed.push({ root, from, why })
    return null
  }
  if (o.shell.channel === "dev" && enabled.dev && o.env.VAULTITE_CODE_ROOT) {
    const r = take(path.resolve(o.env.VAULTITE_CODE_ROOT), "dev")
    if (r) return r
  }
  if (o.shell.channel === "main" && enabled.store && o.store) {
    for (const from of ["current", "good"]) {
      const commit = readJson(path.join(o.store, `${from}.json`))?.commit
      if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) continue
      const r = take(path.join(o.store, "roots", commit), from, o.store)
      if (r) return r
    }
  }
  return bundle
}

// ---------- the record (userData/shell) ----------
export const stateDir = (userData) => path.join(userData, "shell")
const attempt = (dir, pid) => path.join(dir, "attempts", `${pid}.json`)
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === "EPERM" } }

/** What happened, appended to events.jsonl: `kind` (passed, failed, crashed, late), the root, why. */
export function event(dir, e, now = Date.now()) {
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ t: now, ...e }) + "\n")
}
/** The events not yet reported, then marked reported. */
export function unreported(dir) {
  let lines = []
  try { lines = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8").split("\n").filter(Boolean) } catch { return [] }
  const seen = readJson(path.join(dir, "reported.json"))?.lines ?? 0
  writeJson(path.join(dir, "reported.json"), { lines: lines.length })
  return lines.slice(seen > lines.length ? 0 : seen).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
}
/** The roots gone bad, by path: why and when. */
export const badRoots = (dir) => readJson(path.join(dir, "bad.json")) ?? {}
function markBad(dir, root, why, now) {
  writeJson(path.join(dir, "bad.json"), { ...badRoots(dir), [root]: { why, t: now } })
}

/** Before a run: the attempts earlier ones left behind settled. One whose process died before it became ready makes its
 *  root bad; one that died within SETTLED_AFTER of it counts a crash, and a second in a row makes it bad. */
export function settle(dir, o = {}) {
  const isAlive = o.alive ?? alive, now = o.now ?? Date.now()
  let names = []
  try { names = fs.readdirSync(path.join(dir, "attempts")).filter((n) => /^\d+\.json$/.test(n)) } catch { return }
  for (const n of names) {
    const a = readJson(path.join(dir, "attempts", n))
    if (a && typeof a.pid === "number" && isAlive(a.pid)) continue
    fs.rmSync(path.join(dir, "attempts", n), { force: true })
    if (!a?.root) continue
    if (!a.ready) {
      const why = "it started but never became ready"
      if (!sameDir(a.root, o.bundle)) markBad(dir, a.root, why, now)
      event(dir, { kind: "failed", root: a.root, commit: a.commit ?? null, why }, now)
      continue
    }
    const crashes = readJson(path.join(dir, "crashes.json")) ?? {}
    const n2 = (crashes[a.root] ?? 0) + 1
    writeJson(path.join(dir, "crashes.json"), { ...crashes, [a.root]: n2 })
    const why = n2 >= 2 ? "it crashed twice within a minute of starting" : "it crashed within a minute of starting"
    if (n2 >= 2 && !sameDir(a.root, o.bundle)) markBad(dir, a.root, why, now)
    event(dir, { kind: "crashed", root: a.root, commit: a.commit ?? null, why }, now)
  }
}
/** This run started on `root`. */
export const begin = (dir, a, now = Date.now()) => writeJson(attempt(dir, a.pid), { pid: a.pid, root: a.root, commit: a.commit ?? null, t: now })
/** It's ready: its root is good (good.json). */
export function ready(dir, pid, now = Date.now()) {
  const a = readJson(attempt(dir, pid))
  if (!a) return
  writeJson(attempt(dir, pid), { ...a, ready: now })
  writeJson(path.join(dir, "good.json"), { root: a.root, commit: a.commit, t: now })
}
/** Past SETTLED_AFTER since ready (or quit): no crash of its start to count, and its root's crashes start over. */
export function settled(dir, pid) {
  const a = readJson(attempt(dir, pid))
  fs.rmSync(attempt(dir, pid), { force: true })
  if (!a?.ready) return
  const crashes = readJson(path.join(dir, "crashes.json")) ?? {}
  if (crashes[a.root]) { delete crashes[a.root]; writeJson(path.join(dir, "crashes.json"), crashes) }
}
/** This run quit: nothing to settle next time. */
export const ended = (dir, pid) => fs.rmSync(attempt(dir, pid), { force: true })
/** This run's root failed (`why`): bad unless it's the bundle, and recorded. */
export function failed(dir, o, now = Date.now()) {
  if (!sameDir(o.root, o.bundle)) markBad(dir, o.root, o.why, now)
  event(dir, { kind: o.kind ?? "failed", root: o.root, commit: o.commit ?? null, why: o.why }, now)
}
