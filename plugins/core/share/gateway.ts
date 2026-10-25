// A shared folder for its guest, on MCP's public listener: /s/<token> lets them in (a cookie), /s/<id>/ is the app,
// /s/<id>/api/ the few routes a guest may use, on paths inside the folder only. Everything else is refused.
import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import type { Duplex } from "node:stream"
import { WebSocketServer, type WebSocket } from "ws"
import { contentType, guestRefusal, HTTPError, OpError, parseSearch, type Plugin, ROOT, type Who, wikiTargets } from "../../../core/plugins.ts"
import type { Item } from "../../../core/vault.ts"

export type Role = "read" | "comment" | "edit"
/** A share as kept in data/config.json: `token` is the link's hash, never the link. */
export type Share = { folder: string; guest: string; role: Role; created: string; expires: string; token: string; used?: string
  /** The most the folder may hold, its notes and their bytes, past what it had when shared: an edit guest stops there. */
  room?: { notes: number; bytes: number } }
type Guest = { id: string; share: Share }

const DIST = path.join(ROOT, "web", "dist")
const BODY_MAX = 1 << 20
const WRITES = 300, NEW_NOTES = 30, SAYS = 30, SEARCHES = 60, TYPES = 1200 // a minute, per share
const NOTE_MAX = 256_000, SOCKETS = 12
/** What an edit guest may add to a folder: notes, and bytes. */
export const ROOM = { notes: 500, bytes: 20 << 20 }
/** The guest's page runs only its own scripts (`scripts`: its inline ones' hashes) and loads only from this address. */
const csp = (scripts: string[]) => `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${scripts.join(" ")}; style-src 'self' 'unsafe-inline'; ` +
  "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
const ID = /^[A-Za-z0-9_-]{11}$/, TOKEN = /^[A-Za-z0-9_-]{43}$/
/** The app's plugins a guest's app runs: reading, writing and comments; never agents, terminals or settings. */
export const GUEST_PLUGINS = ["files", "editing", "folding", "outline", "find", "properties", "tags", "page-preview", "backlinks", "search", "companion"]

export const sha = (s: string) => crypto.createHash("sha256").update(s).digest("base64url")
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
export const expired = (s: Share, t = Date.now()) => Date.parse(s.expires) <= t
const inside = (top: string, p: string) => p === top || p.startsWith(top + path.sep)

/** A shared folder as its guest sees it: their paths are relative to it, and nothing hidden in it, nor any link out
 *  of it (the vault follows linked folders and files), is theirs. */
export class Folder {
  vaultDir: string
  folder: string
  /** Its real path, in the vault's real one (root); "" when it's gone (or a link out of the vault). */
  top = ""
  root = ""
  constructor(vaultDir: string, folder: string) {
    this.vaultDir = vaultDir
    this.folder = folder
    try {
      const root = fs.realpathSync.native(vaultDir), real = fs.realpathSync.native(path.join(vaultDir, folder))
      if (inside(root, real) && real !== root) { this.root = root; this.top = real }
    } catch { /* gone */ }
  }

  /** The guest's path for a vault path, or null when it isn't theirs. */
  see(rel: string): string | null {
    const mine = rel.startsWith(`${this.folder}/`) ? rel.slice(this.folder.length + 1) : null
    if (!this.top || !mine || mine.split("/").some((x) => x.startsWith("."))) return null
    try { return inside(this.top, fs.realpathSync.native(path.join(this.vaultDir, rel))) ? mine : null } catch { return mine } // (gone: a change to it)
  }

  /** The vault path for a path the guest names: no hidden or `..` parts, and (what isn't there yet: its nearest folder
   *  that is) not a link out of the folder. */
  at(p: unknown): string {
    const parts = String(p ?? "").replaceAll("\\", "/").split("/").filter((x) => x !== "" && x !== ".")
    if (!this.top) throw new HTTPError(404, "this folder isn't there any more")
    if (!parts.length || parts.some((x) => x === ".." || x.startsWith(".") || x.includes("\0"))) throw new HTTPError(400, "not a file in this folder")
    const rel = `${this.folder}/${parts.join("/")}`
    let at = path.join(this.root, rel), real = ""
    while (!fs.existsSync(at) && at !== this.root) at = path.dirname(at)
    try { real = fs.realpathSync.native(at) } catch { /* gone meanwhile */ }
    if (!real || !inside(this.top, real)) throw new HTTPError(404, "not a file in this folder")
    return rel
  }

  /** The tree (GET files) as the guest's: their files and folders, by their paths. */
  tree(t: { files: Item[]; others: Item[]; folders: string[] }, body: (rel: string) => string | undefined = () => undefined) {
    // (links as written, wiki links only: a Markdown link by path is resolved only when its file is there, which would
    // tell what's outside the folder)
    const rows = (list: Item[]) => list.flatMap((r) => {
      const p = this.see(String(r.path))
      return p === null ? [] : [{ ...r, path: p, ...(r.links ? { links: wikiTargets(body(String(r.path)) ?? "") } : {}) }]
    })
    return { files: rows(t.files), others: rows(t.others), folders: t.folders.flatMap((f) => { const p = this.see(f); return p === null ? [] : [p] }) }
  }

  /** An error's words without the folder's place in the vault. */
  scrub(text: string) {
    return text.replaceAll(`${this.folder}/`, "").replaceAll(this.folder, this.folder.split("/").pop()!)
  }
}

export class Gateway {
  plugin: Plugin
  shares: () => Record<string, Share>
  used: (id: string) => void
  boot = Date.now().toString(36)
  hits = new Map<string, { n: number; until: number }>()
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 << 10 })
  sockets = new Map<WebSocket, { g: Guest; kind: "events" | "threads" }>()

  constructor(plugin: Plugin, shares: () => Record<string, Share>, used: (id: string) => void) {
    this.plugin = plugin
    this.shares = shares
    this.used = used
  }

  folderOf(g: Guest) {
    return new Folder(this.plugin.vault.path, g.share.folder)
  }

  /** A guest's request on the public listener: true when it was one (/s/...), answered. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x")
    const m = /^\/s\/([^/]+)(\/.*)?$/.exec(url.pathname)
    if (!m || !this.ours(req)) return false
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Frame-Options", "SAMEORIGIN")
    let g: Guest | null = null
    try {
      if (TOKEN.test(m[1]) && (!m[2] || m[2] === "/")) return this.invite(req, res, m[1]), true
      if (!ID.test(m[1])) return this.page(res, 404, "There's nothing here", "Check the link you were sent."), true
      const rest = m[2] ?? ""
      if (rest === "") return this.redirect(res, `/s/${m[1]}/`), true
      if (!rest.startsWith("/api/")) return this.file(req, res, m[1], rest.slice(1)), true
      g = this.guestOf(req, m[1])
      if (!g) return this.json(res, 401, { error: "this folder isn't shared with you any more" }), true
      await this.api(req, res, g, rest.slice(5), url)
    } catch (e) {
      const status = e instanceof HTTPError || e instanceof OpError ? (e as { status: number }).status : 500
      const known = e instanceof HTTPError || e instanceof OpError
      if (!known) console.error("share:", e)
      const said = known ? String((e as Error).message) : "something went wrong"
      if (!res.headersSent) this.json(res, status, { error: g ? this.folderOf(g).scrub(said) : said })
    }
    return true
  }

  /** A WebSocket for a guest's app (its live changes, its threads): true when it was one, taken or refused. */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const p = new URL(req.url ?? "/", "http://x").pathname
    if (!p.startsWith("/s/") || !this.ours(req)) return false
    const m = /^\/s\/([A-Za-z0-9_-]{11})\/api\/(events|companion\/live)$/.exec(p)
    const g = m && this.sameSite(req) ? this.guestOf(req, m[1]) : null
    // (a share's sockets are counted: a guest's limits are per socket, so not as many as they like)
    if (!g || [...this.sockets.values()].filter((s) => s.g.id === g.id).length >= SOCKETS) { socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return true }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const kind = m![2] === "events" ? "events" : "threads"
      this.sockets.set(ws, { g, kind })
      ws.on("close", () => this.sockets.delete(ws))
      ws.on("error", () => ws.close())
      if (kind === "events") return ws.send(JSON.stringify({ type: "hello", v: this.v() }))
      // (Companion's: threads for a guest who may comment, who's in a note and its text as typed, in their folder, by their paths)
      const threads = this.plugin.service("companion:guest"), f = this.folderOf(g)
      if (typeof threads === "function") threads(ws, { id: g.id, since: Date.parse(g.share.created), name: g.share.guest, who: guestWho(g.share), role: g.share.role, see: (rel: string) => f.see(rel), at: (q: string) => f.at(q), said: () => this.limited(`say:${g.id}`, SAYS),
        may: (rel: string, before: string, after: string) => this.mayWrite(g, rel, before, after), slow: () => this.limited(`type:${g.id}`, TYPES) })
      else ws.send(JSON.stringify({ t: "state", mode: "quiet", name: "", agents: [], notes: [], said: [] }))
    })
    return true
  }

  /** A share's guest by its cookie: the share, while it's neither revoked nor expired. */
  guestOf(req: IncomingMessage, id: string): Guest | null {
    const share = this.shares()[id]
    const token = cookies(req)[`vs_${id}`]
    if (!share || !token || !TOKEN.test(token) || !same(sha(token), share.token) || expired(share)) return null
    return { id, share }
  }

  /** The link: its share's cookie set, then its app. */
  invite(req: IncomingMessage, res: ServerResponse, token: string) {
    if (this.limited(`invite:${req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? ""}`, 30)) return this.page(res, 429, "Too many tries", "Wait a minute and try again.")
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

  /** The app's files (its build), the same for anyone; its page only for a guest. */
  file(req: IncomingMessage, res: ServerResponse, id: string, rest: string) {
    if (req.method !== "GET" && req.method !== "HEAD") return this.json(res, 405, { error: "not here" })
    let name: string
    try { name = decodeURIComponent(rest) } catch { return this.json(res, 400, { error: "bad address" }) }
    if (name === "" || name === "index.html") {
      const g = this.guestOf(req, id)
      if (!g) return this.page(res, 403, "This folder isn't shared with you", "Open the link you were sent again; if it doesn't work, ask for a new one.")
      let html: string
      try { html = fs.readFileSync(path.join(DIST, "index.html"), "utf8") } catch { return this.json(res, 503, { error: "the app isn't built" }) }
      // (the app knows it's a guest's before its code runs: web/src/core/share.ts)
      const said = JSON.stringify(this.guestInfo(g)).replace(/</g, "\\u003c")
      const page = html.replace("<head>", () => `<head>\n    <script>window.vaultiteShare = ${said}</script>`)
      const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`)
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": csp(scripts) })
      return res.end(page)
    }
    // (the app's code and its icons: nothing else of its build)
    const abs = path.resolve(DIST, name)
    if (!abs.startsWith(DIST + path.sep) || name.split("/").some((x) => x.startsWith(".")) || !/^(assets\/[^/]+|icon[\w-]*\.(svg|png)|apple-touch-icon\.png|manifest\.webmanifest)$/.test(name)) {
      return this.json(res, 404, { error: "not found" })
    }
    this.send(res, abs, name.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache")
  }

  send(res: ServerResponse, abs: string, cache: string) {
    let body: Buffer
    try {
      if (!fs.statSync(abs).isFile()) throw new Error("not a file")
      body = fs.readFileSync(abs)
    } catch { return this.json(res, 404, { error: "not found" }) }
    res.writeHead(200, { "Content-Type": contentType(abs), "Cache-Control": cache })
    res.end(body)
  }

  // ---------- the guest's API: each route allowed here, on paths in their folder; anything else is refused

  async api(req: IncomingMessage, res: ServerResponse, g: Guest, route: string, url: URL) {
    const method = req.method ?? "GET"
    if (method !== "GET" && !this.sameSite(req)) return this.json(res, 403, { error: "the page asking isn't this folder's" })
    this.used(g.id)
    const q = Object.fromEntries(url.searchParams)
    const f = this.folderOf(g), role = g.share.role
    // (Activity names the guest for what they do)
    const api = (m: string, r: string, body?: unknown) => this.plugin.host.api(m, r, body, guestWho(g.share), m === "GET" ? {} : { report: `share ${m} ${r.split("?")[0]}` })
    const theirs = (x: Item) => ({ ...x, path: f.see(String(x.path)), problems: [] })
    const key = `${method} ${route}`
    if (key === "GET state") return this.json(res, 200, { v: this.v(), state: await this.state(g, f) })
    if (key === "GET file") return this.json(res, 200, theirs(await api("GET", `file?path=${encodeURIComponent(f.at(q.path))}`) as Item))
    if (key === "GET file/info") return this.json(res, 200, theirs(await api("GET", `file/info?path=${encodeURIComponent(f.at(q.path))}`) as Item))
    if (key === "GET raw") return this.raw(req, res, f.at(q.path))
    if (key === "GET search") {
      if (this.limited(`search:${g.id}`, SEARCHES)) return this.json(res, 429, { error: "too many searches at once: wait a moment" })
      if (!plainQuery(q.q ?? "")) throw new HTTPError(400, "search here takes words and phrases, not /regular expressions/, path: or folder:")
      // (only their files are looked at: what isn't theirs is never matched, nor timed)
      const tree = f.tree(await api("GET", "files") as Parameters<Folder["tree"]>[0]), under = q.folder ? `${String(q.folder).replace(/^\/+|\/+$/g, "")}/` : ""
      const only = [...tree.files, ...tree.others].map((r) => String(r.path)).filter((p) => p.startsWith(under)).map((p) => `${f.folder}/${p}`)
      const found = await api("GET", `search?${new URLSearchParams({ ...pick(q, ["q", "lines", "case", "sort", "context", "offset", "limit"]), total: "1", only: only.join("\n"), ...(q.path ? { path: f.at(q.path) } : {}) })}`) as Item
      const page = (found.results as Item[]).flatMap((r) => { const p = f.see(String(r.path)); return p === null ? [] : [{ ...r, path: p }] })
      return this.json(res, 200, q.total === "1" ? { results: page, files: found.files, lines: found.lines } : page)
    }
    if (key === "GET config/plugin") return this.json(res, 200, Object.fromEntries(String(q.ids ?? "").split(",").filter(Boolean).slice(0, 100).map((x) => [x, {}])))
    if (method === "GET" && ["ops", "vaults", "plugins", "blocks"].includes(route)) return this.json(res, 200, route === "vaults" ? { vaults: [] } : [])
    if ((key === "PUT file" || key === "POST file") && role === "edit") {
      if (this.limited(`write:${g.id}`, WRITES) || (method === "POST" && this.limited(`new:${g.id}`, NEW_NOTES))) return this.json(res, 429, { error: "too many changes at once: wait a moment" })
      const body = await this.body(req) as Item
      const rel = f.at(body.path)
      if (!/\.md$/i.test(rel) || typeof body.text !== "string") throw new HTTPError(400, "only notes' text can be written here")
      if (body.text.length > NOTE_MAX) throw new HTTPError(413, "a note this long can't be written here")
      // (a PUT to a note that isn't there makes one: as a POST, it counts as a new note; a new note's dates take room too)
      const fresh = method === "POST" || !fs.existsSync(this.plugin.vault.abs(rel))
      if (fresh && method === "PUT" && this.limited(`new:${g.id}`, NEW_NOTES)) return this.json(res, 429, { error: "too many changes at once: wait a moment" })
      const has = folderSize(this.plugin.vault, f.folder), room = g.share.room ?? { notes: has.notes + ROOM.notes, bytes: has.bytes + ROOM.bytes }
      const grows = Buffer.byteLength(body.text) + (fresh ? 512 : -(this.plugin.vault.entries.get(rel)?.stat.size ?? 0))
      if ((fresh && has.notes >= room.notes) || (grows > 0 && has.bytes + grows > room.bytes)) throw new HTTPError(507, "this folder is full: ask whoever shared it")
      // (the file route checks what lands, as a guest's: core/guests.ts)
      const sent: Item = { path: rel, text: body.text, ...pick(body, method === "PUT" ? ["base", "baseHash", "lean"] : ["unique"]) }
      try { return this.json(res, method === "POST" ? 201 : 200, theirs(await api(method, "file", sent) as Item)) } catch (e) {
        // (a save that couldn't merge: the file as it is, so the editor shows it)
        if ((e as { status?: number }).status === 409 && method === "PUT") return this.json(res, 409, { error: "the note changed meanwhile", ...theirs(await api("GET", `file?path=${encodeURIComponent(rel)}`) as Item) })
        throw e
      }
    }
    this.json(res, 403, { error: method === "GET" || role === "edit" ? "not part of a shared folder" : "you can't change this folder" })
  }

  v() {
    return `${this.boot}:${this.plugin.vault.version}`
  }

  /** Why a guest's change to a note, typed live (Companion's rooms), can't land: as a write of theirs would be checked. */
  mayWrite(g: Guest, rel: string, before: string, after: string) {
    const cur = this.shares()[g.id]
    if (!cur || cur.token !== g.share.token || expired(cur)) return "this folder isn't shared with you any more"
    if (cur.role !== "edit" || new Folder(this.plugin.vault.path, g.share.folder).see(rel) === null) return "you can't change this folder"
    if (after.length > NOTE_MAX) return "a note this long can't be written here"
    const has = folderSize(this.plugin.vault, g.share.folder), room = cur.room ?? { notes: has.notes + ROOM.notes, bytes: has.bytes + ROOM.bytes }
    const grows = Buffer.byteLength(after) - Buffer.byteLength(before)
    if (grows > 0 && has.bytes + grows > room.bytes) return "this folder is full"
    return guestRefusal(this.plugin.vault, rel, before, after)
  }

  /** The state the guest's app starts from: their folder's files and the defaults, nothing of the vault's own. */
  async state(g: Guest, f: Folder) {
    return {
      vault: { path: g.share.folder.split("/").pop(), problems: [] },
      files: f.tree(await this.plugin.host.api("GET", "files") as Parameters<Folder["tree"]>[0], (rel) => this.plugin.vault.entries.get(rel)?.body),
      config: { appearance: {}, plugins: { disabled: [], enabled: [] }, hotkeys: {}, sidebars: { left: ["files:files"], right: [], collapsed: [] } },
      vaultPlugins: [],
    }
  }

  guestInfo(g: Guest) {
    return { guest: g.share.guest, role: g.share.role, folder: g.share.folder.split("/").pop(), expires: g.share.expires, plugins: GUEST_PLUGINS }
  }

  /** A file's bytes (an image in a note), as the app's /api/raw serves them, never run as a page. */
  raw(req: IncomingMessage, res: ServerResponse, rel: string) {
    const abs = path.join(this.plugin.vault.path, rel)
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { return this.json(res, 404, { error: "not found" }) }
    if (!st.isFile()) return this.json(res, 404, { error: "not found" })
    res.writeHead(200, { "Content-Type": contentType(rel), "Content-Length": String(st.size), "Cache-Control": "no-cache",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}` })
    if (req.method === "HEAD") return res.end()
    fs.createReadStream(abs).on("error", () => res.destroy()).pipe(res)
  }

  /** The vault changed: each guest's app hears of what changed in its folder (/api/events' `change`). */
  changed(paths: string[] | null) {
    for (const [ws, { g, kind }] of this.sockets) {
      if (ws.readyState !== ws.OPEN || kind !== "events") continue
      const f = this.folderOf(g)
      const mine = paths === null ? null : paths.flatMap((p) => { const x = f.see(p); return x === null ? [] : [x] })
      if (mine && !mine.length) continue
      ws.send(JSON.stringify({ type: "change", paths: mine, v: this.v() }))
    }
  }

  /** A share turned off: its guests' sockets close. */
  close(id: string) {
    for (const [ws, { g }] of this.sockets) if (g.id === id) ws.close()
  }

  // ---------- HTTP

  async body(req: IncomingMessage): Promise<unknown> {
    let size = 0
    const parts: Buffer[] = []
    for await (const c of req) if ((size += (c as Buffer).length) <= BODY_MAX) parts.push(c as Buffer)
    if (size > BODY_MAX) throw new HTTPError(413, "too big")
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")) } catch { throw new HTTPError(400, "send JSON") }
  }

  /** A write or a socket from this folder's own page: its Origin, when it sends one, is this address. */
  sameSite(req: IncomingMessage) {
    const o = req.headers.origin
    if (o === undefined) return req.headers["sec-fetch-site"] === undefined || req.headers["sec-fetch-site"] === "same-origin"
    try { return new URL(String(o)).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase() } catch { return false }
  }

  /** Asked at the vault's own public address (mcp.public.url), the one links name: shares answer only there. */
  ours(req: IncomingMessage) {
    const url = (this.plugin.secrets().mcp as { public?: { url?: string } } | undefined)?.public?.url
    try { return !!url && new URL(String(url)).host.toLowerCase() === String(req.headers.host ?? "").toLowerCase() } catch { return false }
  }

  https(req: IncomingMessage) {
    return req.headers["x-forwarded-proto"] === "https" || "cf-connecting-ip" in req.headers
  }

  /** Over `n` this minute for `key`. */
  limited(key: string, n: number) {
    const t = Date.now()
    for (const [k, h] of this.hits) if (h.until < t) this.hits.delete(k)
    const h = this.hits.get(key)
    if (!h) { this.hits.set(key, { n: 1, until: t + 60_000 }); return false }
    return ++h.n > n
  }

  json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    res.end(JSON.stringify(body))
  }

  redirect(res: ServerResponse, to: string) {
    res.writeHead(302, { Location: to, "Cache-Control": "no-store" })
    res.end()
  }

  page(res: ServerResponse, status: number, title: string, text: string) {
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" })
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:28rem;margin:18vh auto;padding:0 1.5rem}h1{font-size:1.4rem;margin:0 0 .5rem}p{opacity:.7;margin:0}</style>
<h1>${esc(title)}</h1><p>${esc(text)}</p>`)
  }
}

/** How many notes a folder holds, and their bytes. */
export function folderSize(vault: { entries: Map<string, { stat: { size: number } }> }, folder: string) {
  let notes = 0, bytes = 0
  for (const [rel, e] of vault.entries) if (rel.startsWith(`${folder}/`)) { notes++; bytes += e.stat.size }
  return { notes, bytes }
}

/** Who a guest's writes are by (Activity, Provenance): a person, not the user nor an agent. */
export const guestWho = (s: Share): Who => ({ client: "guest", agent: s.guest, label: `${s.guest} (guest)`, source: "guest" })

/** A search of words, phrases and their operators: no regular expression (it could hold the server), and no path: or
 *  folder: (they'd say where the folder is). */
function plainQuery(q: string) {
  let node
  try { node = parseSearch(q) } catch { return true } // (the search says what's wrong)
  const ok = (n: Item): boolean => n.t === "folder" ? false : n.t === "term" ? n.field !== "path" && !String(n.m?.label ?? "").startsWith("/")
    : n.t === "prop" ? !n.value || ok(n.value) : (n.kids ?? (n.kid ? [n.kid] : [])).every(ok)
  return ok(node as Item)
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
