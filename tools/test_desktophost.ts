// One server per vault on a machine (core/serving.ts), and a desktop app attaching its browser to it (core/desktopapp.ts):
// who may, another protocol, calls answered, its going. `node tools/test_desktophost.ts` (npm test)
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { check, freePort, sleep, summary, testServer } from "./test/lib.ts"
const began = Date.now()

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-host-test-"))
const VAULT = path.join(tmp, "vault")
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["web-viewer", "machines"], disabled: [] }))
// (its own runtime folder, where the claim is (core/runtime.ts): TMPDIR on a Mac, TEMP on Windows, XDG_RUNTIME_DIR/vaultite on Linux)
const RUN = path.join(tmp, "run")
fs.mkdirSync(RUN, { mode: 0o700 })
const CLAIMS = process.platform === "linux" ? path.join(RUN, "vaultite") : RUN
const claimFile = () => fs.existsSync(CLAIMS) ? fs.readdirSync(CLAIMS).find((f) => f.startsWith("vaultite-serves-")) : undefined

function serve(port: number, env: Record<string, string> = {}) {
  const s = testServer({ stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, `local-${port}`), PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "", TMPDIR: RUN, TEMP: RUN, TMP: RUN, XDG_RUNTIME_DIR: RUN, ...env } })
  let log = ""
  s.stdout!.on("data", (d) => { log += d })
  s.stderr!.on("data", (d) => { log += d })
  const exited = new Promise<number | null>((r) => s.once("exit", (code) => r(code)))
  return { s, log: () => log, exited, up: async () => { for (let i = 0; i < 600 && !/vaultite: vault read/.test(log); i++) await sleep(100) } }
}
const claimed = () => JSON.parse(fs.readFileSync(path.join(CLAIMS, claimFile()!), "utf8"))
function socket(port: number, headers: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/desktop/host`, { headers })
  const heard: any[] = []
  ws.on("message", (d) => heard.push(JSON.parse(String(d))))
  const status = new Promise<number>((r) => { ws.once("open", () => r(101)); ws.once("unexpected-response", (_q, res) => r(res.statusCode ?? 0)); ws.once("error", () => r(0)) })
  const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)))
  return { ws, heard, status, closed }
}
const op = async (port: number, id: string) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}

const port = await freePort()
const one = serve(port)
{
  await one.up()
  const c = claimed()
  check("serving: the server claims its vault (pid, port, a key only this user reads)", c.pid === one.s.pid && c.port === port && c.key.length > 20 &&
    // (Windows' own: a user's TEMP is theirs by its ACL)
    (process.platform === "win32" || (fs.statSync(path.join(CLAIMS, claimFile()!)).mode & 0o077) === 0), c)

  const two = serve(await freePort())
  const code = await Promise.race([two.exited, sleep(30_000).then(() => "running")])
  check("serving: a second server for the vault on this machine doesn't start, saying which serves it", code === 1 && /served on this machine already/.test(two.log()), [code, two.log().slice(-300)])

  const get = (p: string, headers: Record<string, string>) => new Promise<number>((r) =>
    http.get({ host: "127.0.0.1", port, path: p, headers }, (res) => { res.resume(); r(res.statusCode ?? 0) }).on("error", () => r(0)))
  const rebound = { host: `attacker.example:${port}` }
  const [loading, served, api, own] = [await get("/api/loading", rebound), await get("/v/Note.md", rebound), await get("/api/files", rebound), await get("/v/Note.md", {})]
  check("dns rebinding: a page under another name reads nothing (the API, loading, plugins' pages)", loading === 403 && served === 403 && api === 403 && own !== 403, [loading, served, api, own])
  const funnel = await get("/api/files", { "tailscale-funnel-request": "?1" })
  check("funnel: the internet through Tailscale Funnel is refused", funnel === 403, funnel)

  const none = await op(port, "web-viewer.tabs")
  check("no app attached: the browser op says to open one", none.status >= 400 && /none is attached to this server/.test(JSON.stringify(none.body)), none)

  const keyless = socket(port, {})
  check("attach: refused without the key", await keyless.status === 403)
  const page = socket(port, { "x-vaultite-host-key": c.key, Origin: `http://127.0.0.1:${port}` })
  check("attach: refused from a page (an Origin)", await page.status === 403)

  const old = socket(port, { "x-vaultite-host-key": c.key })
  await old.status
  old.ws.send(JSON.stringify({ type: "hello", protocol: 0 }))
  check("attach: another protocol is turned away (4000)", await old.closed === 4000)
  const said = await op(port, "web-viewer.tabs")
  check("… and the browser op says why", /protocol 0, this server 1/.test(JSON.stringify(said.body)), said.body)

  const app = socket(port, { "x-vaultite-host-key": c.key })
  const calls: any[] = []
  await app.status
  app.ws.send(JSON.stringify({ type: "hello", protocol: 1 }))
  app.ws.on("message", (d) => {
    const m = JSON.parse(String(d))
    if (m.type !== "desktop:call") return
    calls.push(m)
    const value = m.name === "agent:tabs" ? [{ tab: 7, url: "https://example.com/", title: "Example", access: "act", container: "Agents" }]
      : m.name === "remote:sites" ? { "c-agents": [{ site: "example.com", signed: true, account: "alice.park" }] }
      : m.name === "remote:key" ? { key: "made-up" } : m.name === "remote:take" ? { ok: true } : null
    app.ws.send(JSON.stringify({ type: "desktop:reply", rid: m.rid, value }))
  })
  await sleep(300)
  check("attach: welcomed", app.heard.some((m) => m.type === "welcome" && m.protocol === 1), app.heard)
  const tabs = await op(port, "web-viewer.tabs")
  check("attached: the server's browser calls reach the app", tabs.status === 200 && JSON.stringify(tabs.body).includes("Example"), tabs)
  const call = (p: string, body?: unknown) => fetch(`http://127.0.0.1:${port}/api/${p}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) as any }))
  const sets = await call("web-viewer/logins?local=1&profiles=,c-agents")
  check("logins: another machine asking hears who's signed in where in this browser (names only)", sets.status === 200 && sets.body?.sets?.["c-agents"]?.[0]?.account === "alice.park"
    && JSON.stringify(calls.find((x) => x.name === "remote:sites")?.args) === JSON.stringify([["", "c-agents"]]), [sets, calls])
  const key = await call("web-viewer/logins/key")
  const took = await call("web-viewer/logins/take", { to: "c-agents", sealed: "{\"v\":1}" })
  check("logins: a sealed login reaches the app as it came, for the set of logins named", key.body?.key === "made-up" && took.body?.ok === true
    && JSON.stringify(calls.find((x) => x.name === "remote:take")?.args) === JSON.stringify(["c-agents", "{\"v\":1}"]), [key, took])
  const bad = await call("web-viewer/logins/take", { to: "../x", sealed: "{}" })
  const foreign = await fetch(`http://127.0.0.1:${port}/api/web-viewer/logins/key`, { headers: { Origin: "http://attacker.example" } })
  check("logins: a bad set of logins, or another site's page, is refused", bad.status === 400 && foreign.status === 403, [bad.status, foreign.status])
  const self = await fetch(`http://127.0.0.1:${port}/api/machines/self`).then((r) => r.json()) as any
  check("attached: Machines says this always-on server has a browser", self.desktop === true && self.standalone === true, self)

  const next = socket(port, { "x-vaultite-host-key": c.key })
  await next.status
  next.ws.send(JSON.stringify({ type: "hello", protocol: 1 }))
  check("attach: a newer app takes over, the old one told not to come back (4001)", await app.closed === 4001)
  next.ws.close()
  await sleep(300)
  const gone = await op(port, "web-viewer.tabs")
  check("detached: the browser op says none is attached again", /none is attached/.test(JSON.stringify(gone.body)), gone.body)

  one.s.kill("SIGTERM")
  await one.exited
  // (Windows ends a process at once, so its claim stays behind: it's its dead pid's, which counts for nothing)
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  check("serving: a server that stops lets its vault go", !claimFile() || (process.platform === "win32" && !alive(claimed().pid)))
}
process.exit(summary("desktophost", began))
