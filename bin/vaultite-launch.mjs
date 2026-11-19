import fs from "node:fs"
import module from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const SHA = /^[0-9a-f]{40}$/
const STARTS_BEFORE_SUSPECT = 3
const WAITS_S = [15, 30, 60, 120]
const short = (sha) => sha.slice(0, 7)
const say = (line) => process.stderr.write(`vaultite: ${line}\n`)
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return null } }
const writeJson = (file, v) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(v) + "\n")
  fs.renameSync(`${file}.${process.pid}.tmp`, file)
}

function whyCantRun(store, root) {
  let real, base
  try { real = fs.realpathSync(root); base = fs.realpathSync(store) } catch { return "it isn't there" }
  if (!real.startsWith(base + path.sep)) return "it isn't in the store"
  const st = fs.statSync(real)
  if (process.getuid && st.uid !== process.getuid()) return "it isn't the user's"
  if (st.mode & 0o022) return "others can write to it"
  if (!fs.existsSync(path.join(real, "server.ts"))) return "it has no server.ts"
  return null
}

function runnable(store, name, quiet = false) {
  const sha = readJson(path.join(store, `${name}.json`))?.commit
  if (!SHA.test(String(sha)) || fs.existsSync(path.join(store, "bad", `${sha}.json`))) return null
  const why = whyCantRun(store, path.join(store, "roots", sha))
  if (why && !quiet) say(`the code store's ${name} root ${short(sha)} can't run: ${why}`)
  return why ? null : sha
}

function settleSuspect(store, suspects) {
  const s = readJson(suspects), good = readJson(path.join(store, "good.json"))
  if (!s || !good || !(good.t > s.t)) return
  if (good.commit !== s.commit) {
    const why = `its server stopped as it started ${STARTS_BEFORE_SUSPECT} times, and ${short(good.commit)}'s started fine after`
    writeJson(path.join(store, "bad", `${s.commit}.json`), { why, t: Date.now() })
    say(`${short(s.commit)}'s server stopped as it started ${STARTS_BEFORE_SUSPECT} times, and ${short(good.commit)}'s started fine after: it's bad, not run again`)
  }
  fs.rmSync(suspects, { force: true })
}

function choose(store, env, suspect) {
  const cur = runnable(store, "current"), good = runnable(store, "good")
  if (cur && (env || suspect !== cur || !good || good === cur)) return { from: "current", sha: cur, cur, good }
  return good ? { from: "good", sha: good, cur, good } : null
}

function afterTries({ from, sha, cur, good }, n, suspect, suspects) {
  if (from === "current" && good && good !== cur) {
    writeJson(suspects, { commit: cur, t: Date.now() })
    say(`${short(cur)}'s server stopped as it started ${STARTS_BEFORE_SUSPECT} times: the good root ${short(good)} runs, to tell its code from this machine's trouble`)
    return { from: "good", sha: good, n: 1, env: false }
  }
  fs.rmSync(suspects, { force: true })
  const also = suspect && suspect !== sha ? `, as ${short(suspect)}'s did` : from === "current" ? " (no other root to tell it by)" : ""
  say(`${short(sha)}'s server stopped as it started ${STARTS_BEFORE_SUSPECT} times${also}: this machine's trouble, not the code's: not marked bad, started again`)
  return cur ? { from: "current", sha: cur, n, env: true } : { from, sha, n, env: true }
}

function pick(store) {
  if (!store) return null
  const starts = path.join(store, "service-start.json"), suspects = path.join(store, "service-suspect.json")
  settleSuspect(store, suspects)
  const was = readJson(starts) ?? {}, env = was.env === true, suspect = readJson(suspects)?.commit
  const chosen = choose(store, env, suspect)
  if (!chosen) return null
  const n = was.commit === chosen.sha ? (Number(was.n) || 0) + 1 : 1
  const run = n > STARTS_BEFORE_SUSPECT && !env ? afterTries(chosen, n, suspect, suspects) : { from: chosen.from, sha: chosen.sha, n, env }
  const streak = (Number(was.streak) || 0) + 1
  writeJson(starts, { commit: run.sha, n: run.n, streak, env: run.env, t: Date.now() })
  const wait = streak > STARTS_BEFORE_SUSPECT ? WAITS_S[Math.min(streak - STARTS_BEFORE_SUSPECT, WAITS_S.length) - 1] : 0
  return { root: path.join(store, "roots", run.sha), from: run.from, wait }
}

export function launcherRoot(store) {
  if (!store) return null
  for (const name of ["current", "good"]) {
    const sha = runnable(store, name, true), root = sha && path.join(store, "roots", sha)
    if (root && fs.existsSync(path.join(root, "bin", "vaultite-launch.mjs"))) return root
  }
  return null
}

export async function launch({ checkout }) {
  const at = pick(process.env.VAULTITE_CODE_STORE)
  const root = at?.root ?? checkout
  const own = await import("../core/codecache.ts").then((c) => c.compileCacheEnv(root, "").NODE_COMPILE_CACHE, () => "")
  try { module.enableCompileCache?.(own ? { directory: own, portable: true } : undefined) } catch { module.enableCompileCache?.() }
  if (at?.wait) {
    say(`its last starts failed: waits ${at.wait} s before the next`)
    if (process.env.VAULTITE_SERVICE_WAIT !== "off") await new Promise((r) => setTimeout(r, at.wait * 1000))
  }
  if (at) process.stdout.write(`vaultite: runs the code store's ${at.from} root ${path.basename(root).slice(0, 7)}\n`)
  process.env.VAULTITE_SERVICE_CHECKOUT = checkout
  process.env.VAULTITE_SERVICE = "1"
  process.env.VAULTITE_LOCAL ||= path.join(checkout, "data")
  process.chdir(root)
  await import(pathToFileURL(path.join(root, "server.ts")).href)
}
