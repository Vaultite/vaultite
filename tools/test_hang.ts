// A peer stops reading a POST's body, the fetch times out, the peer reads again; a hung server is killed. (npm test)
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { check, exit, skip, summary, tempDir } from "./test/lib.ts"
import type { Watchdog } from "../core/watchdog.ts"
const began = Date.now()
const tmp = tempDir("vaultite-hang-test-")
const core = (f: string) => pathToFileURL(path.join(import.meta.dirname, "..", "core", f)).href

type Ran = { code: number | null; signal: NodeJS.Signals | null; out: string; ms: number }
function runModuleKilledAfter(js: string, ms: number, env: Record<string, string> = {}, during?: (pid: number) => void): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = Date.now(), c = spawn(process.execPath, ["--input-type=module", "-e", js], { cwd: tmp, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    c.stdout.on("data", (d) => { out += d }); c.stderr.on("data", (d) => { out += d })
    const kill = setTimeout(() => c.kill("SIGKILL"), ms)
    if (during && c.pid) during(c.pid)
    c.on("exit", (code, signal) => { clearTimeout(kill); resolve({ code, signal, out, ms: Date.now() - t0 }) })
  })
}

const PEER = `import http2 from "node:http2"; import fs from "node:fs"
const s = http2.createSecureServer({ key: fs.readFileSync("k.pem"), cert: fs.readFileSync("c.pem"), allowHTTP1: true, settings: { initialWindowSize: 1024 } }, (req, res) => {
  if (req.method === "GET") return res.end("v" + req.httpVersion)
  req.pause(); req.on("data", () => {}); req.on("end", () => res.end("ok"))
  setTimeout(() => req.resume(), 1500)
})
s.listen(0, "127.0.0.1", () => console.log("port", s.address().port))`
const CLIENT = (h1: boolean) => `${h1 ? `import { fetchOverHttp1 } from ${JSON.stringify(core("http1.ts"))}; console.log("h1", await fetchOverHttp1())` : ""}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"
const base = "https://127.0.0.1:" + process.env.PEER_PORT
let ticks = 0; setInterval(() => ticks++, 50)
console.log("spoke", await (await fetch(base + "/warm")).text())
await fetch(base + "/x", { method: "POST", body: Buffer.alloc(2000, 97), signal: AbortSignal.timeout(500) }).then((r) => console.log("status", r.status), (e) => console.log("threw", e.name))
const before = ticks; setTimeout(() => { console.log("ticks", ticks - before); process.exit(0) }, 3000)`

const openssl = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "k.pem", "-out", "c.pem", "-days", "2", "-subj", "/CN=localhost"], { cwd: tmp })
if (openssl.status !== 0) skip("fetch: a peer that stops reading", "no openssl to make the peer's certificate")
else {
  const peer = spawn(process.execPath, ["--input-type=module", "-e", PEER], { cwd: tmp, stdio: ["ignore", "pipe", "inherit"] })
  const port = await new Promise<string>((r) => peer.stdout.on("data", (d) => { const m = /port (\d+)/.exec(String(d)); if (m) r(m[1]) }))
  try {
    const got = await runModuleKilledAfter(CLIENT(true), 15_000, { PEER_PORT: port })
    const ticks = Number(/ticks (\d+)/.exec(got.out)?.[1] ?? 0)
    check("fetch speaks HTTP/1.1 once fetchOverHttp1 ran (the peer offers HTTP/2)", /h1 http1/.test(got.out) && /spoke v1\.1/.test(got.out), got.out)
    check("a fetch timed out on a peer that stopped reading leaves the process running once the peer reads again",
      got.code === 0 && /threw TimeoutError/.test(got.out) && ticks > 10, { code: got.code, signal: got.signal, ticks, out: got.out })
    if (process.env.VAULTITE_HANG_CONTROL === "1") {
      const h2 = await runModuleKilledAfter(CLIENT(false), 6000, { PEER_PORT: port })
      console.log(`control (Node's HTTP/2): ${h2.signal ? `hung, killed after ${h2.ms} ms` : `ran: ${h2.out.trim().split("\n").at(-1)}`}`)
    }
  } finally { peer.kill("SIGKILL") }
}

const WATCHED = (o: Partial<Watchdog>, then: string) => `import { killWhenMainThreadStalls } from ${JSON.stringify(core("watchdog.ts"))}
killWhenMainThreadStalls({ stallMs: 1500, memStallMs: 400, memMB: 1e6, everyMs: 100, ...${JSON.stringify(o)} })
console.log("watching")
${then}`
const spin = `setTimeout(() => { for (;;) {} }, 300)`
const killed = (r: Ran) => r.signal === "SIGKILL" || (process.platform === "win32" && r.code !== null && r.code !== 0)
{
  const got = await runModuleKilledAfter(WATCHED({}, spin), 10_000)
  const stalledS = Number(/watchdog: the main thread stalled (\d+) s/.exec(got.out)?.[1] ?? Infinity)
  check("a main thread stuck in a loop is killed by the watchdog, saying so", killed(got) && stalledS < 5, got)
}
{
  const got = await runModuleKilledAfter(WATCHED({}, `setTimeout(() => process.exit(0), 3000)`), 10_000)
  check("an idle main thread isn't killed", got.code === 0 && !/watchdog/.test(got.out), got)
}
{
  const got = await runModuleKilledAfter(WATCHED({ stallMs: 60_000, memMB: 1 }, spin), 10_000)
  const stalledS = Number(/stalled (\d+) s/.exec(got.out)?.[1] ?? Infinity)
  check("a stalled main thread holding too much memory is killed sooner", killed(got) && stalledS < 5, got)
}
if (process.platform === "win32") skip("watchdog: a stopped process", "no SIGSTOP on Windows")
else {
  const got = await runModuleKilledAfter(WATCHED({}, `setTimeout(() => process.exit(0), 6000)`), 15_000, {}, (pid) => {
    setTimeout(() => process.kill(pid, "SIGSTOP"), 500)
    setTimeout(() => process.kill(pid, "SIGCONT"), 3500)
  })
  check("a process stopped and started again (the machine slept) isn't killed", got.code === 0 && !/watchdog/.test(got.out), got)
}

fs.rmSync(tmp, { recursive: true, force: true })
await exit(summary("hang", began))
