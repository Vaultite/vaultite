import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeader, OutgoingHttpHeaders } from "node:http"
import path from "node:path"
import { type Duplex, Readable, Writable } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"
import { z } from "zod"
import { contentType, guestRefusal, HTTPError, logger, type Machine, MACHINE_CLIENT, OpError, parseSearch, pipeSockets, type Plugin, reply, ROOT, Text, type Who, linkTargets } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"
const log = logger("share")

export const ROLES = ["read", "comment", "edit"] as const
export type Role = typeof ROLES[number]
export const ShareSchema = z.object({ folder: z.string(), guest: z.string(), role: z.enum(ROLES), created: z.string(), expires: z.string(), token: z.string(),
  used: z.string().optional(), via: z.string().optional(), room: z.object({ notes: z.number(), bytes: z.number() }).optional() })
export type Share = z.infer<typeof ShareSchema>
const passed = z.unknown().optional()
const GuestWrite = z.object({ path: passed, text: z.string().optional().catch(undefined),
  edit: z.object({ at: z.number().int().min(0), cut: z.number().int().min(0), add: z.string() }).optional().catch(undefined),
  base: passed, baseHash: passed, lean: passed, unique: passed })
const GuestStat = z.object({ paths: z.array(z.unknown()).catch([]) })
const Row = z.looseObject({ path: z.string() })
type Row = z.infer<typeof Row>
const Tree = z.object({ files: z.array(Row), others: z.array(Row), folders: z.array(z.string()) })
const Linked = z.object({ linked: z.array(Row) })
const Found = z.looseObject({ results: z.array(Row), files: z.unknown(), lines: z.unknown() })
const Stats = z.record(z.string(), z.number().nullable())
const HostPlugins = z.array(z.looseObject({ id: z.string(), on: z.unknown(), loaded: z.unknown() }))
const GuestPage = z.object({ page: z.string(), wrapper: z.custom<(rawPath: string) => string>((v) => v instanceof Function) })
type Res = Writable & { headersSent: boolean; setHeader(k: string, v: OutgoingHttpHeader): void; removeHeader(k: string): void
  writeHead(status: number, h?: OutgoingHttpHeaders): void }
type SearchNode = ReturnType<typeof parseSearch>
type Guest = { id: string; share: Share }

const DIST = path.join(ROOT, "web", "dist")
const FONTS = path.join(ROOT, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts")
const BODY_MAX = 1 << 20
const WRITES = 300, NEW_NOTES = 30, SAYS = 30, SEARCHES = 60, TYPES = 1200, QUERIES = 60
const NOTE_MAX = 256_000, SOCKETS = 12
export const ROOM = { notes: 500, bytes: 20 << 20 }
const csp = (scripts: string[]) => `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${scripts.join(" ")}; style-src 'self' 'unsafe-inline'; ` +
  "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
export const ID = /^[A-Za-z0-9_-]{11}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/
const VIEWS = ["kanban", "excalidraw", "dataview"]
const PLUGIN_FIELDS = ["id", "name", "description", "requires", "enhances", "runsOnServer", "tint", "category", "group", "icon", "replaces", "marks", "on", "loaded",
  "pages", "blocks", "draws", "settings", "bundle", "version"]
const PAGE_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data: blob:; " +
  "img-src data: blob:; font-src data:; media-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'"
const wrapCsp = (at: string) => `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src ${at}; base-uri 'none'; frame-ancestors 'self'`
export const GUEST_PLUGINS = ["share", "files", "editing", "folding", "outline", "find", "properties", "tags", "page-preview", "backlinks", "search", "companion", "html", ...VIEWS]

export const sha = (s: string) => crypto.createHash("sha256").update(s).digest("base64url")
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
export const expired = (s: Share, t = Date.now()) => Date.parse(s.expires) <= t
const inside = (top: string, p: string) => p === top || p.startsWith(top + path.sep)

export class Folder {
  vaultDir: string
  folder: string
  top = ""
  root = ""
  constructor(vaultDir: string, folder: string) {
    this.vaultDir = vaultDir
    this.folder = folder
    try {
      const root = fs.realpathSync.native(vaultDir), real = fs.realpathSync.native(path.join(vaultDir, folder))
      if (inside(root, real) && real !== root) { this.root = root; this.top = real }
    } catch {}
  }

  see(rel: string): string | null {
    const mine = rel.startsWith(`${this.folder}/`) ? rel.slice(this.folder.length + 1) : null
    if (!this.top || !mine || mine.split("/").some((x) => x.startsWith("."))) return null
    try { return inside(this.top, fs.realpathSync.native(path.join(this.vaultDir, rel))) ? mine : null } catch { return mine }
  }

  at(p: unknown): string {
    const parts = String(p ?? "").replaceAll("\\", "/").split("/").filter((x) => x !== "" && x !== ".")
    if (!this.top) throw new HTTPError(404, "this folder isn't there any more")
    if (!parts.length || parts.some((x) => x === ".." || x.startsWith(".") || x.includes("\0"))) throw new HTTPError(400, "not a file in this folder")
    const rel = `${this.folder}/${parts.join("/")}`
    let at = path.join(this.root, rel), real = ""
    while (!fs.existsSync(at) && at !== this.root) at = path.dirname(at)
    try { real = fs.realpathSync.native(at) } catch {}
    if (!real || !inside(this.top, real)) throw new HTTPError(404, "not a file in this folder")
    return rel
  }

  tree(t: z.infer<typeof Tree>) {
    const rows = (list: Row[]) => list.flatMap((r) => { const p = this.see(r.path); return p === null ? [] : [{ ...r, path: p }] })
    return { files: rows(t.files), others: rows(t.others), folders: t.folders.flatMap((f) => { const p = this.see(f); return p === null ? [] : [p] }) }
  }

  scrub(text: string) {
    return text.replaceAll(`${this.folder}/`, "").replaceAll(this.folder, this.folder.split("/").pop()!)
  }
}

export class Gateway {
  plugin: Plugin
  shares: () => Record<string, Share>
  used: (id: string) => void
  boot = Date.now().toString(36)
  secret = crypto.randomBytes(32)
  hits = new Map<string, { n: number; until: number }>()
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 << 10 })
  sockets = new Map<WebSocket, { g: Guest; kind: "events" | "threads" | "page" }>()
  keeper: (x: string) => Promise<Machine | null>
  passed = new WeakMap<IncomingMessage, string>()
  addresses: () => string[]

  constructor(plugin: Plugin, shares: () => Record<string, Share>, used: (id: string) => void, keeper: (x: string) => Promise<Machine | null> = async () => null,
    addresses: () => string[] = () => []) {
    this.plugin = plugin
    this.shares = shares
    this.used = used
    this.keeper = keeper
    this.addresses = addresses
  }

  folderOf(g: Guest) {
    return new Folder(this.plugin.vault.path, g.share.folder)
  }

  async handle(req: IncomingMessage, res: Res): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x")
    const m = /^\/s\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (!m || !this.ours(req)) return false
    const there = this.passed.has(req) ? null : await this.elsewhere(m[1])
    if (there) return await this.passOn(req, res, there), true
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Frame-Options", "SAMEORIGIN")
    let g: Guest | null = null
    try {
      if (TOKEN.test(m[1]) && (!m[2] || m[2] === "/")) return this.invite(req, res, m[1]), true
      if (!ID.test(m[1])) return this.page(res, 404, "There's nothing here", "Check the link you were sent."), true
      const rest = m[2] ?? ""
      if (rest === "") return this.redirect(res, `/s/${m[1]}/`), true
      if (rest.startsWith("/v/")) return this.artifact(req, res, m[1], rest.slice(3), url), true
      if (!rest.startsWith("/api/")) return this.file(req, res, m[1], rest.slice(1)), true
      g = this.guestOf(req, m[1])
      if (!g) return this.json(res, 401, { error: "this folder isn't shared with you any more" }), true
      await this.api(req, res, g, rest.slice(5), url)
    } catch (e) {
      const known = e instanceof HTTPError || e instanceof OpError ? e : null
      if (!known) log.error("a guest's request failed", e)
      const said = known ? known.message : "something went wrong"
      if (!res.headersSent) this.json(res, known?.status ?? 500, { error: g ? this.folderOf(g).scrub(said) : said })
    }
    return true
  }

  async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<boolean> {
    const p = new URL(req.url ?? "/", "http://x").pathname
    if (!p.startsWith("/s/") || !this.ours(req)) return false
    const id = /^\/s\/([A-Za-z0-9_-]{11})\//.exec(p)?.[1], there = id && !this.passed.has(req) ? await this.elsewhere(id) : null
    if (there) {
      const up = new WebSocket(`${there.url.replace(/^http/, "ws")}/api/share/relay`, { headers: { ...MACHINE_CLIENT, ...this.guestHeaders(req) }, handshakeTimeout: 8000 })
      this.wss.handleUpgrade(req, socket, head, (ws) => pipeSockets(ws, up, () => ws.close(1011, "unreachable")))
      return true
    }
    const a = this.admit(req)
    if (!a) { socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return true }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, req, a))
    return true
  }

  admit(req: IncomingMessage) {
    const url = new URL(req.url ?? "/", "http://x"), p = url.pathname
    const m = /^\/s\/([A-Za-z0-9_-]{11})\/api\/(events|companion\/live|artifact\/shared)$/.exec(p)
    const g = m && this.sameSite(req) ? this.guestOf(req, m[1]) : null
    let page = ""
    if (g && m![2] === "artifact/shared") try { page = this.folderOf(g).at(url.searchParams.get("path")) } catch {}
    const join = this.plugin.service("html:shared")
    if (!g || [...this.sockets.values()].filter((s) => s.g.id === g.id).length >= SOCKETS
      || (m![2] === "artifact/shared" && (!/\.html?$/i.test(page) || !fs.existsSync(this.plugin.vault.abs(page)) || typeof join !== "function"))) return null
    return { g, page, kind: m![2] === "events" ? "events" as const : m![2] === "artifact/shared" ? "page" as const : "threads" as const }
  }

  attach(ws: WebSocket, req: IncomingMessage, { g, page, kind }: NonNullable<ReturnType<Gateway["admit"]>>) {
    const join = this.plugin.service("html:shared")
    this.sockets.set(ws, { g, kind })
    ws.on("close", () => this.sockets.delete(ws))
    ws.on("error", () => ws.close())
    if (kind === "events") return ws.send(JSON.stringify({ type: "hello", v: this.v(), role: g.share.role }))
    if (kind === "page") return join?.(ws, page, { shown: this.folderOf(g).see(page) ?? "",
      id: `g_${g.id}`, name: g.share.guest, ua: String(req.headers["user-agent"] ?? ""), watch: g.share.role === "read" ? "you can only view this folder" : undefined })
    const threads = this.plugin.service("companion:guest"), f = this.folderOf(g)
    if (typeof threads === "function") threads(ws, { id: g.id, since: Date.parse(g.share.created), name: g.share.guest, who: guestWho(g.share), role: g.share.role, see: (rel: string) => f.see(rel), at: (q: string) => f.at(q), said: () => this.limited(`say:${g.id}`, SAYS), holds: () => this.holds(g),
      may: (rel: string, before: string, after: string) => this.mayWrite(g, rel, before, after), slow: () => this.limited(`type:${g.id}`, TYPES) })
    else ws.send(JSON.stringify({ t: "state", mode: "quiet", name: "", agents: [], notes: [], said: [] }))
  }

  async elsewhere(x: string) {
    if (TOKEN.test(x) ? Object.values(this.shares()).some((s) => same(sha(x), s.token)) : !ID.test(x) || x in this.shares()) return null
    return this.keeper(x).catch(() => null)
  }

  guestHeaders(req: IncomingMessage): Record<string, string> {
    const pick = (k: string) => { const v = req.headers[k]; return typeof v === "string" ? v : undefined }
    return Object.fromEntries(Object.entries({ path: req.url, host: pick("host"), cookie: pick("cookie"), origin: pick("origin"), ua: pick("user-agent"),
      "fetch-site": pick("sec-fetch-site"), proto: this.https(req) ? "https" : "http", ip: this.ipOf(req) }).filter(([, v]) => v).map(([k, v]) => [`x-share-${k}`, String(v)]))
  }

  async passOn(req: IncomingMessage, res: Res, m: Machine) {
    const method = req.method ?? "GET"
    let body: Buffer | undefined
    if (method !== "GET" && method !== "HEAD") {
      const all = await readAll(req)
      if (!all) return this.json(res, 413, { error: "too big" })
      body = all
    }
    const type = req.headers["content-type"]
    const r = await fetch(`${m.url}/api/share/relay`, { method, headers: { ...MACHINE_CLIENT, ...this.guestHeaders(req), ...(typeof type === "string" ? { "content-type": type } : {}) },
      body: body ? new Uint8Array(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(60_000) }).catch(() => null)
    if (!r) return this.page(res, 502, "This folder can't be reached now", "The computer it's on doesn't answer. Try again in a while.")
    const head: Record<string, string | string[]> = {}
    for (const k of PASSED) { const v = r.headers.get(k); if (v !== null) head[k] = v }
    const cookie = r.headers.getSetCookie()
    if (cookie.length) head["set-cookie"] = cookie
    res.writeHead(r.status, head)
    if (!r.body || method === "HEAD") return res.end()
    Readable.from(r.body, { objectMode: false }).on("error", () => res.destroy()).pipe(res)
  }

  unwrap(req: IncomingMessage, copy = false): IncomingMessage | null {
    if (this.passed.has(req)) return req
    const had = this.copies.get(req)
    if (had) return had
    const h = req.headers, x = (k: string) => { const v = h[`x-share-${k}`]; return typeof v === "string" ? v : undefined }
    const p = x("path") ?? ""
    if (!p.startsWith("/s/")) return null
    const headers: IncomingHttpHeaders = Object.fromEntries(Object.entries({ host: x("host"), cookie: x("cookie"), origin: x("origin"), "user-agent": x("ua"), "sec-fetch-site": x("fetch-site"),
      "x-forwarded-proto": x("proto"), "content-type": h["content-type"], "content-length": h["content-length"] }).filter(([, v]) => v !== undefined))
    const out: IncomingMessage = copy ? Object.create(req, { url: { value: p }, headers: { value: headers } }) : Object.assign(req, { url: p, headers })
    if (copy) this.copies.set(req, out)
    this.passed.set(out, x("ip") ?? "")
    return out
  }
  copies = new WeakMap<IncomingMessage, IncomingMessage>()

  async relayed(http: IncomingMessage) {
    const req = this.unwrap(http)
    if (!req) throw new HTTPError(400, "not a guest's request")
    const out = new Kept()
    if (!(await this.handle(req, out))) this.json(out, 404, { error: "not found" })
    await out.done
    const { "content-type": type = "application/octet-stream", ...headers } = out.headers
    return reply(out.status, new Text(Buffer.concat(out.chunks), type, headers))
  }
  admitRelayed(http: IncomingMessage) {
    const req = this.unwrap(http, true)
    return !!req && !!this.admit(req)
  }
  attachRelayed(ws: WebSocket, http: IncomingMessage) {
    const req = this.unwrap(http, true), a = req ? this.admit(req) : null
    if (!req || !a) return ws.close(1008, "refused")
    this.attach(ws, req, a)
  }

  guestOf(req: IncomingMessage, id: string): Guest | null {
    const share = this.shares()[id]
    const token = cookies(req)[`vs_${id}`]
    if (!share || !token || !TOKEN.test(token) || !same(sha(token), share.token) || expired(share)) return null
    return { id, share }
  }

  invite(req: IncomingMessage, res: Res, token: string) {
    if (this.limited(`invite:${this.ipOf(req)}`, 30)) return this.page(res, 429, "Too many tries", "Wait a minute and try again.")
    const h = sha(token)
    const hit = Object.entries(this.shares()).find(([, s]) => same(h, s.token))
    if (!hit) return this.page(res, 404, "This link doesn't work", "It may have been mistyped or turned off. Ask whoever sent it for a new one.")
    const [id, share] = hit
    if (expired(share)) return this.page(res, 410, "This link has expired", "Ask whoever sent it for a new one.")
    const secure = this.https(req) ? "; Secure" : ""
    const age = Math.max(0, Math.floor((Date.parse(share.expires) - Date.now()) / 1000))
    res.setHeader("Set-Cookie", `vs_${id}=${token}; Path=/s/${id}/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}`)
    this.redirect(res, `/s/${id}/`)
  }

  file(req: IncomingMessage, res: Res, id: string, rest: string) {
    if (req.method !== "GET" && req.method !== "HEAD") return this.json(res, 405, { error: "not here" })
    let name: string
    try { name = decodeURIComponent(rest) } catch { return this.json(res, 400, { error: "bad address" }) }
    if (name === "" || name === "index.html") {
      const g = this.guestOf(req, id)
      if (!g) return this.page(res, 403, "This folder isn't shared with you", "Open the link you were sent again; if it doesn't work, ask for a new one.")
      let html: string
      try { html = fs.readFileSync(path.join(DIST, "index.html"), "utf8") } catch { return this.json(res, 503, { error: "the app isn't built" }) }
      const said = JSON.stringify(this.guestInfo(g)).replace(/</g, "\\u003c")
      const page = html.replace("<head>", () => `<head>\n    <script>window.vaultiteShare = ${said}</script>`)
      // CSP refuses an inline script it has no hash for, the import map's too
      const scripts = [...page.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`)
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": csp(scripts) })
      return res.end(page)
    }
    const abs = path.resolve(DIST, name)
    if (!abs.startsWith(DIST + path.sep) || name.split("/").some((x) => x.startsWith(".")) || !/^(assets\/[^/]+|icon[\w-]*\.(svg|png)|apple-touch-icon\.png|manifest\.webmanifest)$/.test(name)) {
      return this.json(res, 404, { error: "not found" })
    }
    this.send(res, abs, name.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache")
  }

  artifact(req: IncomingMessage, res: Res, id: string, rest: string, url: URL) {
    let shown: string
    try { shown = decodeURIComponent(rest) } catch { return this.json(res, 400, { error: "bad address" }) }
    // a sandboxed frame's request carries no cookie
    const q = Object.fromEntries(url.searchParams), share = this.shares()[id]
    const g = q.frame === "1" ? (share && !expired(share) && this.keyed(id, shown, q.k) ? { id, share } : null) : this.guestOf(req, id)
    const make = this.plugin.service("html:guest")
    if (!g || typeof make !== "function" || req.method !== "GET") return this.json(res, 404, { error: "not found" })
    const rel = this.folderOf(g).at(shown)
    if (!/\.html?$/i.test(rel)) return this.json(res, 404, { error: "not found" })
    const out = GuestPage.parse(make(rel, shown, q))
    const at = `${this.https(req) ? "https" : "http"}://${req.headers.host}/s/${id}/v/`
    const head = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-DNS-Prefetch-Control": "off" }
    res.removeHeader("X-Frame-Options")
    if (q.frame === "1") res.writeHead(200, { ...head, "Content-Security-Policy": PAGE_CSP }), res.end(out.page)
    else res.writeHead(200, { ...head, "Content-Security-Policy": wrapCsp(at) }), res.end(out.wrapper(`${rest}${url.search || "?"}${url.search ? "&" : ""}k=${this.key(id, shown)}`))
  }

  key(id: string, shown: string, until = Date.now() + 600_000) {
    return `${until}.${crypto.createHmac("sha256", this.secret).update(`${id}\n${shown}\n${until}`).digest("base64url")}`
  }
  keyed(id: string, shown: string, k: unknown) {
    const until = Number(String(k ?? "").split(".")[0])
    return Number.isFinite(until) && until > Date.now() && same(String(k), this.key(id, shown, until))
  }

  send(res: Res, abs: string, cache: string) {
    let body: Buffer
    try {
      if (!fs.statSync(abs).isFile()) throw new Error("not a file")
      body = fs.readFileSync(abs)
    } catch { return this.json(res, 404, { error: "not found" }) }
    res.writeHead(200, { "Content-Type": contentType(abs), "Cache-Control": cache })
    res.end(body)
  }

  async api(req: IncomingMessage, res: Res, g: Guest, route: string, url: URL) {
    const method = req.method ?? "GET"
    if (method !== "GET" && !this.sameSite(req)) return this.json(res, 403, { error: "the page asking isn't this folder's" })
    this.used(g.id)
    const q = Object.fromEntries(url.searchParams)
    const f = this.folderOf(g), role = g.share.role
    const api = (m: string, r: string, body?: unknown) => this.plugin.host.api(m, r, body, guestWho(g.share), m === "GET" ? {} : { report: `share ${m} ${r.split("?")[0]}` })
    const theirs = (x: Row) => ({ ...x, path: f.see(x.path), problems: [] })
    const row = async (m: string, r: string, body?: Item) => theirs(Row.parse(await api(m, r, body)))
    const key = `${method} ${route}`
    if (key === "GET state" || key === "GET state/manifest") return this.json(res, 200, { v: this.v(), state: await this.state(g, f) })
    if (key === "GET file") return this.json(res, 200, await row("GET", `file?path=${encodeURIComponent(f.at(q.path))}`))
    if (key === "GET file/info") return this.json(res, 200, await row("GET", `file/info?path=${encodeURIComponent(f.at(q.path))}`))
    // api/raw/<its name>?path=...: the name only for the browser's sake
    if (method === "GET" && (route === "raw" || route.startsWith("raw/"))) return this.raw(req, res, f.at(q.path), q.download === "1")
    if (key === "GET file/linked") {
      const rel = f.at(q.path), t = Linked.parse(await api("GET", `file/linked?path=${encodeURIComponent(rel)}`))
      const linked = t.linked.flatMap((l) => { const p = f.see(l.path); return p === null ? [] : [{ ...l, path: p }] })
      return this.json(res, 200, { path: f.see(rel), linked, links: linkTargets(this.plugin.vault.entries.get(rel)?.body ?? "") })
    }
    if (key === "GET search") {
      if (this.limited(`search:${g.id}`, SEARCHES)) return this.json(res, 429, { error: "too many searches at once: wait a moment" })
      if (!plainQuery(q.q ?? "")) throw new HTTPError(400, "search here takes words and phrases, not /regular expressions/, path: or folder:")
      const tree = f.tree(Tree.parse(await api("GET", "files"))), under = q.folder ? `${String(q.folder).replace(/^\/+|\/+$/g, "")}/` : ""
      const only = [...tree.files, ...tree.others].map((r) => r.path).filter((p) => p.startsWith(under)).map((p) => `${f.folder}/${p}`)
      const found = Found.parse(await api("GET", `search?${new URLSearchParams({ ...pick(q, ["q", "lines", "case", "sort", "context", "offset", "limit"]), total: "1", only: only.join("\n"), ...(q.path ? { path: f.at(q.path) } : {}) })}`))
      const page = found.results.flatMap((r) => { const p = f.see(r.path); return p === null ? [] : [{ ...r, path: p }] })
      return this.json(res, 200, q.total === "1" ? { results: page, files: found.files, lines: found.lines } : page)
    }
    if (key === "POST artifact/stat") {
      const asked = this.parsed(GuestStat, await this.body(req)).paths, rels = new Map<string, string>()
      for (const x of asked.slice(0, 200)) try { rels.set(f.at(x), String(x)) } catch {}
      const now = Stats.parse(await this.plugin.host.api("POST", "artifact/stat", { paths: [...rels.keys()] }))
      return this.json(res, 200, Object.fromEntries([...rels].map(([rel, x]) => [x, now[rel] ?? null])))
    }
    if (key === "GET config/plugin") return this.json(res, 200, Object.fromEntries(String(q.ids ?? "").split(",").filter(Boolean).slice(0, 100).map((x) => [x, {}])))
    if (key === "GET loading") return this.json(res, 200, { ready: true, downloading: [] })
    if (method === "GET" && ["ops", "vaults", "plugins", "blocks"].includes(route)) return this.json(res, 200, route === "vaults" ? { vaults: [] } : [])
    const code = method === "GET" && /^plugins\/([a-z0-9-]+)\/[^/]+\/[\w.-]+\.js$/.exec(route)
    if (code && VIEWS.includes(code[1])) {
      const js = await this.plugin.host.api("GET", route)
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "private, max-age=31536000, immutable" })
      return res.end(String(js))
    }
    const font = method === "GET" && /^excalidraw\/fonts\/([\w-][\w.-]*)\/([\w-][\w.-]*\.woff2?)$/.exec(route)
    if (font) return this.send(res, path.join(FONTS, font[1], font[2]), "public, max-age=31536000, immutable")
    if (method === "GET" && (route === "dataview/query" || route === "dataview/inline")) {
      if (this.limited(`query:${g.id}`, QUERIES)) return this.json(res, 429, { error: "too many queries at once: wait a moment" })
      const within = this.plugin.service("dataview:within")
      if (typeof within !== "function") return this.json(res, 404, { error: "not here" })
      const run = within(`share:${f.folder}`, (rel: string) => f.see(rel) !== null)
      const at = q.path ? f.at(q.path) : undefined
      const out = await (route === "dataview/query" ? run.query(String(q.q ?? ""), at) : run.inline(String(q.q ?? ""), at))
      return this.json(res, 200, theirPaths(out, f.folder))
    }
    if ((key === "PUT file" || key === "POST file") && role === "edit") {
      if (this.limited(`write:${g.id}`, WRITES) || (method === "POST" && this.limited(`new:${g.id}`, NEW_NOTES))) return this.json(res, 429, { error: "too many changes at once: wait a moment" })
      const body = this.parsed(GuestWrite, await this.body(req))
      const rel = f.at(body.path)
      const edit = method === "PUT" && body.text === undefined ? body.edit : undefined
      let text = body.text ?? null
      if (edit && typeof body.baseHash === "string") {
        let cur = ""
        try { cur = fs.readFileSync(this.plugin.vault.abs(rel), "utf8") } catch {}
        const { at, cut, add } = edit
        if (at + cut <= cur.length) text = cur.slice(0, at) + add + cur.slice(at + cut)
      }
      if (!/\.md$/i.test(rel) || text === null) throw new HTTPError(400, "only notes' text can be written here")
      if (text.length > NOTE_MAX) throw new HTTPError(413, "a note this long can't be written here")
      const fresh = method === "POST" || !fs.existsSync(this.plugin.vault.abs(rel))
      if (fresh && method === "PUT" && this.limited(`new:${g.id}`, NEW_NOTES)) return this.json(res, 429, { error: "too many changes at once: wait a moment" })
      const has = folderSize(this.plugin.vault, f.folder), room = g.share.room ?? { notes: has.notes + ROOM.notes, bytes: has.bytes + ROOM.bytes }
      const grows = Buffer.byteLength(text) + (fresh ? 512 : -(this.plugin.vault.entries.get(rel)?.stat.size ?? 0))
      if ((fresh && has.notes >= room.notes) || (grows > 0 && has.bytes + grows > room.bytes)) throw new HTTPError(507, "this folder is full: ask whoever shared it")
      const sent: Item = { path: rel, ...(edit ? { edit } : { text }), ...pick(body, method === "PUT" ? ["base", "baseHash", "lean"] : ["unique"]) }
      try { return this.json(res, method === "POST" ? 201 : 200, await row(method, "file", sent)) } catch (e) {
        if ((e instanceof OpError || e instanceof HTTPError) && e.status === 409 && method === "PUT") return this.json(res, 409, { error: "the note changed meanwhile", ...await row("GET", `file?path=${encodeURIComponent(rel)}`) })
        throw e
      }
    }
    this.json(res, 403, { error: method === "GET" || role === "edit" ? "not part of a shared folder" : "you can't change this folder" })
  }

  v() {
    return `${this.boot}:${this.plugin.vault.version}`
  }

  holds(g: Guest, cur: Share | undefined = this.shares()[g.id]): cur is Share {
    return !!cur && cur.token === g.share.token && !expired(cur)
  }

  mayWrite(g: Guest, rel: string, before: string, after: string) {
    const cur = this.shares()[g.id]
    if (!this.holds(g, cur)) return "this folder isn't shared with you any more"
    if (cur.role !== "edit" || new Folder(this.plugin.vault.path, g.share.folder).see(rel) === null) return "you can't change this folder"
    if (after.length > NOTE_MAX) return "a note this long can't be written here"
    const has = folderSize(this.plugin.vault, g.share.folder), room = cur.room ?? { notes: has.notes + ROOM.notes, bytes: has.bytes + ROOM.bytes }
    const grows = Buffer.byteLength(after) - Buffer.byteLength(before)
    if (grows > 0 && has.bytes + grows > room.bytes) return "this folder is full"
    return guestRefusal(this.plugin.vault, rel, before, after)
  }

  async state(g: Guest, f: Folder) {
    return {
      vault: { path: g.share.folder.split("/").pop(), problems: [] },
      files: f.tree(Tree.parse(await this.plugin.host.api("GET", "files"))),
      config: { appearance: {}, plugins: { disabled: [], enabled: [] }, hotkeys: {}, sidebars: { left: ["files:files"], right: [], collapsed: [] } },
      vaultPlugins: HostPlugins.parse(await this.plugin.host.api("GET", "plugins")).filter((p) => VIEWS.includes(p.id) && p.on && p.loaded)
        .map((p) => ({ ...Object.fromEntries(PLUGIN_FIELDS.filter((k) => k in p).map((k) => [k, p[k]])), folder: "", problems: [], warnings: [] })),
    }
  }

  guestInfo(g: Guest) {
    return { guest: g.share.guest, role: g.share.role, folder: g.share.folder.split("/").pop(), expires: g.share.expires, plugins: GUEST_PLUGINS }
  }

  raw(req: IncomingMessage, res: Res, rel: string, download = false) {
    const abs = path.join(this.plugin.vault.path, rel)
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { return this.json(res, 404, { error: "not found" }) }
    if (!st.isFile()) return this.json(res, 404, { error: "not found" })
    res.writeHead(200, { "Content-Type": contentType(rel), "Content-Length": String(st.size), "Cache-Control": "no-cache",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}` })
    if (req.method === "HEAD") return res.end()
    fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res)
  }

  changed(paths: string[] | null) {
    for (const [ws, { g, kind }] of this.sockets) {
      if (ws.readyState !== ws.OPEN || kind !== "events") continue
      const f = this.folderOf(g)
      const mine = paths === null ? null : paths.flatMap((p) => { const x = f.see(p); return x === null ? [] : [x] })
      if (mine && !mine.length) continue
      ws.send(JSON.stringify({ type: "change", paths: mine, v: this.v() }))
    }
  }

  here(id: string) {
    for (const { g, kind } of this.sockets.values()) if (g.id === id && kind === "events") return true
    return false
  }

  close(id: string) {
    for (const [ws, { g }] of this.sockets) if (g.id === id) ws.terminate()
  }

  async body(req: IncomingMessage): Promise<unknown> {
    const all = await readAll(req)
    if (!all) throw new HTTPError(413, "too big")
    try { return JSON.parse(all.toString("utf8")) } catch { throw new HTTPError(400, "send JSON") }
  }

  parsed<T>(schema: z.ZodType<T>, body: unknown): T {
    const r = schema.safeParse(body)
    if (!r.success) throw new HTTPError(400, "not a file in this folder")
    return r.data
  }

  sameSite(req: IncomingMessage) {
    const o = req.headers.origin
    if (o === undefined) return req.headers["sec-fetch-site"] === undefined || req.headers["sec-fetch-site"] === "same-origin"
    try { return new URL(String(o)).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase() } catch { return false }
  }

  ours(req: IncomingMessage) {
    if (this.passed.has(req)) return true
    const host = String(req.headers.host ?? "").toLowerCase()
    return !!host && this.addresses().some((u) => { try { return new URL(u).host.toLowerCase() === host } catch { return false } })
  }

  https(req: IncomingMessage) {
    return req.headers["x-forwarded-proto"] === "https" || (!this.passed.has(req) && "cf-connecting-ip" in req.headers)
  }

  ipOf(req: IncomingMessage) {
    return this.passed.get(req) || String(req.headers["cf-connecting-ip"] ?? req.socket?.remoteAddress ?? "")
  }

  limited(key: string, n: number) {
    const t = Date.now()
    for (const [k, h] of this.hits) if (h.until < t) this.hits.delete(k)
    const h = this.hits.get(key)
    if (!h) { this.hits.set(key, { n: 1, until: t + 60_000 }); return false }
    return ++h.n > n
  }

  json(res: Res, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    res.end(JSON.stringify(body))
  }

  redirect(res: Res, to: string) {
    res.writeHead(302, { Location: to, "Cache-Control": "no-store" })
    res.end()
  }

  page(res: Res, status: number, title: string, text: string) {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" })
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{opacity:.7;margin:0}</style>
<h1>${esc(title)}</h1><p>${esc(text)}</p>`)
  }
}

// not its length or encoding: fetch undid that
const PASSED = ["content-type", "cache-control", "content-security-policy", "content-disposition", "location", "x-content-type-options", "referrer-policy",
  "x-frame-options", "x-dns-prefetch-control", "etag", "vary"]

class Kept extends Writable {
  status = 200
  headers: Record<string, string> = {}
  chunks: Buffer[] = []
  headersSent = false
  done = new Promise<void>((ok) => { this.on("finish", ok); this.on("close", ok); this.on("error", () => ok()) })
  setHeader(k: string, v: OutgoingHttpHeader) { this.headers[k.toLowerCase()] = String(v); return this }
  removeHeader(k: string) { delete this.headers[k.toLowerCase()] }
  writeHead(status: number, h: OutgoingHttpHeaders = {}) {
    this.status = status
    for (const [k, v] of Object.entries(h)) if (v !== undefined) this.setHeader(k, v)
    this.headersSent = true
    return this
  }
  override _write(c: Buffer | string, _enc: BufferEncoding, done: () => void) { this.chunks.push(Buffer.from(c)); done() }
}

export function folderSize(vault: { entries: Map<string, { stat: { size: number } }> }, folder: string) {
  let notes = 0, bytes = 0
  for (const [rel, e] of vault.entries) if (rel.startsWith(`${folder}/`)) { notes++; bytes += e.stat.size }
  return { notes, bytes }
}

export const guestWho = (s: Share): Who => ({ client: "guest", agent: s.guest, label: `${s.guest} (guest)`, source: "guest" })

function plainQuery(q: string) {
  let node: SearchNode
  try { node = parseSearch(q) } catch { return true }
  const ok = (n: SearchNode): boolean => n.t === "folder" ? false : n.t === "term" ? n.field !== "path" && !n.m.label.startsWith("/")
    : n.t === "prop" ? !n.value || ok(n.value) : "kids" in n ? n.kids.every(ok) : "kid" in n ? ok(n.kid) : true
  return ok(node)
}

async function readAll(req: AsyncIterable<Buffer>) {
  let size = 0
  const parts: Buffer[] = []
  for await (const c of req) if ((size += c.length) <= BODY_MAX) parts.push(c)
  return size > BODY_MAX ? null : Buffer.concat(parts)
}

function theirPaths(v: unknown, folder: string): unknown {
  if (typeof v === "string") return v === folder ? "" : v.startsWith(`${folder}/`) ? v.slice(folder.length + 1) : v
  if (Array.isArray(v)) return v.map((x) => theirPaths(x, folder))
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, theirPaths(x, folder)]))
  return v
}

const pick = (o: Item, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}
