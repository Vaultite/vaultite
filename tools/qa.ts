// Every UI QA script (web/qa/*.mjs), each on a fresh sandbox and server; exit 1 on any failure.
// node tools/qa.ts [script...] [--repeat 3] [--jobs 3]     (npm run qa; after npm run build)
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const QA = path.join(ROOT, "web/qa")
/** Not tests (benchmarks, a library, the smoke test), needing more than one machine, or another build (the demo's). */
const SKIP = new Set(["boot", "perf", "stability", "termperf", "shots", "subjects", "machines", "termhost", "demo"])
const TIMEOUT = 8 * 60_000

const argv = process.argv.slice(2)
const opt = (name: string, d: number) => { const i = argv.indexOf(`--${name}`); return i < 0 ? d : Number(argv.splice(i, 2)[1]) }
const repeat = opt("repeat", 1), jobs = opt("jobs", 3)
const names = argv.length ? argv.map((a) => path.basename(a, ".mjs"))
  : fs.readdirSync(QA).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).filter((n) => !SKIP.has(n))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)) })
})

/** The usage line's arguments, after `node web/qa/<name>.mjs`. */
function usage(name: string) {
  const head = fs.readFileSync(path.join(QA, `${name}.mjs`), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n")
  const m = new RegExp(`node web/qa/${name}\\.mjs([^\\n(]*)`).exec(head)
  return (m?.[1] ?? "").match(/<[^>]+>|\[[^\]]+\]/g) ?? []
}

type Server = { base: string, port: number, proc: ReturnType<typeof spawn> }
async function serve(vault: string, local: string, env: Record<string, string>): Promise<Server> {
  const port = await freePort()
  const proc = spawn(process.execPath, [path.join(ROOT, "server.ts")], {
    cwd: ROOT, stdio: "ignore", env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: local },
  })
  const base = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`${base}api/state`)).ok) return { base, port, proc } } catch { await wait(250) } }
  throw new Error(`the server on ${vault} didn't start`)
}
function stop(s: Server) {
  if (s.proc.exitCode === null) s.proc.kill()
  const pid = path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${s.port}.sock.pid`)
  try { process.kill(Number(fs.readFileSync(pid, "utf8"))) } catch {}
  spawnSync("tmux", ["-L", `vaultite-${s.port}`, "kill-server"], { stdio: "ignore" })
}

async function run(name: string): Promise<{ ok: boolean, ms: number, out: string, skipped?: string }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `vaultite-qa-${name}-`))
  const vault = path.join(tmp, "vault"), out = path.join(tmp, "out"), claude = path.join(tmp, "claude")
  fs.mkdirSync(out)
  fs.cpSync(path.join(ROOT, "tools/fixtures/claude"), claude, { recursive: true })
  const made = spawnSync(process.execPath, [path.join(ROOT, "bin/vau"), "sandbox", vault], { encoding: "utf8" })
  if (made.status !== 0) return { ok: false, ms: 0, out: made.stderr || made.stdout }
  const servers: Server[] = []
  const t = Date.now()
  try {
    const env: Record<string, string> = { CLAUDE_CONFIG_DIR: claude }
    // (a made-up plugin directory and git repositories, on this machine: web/qa/pluginstore.mjs)
    if ((usage(name) as string[]).includes("<plugin index>")) Object.assign(env, { VAULTITE_PLUGIN_INDEX: path.join(tmp, "index.json"), VAULTITE_GITHUB: `file://${path.join(tmp, "repos")}` })
    const main = await serve(vault, path.join(tmp, "local"), env)
    servers.push(main)
    const args: string[] = []
    for (const tok of usage(name)) {
      const t = tok.slice(1, -1).replace(/^<|>$/g, "")
      if (/^fresh base url$/.test(t)) {
        fs.mkdirSync(path.join(tmp, "fresh"))
        const fresh = await serve(path.join(tmp, "fresh"), path.join(tmp, "fresh-local"), env)
        servers.push(fresh)
        args.push(fresh.base)
      } else if (/^fresh vault path$/.test(t)) args.push(path.join(tmp, "fresh"))
      else if (/base( url)?$/.test(t)) args.push(main.base)
      else if (t === "vault path") args.push(vault)
      else if (t === "vault copy") { fs.cpSync(vault, path.join(tmp, "copy"), { recursive: true }); args.push(path.join(tmp, "copy")) }
      else if (/^claude dir$/.test(t)) args.push(claude)
      else if (t === "plugin index") args.push(path.join(tmp, "index.json"))
      else if (t === "plugin repos") args.push(path.join(tmp, "repos"))
      else if (/(out|shots|screenshots) dir$/.test(t)) args.push(out)
      else if (tok.startsWith("[")) break
      else return { ok: true, ms: 0, out: "", skipped: `needs ${tok}` }
    }
    const child = spawn(process.execPath, [path.join(QA, `${name}.mjs`), ...args], {
      cwd: ROOT, env: { ...process.env, ...env, QA_BASE: main.base, VAULTITE_URL: main.base.slice(0, -1) },
    })
    let text = ""
    child.stdout.on("data", (b) => { text += b })
    child.stderr.on("data", (b) => { text += b })
    const timer = setTimeout(() => { text += `\n(timed out after ${TIMEOUT / 60_000} min)`; child.kill() }, TIMEOUT)
    const code = await new Promise<number | null>((r) => child.on("close", r))
    clearTimeout(timer)
    return { ok: code === 0, ms: Date.now() - t, out: text }
  } catch (e) {
    return { ok: false, ms: Date.now() - t, out: String(e) }
  } finally {
    servers.forEach(stop)
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// One copy of a script at a time: some use fixed ports or session names.
const queue = Array.from({ length: repeat }, () => names).flat()
const running = new Set<string>()
const next = () => { const i = queue.findIndex((n) => !running.has(n)); return i < 0 ? null : queue.splice(i, 1)[0] }
const fails: string[] = []
const runs = new Map<string, boolean[]>()
await Promise.all(Array.from({ length: jobs }, async () => {
  while (queue.length) {
    const name = next()
    if (!name) { await wait(1000); continue }
    running.add(name)
    const r = await run(name)
    running.delete(name)
    if (r.skipped) { console.log(`skip ${name} (${r.skipped})`); continue }
    runs.set(name, [...runs.get(name) ?? [], r.ok])
    console.log(`${r.ok ? "ok  " : "FAIL"} ${name} (${(r.ms / 1000).toFixed(0)} s)`)
    if (!r.ok) fails.push(`--- ${name}\n${r.out.trim().split("\n").filter((l) => !l.startsWith("ok")).slice(-25).join("\n")}`)
  }
}))
const flaky = [...runs].filter(([, rs]) => rs.includes(true) && rs.includes(false)).map(([n]) => n)
if (fails.length) console.log(`\n${fails.join("\n\n")}`)
console.log(`\n${[...runs.values()].flat().filter(Boolean).length}/${[...runs.values()].flat().length} runs passed` +
  (flaky.length ? `; flaky: ${flaky.join(", ")}` : ""))
process.exit(fails.length ? 1 : 0)
