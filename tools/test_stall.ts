// A file iCloud is slow to give never holds the server: FIFOs stand in for them (a read waits until written), and the
// server still answers and reads the rest of the vault. `node tools/test_stall.ts` (npm test)
import { execFileSync, spawn } from "node:child_process"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

const ROOT = path.dirname(import.meta.dirname)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-stall-test-"))
const VAULT = path.join(tmp, "vault")
const fails: string[] = []
function check(name: string, ok: unknown, got?: unknown) {
  console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : `  -> ${JSON.stringify(got)?.slice(0, 400)}`))
  if (!ok) fails.push(name)
}
const put = (rel: string, text: string) => { fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); fs.writeFileSync(path.join(VAULT, rel), text) }
const fifo = (rel: string) => { fs.mkdirSync(path.dirname(path.join(VAULT, rel)), { recursive: true }); execFileSync("mkfifo", [path.join(VAULT, rel)]) }
put(".vaultite/plugins.json", "{}\n") // (a vault the app has opened before: no setup)
put("Notes/Alpha.md", "---\ntype: note\n---\n\nAlpha.\n")
put("Notes/Beta.md", "---\ntype: note\n---\n\nBeta.\n")
fifo("Notes/Slow.md")
// More than libuv's 4 threads, each held by one of them (the server asks for more).
for (let i = 1; i <= 6; i++) fifo(`Held/Note ${i}.md`)
// What the startup needn't read: attachments (a text one, which File history keeps) and the trash.
fifo("Attachments/data.txt")
fifo("Attachments/photo.png")
fifo(".trash/Old.md")

const port = await new Promise<number>((ok) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)) }) })
const server = spawn(process.execPath, [path.join(ROOT, "server.ts")], {
  env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, "local"), PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "" },
  stdio: ["ignore", "pipe", "pipe"],
})
let log = ""
server.stdout.on("data", (d) => { log += d })
server.stderr.on("data", (d) => { log += d })
const base = `http://127.0.0.1:${port}/api/`
// A request gives up after 8 s: a held server is a failure, not a hung test.
async function get(p: string, wait = 8000) {
  try {
    const r = await fetch(base + p, { signal: AbortSignal.timeout(wait) })
    return { status: r.status, body: await r.json().catch(() => null) as any }
  } catch (e) {
    return { status: 0, body: String(e) }
  }
}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
const t0 = Date.now()

try {
  let loading: any = null
  while (Date.now() - t0 < 10_000) {
    const r = await get("loading", 1000)
    if (r.status === 200) { loading = r.body; if (loading.ready || loading.downloading.length) break }
    await sleep(100)
  }
  check("loading: answers before the vault is read, naming the file iCloud is still downloading",
    loading && (loading.downloading.includes("Notes/Slow.md") || loading.ready), loading)
  const state = await get("state")
  const files = (state.body?.files?.files ?? []).map((f: any) => f.path)
  check("state: answers while a file is still being read", state.status === 200 && Date.now() - t0 < 8000, [state.status, Date.now() - t0])
  check("state: the rest of the vault is read", files.includes("Notes/Alpha.md") && files.includes("Notes/Beta.md"), files)
  check("state: the file being read isn't in it yet, and is named", !files.includes("Notes/Slow.md") && state.body?.vault?.downloading?.includes("Notes/Slow.md"), state.body?.vault)
  check("loading: the file is still named once the vault is read", (await get("loading")).body?.downloading?.includes("Notes/Slow.md"))
  const one = await get("file?path=Notes/Alpha.md")
  check("a file that's there opens meanwhile", one.status === 200 && one.body.text.includes("Alpha."), one)
  const t1 = Date.now()
  const again = await get("state")
  check("a sync after doesn't wait for it again", again.status === 200 && Date.now() - t1 < 1500, Date.now() - t1)

  // iCloud gives it: the read ends, and the vault reads it without being asked.
  // (the file is there for good, then the read waiting on the FIFO ends)
  const held = fs.openSync(path.join(VAULT, "Notes/Slow.md"), "w")
  put("Notes/.Slow.tmp", "---\ntype: note\n---\n\nArrived.\n")
  fs.renameSync(path.join(VAULT, "Notes/.Slow.tmp"), path.join(VAULT, "Notes/Slow.md"))
  fs.closeSync(held)
  let arrived = false
  for (let i = 0; i < 50 && !arrived; i++) {
    await sleep(100)
    const s = await get("state")
    arrived = (s.body?.files?.files ?? []).some((f: any) => f.path === "Notes/Slow.md") && !s.body.vault.downloading.includes("Notes/Slow.md")
  }
  check("once it arrives it's read", arrived)
  const slow = await get("file?path=Notes/Slow.md")
  check("and opens", slow.status === 200 && slow.body.text.includes("Arrived."), slow)
} finally {
  server.kill("SIGKILL")
}
if (fails.length) console.log(log.slice(-3000))
fs.rmSync(tmp, { recursive: true, force: true })
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed")
process.exit(fails.length ? 1 : 0)
