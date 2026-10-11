// Read-only VM enrollment, authentication, real Python file reads, reconnect and revocation on a throwaway vault.
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import crypto from "node:crypto"
import http from "node:http"
import { WebSocket } from "ws"

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-machines-test-"))
const vault = path.join(tmp, "vault"), home = path.join(tmp, "vm")
fs.mkdirSync(path.join(vault, ".vaultite/plugins/machines"), { recursive: true })
fs.mkdirSync(home)
fs.writeFileSync(path.join(vault, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["machines", "mcp"], disabled: [] }))
fs.writeFileSync(path.join(vault, ".vaultite/plugins/machines/data.json"), JSON.stringify({ machines: [{ id: "studio", label: "Studio", url: "http://127.0.0.1:8793" }] }))
fs.writeFileSync(path.join(home, "hello.txt"), "A file from the VM.\n")
fs.writeFileSync(path.join(home, "binary.bin"), Buffer.from([0, 1, 2]))
fs.writeFileSync(path.join(home, "large.txt"), "x".repeat((1 << 20) + 10))
fs.symlinkSync("hello.txt", path.join(home, "link.txt"))
process.env.VAULTITE_LOCAL = path.join(tmp, "local")
const { open } = await import("../core/app.ts")
const { PublicMcp } = await import("../plugins/core/mcp/public.ts")
const app = await open(vault, { start: false })
const mcp = app.plugins.find((p) => p.id === "mcp")!
const pub = new PublicMcp(mcp, PublicMcp.cloudOnly())
pub.start()
const port = await pub.ready
pub.settings.url = `http://127.0.0.1:${port}`
const base = pub.settings.url
const agentPath = path.join(import.meta.dirname, "../plugins/core/machines/dial.py")
const env = { ...process.env, HOME: home, NO_PROXY: "127.0.0.1,localhost" }
const command = async (args: string[]) => {
  const p = spawn("python3", [agentPath, ...args], { env })
  let out = ""
  p.stdout.on("data", (d) => { out += d }); p.stderr.on("data", (d) => { out += d })
  const status = await new Promise<number | null>((r) => p.on("exit", r))
  assert.equal(status, 0, out)
  return out
}
const api = async (method: string, route: string, body = {}, http?: unknown) => {
  const u = new URL(route, "http://x")
  await app.vault.sync()
  const r = await app.run(method, u.pathname.split("/").filter(Boolean), Object.fromEntries(u.searchParams), body, http as never)
  return { status: r.status, body: r.body as Record<string, any> }
}
const until = async (fn: () => Promise<boolean>) => {
  const end = Date.now() + 15000
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)) }
  throw new Error("Timed out")
}
const read = async (file: string) => (await api("GET", `machines/sandbox/fs/read?path=${encodeURIComponent(file)}`)).body as Record<string, unknown>
let failed = false
try {
  const download = await fetch(`${base}/machines/agent.py`)
  assert.equal(download.status, 200)
  assert.match(await download.text(), /OPS =/)
  const enrolled = await command(["enroll", base, "sandbox", "Sandbox"])
  const code = enrolled.match(/Enrollment code: (\d{8})/)![1]
  assert.ok(code)
  assert.equal((await api("GET", "machines/sandbox/fs/list")).status, 404)
  assert.equal((await api("POST", "ops/machines.approve", { code: "00000000" })).status, 404)
  const approved = await api("POST", "ops/machines.approve", { code })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const cfg = JSON.parse(fs.readFileSync(path.join(home, ".vaultite-dial/config.json"), "utf8"))
  const secrets = fs.readFileSync(path.join(tmp, "local/config.json"), "utf8")
  assert.ok(!secrets.includes(cfg.key), "the server stores only a hash")
  assert.equal(fs.statSync(path.join(home, ".vaultite-dial/config.json")).mode & 0o777, 0o600)
  await until(async () => !!(await api("GET", "machines/sandbox/info")).body.online)
  const list = await api("GET", "machines/sandbox/fs/list?path=~")
  assert.equal(list.status, 200)
  assert.ok(list.body.entries.some((e: { name: string }) => e.name === "hello.txt"))
  assert.equal((await read("hello.txt")).text, "A file from the VM.\n")
  assert.equal((await api("POST", "ops/machines.read", { machine: "sandbox", path: "hello.txt" })).body.text, "A file from the VM.\n")
  assert.equal((await api("POST", "ops/machines.approve", { code })).status, 404)
  assert.equal((await read("link.txt")).text, "A file from the VM.\n")
  assert.equal((await read("binary.bin")).base64, "AAEC")
  assert.equal((await read("large.txt")).truncated, true)
  assert.equal((await api("GET", "machines/sandbox/fs/read?path=missing")).status, 400)
  assert.equal((await api("GET", "machines/sandbox/fs/read?path=/dev/zero")).status, 400)
  assert.equal((await api("GET", "machines/sandbox/terminal/anything")).status, 404)
  assert.notEqual((await api("POST", "machines/sandbox/fs/read", {})).status, 200)
  const outsider = { headers: { host: "localhost", "x-forwarded-for": "203.0.113.1" }, socket: { remoteAddress: "127.0.0.1" } }
  assert.equal((await api("GET", "machines/sandbox/fs/list", {}, outsider)).status, 403)
  assert.equal((await api("POST", "ops/machines.revoke", { id: "sandbox" }, outsider)).status, 403)
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(cfg.url, { headers: { Authorization: `Bearer ${crypto.randomBytes(32).toString("base64url")}` } })
    ws.on("unexpected-response", (_req, res) => { assert.equal(res.statusCode, 401); res.resume(); resolve() })
    ws.on("open", () => { ws.terminate(); throw new Error("Invalid key accepted") })
  })
  const machinePlugin = app.plugins.find((p) => p.id === "machines")!
  // A transient disconnect: the real Python process reconnects and serves files again.
  const { keys } = JSON.parse(secrets).machines
  const reconnect = new WebSocket(cfg.url, { headers: { Authorization: `Bearer ${cfg.key}` } })
  await new Promise<void>((r) => reconnect.once("open", () => r()))
  reconnect.terminate()
  await until(async () => (await api("GET", "machines/sandbox/fs/read?path=hello.txt")).status === 200)
  assert.ok(keys.sandbox)
  assert.equal((await api("POST", "ops/machines.revoke", { id: "sandbox" })).status, 200)
  await until(async () => !(await api("GET", "machines/sandbox/info")).body.online)
  assert.equal((await api("GET", "machines/sandbox/fs/list")).status, 502)
  machinePlugin.forget()
  assert.ok((await api("GET", "machines")).body.some((m: { id: string; online: boolean }) => m.id === "sandbox" && !m.online))
  const seen: string[] = []
  const relay = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`)
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/machines/self") return res.end(JSON.stringify({ instance: "another-server", host: "other", plugins: [] }))
    if (req.url === "/api/machines/away/info") return res.end(JSON.stringify({ online: true, platform: "linux" }))
    if (req.url?.startsWith("/api/machines/away/fs/list")) return res.end(JSON.stringify({ path: "/workspace", entries: [{ name: "report.txt", dir: false }] }))
    if (req.url === "/api/ops/machines.revoke") return res.end(JSON.stringify({ id: "away", revoked: true }))
    if (req.url === "/api/ops/machines.approve") return res.end(JSON.stringify({ id: "new-agent", via: "other" }))
    res.statusCode = 404; res.end(JSON.stringify({ error: "missing" }))
  })
  await new Promise<void>((r) => relay.listen(0, "127.0.0.1", () => r()))
  try {
    const relayPort = (relay.address() as { port: number }).port
    const cur = machinePlugin.readSettings()!
    machinePlugin.saveSettings({ ...cur, machines: [...cur.machines, { id: "other", label: "Other", url: `http://127.0.0.1:${relayPort}` }, { id: "away", label: "Away", via: "other" }] })
    machinePlugin.forget()
    const ms = (await api("GET", "machines")).body
    assert.ok(ms.some((m: { id: string; online: boolean; dial: boolean }) => m.id === "away" && m.online && m.dial))
    const forwarded = await api("GET", "machines/away/fs/list?path=/workspace")
    assert.equal(forwarded.status, 200)
    assert.ok(String(forwarded.body.text).includes("report.txt"))
    assert.equal((await api("GET", "machines/away/state")).status, 404)
    assert.equal((await api("POST", "ops/machines.revoke", { id: "away" })).status, 200)
    assert.equal((await api("POST", "machines/other/approve", { code: "12345678" })).status, 200)
    assert.ok(seen.includes("GET /api/machines/away/fs/list?path=%2Fworkspace"))
    assert.ok(seen.includes("POST /api/ops/machines.revoke"))
    assert.ok(seen.includes("POST /api/ops/machines.approve"))
  } finally { relay.closeAllConnections(); relay.close() }
  console.log("ok: forwarding, enrollment, owner access, key hashes, real file reads, limits, reconnect, revocation and offline status")
} catch (e) { failed = true; console.error(e) } finally {
  await command(["stop"]).catch(() => {})
  pub.stop()
  for (const p of app.plugins) for (const fn of p.cleanups) fn()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
}
