// The companion's eval: a session's moments replayed, each turn checked against the contract (on a sandbox vault).
//   node tools/evals/companion.ts [--live [--model sonnet] [--effort medium]] [fixture]   (no --live: its baseline)
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { freePort, stopTerminals, testServer, waitFor } from "../test/lib.ts"
import { type Fixture, score, scoreText } from "./companion/score.ts"

const argv = process.argv.slice(2)
const opt = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv.splice(i, 2)[1] : undefined }
const LIVE = argv.includes("--live") && !!argv.splice(argv.indexOf("--live"), 1)
const MODEL = opt("--model") ?? "sonnet", EFFORT = opt("--effort") ?? "medium"
const FIXTURE = argv[0] ?? path.join(import.meta.dirname, "companion", "2026-11-02.json")
const fx: Fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"))

const base = score(fx.steps, fx.baseline)
console.log(scoreText(`baseline (${path.basename(FIXTURE)})`, base))
if (!LIVE) process.exit(0)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-companion-eval-"))
const VAULT = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local")
const S = await import("../../core/sandbox.ts")
S.makeSandbox(VAULT, S.localToday())
const port = await freePort(), url = `http://127.0.0.1:${port}`
const server = testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: LOCAL } })
const call = async (id: string, params: object = {}) => (await fetch(`${url}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify(params) })).json()
type Act = { t: number; as: string; op: string; seqs?: number[] }
/** The companion's actions so far (its day log on this server's machine). */
const acts = (): Act[] => {
  const dir = path.join(LOCAL, "companion"), key = fs.existsSync(dir) ? fs.readdirSync(dir).find((d) => fs.existsSync(path.join(dir, d, "vault.txt"))) : undefined
  if (!key) return []
  return fs.readdirSync(path.join(dir, key)).filter((f) => f.startsWith("actions-")).sort()
    .flatMap((f) => fs.readFileSync(path.join(dir, key, f), "utf8").split("\n").flatMap((l) => { try { return l ? [JSON.parse(l)] : [] } catch { return [] } }))
}
/** The turn after `t0`: handed, then done (its ops between), or null by the deadline. (A chat session's last turn's end
 *  can land just after the next is handed: a turn takes longer than that.) */
async function turnAfter(t0: number, ms: number) {
  return await waitFor(() => {
    const all = acts(), h = all.findIndex((a) => a.op === "handed" && a.t >= t0)
    const d = h < 0 ? -1 : all.findIndex((a, i) => i > h && a.op === "done" && a.t - all[h].t > 400)
    return d < 0 ? null : { handed: all[h].t, ops: all.slice(h + 1, d).filter((a) => a.op !== "next" && a.op !== "handed" && a.op !== "done"), done: all[d].t }
  }, ms, 300)
}

let code = 0
try {
  if (!await waitFor(async () => (await fetch(`${url}/api/state`)).ok, 60_000)) throw new Error("the sandbox server didn't start")
  await fetch(`${url}/api/config/plugin/companion`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: fx.mode, model: MODEL, effort: EFFORT }) })
  const t0 = Date.now(), started = await call("companion.start")
  if (started.error) throw new Error(`the companion didn't start: ${started.error}`)
  // (its first turn reads ME.md and the docs, handed nothing)
  if (!await waitFor(() => acts().some((a) => a.op === "done" && a.t >= t0), 180_000, 300)) throw new Error("its first turn didn't end")
  console.log(`\nlive: ${MODEL} at ${EFFORT}, ${fx.steps.length} steps`)
  const did: string[][] = [], firsts: number[] = []
  for (const [i, s] of fx.steps.entries()) {
    for (const [p, text] of Object.entries(s.notes)) await fetch(`${url}/api/file`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "app/web" }, body: JSON.stringify({ path: p, text }) })
    const file = path.join(tmp, `step-${i + 1}.jsonl`)
    fs.writeFileSync(file, s.moments.map((m) => JSON.stringify({ ...m, t: 1 })).join("\n"))
    const at = Date.now()
    await call("companion.replay", { file, speed: 1000 })
    const turn = await turnAfter(at, 180_000)
    const ops = turn?.ops.map((a) => a.op) ?? ["(no turn)"]
    if (turn?.ops[0]) firsts.push(turn.ops[0].t - turn.handed)
    did.push(ops)
    console.log(`  ${String(i + 1).padStart(2)} ${ops.join(", ") || "-"}`)
  }
  const r = score(fx.steps, did), med = firsts.sort((a, b) => a - b)[Math.floor(firsts.length / 2)]
  console.log(`\n${scoreText(`live (${MODEL}, ${EFFORT})`, r)}\nfirst action: median ${med === undefined ? "-" : (med / 1000).toFixed(1)} s after it was handed`)
  console.log(`vs the baseline: ${base.right}/${base.of} -> ${r.right}/${r.of}`)
  code = r.right >= base.right ? 0 : 1
} catch (e) { console.error(`companion eval: ${(e as Error).message}`); code = 2 } finally {
  await call("companion.stop", { all: true }).catch(() => {})
  server.kill()
  stopTerminals(port)
  // (its chat keeper, this port's alone)
  const keeper = spawnSync("pgrep", ["-f", `vaultite-chatd1-vaultite-${port}\\.sock`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean)
  for (const pid of keeper) try { process.kill(Number(pid)) } catch { /* gone */ }
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.exit(code)
