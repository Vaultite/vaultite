// MCP on the internet for apps connecting from their servers (claude.ai, ChatGPT), its own listener behind a tunnel (the
// owner's, or Vaultite Cloud's: cloud.ts). Sign-in shows a code the owner types in the app; risky ops wait for their yes (gateOf).
import crypto from "node:crypto"
import fs from "node:fs"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { type OpEntry, whoOf } from "../../../core/ops.ts"
import { agentLines, APP_VERSION, fromInternet, OpError, type Plugin, type Who } from "../../../core/plugins.ts"
import { type Disclosures, disclosed } from "../../../core/pluginmeta.ts"
import { hashed } from "../../../core/rules.ts"
import type { Item } from "../../../core/vault.ts"
import { blockedHost } from "../../../core/web.ts"
import { byUser } from "../../../core/writegate.ts"
import { toolsOf } from "./catalog.ts"
import { type ConnectOptions, MCP_PATHS, serveApp, SIGNED_HEADER, upgradeApp, verifyConnect } from "./connect.ts"
import { type Client, handleBody, initializes, instructionsOf, type Session, ToolError } from "./protocol.ts"

/** Operations that can run code on this machine, or change what does: why each waits for the owner's yes. */
const GATED: Record<string, string> = {
  "plugin.enable": "turn on a plugin (a vault plugin runs code on this machine)",
  "plugin.allow": "let a vault plugin run code on this machine",
  "plugin.install": "install a plugin from a repository",
  "plugin.update": "update installed plugins",
  "plugin.uninstall": "remove a plugin",
  "bundle.apply": "apply a bundle (it turns plugins on and off)",
  "bundle.import": "import a bundle",
  "bundle.restore": "restore the setup from before a bundle (it turns plugins on and off)",
  "settings.set": "change the app's settings",
  "ui.command": "run a command in your window",
  "dispatch.run": "start a coding agent on your machine with a file",
}
const APP_FILES = /^\/*\.vaultite(\/|$)/

/** Why an app on the internet needs the owner's yes to run this operation with these parameters, or "" when it doesn't.
 *  `code`: whether a path is a vault plugin's code that runs only once the owner allows it as it is (writing it needs no
 *  yes: allowing it does). */
export function gateOf(id: string, kind: OpEntry["kind"], params: Record<string, unknown>, code: (p: string) => boolean = () => false): string {
  if (id === "dispatch.run" && params.allow === true) return "run a shell command a setting names, on your machine"
  if (id === "plugin.allow" && params.edits === true) return "let a vault plugin run code on this machine, and its later edits without asking"
  if (GATED[id]) return GATED[id]
  const strings = Object.values(params).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v): v is string => typeof v === "string")
  const app = kind !== "read" && strings.find((v) => APP_FILES.test(v.trim()) && !code(v.trim()))
  if (app) return `write ${app.trim().replace(/^\/+/, "")} (the app's settings and plugins)`
  if (id === "clipper.save" && typeof params.url === "string") {
    let host = ""
    try { host = new URL(params.url).hostname } catch { /* not an address: the op says so */ }
    if (host && blockedHost(host)) return `fetch ${host}, an address on this machine's network`
  }
  return ""
}

const APPROVAL_TTL = 10 * 60_000, UPLOAD_TTL = 15 * 60_000
/** The most a request's body may be read into memory here: this server is on the internet, so it's kept, and a file's
 *  bytes go through an upload link instead (streamed, any size). */
const BODY_MAX = 4 << 20
const REDIRECT_HOSTS = ["claude.ai", "claude.com", "chatgpt.com", "openai.com", "cursor.com", "agent.meta.ai"]
const ACCESS_TTL = 3600, REFRESH_TTL = 30 * 86400, SIGN_IN_TTL = 10 * 60, CODE_TTL = 120
const CODE_CHARS = "BCDFGHJKMNPQRSTVWXZ23456789" // no vowels (no words), no 0/O, 1/I/L

type Settings = { url: string; port: number; redirectHosts: string[]; tools: string[] | null; approvalWait: number }
/** A connected app: what it's called, when, and its refresh token's hash (the one before it too, for a while: an app
 *  that retries a refresh it already made isn't signed out). */
type Grant = { name: string; client: string; created: string; used?: string; refresh: string; prev?: string; prevUntil?: number }
type Stored = { public?: Partial<Settings>; key?: string; grants?: Record<string, Grant> }
type App = { name: string; redirects: string[] }
type SignIn = { id: string; code: string; app: App; clientId: string; redirect: string; state: string | null; challenge: string; started: number; from: string; base: string; done?: string }
type AuthCode = { clientId: string; app: App; redirect: string; challenge: string; until: number }

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url")
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("base64url")
const now = () => Math.floor(Date.now() / 1000)
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Marks a request Vaultite Cloud's tunnel forwarded (cloud.ts): only this process knows it, so only then are the
 *  forwarded host and address believed. */
export const RELAY_HEADER = "x-vaultite-relay"
export const RELAYED = crypto.randomBytes(24).toString("base64url")

export class PublicMcp {
  plugin: Plugin
  settings: Settings
  server: http.Server | null = null
  signIns = new Map<string, SignIn>()
  codes = new Map<string, AuthCode>()
  sessions = new Map<string, Client | null>()
  hits = new Map<string, { n: number; until: number }>()
  /** Requests that came with this process's relay mark (cloud.ts). */
  viaRelay = new WeakSet<IncomingMessage>()
  /** Upload links (file.upload without the file), by token: what to save the bytes as, for whom, until when. */
  uploads = new Map<string, { pending: Record<string, unknown>; who: Who; until: number }>()
  /** The address each tool call's app reached (base), for links it's given: an app may know only one of them. */
  bases = new WeakMap<Who, string>()
  /** Gated calls asked about (gateOf), by app, operation and parameters: the inbox event that asks, until when. */
  asked = new Map<string, { event: string; until: number }>()
  lastNotice = 0
  /** Vaultite Cloud's address while this machine is signed in (cloud.ts). */
  cloudUrl: () => string | null = () => null
  /** Connect (connect.ts): the key Vaultite Cloud signs the owner's requests with, its handle, whether owner tools are on. */
  connect: { key: () => string | null; handle: () => string | null; ownerTools: () => boolean } = { key: () => null, handle: () => null, ownerTools: () => false }
  /** The port it listens on, once it does (mcp.public.port, or any free one for Vaultite Cloud alone). */
  ready: Promise<number>
  private listening!: (port: number) => void

  constructor(plugin: Plugin, settings: Settings) {
    this.plugin = plugin
    this.settings = settings
    this.ready = new Promise((r) => { this.listening = r })
  }

  /** The settings in data/config.json, or null when it's off (no url). */
  static settingsOf(plugin: Plugin): Settings | null {
    const p = (plugin.secrets().mcp as Stored | undefined)?.public
    if (!p?.url) return null
    return {
      url: String(p.url).replace(/\/+$/, ""), port: Number(p.port) || 8796,
      redirectHosts: Array.isArray(p.redirectHosts) ? p.redirectHosts.map(String) : REDIRECT_HOSTS,
      tools: Array.isArray(p.tools) ? p.tools.map(String) : null,
      approvalWait: Math.min(Math.max(Number(p.approvalWait) || 45, 1), 90),
    }
  }

  /** For Vaultite Cloud alone (no mcp.public.url): any free port, reached only through its tunnel. */
  static cloudOnly(): Settings {
    return { url: "", port: 0, redirectHosts: REDIRECT_HOSTS, tools: null, approvalWait: 45 }
  }

  start() {
    // An app it signed in acts for the user, like the app's own requests (core/app.ts), not as this plugin on its own.
    this.server = http.createServer((req, res) => {
      byUser(() => this.handle(req, res)).catch((e) => {
        console.error("mcp public:", e)
        if (!res.headersSent) this.json(res, 500, { error: "server_error" })
        else res.end()
      })
    })
    // Its port still held (the last server ending): tried again, a little later each time, so `ready` (which Vaultite
    // Cloud's relay waits on) settles once it's free instead of never.
    const server = this.server
    let wait = 2000
    server.on("error", (e) => {
      if (wait === 2000) console.error(`mcp public: can't listen on 127.0.0.1:${this.settings.port}:`, e.message)
      setTimeout(() => { if (this.server === server && !server.listening) server.listen(this.settings.port, "127.0.0.1") }, wait)
      wait = Math.min(wait * 2, 60_000)
    })
    server.on("listening", () => this.listening((server.address() as { port: number }).port))
    server.on("upgrade", (req: IncomingMessage, socket, head: Buffer) => {
      socket.on("error", () => socket.destroy())
      const signed = this.signedOwner(req)
      if (signed !== true) return socket.end(`HTTP/1.1 ${signed ? 401 : 404} ${signed ? "Unauthorized" : "Not Found"}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
      upgradeApp(req, socket, head, this.connectOptions())
    })
    server.listen(this.settings.port, "127.0.0.1")
  }

  stop() {
    this.server?.close()
    this.server = null
  }

  // --- what's stored (data/config.json "mcp"): the signing key and the connections

  stored(): Stored {
    return (this.plugin.secrets().mcp as Stored | undefined) ?? {}
  }

  save(fn: (s: Stored) => void) {
    const s = structuredClone(this.stored())
    fn(s)
    this.plugin.saveSecrets(s)
  }

  key(): string {
    let k = this.stored().key
    if (!k) {
      k = crypto.randomBytes(32).toString("base64url")
      const made = k
      this.save((s) => { s.key = made })
    }
    return k
  }

  sign(s: string) {
    return crypto.createHmac("sha256", this.key()).update(s).digest("base64url")
  }

  /** `<payload>.<signature>`, the payload JSON. */
  token(kind: string, data: object) {
    const body = b64u(JSON.stringify({ k: kind, ...data }))
    return `${body}.${this.sign(body)}`
  }

  unsign<T>(kind: string, t: string): T | null {
    const [body, sig] = t.split(".")
    if (!body || !sig || !same(sig, this.sign(body))) return null
    try {
      const d = JSON.parse(Buffer.from(body, "base64url").toString())
      return d.k === kind ? d as T : null
    } catch { return null }
  }

  grants(): Record<string, Grant> {
    return this.stored().grants ?? {}
  }

  /** The connections, for the owner's view. */
  list() {
    return Object.entries(this.grants()).map(([id, g]) => ({ id, name: g.name, created: g.created, used: g.used ?? null }))
  }

  disconnect(id: string) {
    if (!this.grants()[id]) return false
    this.save((s) => { delete s.grants![id] })
    return true
  }

  /** The owner typed a sign-in's code: it may go on (the page it's on takes the app back with an authorization code).
   *  The app's name, or null when no sign-in waits with that code. */
  /** Lets in the sign-in waiting with `code`; `as`: the app the owner set up (Grok Bot signs in as Cursor), its name here. */
  approve(code: string, as?: string) {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "")
    this.prune()
    const s = [...this.signIns.values()].find((x) => !x.done && x.code === c)
    if (!s) return null
    const authCode = crypto.randomBytes(24).toString("base64url")
    if (as) s.app = { ...s.app, name: as.slice(0, 80) }
    this.codes.set(authCode, { clientId: s.clientId, app: s.app, redirect: s.redirect, challenge: s.challenge, until: now() + CODE_TTL })
    const to = new URL(s.redirect)
    to.searchParams.set("code", authCode)
    if (s.state !== null) to.searchParams.set("state", s.state)
    to.searchParams.set("iss", s.base)
    s.done = to.toString()
    return s.app.name
  }

  waiting() {
    this.prune()
    return [...this.signIns.values()].filter((s) => !s.done).length
  }

  /** The apps whose code the owner typed that haven't finished signing in (their authorization code not yet traded for
   *  tokens): their names, a connection about to show. */
  finishing() {
    this.prune()
    return [...this.codes.values()].map((c) => c.app.name)
  }

  prune() {
    const t = now()
    for (const [k, s] of this.signIns) if (t - s.started > SIGN_IN_TTL) this.signIns.delete(k)
    for (const [k, c] of this.codes) if (c.until < t) this.codes.delete(k)
    for (const [k, h] of this.hits) if (h.until < t) this.hits.delete(k)
  }

  // --- HTTP

  json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers })
    res.end(JSON.stringify(body))
  }

  /** At most `n` requests a minute from one address for one kind of request. */
  limited(req: IncomingMessage, kind: string, n: number) {
    const who = `${kind}:${this.from(req)}`
    const h = this.hits.get(who)
    if (!h || h.until < now()) { this.hits.set(who, { n: 1, until: now() + 60 }); return false }
    return ++h.n > n
  }

  /** The address asking: the tunnel's header (Cloudflare's; the relay's), else the socket's. */
  from(req: IncomingMessage) {
    const relayed = this.relayed(req) && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()
    return String(req.headers["cf-connecting-ip"] ?? (relayed || req.socket.remoteAddress) ?? "")
  }

  relayed(req: IncomingMessage) {
    return this.viaRelay.has(req)
  }

  /** What the request says of who sent it, believed only for what a tunnel can't forge: Tailscale's and the app's own
   *  headers go, and nothing that comes here is ever the owner (core/owner.ts). */
  untrusted(req: IncomingMessage) {
    if (same(String(req.headers[RELAY_HEADER] ?? ""), RELAYED)) this.viaRelay.add(req)
    for (const k of Object.keys(req.headers)) if (/^(tailscale-|x-vaultite-)/.test(k)) delete req.headers[k]
    fromInternet(req)
  }

  /** Connect: true when Vaultite Cloud's tunnel brought this signed by the owner (a path that isn't MCP's), "bad" when its
   *  signature doesn't hold, null when it isn't the app's. Reads the header before untrusted() drops it. */
  signedOwner(req: IncomingMessage): true | "bad" | null {
    const token = req.headers[SIGNED_HEADER]
    this.untrusted(req)
    const p = new URL(req.url ?? "/", "http://localhost").pathname
    if (token === undefined || !this.relayed(req) || MCP_PATHS.test(p)) return null
    return verifyConnect(this.connect.key(), token, this.connect.handle()) ? true : "bad"
  }

  connectOptions(): ConnectOptions {
    const port = Number(process.env.PORT || 8793)
    let host: string | null = null
    try { host = new URL(this.cloudUrl() ?? "").host.toLowerCase() } catch { /* signed out */ }
    return { appPort: () => port, publicHost: () => host, ownerTools: this.connect.ownerTools, from: (req) => this.from(req) }
  }

  /** An operation by its id or CLI name, as host.call finds it. */
  entryOf(name: string) {
    const all = this.plugin.host.catalog()
    return all.find((e) => e.id === name) ?? all.find((e) => e.cli === name) ?? null
  }

  /** The address the app reached: through Vaultite Cloud, the host it forwards for; else mcp.public.url. */
  base(req: IncomingMessage) {
    const h = req.headers
    if (this.relayed(req)) {
      const host = String(h["x-forwarded-host"] ?? "").toLowerCase()
      const proto = h["x-forwarded-proto"] === "http" ? "http" : "https"
      if (/^[a-z0-9.-]+(:\d+)?$/.test(host)) return `${proto}://${host}`
      return this.cloudUrl() ?? this.settings.url
    }
    return this.settings.url || this.cloudUrl() || `http://127.0.0.1:${this.settings.port}`
  }

  async body(req: IncomingMessage): Promise<string> {
    let size = 0
    const parts: Buffer[] = []
    // (past the limit the rest is read and dropped, so the sender gets the answer rather than a cut connection)
    for await (const c of req) if ((size += (c as Buffer).length) <= BODY_MAX) parts.push(c as Buffer)
    if (size > BODY_MAX) throw Object.assign(new Error("too big"), { status: 413 })
    return Buffer.concat(parts).toString("utf8")
  }

  /** A form's or JSON's fields. */
  async fields(req: IncomingMessage): Promise<Record<string, string>> {
    const text = await this.body(req)
    if (String(req.headers["content-type"] ?? "").includes("json")) {
      try { return Object.fromEntries(Object.entries(JSON.parse(text)).map(([k, v]) => [k, String(v)])) } catch { return {} }
    }
    return Object.fromEntries(new URLSearchParams(text))
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const signed = this.signedOwner(req)
    if (signed === true) return serveApp(req, res, this.connectOptions())
    if (signed === "bad") return this.json(res, 401, { error: "sign_in", message: "Vaultite Cloud's sign-in for this Mac didn't check out: sign in again" })
    const url = new URL(req.url ?? "/", "http://localhost")
    const p = url.pathname.replace(/\/+$/, "") || "/"
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version")
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.setHeader("X-Content-Type-Options", "nosniff")
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end() }
    try { void this.plugin.host } catch { return this.json(res, 503, { error: "temporarily_unavailable" }, { "Retry-After": "2" }) } // still starting
    const base = this.base(req)
    if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") {
      return this.json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ["header"], scopes_supported: ["vault"], resource_name: "Vaultite" })
    }
    if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/oauth-authorization-server/mcp") {
      return this.json(res, 200, {
        issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["vault"],
        authorization_response_iss_parameter_supported: true,
      })
    }
    if (p === "/register" && req.method === "POST") return this.register(req, res)
    if (p === "/authorize" && req.method === "GET") return this.authorize(req, res, url, base)
    if (p === "/authorize/status" && req.method === "GET") return this.status(res, url)
    if (p === "/token" && req.method === "POST") return this.tokenRoute(req, res)
    if (p === "/mcp") return this.mcp(req, res, base)
    if (p.startsWith("/upload/") && (req.method === "PUT" || req.method === "POST")) return this.upload(req, res, p.slice(8))
    if (p === "/icon.svg" || p === "/icon.png" || p === "/favicon.ico") {
      const [file, type] = p === "/icon.svg" ? ["icon.svg", "image/svg+xml"] : p === "/icon.png" ? ["icon-256.png", "image/png"] : ["apple-touch-icon.png", "image/png"]
      try {
        const body = fs.readFileSync(path.join(PUBLIC, file))
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" })
        return res.end(body)
      } catch { return this.json(res, 404, { error: "not_found" }) }
    }
    if (p === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
      return res.end(`A Vaultite vault's MCP server. Add ${base}/mcp as a connector in your AI app.\n`)
    }
    this.json(res, 404, { error: "not_found" })
  }

  // --- sign-in

  async register(req: IncomingMessage, res: ServerResponse) {
    if (this.limited(req, "register", 20)) return this.json(res, 429, { error: "slow_down" })
    let d: Record<string, unknown> = {}
    try { d = JSON.parse(await this.body(req)) } catch { return this.json(res, 400, { error: "invalid_client_metadata", error_description: "a JSON body" }) }
    const redirects = Array.isArray(d.redirect_uris) ? d.redirect_uris.map(String) : []
    const bad = redirects.find((r) => !this.redirectOk(r))
    if (!redirects.length || bad) {
      return this.json(res, 400, { error: "invalid_redirect_uri", error_description: bad ? `${bad} isn't an app this vault lets in (redirectHosts)` : "redirect_uris is missing" })
    }
    const name = String(d.client_name ?? "An app").slice(0, 80)
    const app: App = { name, redirects }
    const clientId = this.token("client", { a: app })
    this.json(res, 201, {
      client_id: clientId, client_id_issued_at: now(), client_name: name, redirect_uris: redirects,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    })
  }

  redirectOk(r: string) {
    try {
      const u = new URL(r)
      // A desktop app's own loopback (Grok Bot's, RFC 8252): the code still goes only to that machine, after the user's code.
      if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return true
      return u.protocol === "https:" && this.settings.redirectHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    } catch { return false }
  }

  appOf(clientId: string): App | null {
    return this.unsign<{ a: App }>("client", clientId)?.a ?? null
  }

  authorize(req: IncomingMessage, res: ServerResponse, url: URL, base: string) {
    const q = url.searchParams
    const app = this.appOf(q.get("client_id") ?? "")
    const redirect = q.get("redirect_uri") ?? ""
    // Not the app's own address: never send anyone there (an open redirect), say so here.
    if (!app) return this.page(res, 400, "This app isn't registered", "Add the connector again from the app you're connecting.")
    if (!app.redirects.includes(redirect)) return this.page(res, 400, "This sign-in can't go on", "Its return address isn't the one the app registered.")
    const back = (error: string, description: string) => {
      const to = new URL(redirect)
      to.searchParams.set("error", error)
      to.searchParams.set("error_description", description)
      if (q.get("state") !== null) to.searchParams.set("state", q.get("state")!)
      res.writeHead(302, { Location: to.toString() })
      res.end()
    }
    if (q.get("response_type") !== "code") return back("unsupported_response_type", "response_type is code")
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return back("invalid_request", "PKCE with S256 is required")
    if (this.limited(req, "authorize", 10)) return this.page(res, 429, "Too many sign-ins", "Wait a minute and try again.")
    this.prune()
    if (this.signIns.size > 50) return this.page(res, 429, "Too many sign-ins", "Wait a few minutes and try again.")
    const code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("")
    const s: SignIn = { id: crypto.randomBytes(24).toString("base64url"), code, app, clientId: q.get("client_id")!, redirect,
      state: q.get("state"), challenge: q.get("code_challenge")!, started: now(), from: this.from(req), base }
    this.signIns.set(s.id, s)
    if (Date.now() - this.lastNotice > 30_000) {
      this.lastNotice = Date.now()
      void this.plugin.runOp("ui.notify", { text: `${app.name} wants to connect to your vault: type the code its page shows`, actionOpen: "view:connections", actionLabel: "Connect" }).catch(() => {})
    }
    this.signInPage(res, s)
  }

  status(res: ServerResponse, url: URL) {
    const s = this.signIns.get(url.searchParams.get("id") ?? "")
    if (!s || now() - s.started > SIGN_IN_TTL) return this.json(res, 200, { state: "expired" })
    if (!s.done) return this.json(res, 200, { state: "waiting" })
    this.signIns.delete(s.id)
    this.json(res, 200, { state: "approved", to: s.done })
  }

  async tokenRoute(req: IncomingMessage, res: ServerResponse) {
    if (this.limited(req, "token", 60)) return this.json(res, 429, { error: "slow_down" })
    const f = await this.fields(req)
    const fail = (error: string, description: string, status = 400) => this.json(res, status, { error, error_description: description })
    if (f.grant_type === "authorization_code") {
      const c = this.codes.get(f.code ?? "")
      this.codes.delete(f.code ?? "")
      if (!c || c.until < now()) return fail("invalid_grant", "the code is unknown or expired")
      if (f.client_id && f.client_id !== c.clientId) return fail("invalid_grant", "the code is another app's")
      if (f.redirect_uri && f.redirect_uri !== c.redirect) return fail("invalid_grant", "redirect_uri isn't the sign-in's")
      if (!f.code_verifier || !same(sha(f.code_verifier), c.challenge)) return fail("invalid_grant", "code_verifier doesn't match the challenge")
      const id = crypto.randomBytes(9).toString("base64url")
      const refresh = `${id}.${crypto.randomBytes(32).toString("base64url")}`
      const at = new Date().toISOString()
      this.save((s) => { s.grants = { ...s.grants, [id]: { name: c.app.name, client: c.clientId, created: at, used: at, refresh: sha(refresh) } } })
      void this.plugin.runOp("ui.notify", { text: `${c.app.name} is connected to your vault`, actionOpen: "view:connections", actionLabel: "Show" }).catch(() => {})
      return this.issue(res, id, refresh)
    }
    if (f.grant_type === "refresh_token") {
      const t = f.refresh_token ?? ""
      const id = t.split(".")[0]
      const g = this.grants()[id]
      const h = sha(t)
      if (!g || !(same(h, g.refresh) || (g.prev && same(h, g.prev) && (g.prevUntil ?? 0) > now()))) return fail("invalid_grant", "the refresh token is unknown, used or revoked")
      if (Date.parse(g.used ?? g.created) / 1000 + REFRESH_TTL < now()) return fail("invalid_grant", "the connection went unused for 30 days")
      const refresh = `${id}.${crypto.randomBytes(32).toString("base64url")}`
      this.save((s) => {
        const x = s.grants?.[id]
        if (!x) return
        x.prev = x.refresh; x.prevUntil = now() + 600; x.refresh = sha(refresh); x.used = new Date().toISOString()
      })
      return this.issue(res, id, refresh)
    }
    fail("unsupported_grant_type", "authorization_code or refresh_token")
  }

  issue(res: ServerResponse, grant: string, refresh: string) {
    this.json(res, 200, {
      access_token: this.token("access", { g: grant, e: now() + ACCESS_TTL }), token_type: "Bearer", expires_in: ACCESS_TTL,
      refresh_token: refresh, scope: "vault",
    }, { Pragma: "no-cache" })
  }

  // --- MCP

  /** The connection a request's Bearer token is for, or null. */
  grantOf(req: IncomingMessage): [string, Grant] | null {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ""))
    const t = m && this.unsign<{ g: string; e: number }>("access", m[1])
    if (!t || t.e < now()) return null
    const g = this.grants()[t.g]
    return g ? [t.g, g] : null
  }

  async mcp(req: IncomingMessage, res: ServerResponse, base: string) {
    const grant = this.grantOf(req)
    if (!grant) {
      return this.json(res, 401, { error: "invalid_token", error_description: "sign in first" }, {
        "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="vault"`,
      })
    }
    if (this.limited(req, `mcp-${grant[0]}`, 600)) return this.json(res, 429, { error: "slow_down" })
    if (req.method === "GET") {
      res.writeHead(405, { Allow: "POST, DELETE", "Content-Type": "text/plain; charset=utf-8" })
      return res.end("This MCP server answers POSTs only.")
    }
    const sid = String(req.headers["mcp-session-id"] ?? "")
    if (req.method === "DELETE") { this.sessions.delete(sid); return this.json(res, 200, { ok: true }) }
    if (req.method !== "POST") return this.json(res, 405, { error: "method_not_allowed" })
    let body: unknown
    try { body = JSON.parse(await this.body(req)) } catch (e) {
      if ((e as { status?: number }).status === 413) {
        return this.json(res, 413, { jsonrpc: "2.0", id: null, error: { code: -32600, message: `A request here is at most ${BODY_MAX >> 20} MB. ` +
          "To save a file of any size, call upload_file without file, url or data: it answers a one-time upload link to PUT the bytes to (curl -T <file> <link>)." } })
      }
      return this.json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
    }
    this.touch(grant)
    // Marked as come through
    // a proxy, whatever the tunnel sends: an op or route only this machine's owner may use refuses it (core/owner.ts).
    req.headers["x-forwarded-for"] = this.from(req) || "public"
    const session: Session = { client: this.sessions.get(sid) ?? null }
    const allow = this.settings.tools && new Set(this.settings.tools)
    const app = grant[1].name
    const out = await handleBody(body, session, {
      version: APP_VERSION,
      instructions: () => instructionsOf(agentLines(this.plugin.vault).map((l) => l.text), this.plugin.host.catalog(), [WAITS]),
      identity: { icons: [{ src: `${base}/icon.png`, mimeType: "image/png", sizes: ["256x256"] }, { src: `${base}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }] },
      ctx: (client, tool) => {
        // Named as it signed in (Connections' name), not as its MCP client calls itself ("An MCP client", a skill's name).
        const who: Who = whoOf("mcp", grant[1].name)
        this.bases.set(who, base)
        return { client, op: async (name, params) => {
          const entry = this.entryOf(name)
          if (entry?.owner && !GATED[entry.id]) throw new ToolError(`${entry.id} is only for this machine's owner, on that machine: not an app on the internet.`)
          const id = entry?.id ?? name
          await this.approved(grant[0], app, id, params)
          // An owner's op they just said yes to runs as theirs: the request's owner checks would refuse it.
          return (await this.plugin.host.call(id, params, who, { report: `mcp ${tool}`, http: entry?.owner ? undefined : req })).text
        } }
      },
      tools: () => toolsOf(this.plugin.host.catalog().filter((e) => !e.owner || GATED[e.id])).filter((t) => !allow || allow.has(t.name)),
    })
    const headers: Record<string, string> = {}
    if (initializes(body)) {
      const id = crypto.randomUUID()
      this.sessions.set(id, session.client)
      while (this.sessions.size > 200) this.sessions.delete(this.sessions.keys().next().value!)
      headers["Mcp-Session-Id"] = id
    }
    if (out === null) { res.writeHead(202, headers); return res.end() }
    this.json(res, 200, out, headers)
  }

  /** Returns when an app may run this operation: at once, or once the owner said
   *  yes (gateOf). Throws ToolError when they said no, or haven't answered yet (call again with the same arguments). */
  async approved(grant: string, app: string, id: string, params: Record<string, unknown>) {
    const entry = this.plugin.host.catalog().find((e) => e.id === id)
    const why = entry ? gateOf(id, entry.kind, params, await this.pluginCode()) : ""
    if (!why) return
    const ask = this.plugin.service("inbox:ask"), answerOf = this.plugin.service("inbox:answer")
    if (!ask || !answerOf) throw new ToolError(`This needs the user's yes (to ${why}), asked through Vaultite's Inbox, which is off: they can turn it on, or do it on their machine.`)
    const now = Date.now()
    for (const [k, a] of this.asked) if (a.until < now) this.asked.delete(k)
    const key = sha(JSON.stringify([grant, id, params]))
    let asked = this.asked.get(key)
    if (!asked) {
      const event = await ask({ source: "mcp", title: `${app} asks to ${why}`, body: await this.askBody(id, params) })
      asked = { event, until: now + APPROVAL_TTL }
      this.asked.set(key, asked)
    }
    const answer = await answerOf(asked.event, this.settings.approvalWait * 1000)
    if (answer === "approve") { this.asked.delete(key); return }
    if (answer === "deny") { this.asked.delete(key); throw new ToolError(`The user said no to this (${id}): don't do it.`) }
    if (answer === "gone") { this.asked.delete(key); throw new ToolError("The request for the user's yes is gone: call again to ask again.") }
    throw new ToolError(`Waiting for the user's yes: Vaultite asked them on their phone (and in its Inbox) whether you may ${why}. Tell them, and once they approve, call this again with exactly the same arguments: it then runs at once.`)
  }

  /** Which paths are a vault plugin's code that runs only once this machine's owner allows it as changed: not the app's
   *  plugins' settings, not its data.json or userFiles, not one whose edits run without asking (core/trust.ts). */
  async pluginCode() {
    const list = (await this.plugin.host.call("plugin.list", {})).result as { id: string; tier: string; edits?: boolean }[]
    const app = new Set(list.filter((p) => p.tier !== "vault").map((p) => p.id)), edits = new Set(list.filter((p) => p.edits).map((p) => p.id))
    const root = this.plugin.vault.abs(".vaultite/plugins")
    return (p: string) => {
      const abs = path.resolve(this.plugin.vault.abs(p.replace(/^\/+/, "")))
      const [id, ...rest] = path.relative(root, abs).split(path.sep)
      if (!id || id === ".." || !rest.length || !/^[a-z][a-z0-9-]*$/.test(id) || app.has(id) || edits.has(id)) return false
      const dir = path.join(root, id)
      return rest.join("/") !== "data.json" && hashed(dir, abs)
    }
  }

  /** What the owner reads before saying yes: for a vault plugin to run, what it is, what it does beyond the vault and
   *  which files changed since they last allowed it; else the operation and its parameters. */
  async askBody(id: string, params: Record<string, unknown>) {
    const raw = `${id} ${JSON.stringify(params, null, 2)}`
    if (id !== "plugin.allow" && id !== "plugin.enable") return raw
    const q = String(params.id ?? "").toLowerCase().trim()
    const list = (await this.plugin.host.call("plugin.list", {})).result as { id: string; name: string; tier: string }[]
    const own = list.find((p) => p.tier === "vault" && (p.id === q || p.name.toLowerCase() === q))
    const vp = own && ((await this.plugin.host.call("plugin.check", { dir: own.id })).result as Item[])[0]
    if (!vp) return raw
    const does = disclosed(vp.disclosures as Disclosures)
    const changes = vp.approval as { state: string; changed: string[] } | null
    return [
      `${vp.name} (${vp.id})${vp.description ? `: ${vp.description}` : ""}`,
      does.length ? `It ${does.join("; ")}.` : "It discloses nothing beyond the vault.",
      changes ? `${changes.state === "new" ? "Never allowed here" : "Changed since allowed"}: ${changes.changed.join(", ") || "its files"}.` : "",
      raw,
    ].filter(Boolean).join("\n")
  }

  /** A one-time link for file.upload's bytes, 15 minutes, on the address the app reached; null when there's none. */
  uploadLink(pending: Record<string, unknown>, who: Who) {
    const base = this.bases.get(who) ?? (this.settings.url || this.cloudUrl())
    if (!base) return null
    const now = Date.now()
    for (const [k, u] of this.uploads) if (u.until < now) this.uploads.delete(k)
    const token = crypto.randomBytes(24).toString("base64url")
    this.uploads.set(token, { pending, who, until: now + UPLOAD_TTL })
    return { url: `${base}/upload/${token}`, expires: new Date(now + UPLOAD_TTL).toISOString() }
  }

  /** PUT /upload/<token>: the bytes saved as file.upload would (its parameters were gated when the link was made), once. */
  async upload(req: IncomingMessage, res: ServerResponse, token: string) {
    const u = this.uploads.get(token)
    if (!u || u.until < Date.now()) return this.json(res, 404, { error: "this upload link is used or expired: ask for a new one" })
    this.uploads.delete(token)
    try {
      // (the bytes stream on into the vault, any size: file.upload's input)
      const r = await this.plugin.host.call("file.upload", u.pending, u.who, { report: "mcp upload", http: req, input: req })
      return this.json(res, 201, { ...(r.result as object), text: r.text })
    } catch (e) {
      const empty = e instanceof OpError && e.message === "the file is empty"
      return this.json(res, e instanceof OpError ? e.status : 500, { error: empty ? "no bytes came: PUT the file as the body (curl -T <file> <link>)" : (e as Error).message })
    }
  }

  /** When a connection was last used, kept every 10 minutes at most. */
  touch([id, g]: [string, Grant]) {
    if (g.used && Date.now() - Date.parse(g.used) < 600_000) return
    this.save((s) => { if (s.grants?.[id]) s.grants[id].used = new Date().toISOString() })
  }

  // --- pages

  page(res: ServerResponse, status: number, title: string, text: string, extra = "", nonce = "") {
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'${nonce ? `; script-src 'nonce-${nonce}'` : ""}`,
    })
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vaultite</title><link rel="icon" href="icon.svg" type="image/svg+xml"><style>${CSS}</style></head><body><main><div class="brand"><img src="/icon.svg" alt="">Vaultite</div><h1>${esc(title)}</h1><p>${esc(text)}</p>${extra}</main></body></html>`)
  }

  signInPage(res: ServerResponse, s: SignIn) {
    const nonce = crypto.randomBytes(16).toString("base64")
    const code = `${s.code.slice(0, 3)} ${s.code.slice(3)}`
    const extra = `<div class="code" aria-label="code">${esc(code)}</div>
<p class="muted" id="state">Open Vaultite on your phone or computer, go to Connections, and type this code. This page goes on by itself.</p>
<p class="muted small">Didn't start this? Close the page: nothing connects without the code.</p>
<script nonce="${nonce}">
const id = ${JSON.stringify(s.id)}
async function poll() {
  try {
    const r = await (await fetch("authorize/status?id=" + encodeURIComponent(id), { cache: "no-store" })).json()
    if (r.state === "approved") { document.getElementById("state").textContent = "Connected. Going back..."; location.replace(r.to); return }
    if (r.state === "expired") { document.getElementById("state").textContent = "This sign-in expired. Start again from the app."; return }
  } catch {}
  setTimeout(poll, 2000)
}
poll()
</script>`
    this.page(res, 200, `Connect ${s.app.name} to your vault`, `${s.app.name} asks to read and write your vault.`, extra, nonce)
  }
}

/** The web app's public files (its logo), from the repo or the packaged app. */
const PUBLIC = path.resolve(import.meta.dirname, "../../../web/public")

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const CSS = `:root{color-scheme:light dark;--bg:#fbfbfa;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e4df}
@media (prefers-color-scheme:dark){:root{--bg:#191918;--fg:#ececea;--muted:#9a9a94;--line:#2e2e2c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:420px;margin:12vh auto;padding:0 16px}.brand{display:flex;align-items:center;gap:10px;font-weight:600;margin-bottom:24px}.brand img{width:32px;height:32px}
h1{font-size:22px;line-height:1.3;margin:0 0 8px}p{margin:0 0 16px}.muted{color:var(--muted)}.small{font-size:14px}
.code{font:600 34px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;padding:18px 0;margin:8px 0 20px;text-align:center;border:1px solid var(--line);border-radius:10px}`

/** What the public server's instructions add: what waits for the user's yes here. */
const WAITS = `What can run code on the user's machine (turning a plugin on or allowing it, writing under .vaultite/ except a vault plugin's code, bundles, settings, palette commands, dispatch.run: a coding agent given a note to work on) waits for their yes on their phone: if a tool says it's waiting, tell them, and call it again with the same arguments once they approve.`
