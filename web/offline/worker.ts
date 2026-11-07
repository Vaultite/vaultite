// The offline app's server (web/offline/boot.ts): core/app.ts in a worker, as the web demo runs it, on the phone's copy of
// the vault, which the page loads from the container and writes back to. Edits outside .vaultite/ are kept.
import "../demo/node/prelude.ts"
import "../demo/mount.ts"
import fs, { changes } from "../demo/node/fs.ts"
import { jsonOf, open, type App } from "../../core/app.ts"
import { Live } from "../../core/live.ts"
import { contentType, HTTPError, matchSocket, Text } from "../../core/plugins.ts"
import { clean } from "../../core/files.ts"
import "virtual:demo-plugins"
import type { IncomingMessage } from "node:http"

const VAULT = "/Vault"
type Ask = { method: string; url: string; headers: Record<string, string>; body: ArrayBuffer | null }
type Answer = { status: number; headers: Record<string, string>; body: string | Uint8Array | null }
type Given = { files: { path: string; data: Uint8Array | null; mtime: number }[]; keep: boolean }

/** Files only stood in for (media left on the hub): never written back, and served by the page's previews. */
const standIns = new Set<string>()
let keep = false
const dirty = new Set<string>()
let flushing: ReturnType<typeof setTimeout> | null = null
/** What changed, to the page, which writes it into the container (only outside .vaultite/: the app's own state stays here). */
function flush() {
  flushing = null
  const out: { path: string; data: Uint8Array | null }[] = []
  for (const abs of dirty) {
    const rel = abs.slice(VAULT.length + 1)
    if (rel.startsWith(".vaultite/") || standIns.has(rel)) continue
    const st = fs.statSync(abs, { throwIfNoEntry: false })
    if (st?.isDirectory()) continue
    out.push({ path: rel, data: st ? fs.readFileSync(abs) as Uint8Array : null })
  }
  dirty.clear()
  if (out.length && keep) self.postMessage({ type: "wrote", files: out })
}

let app: App, live: Live
const given = new Promise<Given>((ok) => { self.addEventListener("message", (e: MessageEvent) => { if (e.data?.type === "files") ok(e.data as Given) }) })
const ready = given.then(async (g) => {
  keep = g.keep
  for (const f of g.files) {
    const abs = `${VAULT}/${f.path}`
    fs.mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true })
    fs.writeFileSync(abs, f.data ?? new Uint8Array())
    if (!f.data) standIns.add(f.path)
    if (f.mtime) fs.utimesSync(abs, f.mtime / 1000, f.mtime / 1000)
  }
  fs.mkdirSync(VAULT, { recursive: true })
  changes.add((abs) => {
    if (!abs.startsWith(VAULT + "/")) return
    standIns.delete(abs.slice(VAULT.length + 1)) // (written by the app now: a file of its own)
    dirty.add(abs)
    flushing ??= setTimeout(flush, 300)
  })
  app = await open(VAULT)
  live = new Live(app.vault).start()
  live.listen((c) => app.changed(c.paths))
  app.ui = live.drive
})

const json = (body: unknown, status = 200): Answer => ({ status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const OFFLINE = "This needs the hub: it's offline now"
/** Who asks: the phone's owner, on this phone. */
const owner = (url: string, headers: Record<string, string>) =>
  ({ method: "GET", url, headers: { ...headers, host: "localhost" }, socket: { remoteAddress: "127.0.0.1", remotePort: 0 } }) as unknown as IncomingMessage

async function handle(ask: Ask): Promise<Answer> {
  await ready
  const url = new URL(ask.url, "http://localhost/")
  const query: Record<string, string> = {}
  for (const [k, v] of url.searchParams) if (v !== "" && !(k in query)) query[k] = v
  const [first, ...rest] = url.pathname.slice(1).split("/")
  if (first !== "api") {
    const out = await app.serve(decodeURIComponent(first), decodeURIComponent(rest.join("/")), rest.join("/") + url.search, query)
    return out ? reply(out) : { status: 404, headers: {}, body: null }
  }
  const parts = rest.filter(Boolean).map(decodeURIComponent), route = parts.join("/"), method = ask.method
  if (route === "loading") return json({ ready: true, downloading: [] })
  if (parts[0] === "raw") return raw(query)
  if (route === "file/open" || parts[0] === "vaults" || parts[0] === "sync") return json({ error: OFFLINE }, 503)
  if (route === "ui") { let b: unknown = {}; try { b = JSON.parse(new TextDecoder().decode(ask.body ?? new ArrayBuffer(0)) || "{}") } catch { /* none */ } const [out, status] = live.handle(method, b as Record<string, unknown>); return json(out, status) }
  let body: unknown = {}
  if (method === "POST" && route === "upload") body = { bytes: Buffer.from(ask.body ?? new ArrayBuffer(0)) }
  else if (ask.body && ask.body.byteLength) { try { body = JSON.parse(new TextDecoder().decode(ask.body)) } catch { return json({ error: "the body isn't JSON" }, 400) } }
  await app.syncPlugins()
  return reply(await app.run(method, parts, query, body, owner(url.pathname + url.search, ask.headers)))
}

function reply(out: { status: number; body: unknown }): Answer {
  if (out.body instanceof Text) return { status: out.status, headers: { "Content-Type": out.body.type, ...out.body.headers }, body: out.body.text as string }
  const data = jsonOf(out.body)
  return { status: out.status, headers: { "Content-Type": "application/json" }, body: typeof data === "string" ? data : new Uint8Array(data) }
}

/** GET /api/raw?path=: a file the app wrote here (the shell serves those already on the phone itself). */
function raw(query: Record<string, string>): Answer {
  try {
    const rel = clean(query.path, true, app.vault)
    if (standIns.has(rel)) return json({ error: "online only" }, 404)
    const data = fs.readFileSync(app.vault.abs(rel)) as Uint8Array
    return { status: 200, body: data, headers: { "Content-Type": contentType(rel), "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } }
  } catch (e) {
    return e instanceof HTTPError ? json({ error: e.message }, e.status) : json({ error: "not found" }, 404)
  }
}

// One request at a time: the server's contexts (node/async_hooks.ts) last until their request is answered.
let queue = Promise.resolve()
function answer(ask: Ask, port: MessagePort) {
  queue = queue.then(() => handle(ask)).catch((e) => json({ error: String((e as Error)?.message ?? e) }, 500)).then((a) => {
    if (flushing) { clearTimeout(flushing); flush() } // (what it changed goes to the page before the answer: it may close at once)
    const body = a.body instanceof Uint8Array ? a.body.slice().buffer : a.body
    port.postMessage({ ...a, body }, body instanceof ArrayBuffer ? [body] : [])
  })
}

/** A socket: /api/events (core/live.ts's client) or a plugin's, as a `ws` socket over a port. */
async function socket(port: MessagePort, at: string) {
  await ready
  const on: Record<string, ((data?: unknown) => void)[]> = {}
  const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0,
    send: (text: string) => { if (ws.readyState === 1) port.postMessage(text) }, on: (event: string, fn: (data?: unknown) => void) => { (on[event] ??= []).push(fn); return ws },
    close: () => { if (ws.readyState === 3) return; ws.readyState = 3; port.postMessage(null); for (const fn of on.close ?? []) fn() }, terminate: () => ws.close(), ping() {} }
  port.onmessage = (e) => { if (e.data === null) ws.close(); else for (const fn of on.message ?? []) fn(e.data) }
  const url = new URL(at, "http://localhost/")
  if (url.pathname === "/api/events") return live.client(ws as never)
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent)
  const hit = matchSocket(app.plugins, parts)
  if (!hit || app.vault.switchedOff().has(hit[0].id)) return ws.close()
  const query: Record<string, string> = {}
  for (const [k, v] of url.searchParams) if (v !== "" && !(k in query)) query[k] = v
  try {
    await hit[1].accept?.(owner(at, {}), { wild: hit[2], query })
    await hit[1].fn(ws as never, owner(at, {}), { wild: hit[2], query })
  } catch { ws.close() }
}

self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: string; ask?: Ask; url?: string }
  if (m.type === "fetch") answer(m.ask!, e.ports[0])
  else if (m.type === "socket") void socket(e.ports[0], m.url ?? "/api/events")
}
ready.then(() => self.postMessage({ type: "ready" }), (e) => self.postMessage({ type: "failed", error: String(e?.stack ?? e) }))
