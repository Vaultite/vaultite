// tools/compilefill.mjs caches the main process's modules and runs none of them, side effects included. (npm test)
import "./test/isolate.ts"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { check, exit, summary, tempDir } from "./test/lib.ts"

const began = Date.now(), ROOT = path.resolve(import.meta.dirname, "..")
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

const real = fill(path.join(tmp, "real"), ROOT), counted = /(\d+) of (\d+) entries compiled/.exec(real.stdout)
check("every module the main process may load compiles", real.status === 0 && !!counted && counted[1] === counted[2] && Number(counted[2]) > 100 && entries(path.join(tmp, "real")) > 200, real.stdout.slice(-2000) + real.stderr.slice(-500))
await exit(summary("compilefill", began))
