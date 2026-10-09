// Vaultite's server: the web app and a JSON API over the vault (core/app.ts). The desktop app runs one per vault as
// its child (VAULTITE_DESKTOP=1, outside files over IPC: core/outside.ts); the web can switch vaults (core/vaults.ts).
import { errorContext, onServerError, startServerLog } from "./core/serverlog.ts"
import { execFile, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import module from "node:module"
import net from "node:net"
import os from "node:os"
import type { Duplex } from "node:stream"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import zlib from "node:zlib"
import { tailnetNames } from "./core/owner.ts"
import type { App } from "./core/app.ts"
import type { Live as LiveType } from "./core/live.ts"
import type { Vault } from "./core/vault.ts"

// Node's compile cache halves a start (the desktop app starts a server per window); it must be on before the app's
// modules load, so they're imported below rather than above.
module.enableCompileCache?.()
// Vault files are read on libuv's threads (core/vault.ts, readSoon): one iCloud holds keeps its thread, so have many.
process.env.UV_THREADPOOL_SIZE ??= "128"
startServerLog() // the log's lines dated, its errors heard (plugin.onServerError: the Errors plugin)
const { WebSocketServer } = await import("ws")
const { decodePart: decode, jsonOf, open, queryOf } = await import("./core/app.ts")
const { Live } = await import("./core/live.ts")
const events = await import("./core/events.ts")
Live.web = webBuild
const { clean } = await import("./core/files.ts")
const { allow, allowedPath, isOutside } = await import("./core/outside.ts")
const { isHeic, jpegOf } = await import("./core/heic.ts")
const { tooBig } = await import("./core/filetypes.ts")
const { contentType, enabled, HTTPError, LOADED, matchSocket, ROOT, Text, VAULT_PATH } = await import("./core/plugins.ts")
const { fetchFromICloud, slowReads } = await import("./core/vault.ts")
const vaults = await import("./core/vaults.ts")

const DIST = path.join(ROOT, "web", "dist") // built web app (npm run build)
const ASSETS = path.join(DIST, "assets") // Vite names every file here by its content's hash
const HOST = process.env.HOST || "127.0.0.1"
const PORT = Number(process.env.PORT || 8793)
const DESKTOP = process.env.VAULTITE_DESKTOP === "1"

// The server answers while it reads the vault, so the web app's files load meanwhile; what needs the vault waits for
// `ready`. A vault that can't be opened still ends the server.
const VAULT_AT = DESKTOP ? VAULT_PATH : vaults.current(VAULT_PATH)
await vaultThere(VAULT_AT)
let app: App, vault: Vault, live: LiveType
const ready = open(VAULT_AT).then((a) => {
  app = a
  vault = a.vault
  live = watch(new Live(vault).start())
  a.scheduler.start()
  for (const p of vault.problemList()) console.log(`vault: ${p.file}: ${p.problem}`)
  console.log(`vaultite: vault read, plugins: ${app.plugins.map((p) => p.id).join(", ")}`)
  module.flushCompileCache?.() // written now: a server usually ends by a signal, which doesn't write it
}, (e) => {
  console.error(e)
  process.exit(1)
})
onServerError((e) => app?.serverError(e)) // (one before the vault is read has nobody to hear it but the log)

/** A vault named that isn't there (a typo, a drive not connected) isn't made unasked: a terminal is asked; without one
 *  it's made only in a folder that's there. */
async function vaultThere(p: string) {
  if (!process.env.VAULTITE_VAULT || fs.existsSync(p)) return
  if (process.stdin.isTTY) {
    const rl = (await import("node:readline/promises")).createInterface({ input: process.stdin, output: process.stdout })
    const yes = /^y(es)?$/i.test((await rl.question(`There's no folder ${p}. Create a new vault there? [y/N] `)).trim())
    rl.close()
    if (yes) return
  } else if (fs.existsSync(path.dirname(p))) return
  else console.error(`vaultite: there's no folder ${p} or the folder it would go in (a drive that isn't connected?)`)
  process.exit(1)
}

/** Plugins that follow changes on disk (plugin.onChange) hear of each, after the vault read them. */
function watch(l: LiveType) {
  l.listen((c) => app.changed(c.paths))
  app.ui = l.drive // ops drive the user's window the way POST /api/ui does
  return l
}

/** Serve another vault (Manage vaults, on the web): read it, then every request and socket goes to it. Open apps are
 *  disconnected from the old one's events and reload everything when they reconnect. */
async function switchTo(p: string) {
  await vault.lock(async () => {
    await app.vaultPlugins.close() // the old vault's own plugins stop (their onUnload runs)
    app.scheduler.stop()
    let next
    try {
      next = await open(p) // (plugins are the same modules: they now see the new vault)
    } catch (e) {
      for (const plugin of app.app) plugin.vault = vault // still the old one
      LOADED.splice(0, LOADED.length, ...app.app)
      await app.syncPlugins(false)
      app.scheduler.start()
      throw e
    }
    live.close()
    for (const plugin of LOADED) plugin.forget()
    app = next
    vault = next.vault
    live = watch(new Live(vault).start())
    app.scheduler.start()
  })
  console.log(`vaultite: now serving ${p}`)
}

// The desktop app's main process: files from outside the vault this window may open.
process.on("message", (m: { type?: string; paths?: unknown }) => {
  if (m && m.type === "allow") allow(m.paths)
})
if (DESKTOP) process.on("disconnect", () => process.exit(0)) // the app is gone (even if it crashed): so is its server

/** Text worth compressing (images, fonts and media already are). */
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg)/
const brotli = (data: Buffer, quality: number) => zlib.brotliCompressSync(data, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })

/** The encoding to compress an answer in for this client, or null: only over the network (overNetwork), for text of
 *  1 KB or more, when the client takes it. */
function encodingFor(req: http.IncomingMessage | undefined, type: string, size: number) {
  if (!req || size < 1024 || !COMPRESSIBLE.test(type) || !overNetwork(req)) return null
  const accepts = String(req.headers["accept-encoding"] ?? "")
  return /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null
}

/** An answer. Over the network (the phone) a 200 GET gets an ETag (a reload is a 304) and text is brotli'd; the app on
 *  this Mac gets answers as they are, since bytes cost nothing there. */
function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, headers: Record<string, string> = {}) {
  const req = res.req as http.IncomingMessage | undefined
  let data = typeof body === "string" ? Buffer.from(body) : body
  const out: Record<string, string> = { "Content-Type": type, ...headers }
  if (req && req.method === "GET" && status === 200 && overNetwork(req) && (out["Cache-Control"] ?? "no-cache") === "no-cache") {
    out.ETag = `"${crypto.hash("sha1", data, "base64url")}"`
    out["Cache-Control"] = "no-cache"
    if (String(req.headers["if-none-match"] ?? "").split(/\s*,\s*/).includes(out.ETag)) {
      res.writeHead(304, { ETag: out.ETag, "Cache-Control": out["Cache-Control"] })
      return res.end()
    }
  }
  const enc = encodingFor(req, type, data.length)
  if (enc) {
    data = enc === "br" ? brotli(data, 1) : zlib.gzipSync(data, { level: 1 })
    out["Content-Encoding"] = enc
    out.Vary = "Accept-Encoding"
  }
  res.writeHead(status, { ...out, "Content-Length": String(data.length) })
  res.end(data)
}

const json = (res: http.ServerResponse, obj: unknown, status = 200) =>
  send(res, status, JSON.stringify(obj ?? null), "application/json")

/** Each API request's body once read (bodyOf), for plugins watching requests (plugin.onRequest). */
const bodies = new WeakMap<http.IncomingMessage, unknown>()

/** The request's body: JSON, {} when there's none, undefined when it isn't JSON. A file's bytes don't come as JSON:
 *  uploads stream (App.streams), so a body too big for one string is told where to send them. */
async function bodyOf(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  let raw: string
  try { raw = Buffer.concat(chunks).toString("utf8") } catch (e) {
    if (!tooBig(e)) throw e
    throw new HTTPError(413, "the request is too big for JSON: send a file's bytes as the body of POST /api/upload?path=, or of POST /api/ops/file.upload")
  }
  if (!raw) return {}
  try {
    const body = JSON.parse(raw)
    bodies.set(req, body)
    return body
  } catch {
    return undefined
  }
}

/** A request's start as plugins watching requests hear it (plugin.onRequest: core/plugins.ts). */
function started(req: http.IncomingMessage, url: URL) {
  const h = (k: string) => { const v = req.headers[k]; return typeof v === "string" && v ? v.slice(0, 200) : null }
  const query: Record<string, string> = {}
  for (const [k, v] of url.searchParams) if (!(k in query)) query[k] = v
  return app.requestStarted({ t: Date.now(), method: req.method ?? "GET", route: url.pathname.split("/").filter(Boolean).slice(1).map(decode).join("/"),
    query, client: h("x-vaultite-client"), agent: h("x-vaultite-agent"), command: h("x-vaultite-command"), ua: h("user-agent") ?? "",
    remote: req.socket.remoteAddress ?? "", port: req.socket.remotePort ?? 0, forwarded: !!(req.headers["x-forwarded-for"] || req.headers["tailscale-user-login"]) })
}

/** A vault file's bytes (range requests so players can seek; `as=jpeg` for HEIC; `download=1`), or an allowed outside
 *  file. Documents are sandboxed so an SVG or HTML can't run script; PDFs can't be (the browser's viewer). */
/** iCloud may leave a file (an image no sync reads) as a placeholder a read here can't materialize (errno 11, EDEADLK,
 *  under launchd): ask iCloud for it and wait a while for it to come down. False if it hasn't by then. */
async function downloaded(abs: string, wait = 30_000) {
  for (const start = Date.now(); ;) {
    try {
      const fh = await fs.promises.open(abs)
      try { await fh.read(Buffer.alloc(1), 0, 1, 0) } finally { await fh.close() }
      return true
    } catch (e) {
      if (Math.abs((e as NodeJS.ErrnoException).errno ?? 0) !== 11) return true // the stream below reports it
      if (Date.now() - start > wait) return false
      fetchFromICloud(abs, e)
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

async function raw(req: http.IncomingMessage, res: http.ServerResponse, query: Record<string, string>) {
  let rel: string, abs: string, st: fs.Stats
  try {
    if (isOutside(query.path)) abs = rel = allowedPath(query.path)
    else abs = vault.abs((rel = clean(query.path, true, vault)))
    st = fs.statSync(abs)
    if (!st.isFile()) throw new HTTPError(400, `'${rel}' is a folder`)
  } catch (e) {
    if (e instanceof HTTPError) return json(res, { error: e.message }, e.status)
    return json(res, { error: "not found" }, 404)
  }
  if (!(await downloaded(abs))) return json(res, { error: "iCloud hasn't brought this file down yet" }, 503)
  let type = contentType(rel)
  if (query.as === "jpeg" && isHeic(rel)) {
    const jpeg = await jpegOf(abs, st)
    if (!jpeg) return json(res, { error: "this machine can't convert HEIC photos" }, 415)
    abs = jpeg
    st = fs.statSync(jpeg)
    type = "image/jpeg"
  }
  const ext = path.extname(rel).toLowerCase()
  const headers: Record<string, string> = {
    "Content-Type": type, "Cache-Control": "no-cache", "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff", "Last-Modified": st.mtime.toUTCString(),
  }
  if (ext !== ".pdf") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
  headers["Content-Disposition"] = `${query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}`
  let start = 0, end = st.size - 1, status = 200
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""))
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end) }
    else start = Math.max(0, st.size - Number(range[2])) // the last n bytes
    if (start > end || start >= st.size) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` })
      return res.end()
    }
    status = 206
    headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`
  }
  headers["Content-Length"] = String(Math.max(0, end - start + 1))
  res.writeHead(status, headers)
  if (req.method === "HEAD" || st.size === 0) return res.end()
  fs.createReadStream(abs, { start, end }).on("error", () => res.destroy()).pipe(res)
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])

/** Asked from another machine, or through a proxy (Tailscale Serve connects from loopback too, but says so in its
 *  headers). */
function overNetwork(req: http.IncomingMessage) {
  const h = req.headers
  return !LOOPBACK.has(req.socket.remoteAddress ?? "") ||
    ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip"].some((k) => k in h) || Object.keys(h).some((k) => k.startsWith("tailscale-"))
}

// Other names this server is reached by (a reverse proxy's own domain), besides its addresses, localhost and its own names.
const EXTRA_HOSTS = (process.env.VAULTITE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)

/** Why a request isn't from this app's own pages, or "": another site's page (its Origin), or a page reaching this server
 *  under another site's name (DNS rebinding): the Host must be an address, localhost, or this machine's own name. */
async function foreign(req: http.IncomingMessage) {
  const h = req.headers
  const hosts = [h.host, h["x-forwarded-host"]].map((x) => String(x ?? "").toLowerCase())
  if (h.origin !== undefined) {
    let from = ""
    try { from = new URL(String(h.origin)).host.toLowerCase() } catch { /* "null": a sandboxed frame, a file */ }
    if (!from || !hosts.includes(from)) return "the page asking isn't this app"
  }
  for (const host of hosts.filter(Boolean)) {
    const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "")
    if (net.isIP(name) || name === "localhost" || name.endsWith(".localhost")) continue
    const me = os.hostname().toLowerCase().replace(/\.local$/, "")
    if (name === me || name === `${me}.local` || EXTRA_HOSTS.includes(name) || (await tailnetNames()).includes(name)) continue
    return `this app doesn't answer for ${name}`
  }
  return ""
}

/** Asked from this machine itself: a loopback address, not through a proxy, for a local host name, from this app's own
 *  page. */
function fromThisMachine(req: http.IncomingMessage) {
  const h = req.headers
  if (overNetwork(req)) return false
  const host = String(h.host ?? "").toLowerCase()
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "")
  if (!(name === "localhost" || LOOPBACK.has(name) || name === os.hostname().toLowerCase())) return false
  let from = ""
  try { from = new URL(String(h.origin ?? "")).host.toLowerCase() } catch { /* no Origin */ }
  return from === host
}

/** POST /api/file/open {path, reveal}: open a file in this machine's default app, or show it in its folder (Finder, or
 *  Linux's file manager). Only for the app running on this machine, never from another device. */
async function openHere(req: http.IncomingMessage, res: http.ServerResponse) {
  if (!fromThisMachine(req)) return json(res, { error: "files only open in their app from this machine" }, 403)
  if (process.platform !== "darwin" && process.platform !== "linux") return json(res, { error: "opening files in their app needs macOS or Linux" }, 501)
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    return json(res, { error: "this server has no desktop to open files on (no DISPLAY or WAYLAND_DISPLAY)" }, 501)
  const body = await bodyOf(req) as { path?: unknown; reveal?: unknown } | undefined
  let abs: string
  // Settings' "Open themes folder" / "Open snippets folder": made if it isn't there yet.
  if (body?.path === ".vaultite/themes" || body?.path === ".vaultite/snippets") fs.mkdirSync(vault.abs(body.path), { recursive: true })
  try {
    // (the settings files and appearance folders too: Settings opens them; a file from outside the vault the app opened)
    // (and a folder a plugin that's on reads live data from: plugin.folders)
    abs = isOutside(body?.path) ? liveFolder(body!.path as string) ?? allowedPath(body!.path as string) : vault.abs(clean(body?.path, true, vault, true))
  } catch (e) {
    return json(res, { error: (e as Error).message }, e instanceof HTTPError ? e.status : 400)
  }
  const done = (err: Error | null) => (err ? json(res, { error: String(err.message) }, 500) : json(res, { ok: true }))
  // reveal: show it in Finder (open -R).
  if (process.platform === "darwin") return void execFile("/usr/bin/open", body?.reveal ? ["-R", abs] : [abs], { timeout: 10000 }, done)
  openOnLinux(abs, !!body?.reveal).then(() => done(null), done)
}

function liveFolder(p: string) {
  const on = enabled(vault, app.plugins)
  return app.plugins.some((x) => on.has(x.id) && x.liveFolders().includes(p)) ? p : null
}

/** Linux: the file in its default app (gio, else xdg-open), or selected in the file manager (FileManager1 over D-Bus:
 *  Nautilus, Thunar, Dolphin, Nemo...), else its folder opened. */
async function openOnLinux(abs: string, reveal: boolean) {
  const run = (cmd: string, args: string[]) => new Promise<void>((ok, fail) =>
    execFile(cmd, args, { timeout: 10000 }, (err) => (err ? fail(err) : ok())))
  if (reveal) {
    try {
      return await run("dbus-send", ["--session", "--print-reply", "--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1.ShowItems", `array:string:${pathToFileURL(abs).href.replace(/,/g, "%2C")}`, "string:"])
    } catch { abs = path.dirname(abs) }
  }
  try { return await run("gio", ["open", abs]) } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e }
  // xdg-open may wait for the app it starts: it's left to run.
  const child = spawn("xdg-open", [abs], { detached: true, stdio: "ignore" })
  await new Promise<void>((ok, fail) => { child.once("error", fail); child.once("spawn", () => ok()) })
  child.unref()
}

/** GET /<prefix>/<rest>: an address a plugin serves (plugin.serve), or false. The web app's own files never wait for the
 *  vault; anything else waits until it's read, to know the plugins. */
async function served(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  if (req.method !== "GET" && req.method !== "HEAD") return false
  const raw = url.pathname.slice(1)
  const slash = raw.indexOf("/")
  if (slash < 1 || slash === raw.length - 1) return false
  const prefix = decode(raw.slice(0, slash))
  if (prefix === "api" || fs.existsSync(path.join(DIST, prefix))) return false
  await ready
  await app.syncPlugins()
  const query = Object.fromEntries(url.searchParams)
  const out = await app.serve(prefix, decode(raw.slice(slash + 1)), raw.slice(slash + 1) + url.search, query)
  if (!out) return false
  if (out.body instanceof Text) send(res, out.status, out.body.text, out.body.type, out.body.headers)
  else send(res, out.status, jsonOf(out.body), "application/json")
  return true
}

async function api(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  await ready
  const method = req.method ?? "GET"
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decode) // drop "api"
  const query = queryOf(url.searchParams)
  // /api/raw/<file name>?path=...: the name only makes the address end like the file (a PDF viewer's title).
  if (parts[0] === "raw" && (method === "GET" || method === "HEAD")) return raw(req, res, query)
  if (parts.join("/") === "file/open" && method === "POST") return openHere(req, res)
  // A route that reads its own body (an upload: plugin.route's `stream`) gets it unread.
  const body = app.streams(method, parts, String(req.headers["content-type"] ?? "")) ? {} : await bodyOf(req)
  if (body === undefined) return json(res, { error: "the body isn't JSON" }, 400)
  if (parts.join("/") === "ui") { const [out, status] = live.handle(method, body); return json(res, out, status) } // core/live.ts
  if (parts.join("/") === "events/stream" && method === "GET") return events.stream(events.eventsOf(vault), req, res, query) // core/events.ts
  if (parts[0] === "vaults" && !DESKTOP) {
    try {
      return json(res, await vaults.handle(method, parts, query, (body ?? {}) as Record<string, unknown>, vault.path, switchTo))
    } catch (e) {
      if (e instanceof HTTPError) return json(res, { error: e.message }, e.status)
      throw e
    }
  }
  // Writes hold the vault from the sync to their last write, so a file edited meanwhile is read first; reads don't, so a
  // slow live fetch never holds up the rest. Routes with `lock: false` sync like a read and hold it only to write.
  await app.syncPlugins()
  const out = method === "GET" || app.unlocked(method, parts)
    ? await vault.synced().then(() => app.run(method, parts, query, body, req))
    : await app.hold(() => app.run(method, parts, query, body, req))
  if (out.body instanceof Text) return send(res, out.status, out.body.text, out.body.type, out.body.headers)
  send(res, out.status, jsonOf(out.body), "application/json")
}

/** The web app's files compressed once per build: "<path>\0<encoding>" -> [mtime and size, bytes]. Emptied if many
 *  rebuilds under a running server made it big. */
const packed = new Map<string, [string, Promise<Buffer>]>()
let packedBytes = 0
const compress = { br: promisify(zlib.brotliCompress), gzip: promisify(zlib.gzip) }

function pack(p: string, st: fs.Stats, enc: "br" | "gzip") {
  const key = `${p}\0${enc}`, version = `${st.mtimeMs}:${st.size}`
  const hit = packed.get(key)
  if (hit && hit[0] === version) return hit[1]
  if (packedBytes > 64 << 20) { packed.clear(); packedBytes = 0 }
  const data = fs.readFileSync(p)
  const out = enc === "br"
    ? compress.br(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : compress.gzip(data, { level: 6 })
  out.then((b) => { packedBytes += b.length }, () => packed.delete(key))
  packed.set(key, [version, out])
  return out
}

/** The web app's build in web/dist: its entry script's name (named by content), read again when index.html changes. */
let built = { at: 0, name: null as string | null }
function webBuild() {
  try {
    const at = fs.statSync(path.join(DIST, "index.html")).mtimeMs
    if (at !== built.at) {
      const m = /<script type="module"[^>]*\ssrc="[^"]*\/([^"/]+\.js)"/.exec(fs.readFileSync(path.join(DIST, "index.html"), "utf8"))
      built = { at, name: m?.[1] ?? null }
    }
    return built.name
  } catch {
    return null
  }
}

/** The web app (web/dist). Its assets are named by content, so a browser keeps them for good; the rest (index.html,
 *  icons) is asked again each time (a 304 when unchanged). Over the network they're sent compressed. */
async function file(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  let p = path.normalize(path.join(DIST, decode(url.pathname)))
  if (!p.startsWith(DIST)) return send(res, 403, "Forbidden", "text/plain")
  let st: fs.Stats
  try {
    if (fs.statSync(p).isDirectory()) p = path.join(p, "index.html")
    st = fs.statSync(p)
  } catch {
    process.stderr.write(`"${req.method} ${url.pathname} HTTP/${req.httpVersion}" 404 -\n`) // (an app from an older build asking for its files)
    return send(res, 404, "File not found", "text/plain", { "Cache-Control": "no-cache" })
  }
  const type = contentType(p)
  const modified = st.mtime.toUTCString()
  const headers: Record<string, string> = p.startsWith(ASSETS + path.sep)
    ? { "Cache-Control": "public, max-age=31536000, immutable" }
    : { "Last-Modified": modified, "Cache-Control": "no-cache" }
  if (COMPRESSIBLE.test(type)) headers.Vary = "Accept-Encoding"
  const since = req.headers["if-modified-since"]
  if (since && Math.floor(st.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, headers)
    return res.end()
  }
  const enc = encodingFor(req, type, st.size)
  try {
    const data = enc ? await pack(p, st, enc) : fs.readFileSync(p)
    res.writeHead(200, { ...headers, "Content-Type": type, "Content-Length": String(data.length), ...(enc ? { "Content-Encoding": enc } : {}) })
    res.end(data)
  } catch {
    send(res, 404, "File not found", "text/plain", { "Cache-Control": "no-cache" })
  }
}

const server = http.createServer(async (req, res) => {
  // "//x" would parse as a host (and "//" throw): read the request line as a path only
  const url = new URL((req.url ?? "/").replace(/^\/+/, "/"), "http://localhost")
  try {
    // What the window shows while the vault is read: whether it's read, and the files iCloud is still downloading.
    if (url.pathname === "/api/loading") {
      const root = path.join(vault?.path ?? VAULT_AT, "/")
      return json(res, { ready: !!vault, downloading: slowReads().filter((p) => p.startsWith(root)).map((p) => p.slice(root.length)) })
    }
    if (url.pathname.startsWith("/api/")) {
      const why = await foreign(req)
      if (why) return json(res, { error: why }, 403)
      await ready // Activity's hook is the app's: it's there once the vault is read
      const t = performance.now(), end = started(req, url)
      try { await errorContext.run(`${req.method} ${url.pathname}`, () => api(req, res, url)) } finally { end({ status: res.statusCode, ms: performance.now() - t, body: bodies.get(req) }) }
      process.stderr.write(`"${req.method} ${req.url} HTTP/${req.httpVersion}" ${res.statusCode} -\n`)
    } else if (!(await served(req, res, url))) await file(req, res, url)
  } catch (e) {
    if (!(e instanceof HTTPError)) console.error(e)
    if (!res.headersSent) json(res, { error: String((e as Error).message ?? e) }, e instanceof HTTPError ? e.status : 500)
    else res.end()
  }
})

// Plugins' WebSockets (plugin.socket): /api/<pattern>, refused when nothing matches, the plugin is off, or its accept
// throws. 32 MB a message: a terminal's pasted file comes in pieces of 1 MB (base64'd), so this is room to spare.
const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 << 20 })

function refuse(socket: Duplex, status: number, message: string) {
  process.stderr.write(`WS refused: ${status} ${message}\n`)
  const reason = http.STATUS_CODES[status] ?? "Error"
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n` +
    `Connection: close\r\n\r\n${message}`)
}

server.on("upgrade", async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
  // Like a request: "//api/events" (a page opened at "//") would parse as a host
  const url = new URL((req.url ?? "/").replace(/^\/+/, "/"), "http://localhost")
  socket.on("error", () => socket.destroy())
  try {
    if (!url.pathname.startsWith("/api/")) return refuse(socket, 404, "not found")
    const why = await foreign(req)
    if (why) return refuse(socket, 403, why)
    await ready
    if (url.pathname === "/api/events") {
      return sockets.handleUpgrade(req, socket, head, (ws) => {
        ws.on("error", () => ws.terminate())
        live.client(ws)
      })
    }
    const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decode)
    await app.syncPlugins()
    // A socket is a request too: its accept and handler read the vault and settings as they are now (a terminal's
    // allowUsers just written), sharing a sync with reads arriving together.
    await vault.synced()
    const hit = matchSocket(app.plugins, parts)
    if (!hit) return refuse(socket, 404, "not found")
    const [plugin, sock, wild] = hit
    if (vault.switchedOff().has(plugin.id)) return refuse(socket, 404, `${plugin.manifest.name} is off`)
    const query = queryOf(url.searchParams)
    const params = { wild, query }
    await sock.accept?.(req, params)
    sockets.handleUpgrade(req, socket, head, (ws) => {
      // A bad frame (one over maxPayload) closes this socket, not the server: unheard, ws's error event throws.
      ws.on("error", (e) => { process.stderr.write(`WS ${url.pathname}: ${(e as Error).message}\n`); ws.terminate() })
      process.stderr.write(`"WS ${url.pathname} HTTP/${req.httpVersion}" 101 -\n`)
      // (a handler that throws, or whose promise fails, ends its socket, not the server)
      Promise.resolve().then(() => sock.fn(ws, req, params)).catch((e) => { console.error(`WS ${url.pathname}:`, e); try { ws.close(1011, "error") } catch { ws.terminate() } })
    })
  } catch (e) {
    if (e instanceof HTTPError) return refuse(socket, e.status, e.message)
    console.error(e)
    refuse(socket, 500, String((e as Error).message ?? e))
  }
})

server.listen(PORT, HOST, () => {
  console.log(`vaultite on http://${HOST}:${PORT}  vault=${VAULT_AT}`)
})
