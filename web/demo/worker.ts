// The demo's server: core/app.ts as server.ts runs it, in a worker, on the sandbox vault in memory (node/fs.ts), kept in
// IndexedDB. The page hands it the requests its service worker caught (sw.ts) and the live socket (boot.ts).
import "./node/prelude.ts"
import "./mount.ts"
import fs, { changes } from "./node/fs.ts"
import { NEEDS_APP } from "./node/stub.ts"
import { MACHINE } from "./machine.ts"
import { jsonOf, open, type App } from "../../core/app.ts"
import { Live } from "../../core/live.ts"
import { contentType, HTTPError, Text } from "../../core/plugins.ts"
import { clean } from "../../core/files.ts"
import * as vaults from "../../core/vaults.ts"
import { localToday, makeSandbox, MARKER, sampleStamp } from "../../core/sandbox.ts"
import "virtual:demo-plugins" // (the plugins' backends, once the core they import is loaded)
import type { IncomingMessage } from "node:http"

const VAULT = "/Sandbox"

// ---------- the vault, kept in IndexedDB ----------
const db = new Promise<IDBDatabase>((ok, no) => {
  const r = indexedDB.open("vaultite-demo", 1)
  r.onupgradeneeded = () => { r.result.createObjectStore("files"); r.result.createObjectStore("meta") }
  r.onsuccess = () => ok(r.result)
  r.onerror = () => no(r.error)
})
async function tx<T>(stores: string[], fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  const t = (await db).transaction(stores, "readwrite")
  const r = fn(t)
  return new Promise((ok, no) => { t.oncomplete = () => ok(r ? r.result : undefined); t.onerror = () => no(t.error) })
}

type Meta = { day: string; sample: string; edited: boolean }
let meta: Meta | undefined
/** Files changed since the last save (absolute paths), saved a moment later. */
const dirty = new Set<string>()
let saving: ReturnType<typeof setTimeout> | null = null
let resetting = false

function save() {
  saving = null
  if (resetting) return
  const paths = [...dirty]
  dirty.clear()
  const puts = new Map<string, Uint8Array | null>(), dels: string[] = []
  const add = (abs: string) => {
    const rel = abs.slice(VAULT.length + 1)
    const st = fs.statSync(abs, { throwIfNoEntry: false })
    if (!st) return void dels.push(rel)
    if (!st.isDirectory()) return void puts.set(rel, fs.readFileSync(abs) as Uint8Array)
    puts.set(rel, null)
    for (const name of fs.readdirSync(abs) as string[]) add(`${abs}/${name}`)
  }
  for (const p of paths) add(p)
  void tx(["files", "meta"], (t) => {
    const files = t.objectStore("files")
    // (a folder gone takes what was in it)
    for (const rel of dels) { files.delete(rel); files.delete(IDBKeyRange.bound(rel + "/", rel + "/\uffff")) }
    for (const [rel, data] of puts) files.put(data, rel)
    t.objectStore("meta").put(meta, "vault")
  })
}

/** The vault as this browser left it, or the sandbox made new: on a first visit, after a reset, when the sample
 *  changed, or a day later if nothing was edited (its dates follow today). */
async function restore() {
  const today = localToday(), sample = sampleStamp()
  const was = await tx<Meta>(["meta"], (t) => t.objectStore("meta").get("vault"))
  if (was && was.sample === sample && (was.edited || was.day === today)) {
    const [keys, values] = await Promise.all([tx<IDBValidKey[]>(["files"], (t) => t.objectStore("files").getAllKeys()),
      tx<(Uint8Array | null)[]>(["files"], (t) => t.objectStore("files").getAll())])
    keys!.forEach((k, i) => { const p = `${VAULT}/${k}`; if (values![i]) { fs.mkdirSync(p.replace(/\/[^/]+$/, ""), { recursive: true }); fs.writeFileSync(p, values![i]) } else fs.mkdirSync(p, { recursive: true }) })
    meta = was
  } else {
    makeSandbox(VAULT, today)
    fs.rmSync(`${VAULT}/${MARKER}`) // (the app's "changes here are lost" notice: here they're kept until Reset)
    // What needs a machine starts off (machine.ts).
    const file = `${VAULT}/.vaultite/plugins.json`, cfg = JSON.parse(fs.readFileSync(file, "utf8") as string)
    cfg.disabled = [...new Set([...cfg.disabled, ...MACHINE])]
    cfg.enabled = cfg.enabled.filter((id: string) => !MACHINE.includes(id))
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n")
    await tx(["files"], (t) => t.objectStore("files").clear())
    meta = { day: today, sample, edited: false }
    dirty.add(VAULT)
    save()
  }
  changes.add((abs) => {
    if (!abs.startsWith(VAULT + "/")) return
    // (edited: a file of the visitor's, not the app's settings nor the pages it installs as it opens)
    if (app && !abs.startsWith(`${VAULT}/.vaultite/`)) meta = { ...meta!, edited: true }
    dirty.add(abs)
    saving ??= setTimeout(save, 300)
  })
}

// ---------- requests ----------
type Ask = { method: string; url: string; headers: Record<string, string>; body: ArrayBuffer | null }
type Answer = { status: number; headers: Record<string, string>; body: string | Uint8Array | null }

let app: App, live: Live
const ready = restore().then(() => open(VAULT)).then((a) => {
  app = a
  live = new Live(a.vault).start()
  live.listen((c) => app.changed(c.paths))
  app.ui = live.drive
})

const json = (body: unknown, status = 200): Answer => ({ status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

/** A plugin that needs a machine can't be turned on here. */
function refused(method: string, route: string, body: unknown) {
  if (route !== "config/plugins" || (method !== "PUT" && method !== "PATCH") || !body || typeof body !== "object") return ""
  const b = body as { disabled?: unknown; enabled?: unknown }
  // (an offByDefault one is on when in `enabled`, another when out of `disabled`)
  const on = MACHINE.find((id) => app.vault.optIn.has(id) ? Array.isArray(b.enabled) && b.enabled.includes(id) : Array.isArray(b.disabled) && !b.disabled.includes(id))
  const name = on && app.plugins.find((p) => p.id === on)?.manifest.name
  return on ? `${name ?? on} needs the Vaultite app: download it to use it` : ""
}

async function handle(ask: Ask): Promise<Answer> {
  await ready
  const url = new URL(ask.url, "http://demo/")
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
  if (route === "file/open") return json({ error: NEEDS_APP }, 501)
  let body: unknown = {}
  if (ask.body && ask.body.byteLength) { try { body = JSON.parse(new TextDecoder().decode(ask.body)) } catch { return json({ error: "the body isn't JSON" }, 400) } }
  if (parts[0] === "vaults") return vaults.handle(method, parts, query, body as Record<string, unknown>, VAULT, () => { throw new HTTPError(501, NEEDS_APP) })
    .then((out) => json(out), (e) => json({ error: e.message }, e instanceof HTTPError ? e.status : 500))
  if (route === "ui") { const [out, status] = live.handle(method, body as Record<string, unknown>); return json(out, status) }
  const why = refused(method, route, body)
  if (why) return json({ error: why }, 403)
  // (who asks: a page on the network, so never the owner: what's the owner's only isn't offered)
  const req = { method, url: url.pathname + url.search, headers: { ...ask.headers, host: "demo" }, socket: { remoteAddress: "192.0.2.1", remotePort: 0 } } as unknown as IncomingMessage
  await app.syncPlugins()
  const out = method === "GET" || app.unlocked(method, parts)
    ? await app.vault.synced().then(() => app.run(method, parts, query, body, req))
    : await app.hold(() => app.run(method, parts, query, body, req))
  return reply(out)
}

function reply(out: { status: number; body: unknown }): Answer {
  if (out.body instanceof Text) return { status: out.status, headers: { "Content-Type": out.body.type, ...out.body.headers }, body: out.body.text as string }
  const data = jsonOf(out.body)
  return { status: out.status, headers: { "Content-Type": "application/json" }, body: typeof data === "string" ? data : new Uint8Array(data) }
}

/** GET /api/raw?path=: a vault file's bytes (server.ts's raw, without ranges). */
function raw(query: Record<string, string>): Answer {
  try {
    const rel = clean(query.path, true, app.vault), data = fs.readFileSync(app.vault.abs(rel)) as Uint8Array
    const name = encodeURIComponent(rel.split("/").pop()!)
    return { status: 200, body: data, headers: { "Content-Type": contentType(rel), "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${query.download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
      ...(rel.toLowerCase().endsWith(".pdf") ? {} : { "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'" }) } }
  } catch (e) {
    return e instanceof HTTPError ? json({ error: e.message }, e.status) : json({ error: "not found" }, 404)
  }
}

// One request at a time: the server's contexts (node/async_hooks.ts) last until their request is answered.
let queue = Promise.resolve()
function answer(ask: Ask, port: MessagePort) {
  queue = queue.then(() => handle(ask)).catch((e) => json({ error: String((e as Error)?.message ?? e) }, 500)).then((a) => {
    const body = a.body instanceof Uint8Array ? a.body.slice().buffer : a.body
    port.postMessage({ ...a, body }, body instanceof ArrayBuffer ? [body] : [])
  })
}

/** /api/events: core/live.ts's client, as a `ws` socket over a port. */
async function socket(port: MessagePort) {
  await ready
  const on: Record<string, ((data?: unknown) => void)[]> = {}
  const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0,
    send: (text: string) => port.postMessage(text), on: (event: string, fn: (data?: unknown) => void) => { (on[event] ??= []).push(fn); return ws },
    close: () => { ws.readyState = 3; port.postMessage(null); for (const fn of on.close ?? []) fn() }, terminate: () => ws.close(), ping() {} }
  port.onmessage = (e) => { if (e.data === null) ws.close(); else for (const fn of on.message ?? []) fn(e.data) }
  live.client(ws as never)
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: string; ask?: Ask }
  if (m.type === "fetch") answer(m.ask!, e.ports[0])
  else if (m.type === "socket") void socket(e.ports[0])
  else if (m.type === "reset") {
    resetting = true
    await tx(["files", "meta"], (t) => { t.objectStore("files").clear(); t.objectStore("meta").clear() })
    e.ports[0].postMessage(true)
  }
}
ready.then(() => self.postMessage({ type: "ready" }), (e) => self.postMessage({ type: "failed", error: String(e?.stack ?? e) }))
