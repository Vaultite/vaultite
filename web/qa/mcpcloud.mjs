// Vaultite Cloud (plugins/core/mcp/cloud.ts) against a fake relay speaking its protocol: signing in with a code (bad, 429),
// the tunnel forwarding requests, SSE streamed chunk by chunk, cancel, ping, reconnecting, 4000 (another machine), 4001 and 401
// (revoked), sign-out; then a server signed in from Connections (Chrome) and its ops, an app connecting through the relay
// (OAuth addresses from the forwarded host, never a spoofed one), and only the public listener reachable. Own servers and
// temp folders; WRITES only to the vault copy given.
//   node web/qa/mcpcloud.mjs <vault copy>
import { spawn, spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { WebSocketServer } from "ws"
import { ROOT, freePort, launch, qa, until, wait } from "./lib/qa.mjs"

const { args: [VAULT], check, watch, noErrors, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-mcpcloud-"))

/** cloud.vaultite.com as the protocol says it behaves: one-time codes redeemed for a token, one Mac per account. */
async function fakeRelay() {
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const r = { url, names: [], revoked: [], tokens: new Set(), codes: new Set(), conn: null, conns: 0, frames: [], pending: new Map(), n: 0, slow: 0 }
  const body = (req) => new Promise((res) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => res(s ? JSON.parse(s) : {})) })
  const send = (res, status, d) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)) }
  const server = http.createServer(async (req, res) => {
    const d = await body(req)
    if (req.url === "/api/device/redeem") {
      if (r.slow > 0) { r.slow--; return send(res, 429, { error: "slow_down" }) }
      const code = String(d.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      if (!r.codes.delete(code) || !d.name) return send(res, 400, { error: "invalid" })
      r.names.push(d.name)
      for (const t of r.tokens) r.tokens.delete(t) // one Mac per account: the one before is revoked
      const token = crypto.randomBytes(16).toString("hex")
      r.tokens.add(token)
      r.conn?.close(4000, `replaced by ${d.name}`)
      return send(res, 200, { token, handle: "alice", url: "https://alice.vaultite.app" })
    }
    if (req.url === "/api/device/revoke") {
      const t = String(req.headers.authorization ?? "").replace(/^Bearer /, "")
      r.revoked.push(t); r.tokens.delete(t)
      return send(res, 200, { ok: true })
    }
    send(res, 404, { error: "not_found" })
  })
  const wss = new WebSocketServer({ noServer: true })
  server.on("upgrade", (req, socket, head) => {
    const t = String(req.headers.authorization ?? "").replace(/^Bearer /, "")
    if (req.url !== "/api/tunnel" || !r.tokens.has(t)) { socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); return }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (r.conn) r.conn.close(4000, "replaced by this machine again")
      r.conn = ws; r.conns++
      ws.on("message", (m) => {
        const f = JSON.parse(String(m))
        r.frames.push(f)
        const p = r.pending.get(f.id)
        if (!p) return
        if (f.t === "res") { p.status = f.status; p.headers = f.headers }
        else if (f.t === "data") { p.chunks.push({ at: Date.now(), text: Buffer.from(f.chunk, "base64").toString() }); p.onData?.() }
        else if (f.t === "end" || f.t === "err") { p.error = f.t === "err" ? f.message : null; r.pending.delete(f.id); p.done() }
      })
      ws.on("close", () => { if (r.conn === ws) r.conn = null })
    })
  })
  await new Promise((res) => server.listen(port, "127.0.0.1", res))
  /** A code as /connect shows one after signing in. */
  r.newCode = () => { const c = `BCDF${String(++r.n).padStart(4, "0")}`; r.codes.add(c); return `${c.slice(0, 4)}-${c.slice(4)}` }
  /** A request through the tunnel: its status, headers, chunks as they came, and text. */
  r.request = (method, p, { headers = [], body, onData } = {}) => {
    const id = `r${++r.n}`
    const out = { id, status: 0, headers: [], chunks: [], error: undefined, onData }
    const done = new Promise((res) => { out.done = res })
    r.pending.set(id, out)
    const host = headers.some(([k]) => k.toLowerCase() === "x-forwarded-host") ? [] : [["x-forwarded-host", "alice.vaultite.app"]]
    r.conn?.send(JSON.stringify({ t: "req", id, method, path: p, headers: [["host", "alice.vaultite.app"], ["x-forwarded-proto", "https"], ...host, ...headers], ...(body ? { body: Buffer.from(body).toString("base64") } : {}) }))
    out.finished = Promise.race([done, wait(10_000)]).then(() => ({ ...out, text: out.chunks.map((c) => c.text).join("") }))
    return out
  }
  r.close = () => { for (const c of wss.clients) c.terminate(); server.close() }
  return r
}

/** A stand-in for the public listener: an echo, an SSE stream, and one that never ends. */
async function fakeTarget() {
  const port = await freePort()
  const t = { port, closed: [] }
  const server = http.createServer((req, res) => {
    if (req.url === "/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
      res.write("data: one\n\n")
      setTimeout(() => res.write("data: two\n\n"), 400)
      setTimeout(() => res.end(), 800)
      return
    }
    if (req.url === "/slow") { req.on("close", () => t.closed.push("slow")); res.writeHead(200); res.write("start"); return }
    let s = ""
    req.on("data", (c) => (s += c))
    req.on("end", () => { res.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": "a=1" }); res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: s })) })
  })
  await new Promise((res) => server.listen(port, "127.0.0.1", res))
  t.close = () => server.close()
  return t
}

const servers = []
function serve(local, port) {
  const proc = spawn(process.execPath, [path.join(ROOT, "server.ts")], { cwd: ROOT, stdio: "ignore",
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: VAULT, VAULTITE_LOCAL: local, VAULTITE_CLOUD: relay.url } })
  servers.push({ proc, port })
  return proc
}
function stopAll() {
  for (const { proc, port } of servers) {
    if (proc.exitCode === null) proc.kill()
    try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
    spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  }
}

const relay = await fakeRelay()
const target = await fakeTarget()
let cloud, browser
try {
  // --- the tunnel on its own (cloud.ts in this process, to a stand-in listener)
  process.env.VAULTITE_LOCAL = path.join(TMP, "unit")
  const { Cloud } = await import("../../plugins/core/mcp/cloud.ts")
  const { RELAY_HEADER } = await import("../../plugins/core/mcp/public.ts")
  let cfg = {}
  const notices = []
  const plugin = { secrets: () => structuredClone(cfg), saveSecrets: (d) => { if (d === null) delete cfg.mcp; else cfg.mcp = d } }
  cloud = new Cloud(plugin, async () => target.port, relay.url)
  cloud.onChange = (s) => notices.push(s.state)
  check("signed out at first", cloud.status().state === "off" && cloud.status().url === null, cloud.status())
  const p0 = await cloud.signIn()
  check("without a code: still off, and where to get one", p0.state === "off" && p0.connectUrl === `${relay.url}/connect` && relay.names.length === 0, p0)
  const bad0 = await cloud.signIn("ZZZZ-ZZZZ").then(() => null, (e) => e)
  check("a wrong code: refused (400), nothing kept", bad0?.status === 400 && !cfg.mcp?.cloud && cloud.status().state === "off", String(bad0))
  relay.slow = 1
  const slow0 = await cloud.signIn(relay.newCode()).then(() => null, (e) => e)
  check("429 slow_down: says to wait", slow0?.status === 429 && /wait/.test(slow0.message), String(slow0))
  const first = relay.newCode()
  await cloud.signIn(first.toLowerCase())
  check("the code redeemed, it connects", !!(await until(() => cloud.status().state === "connected", 8000)), cloud.status())
  check("it names this machine", typeof relay.names[0] === "string" && relay.names[0].length > 0, relay.names)
  check("a code works once", (await cloud.signIn(first).then(() => null, (e) => e))?.status === 400 && cloud.status().state === "connected")
  check("the token is kept in data/config.json's mcp.cloud", cfg.mcp?.cloud?.token?.length === 32 && cfg.mcp.cloud.handle === "alice", Object.keys(cfg.mcp?.cloud ?? {}))
  check("its MCP address", cloud.status().url === "https://alice.vaultite.app/mcp", cloud.status())
  check("the token isn't in its status", !JSON.stringify(cloud.status()).includes(cfg.mcp.cloud.token))

  const echo = await relay.request("POST", "/echo?x=1", { headers: [["content-type", "application/json"], [RELAY_HEADER, "forged"], ["connection", "keep-alive"], ["tailscale-user-login", "alice@example.com"], ["x-vaultite-client", "app"], ["forwarded", "for=127.0.0.1"]], body: '{"hi":1}' }).finished
  const e = JSON.parse(echo.text || "{}")
  check("a request is forwarded: method, path, body", echo.status === 201 && e.method === "POST" && e.url === "/echo?x=1" && e.body === '{"hi":1}', echo)
  check("with the forwarded host and proto, and this process's mark (not the relay's)", e.headers?.["x-forwarded-host"] === "alice.vaultite.app" && e.headers["x-forwarded-proto"] === "https" && e.headers[RELAY_HEADER]?.length > 20 && e.headers[RELAY_HEADER] !== "forged", e.headers)
  check("never Tailscale's, the app's own or Forwarded headers", !Object.keys(e.headers ?? {}).some((k) => /^(tailscale-|forwarded$|x-vaultite-client)/.test(k)), e.headers)
  check("to the listener, not the relay's host", e.headers?.host === `127.0.0.1:${target.port}`, e.headers?.host)
  check("the answer's headers come back, without hop-by-hop ones", echo.headers.some(([k, v]) => k.toLowerCase() === "set-cookie" && v === "a=1") && !echo.headers.some(([k]) => /^(connection|transfer-encoding)$/i.test(k)), echo.headers)

  const sse = await relay.request("GET", "/sse").finished
  const gap = sse.chunks.length >= 2 ? sse.chunks[1].at - sse.chunks[0].at : 0
  check("SSE streams chunk by chunk, as it's written", sse.status === 200 && sse.text === "data: one\n\ndata: two\n\n" && gap > 250, { chunks: sse.chunks, gap })

  const slow = relay.request("GET", "/slow", { onData: () => {} })
  await until(() => slow.chunks.length > 0, 8000)
  relay.conn.send(JSON.stringify({ t: "cancel", id: slow.id }))
  check("cancel aborts the request to the listener", !!(await until(() => target.closed.includes("slow"), 3000)), target.closed)
  check("and sends nothing more for it", !relay.frames.some((f) => f.id === slow.id && (f.t === "end" || f.t === "err")))

  const bad = await relay.request("GET", "http://127.0.0.1:1/api/state").finished
  check("a path that isn't one is refused", bad.error && bad.status === 0, bad)
  const pongs = relay.frames.filter((f) => f.t === "pong").length
  relay.conn.send(JSON.stringify({ t: "ping" }))
  check("ping gets pong", !!(await until(() => relay.frames.filter((f) => f.t === "pong").length > pongs, 2000)))

  const conns = relay.conns
  relay.conn.terminate()
  check("a dropped tunnel reconnects", !!(await until(() => relay.conns > conns && cloud.status().state === "connected", 6000)) && notices.includes("reconnecting"), notices)

  relay.conn.close(4000, "replaced by Bob's MacBook")
  await wait(2500)
  const before = relay.conns
  check("4000: another machine took over, named, and not fought", cloud.status().state === "replaced" && relay.conns === before && cloud.status().message === "Replaced by Bob's MacBook", cloud.status())
  await cloud.signIn()
  check("sign in again: this machine takes it back", !!(await until(() => cloud.status().state === "connected", 8000)) && relay.conns === before + 1)

  relay.conn.close(4001, "revoked")
  check("4001: signed out here, token forgotten", !!(await until(() => cloud.status().state === "off", 8000)) && !cfg.mcp?.cloud && /ended/.test(cloud.status().message), { s: cloud.status(), cfg })

  await cloud.signIn(relay.newCode())
  await until(() => cloud.status().state === "connected", 8000)
  relay.tokens.delete(cfg.mcp?.cloud?.token)
  relay.conn.terminate()
  check("401 when reconnecting: signed out here", !!(await until(() => cloud.status().state === "off", 6000)) && !cfg.mcp?.cloud, cloud.status())

  await cloud.signIn(relay.newCode())
  await until(() => cloud.status().state === "connected", 8000)
  const replacedToken = cfg.mcp.cloud.token
  await fetch(`${relay.url}/api/device/redeem`, { method: "POST", body: JSON.stringify({ code: relay.newCode(), name: "Bob's MacBook" }) })
  check("another machine redeems a code: replaced, named", !!(await until(() => cloud.status().state === "replaced", 8000)) && /Bob's MacBook/.test(cloud.status().message), cloud.status())
  await cloud.signIn()
  check("Use this machine with a revoked token: signed out, told to get a new code", !!(await until(() => cloud.status().state === "off", 4000)) && !cfg.mcp?.cloud && /Bob's MacBook.*new code/.test(cloud.status().message) && !relay.tokens.has(replacedToken), cloud.status())

  await cloud.signIn(relay.newCode())
  await until(() => cloud.status().state === "connected", 8000)
  const token = cfg.mcp.cloud.token
  const out = await cloud.signOut()
  check("sign out revokes the token, forgets it and closes the tunnel", out.state === "off" && relay.revoked.includes(token) && !cfg.mcp?.cloud && !!(await until(() => relay.conn === null, 2000)), { out, revoked: relay.revoked })
  cloud.stop()

  // --- a server: Vaultite Cloud alone (no mcp.public), signed in through its ops
  const local = path.join(TMP, "server")
  fs.mkdirSync(local, { recursive: true })
  const port = await freePort()
  const BASE = `http://127.0.0.1:${port}`
  serve(local, port)
  await until(async () => { try { return (await fetch(`${BASE}/api/state`)).ok } catch { return false } }, 40_000)
  const opCall = async (id, headers = {}, params = {}) => { const r = await fetch(`${BASE}/api/ops/${id}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(params) }); return { status: r.status, body: await r.json().catch(() => null) } }
  const listed = await (await fetch(`${BASE}/api/mcp/connections`)).json()
  check("Connections: Cloud off, no address", listed.cloud?.state === "off" && listed.url === null && listed.cloud.url === null, listed)
  check("only this machine's owner may sign in", (await opCall("mcp.cloud-sign-in", { "X-Forwarded-For": "203.0.113.9" })).status === 403)
  const ops = await (await fetch(`${BASE}/api/ops`)).json()
  const ids = (ops.ops ?? ops).map((o) => o.id)
  check("the ops are listed", ["mcp.cloud-sign-in", "mcp.cloud-sign-out", "mcp.cloud-status"].every((i) => ids.includes(i)), ids.filter((i) => i.startsWith("mcp")))
  browser = await launch()
  const page = watch(await browser.newPage({ viewport: { width: 1200, height: 800 } }))
  const popups = []
  page.on("popup", (p) => { popups.push(p.url()); void p.close() })
  await page.goto(`${BASE}/#view/connections`)
  await page.click("[data-cloud-sign-in]", { timeout: 20_000 })
  check("Connections: Sign in opens /connect and asks for its code", await page.isVisible("[data-cloud-code]") && !!(await until(() => popups.includes(`${relay.url}/connect`), 3000)), popups)
  await page.fill("[data-cloud-code]", "zzzz-zzzz")
  await page.click("[data-cloud-redeem]")
  await wait(800)
  check("a wrong code says so and keeps the field", await page.isVisible("[data-cloud-code]") && /doesn't work/.test(await page.textContent("body")))
  await page.fill("[data-cloud-code]", relay.newCode().toLowerCase())
  await page.click("[data-cloud-redeem]")
  await page.waitForSelector("[data-cloud-state=connected]", { timeout: 15_000 }).catch(() => {})
  check("then shows it connected, and the address", await page.isVisible("[data-cloud-state=connected]") && (await page.textContent("[data-cloud-url]"))?.includes("https://alice.vaultite.app/mcp"))
  await page.click("[data-guide-for=claude]")
  check("Set up Claude opens its steps: open, copy the name, copy the address", await page.isVisible("[data-guide=claude] [data-guide-open]")
    && await page.isVisible("[data-guide=claude] [data-guide-copy=name]") && await page.isVisible("[data-guide=claude] [data-guide-copy=address]"))
  await page.screenshot({ path: path.join(os.tmpdir(), "vaultite-qa-connections-claude.png") })
  await page.click("[data-guide-for=chatgpt]")
  check("Set up ChatGPT swaps them for its own, with Vaultite's icon", !(await page.isVisible("[data-guide=claude]"))
    && (await page.getAttribute("[data-guide=chatgpt] [data-connector-icon]", "href")) === "https://alice.vaultite.app/icon.png")
  await page.screenshot({ path: path.join(os.tmpdir(), "vaultite-qa-connections.png") })
  const connected = await until(async () => { const s = (await opCall("mcp.cloud-status")).body; return s?.state === "connected" && s }, 8000)
  check("mcp.cloud-status: connected, with its address", connected?.url === "https://alice.vaultite.app/mcp", connected)
  check("the token is in data/config.json, not the vault", JSON.parse(fs.readFileSync(path.join(local, "config.json"), "utf8")).mcp?.cloud?.token?.length > 0
    && !fs.readdirSync(VAULT, { recursive: true }).map(String).some((f) => f.includes(".vaultite") && f.endsWith(".json") && fs.readFileSync(path.join(VAULT, f), "utf8").includes("alice.vaultite.app")))
  const text = await (await fetch(`${BASE}/api/ops/mcp.cloud-status?as=text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).text()
  check("its text names the address", text.includes("https://alice.vaultite.app/mcp"), text)

  const through = (method, p, opts) => relay.request(method, p, opts).finished
  const meta = JSON.parse((await through("GET", "/.well-known/oauth-authorization-server")).text || "{}")
  check("through the relay: OAuth addresses from the forwarded host", meta.issuer === "https://alice.vaultite.app" && meta.token_endpoint === "https://alice.vaultite.app/token", meta)
  const other = JSON.parse((await through("GET", "/.well-known/oauth-protected-resource", { headers: [["x-forwarded-host", "bob.vaultite.app"]] })).text || "{}")
  check("the relay's host is the one used", other.resource === "https://bob.vaultite.app/mcp", other)
  check("only the public listener is reachable", (await through("GET", "/api/state")).status === 404 && (await through("GET", "/api/mcp/connections")).status === 404 && (await through("POST", "/api/ops/terminal.list", { body: "{}" })).status === 404)
  const mainMeta = await fetch(`${BASE}/.well-known/oauth-authorization-server`, { headers: { "X-Forwarded-Host": "evil.example" } })
  check("the app's port never answers as the public listener", !(await mainMeta.text()).includes("evil.example"))

  // An app connects through the relay: register, sign in with the code, tokens, MCP.
  const REDIRECT = "https://claude.ai/api/mcp/auth_callback"
  const reg = JSON.parse((await through("POST", "/register", { headers: [["content-type", "application/json"]], body: JSON.stringify({ client_name: "Lighthouse AI", redirect_uris: [REDIRECT] }) })).text || "{}")
  const verifier = crypto.randomBytes(32).toString("base64url")
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id ?? "", redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "s1" })
  const signInPage = (await through("GET", `/authorize?${q}`)).text
  const code = /<div class="code"[^>]*>([^<]+)</.exec(signInPage)?.[1]?.replace(/\s/g, "")
  const sid = /const id = "([^"]+)"/.exec(signInPage)?.[1]
  check("the sign-in page comes through the relay", !!code && !!sid, signInPage.slice(0, 200))
  check("it carries Vaultite's logo", signInPage.includes('<img src="/icon.svg"') && (await through("GET", "/icon.svg")).status === 200)
  const let_ = await fetch(`${BASE}/api/mcp/connections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
  check("the owner types its code in Connections", let_.status === 200, let_.status)
  const st = JSON.parse((await through("GET", `/authorize/status?id=${encodeURIComponent(sid ?? "")}`)).text || "{}")
  const back = new URL(st.to ?? "https://x.invalid/")
  check("it goes back to the app with the Cloud's address as issuer", back.searchParams.get("iss") === "https://alice.vaultite.app" && back.searchParams.get("state") === "s1", st)
  const tok = JSON.parse((await through("POST", "/token", { headers: [["content-type", "application/x-www-form-urlencoded"]], body: String(new URLSearchParams({ grant_type: "authorization_code", code: back.searchParams.get("code") ?? "", client_id: reg.client_id ?? "", redirect_uri: REDIRECT, code_verifier: verifier })) })).text || "{}")
  check("tokens through the relay", !!tok.access_token, tok)
  const rpc = async (method, params) => JSON.parse((await through("POST", "/mcp", { headers: [["content-type", "application/json"], ["authorization", `Bearer ${tok.access_token}`]], body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).text || "{}")
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "lighthouse" }, capabilities: {} })
  check("MCP through the relay, its logo at the Cloud's address", init.result?.serverInfo?.icons?.[0]?.src === "https://alice.vaultite.app/icon.png", init)
  const found = await rpc("tools/call", { name: "search", arguments: { query: "Alice" } })
  check("a tool runs through the relay", found.result?.isError === false, found)
  const owner = await rpc("tools/call", { name: "call", arguments: { id: "mcp.cloud-sign-out" } })
  check("an app can't sign the Mac out", owner.result?.isError === true, owner)
  // Forged headers through the relay: Tailscale Serve's login (one the terminal lets in), the app's own.
  fs.mkdirSync(path.join(VAULT, ".vaultite/plugins/terminal"), { recursive: true })
  fs.writeFileSync(path.join(VAULT, ".vaultite/plugins/terminal/data.json"), JSON.stringify({ allowUsers: ["alice@example.com"] }))
  for (const id of ["terminal.list", "terminal", "mcp.cloud-status"]) {
    const r = JSON.parse((await through("POST", "/mcp", { headers: [["content-type", "application/json"], ["authorization", `Bearer ${tok.access_token}`], ["tailscale-user-login", "alice@example.com"], ["x-vaultite-client", "app"]],
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "call", arguments: { id } } }) })).text || "{}")
    check(`through the relay, a forged Tailscale login can't run an owner op (${id})`, r.result?.isError === true, r)
  }
  const unauth = await through("POST", "/mcp", { headers: [["content-type", "application/json"]], body: "{}" })
  check("no token: 401 naming the Cloud's metadata", unauth.status === 401 && unauth.headers.some(([k, v]) => k.toLowerCase() === "www-authenticate" && v.includes("https://alice.vaultite.app/.well-known")), unauth.headers)

  relay.conn.close(4000, "replaced by this machine again")
  await page.waitForSelector("[data-cloud-state=replaced]", { timeout: 15_000 }).catch(() => {})
  check("Connections shows another machine took over", await page.isVisible("[data-cloud-state=replaced]"))
  await page.click("[data-cloud-take-over]").catch(() => {})
  await page.waitForSelector("[data-cloud-state=connected]", { timeout: 15_000 }).catch(() => {})
  check("Use this machine connects it again", await page.isVisible("[data-cloud-state=connected]") && !!relay.conn)
  await page.click("[data-cloud-sign-out]")
  await page.keyboard.press("Enter")
  await page.waitForSelector("[data-cloud-sign-in]", { timeout: 10_000 }).catch(() => {})
  check("Sign out (confirmed) revokes and forgets", await page.isVisible("[data-cloud-sign-in]") && relay.revoked.length === 2 && !!(await until(() => relay.conn === null, 3000)) && (await opCall("mcp.cloud-status")).body?.state === "off")
  noErrors()
  const how = await (await fetch(`${BASE}/api/ops/mcp.cloud-sign-in?as=text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).text()
  check("mcp.cloud-sign-in without a code: where to get one", how.includes(`${relay.url}/connect`) && how.includes("vau cloud sign-in <code>"), how)
  const wrong = await opCall("mcp.cloud-sign-in", {}, { code: "ZZZZ-ZZZZ" })
  check("mcp.cloud-sign-in with a wrong code: 400 saying so", wrong.status === 400 && /doesn't work/.test(wrong.body?.error), wrong)
  const right = await opCall("mcp.cloud-sign-in", {}, { code: relay.newCode() })
  check("mcp.cloud-sign-in with a code: connects", right.status === 200 && !!(await until(async () => (await opCall("mcp.cloud-status")).body?.state === "connected", 8000)), right)
  const out3 = await opCall("mcp.cloud-sign-out")
  check("mcp.cloud-sign-out", out3.body?.state === "off" && relay.revoked.length === 3, out3)

  // --- a server with its own tunnel too (mcp.public) and signed in from before: both addresses, the same listener
  const local2 = path.join(TMP, "server2")
  fs.mkdirSync(local2, { recursive: true })
  const port2 = await freePort(), pubPort = await freePort()
  const t2 = crypto.randomBytes(16).toString("hex")
  relay.tokens.add(t2)
  fs.writeFileSync(path.join(local2, "config.json"), JSON.stringify({ mcp: { public: { url: `http://127.0.0.1:${pubPort}`, port: pubPort }, cloud: { token: t2, handle: "alice", url: "https://alice.vaultite.app" } } }))
  const conns2 = relay.conns
  serve(local2, port2)
  check("signed in from before, it connects on start", !!(await until(() => relay.conns > conns2 && relay.conn, 40_000)))
  const both = await (await fetch(`http://127.0.0.1:${port2}/api/mcp/connections`)).json()
  check("Connections lists both addresses", both.url === `http://127.0.0.1:${pubPort}/mcp` && both.cloud?.url === "https://alice.vaultite.app/mcp" && both.cloud.state === "connected", both)
  const direct = await (await fetch(`http://127.0.0.1:${pubPort}/.well-known/oauth-authorization-server`, { headers: { "X-Forwarded-Host": "evil.example", "X-Vaultite-Relay": "guess" } })).json()
  check("the owner's tunnel: its own address, a forwarded host isn't believed", direct.issuer === `http://127.0.0.1:${pubPort}`, direct)
  const viaRelay = JSON.parse((await through("GET", "/.well-known/oauth-authorization-server")).text || "{}")
  check("the relay: the Cloud's address, same listener", viaRelay.issuer === "https://alice.vaultite.app", viaRelay)
} finally {
  cloud?.stop()
  await browser?.close()
  stopAll()
  relay.close()
  target.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}
await done()
