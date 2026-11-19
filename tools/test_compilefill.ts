// tools/compilefill.mjs caches the main process's modules, runs none, and a moved read-only root's cache is hit. (npm test)
import "./test/isolate.ts"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { check, exit, summary, tempDir } from "./test/lib.ts"
import { codeCacheDir } from "../electron/shell/compilecache.mjs"

const began = Date.now(), ROOT = path.resolve(import.meta.dirname, "..")
os.setPriority(process.platform === "win32" ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_LOW)
const electron = z.string().parse(createRequire(path.join(ROOT, "package.json"))("electron"))
const tmp = tempDir("vaultite-compilefill-test-"), root = path.join(tmp, "root"), ran = path.join(tmp, "ran")
fs.mkdirSync(path.join(root, "electron"), { recursive: true })
fs.mkdirSync(path.join(root, "tools"))
fs.copyFileSync(path.join(ROOT, "tools", "compilefill.mjs"), path.join(root, "tools", "compilefill.mjs"))
fs.writeFileSync(path.join(root, "electron", "side.ts"), `import fs from "node:fs"\nconst at: string = ${JSON.stringify(ran)}\nfs.writeFileSync(at, "ran")\nexport const x = 1\n`)
fs.writeFileSync(path.join(root, "electron", "uses.ts"), `import { x } from "./side.ts"\nexport const y: number = x + 1\n`)

const fill = (dir: string, cwd: string) => spawnSync(electron, [path.join(cwd, "tools", "compilefill.mjs")], { cwd, encoding: "utf8",
  env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: undefined, ELECTRON_RUN_AS_NODE: "1", NODE_COMPILE_CACHE: dir, NODE_COMPILE_CACHE_PORTABLE: "1" } })
const entries = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((d) => fs.readdirSync(path.join(dir, d))).length : 0)

const own = fill(path.join(tmp, "cache"), root)
check("a fixture's two modules are compiled", own.status === 0 && /2 of 2 entries compiled/.test(own.stdout), own.stdout + own.stderr)
check("...into the cache (their stripped TS and code)", entries(path.join(tmp, "cache")) >= 4, entries(path.join(tmp, "cache")))
check("...and neither ran (its file write never happened)", !fs.existsSync(ran))

const control = spawnSync(electron, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(path.join(root, "electron", "uses.ts")).href)})`],
  { encoding: "utf8", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } })
check("(the fixture's side effect does happen when it's imported for real)", control.status === 0 && fs.existsSync(ran), control.stderr)

const at = path.join(tmp, "made"), moved = path.join(tmp, "root-moved")
fs.mkdirSync(path.join(at, "tools"), { recursive: true })
for (const d of ["electron", "core"]) fs.cpSync(path.join(ROOT, d), path.join(at, d), { recursive: true })
for (const f of ["package.json", "tools/compilefill.mjs"]) fs.copyFileSync(path.join(ROOT, f), path.join(at, f))
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(at, "node_modules"), "junction")
const made = fill(codeCacheDir(at), at), counted = /(\d+) of (\d+) entries compiled/.exec(made.stdout)
check("every module the main process may load compiles", made.status === 0 && !!counted && counted[1] === counted[2] && Number(counted[2]) > 100 && entries(codeCacheDir(at)) > 200,
  made.stdout.slice(-2000) + made.stderr.slice(-1500))
fs.renameSync(at, moved)
const CACHE = codeCacheDir(moved), filledAt = fs.existsSync(CACHE)
const writable = (on: boolean) => { for (const f of fs.readdirSync(CACHE, { recursive: true, encoding: "utf8" }).map((f) => path.join(CACHE, f)).concat(CACHE)) fs.chmodSync(f, on ? 0o755 : 0o555) }
if (filledAt) writable(false)
const load = ["early.ts", "main.ts"].map((f) => pathToFileURL(path.join(moved, "electron", f)).href)
const launch = spawnSync(electron, ["--input-type=module", "-e", `import module from "node:module"
import { ownCompileCache } from ${JSON.stringify(pathToFileURL(path.join(moved, "electron", "shell", "compilecache.mjs")).href)}
const chosen = ownCompileCache(${JSON.stringify(moved)})
console.log(JSON.stringify(chosen))
if (chosen) module.enableCompileCache({ directory: chosen, portable: true })
for (const u of ${JSON.stringify(load)}) try { await import("data:text/javascript," + encodeURIComponent("import " + JSON.stringify(u) + "; import { never } from 'node:path'")) } catch {}`],
{ encoding: "utf8", env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: undefined, ELECTRON_RUN_AS_NODE: "1", NODE_DEBUG_NATIVE: "COMPILE_CACHE" } })
if (filledAt) writable(true)
const chosen = launch.stdout.split("\n")[0]?.trim()
const ours = launch.stderr.split(/\r?\n/).filter((l) => l.includes(`${pathToFileURL(fs.realpathSync(moved)).href}/electron/`))
const said = (re: RegExp) => ours.filter((l) => re.test(l))
const stripped = said(/retrieving transpile cache for StrippedTypeScript .*success/), compiled = said(/V8 code cache for ESM .* was accepted/)
const missed = said(/no transpile cache|was rejected|no such file/)
check("a root's filled cache is the one it ships once moved and read only (shell/compilecache.mjs)", filledAt && chosen === JSON.stringify(CACHE), { filledAt, chosen, CACHE })
check("...and answers for every module the first window loads: none stripped or compiled again", stripped.length > 30 && !missed.length && compiled.length >= stripped.length,
  { stripped: stripped.length, compiled: compiled.length, missed: missed.slice(0, 5), said: launch.stderr.slice(0, 600) })
await exit(summary("compilefill", began))
