// A launch reads electron/ from a filled compile cache (tools/compilefill.mjs, shell/boot.mjs): node web/qa/compilecache.mjs <vault copy>
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until } from "./lib/qa.mjs"
import { ownedNow } from "../../electron/devinstance.ts"

const { args: [VAULT], check, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-compilecache-"))
const cache = path.join(TMP, "cache"), userData = path.join(TMP, "userData")
const electron = createRequire(import.meta.url)("electron")
const cacheEnv = { NODE_DISABLE_COMPILE_CACHE: undefined, NODE_COMPILE_CACHE: cache, NODE_COMPILE_CACHE_PORTABLE: "1" }
const kill = (pid) => { try { process.kill(pid, "SIGKILL") } catch { return } }
const entries = () => fs.readdirSync(cache).flatMap((d) => fs.readdirSync(path.join(cache, d))).length

const fill = spawnSync(electron, [path.join(ROOT, "tools", "compilefill.mjs")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...cacheEnv, ELECTRON_RUN_AS_NODE: "1" } })
const filled = fs.existsSync(cache) ? entries() : 0
check("the fill compiles every module the main process may load", fill.status === 0 && filled > 200, fill.stdout.slice(-500) + fill.stderr.slice(-500))

let said = ""
const env = { ...process.env, ...cacheEnv, NODE_DEBUG_NATIVE: "COMPILE_CACHE", VAULTITE_QUIET: "1", VAULTITE_USER_DATA: userData, VAULTITE_LOCAL: path.join(TMP, "local") }
const app = spawn(electron, [...(process.platform === "linux" ? ["--no-sandbox"] : []), ROOT, "--vault", VAULT], { env, stdio: ["ignore", "ignore", "pipe"], detached: true })
app.stderr.on("data", (d) => { said += d })
const ours = new RegExp(`StrippedTypeScript file://\\S*${path.basename(ROOT).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/electron/`)
try {
  const rest = await until(() => /StrippedTypeScript file:\/\/\S*\/electron\/mainrest\.ts/.test(said), 60_000)
  const lines = said.split("\n").filter((l) => ours.test(l))
  const hits = lines.filter((l) => /retrieving transpile cache for StrippedTypeScript .*success/.test(l)), misses = lines.filter((l) => /no transpile cache for/.test(l))
  check("the app launched and loaded its code after the first window (mainrest.ts)", rest, said.slice(-1500))
  check("...every module of electron/ from the filled cache, none stripped again", hits.length > 40 && !misses.length, { hits: hits.length, misses: misses.slice(0, 5) })
  check("...and it saved nothing new into the cache", !said.split("\n").some((l) => /\[compile cache\] saving/.test(l)), said.split("\n").filter((l) => /saving/.test(l)).slice(0, 5))
} finally {
  for (const pid of [...ownedNow(userData), -app.pid]) kill(pid)
}
done()
