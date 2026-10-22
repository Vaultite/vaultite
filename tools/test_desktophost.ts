// One server per vault on a machine (core/serving.ts), and a desktop app attaching its browser to it (core/desktopapp.ts):
// who may, another protocol, calls answered, its going. `node tools/test_desktophost.ts` (npm test)
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { check, freePort, sleep, summary, testServer } from "./test/lib.ts"
const began = Date.now()

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-host-test-"))
const VAULT = path.join(tmp, "vault")
fs.mkdirSync(path.join(VAULT, ".vaultite"), { recursive: true })
fs.writeFileSync(path.join(VAULT, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["web-viewer", "machines"], disabled: [] }))
// (its own runtime folder, where the claim is: another "machine" is another TMPDIR)
const RUN = path.join(tmp, "run")
fs.mkdirSync(RUN)

function serve(port: number, env: Record<string, string> = {}) {
  const s = testServer({ stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: path.join(tmp, `local-${port}`), PORT: String(port), HOST: "127.0.0.1", VAULTITE_DESKTOP: "", TMPDIR: RUN, ...env } })
  let log = ""
  s.stdout!.on("data", (d) => { log += d })
  s.stderr!.on("data", (d) => { log += d })
  const exited = new Promise<number | null>((r) => s.once("exit", (code) => r(code)))
  return { s, log: () => log, exited, up: async () => { for (let i = 0; i < 600 && !/vaultite: vault read/.test(log); i++) await sleep(100) } }
}
const claimed = () => JSON.parse(fs.readFileSync(path.join(RUN, fs.readdirSync(RUN).find((f) => f.startsWith("vaultite-serves-"))!), "utf8"))
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
    (fs.statSync(path.join(RUN, fs.readdirSync(RUN).find((f) => f.startsWith("vaultite-serves-"))!)).mode & 0o077) === 0, c)

  const two = serve(await freePort())
  const code = await Promise.race([two.exited, sleep(30_000).then(() => "running")])
  check("serving: a second server for the vault on this machine doesn't start, saying which serves it", code === 1 && /served on this machine already/.test(two.log()), [code, two.log().slice(-300)])

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
  await app.status
  app.ws.send(JSON.stringify({ type: "hello", protocol: 1 }))
  app.ws.on("message", (d) => {
    const m = JSON.parse(String(d))
    if (m.type === "desktop:call") app.ws.send(JSON.stringify({ type: "desktop:reply", rid: m.rid, value: m.name === "agent:tabs" ? [{ tab: 7, url: "https://example.com/", title: "Example", access: "act", container: "Agents" }] : null }))
  })
  await sleep(300)
  check("attach: welcomed", app.heard.some((m) => m.type === "welcome" && m.protocol === 1), app.heard)
  const tabs = await op(port, "web-viewer.tabs")
  check("attached: the server's browser calls reach the app", tabs.status === 200 && JSON.stringify(tabs.body).includes("Example"), tabs)
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
  check("serving: a server that stops lets its vault go", !fs.readdirSync(RUN).some((f) => f.startsWith("vaultite-serves-")))
}
process.exit(summary("desktophost", began))
