import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"
import type { Item } from "../../../core/vault.ts"
import { HTTPError, type Plugin } from "../../../core/plugins.ts"

export type DialEntry = { id: string; label: string; url: string; via?: string }
type Hello = { host: string; platform: string; home: string; os: string; v: string }
type Pending = { id: string; label: string; hash: string; hello: Hello; until: number }
type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
type Connected = { ws: WebSocket; hello?: Hello; waiting: Map<number, Waiter>; alive: boolean }
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/
const HASH = /^[A-Za-z0-9_-]{43}$/
const digest = (s: string) => crypto.createHash("sha256").update(s).digest("base64url")
const clean = (v: unknown, max = 200) => String(v ?? "").slice(0, max)
const helloOf = (v: Item): Hello => ({ host: clean(v.host), platform: clean(v.platform, 30), home: clean(v.home, 2000), os: clean(v.os), v: clean(v.v, 10) })

export function dialIn(plugin: Plugin, entries: () => DialEntry[], selfId: () => Promise<string | null>) {
  const pending = new Map<string, Pending>()
  const connected = new Map<string, Connected>()
  const server = new WebSocketServer({ noServer: true, maxPayload: 12 << 20, perMessageDeflate: false })
  let seq = 0, attempts = 0, minute = Date.now()
  const stored = () => (plugin.secrets().machines ?? {}) as Item
  const hashes = () => (stored().keys ?? {}) as Record<string, string>
  const expire = () => { for (const [code, p] of pending) if (p.until < Date.now()) pending.delete(code) }
  const changed = () => plugin.forget()
  const forget = (id: string, c: Connected) => {
    if (connected.get(id) === c) connected.delete(id)
    for (const w of c.waiting.values()) { clearTimeout(w.timer); w.reject(new HTTPError(502, "The machine disconnected")) }
    c.waiting.clear(); changed()
  }
  const summary = (id: string) => {
    const c = connected.get(id), h = c?.hello
    return { online: !!h && c?.ws.readyState === WebSocket.OPEN, self: false, dial: true, readOnly: true, host: h?.host, platform: h?.platform,
      home: h?.home, plugins: [], error: h ? undefined : "not connected" }
  }
  const request = (id: string, op: string, args: Item): Promise<unknown> => {
    const c = connected.get(id)
    if (!c?.hello || c.ws.readyState !== WebSocket.OPEN) throw new HTTPError(502, "The machine is offline. Start its file agent to reconnect.")
    if (c.waiting.size >= 16) throw new HTTPError(429, "Too many file reads at once")
    return new Promise((resolve, reject) => {
      const rid = ++seq
      const timer = setTimeout(() => { c.waiting.delete(rid); reject(new HTTPError(504, "The machine didn't answer the file request")) }, 15000)
      c.waiting.set(rid, { resolve, reject, timer })
      c.ws.send(JSON.stringify({ t: "req", id: rid, op, args }), (e) => {
        if (e) { clearTimeout(timer); c.waiting.delete(rid); reject(new HTTPError(502, "The connection ended")) }
      })
    })
  }
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname
    if (!p.startsWith("/machines/dial/")) return false
    const id = p.slice(15), expected = hashes()[id]
    const key = String(req.headers.authorization ?? "").replace(/^Bearer /, "")
    const refuse = (status: number) => socket.end(`HTTP/1.1 ${status} Refused\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
    if ([...pending.values()].some((p) => p.id === id && p.until > Date.now() && p.hash === digest(key))) { refuse(409); return true }
    if (plugin.isOff() || !ID.test(id) || !entries().some((e) => e.id === id && e.via)) { refuse(404); return true }
    const actual = digest(key)
    if (!expected || key.length > 200 || actual.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) { refuse(401); return true }
    server.handleUpgrade(req, socket, head, (ws) => {
      connected.get(id)?.ws.terminate()
      const c: Connected = { ws, waiting: new Map(), alive: true }
      connected.set(id, c)
      const helloTimer = setTimeout(() => { if (!c.hello) ws.terminate() }, 5000)
      ws.on("pong", () => { c.alive = true })
      ws.on("error", () => ws.terminate())
      ws.on("close", () => { clearTimeout(helloTimer); forget(id, c) })
      ws.on("message", (data, binary) => {
        try {
          if (binary) throw new Error("text only")
          const m = JSON.parse(data.toString()) as Item
          if (m.t === "hello" && !c.hello && m.v === "1") { c.hello = helloOf(m); clearTimeout(helloTimer); changed(); return }
          if (m.t !== "res" || !c.hello) throw new Error("unexpected message")
          const w = c.waiting.get(m.id)
          if (!w) return
          c.waiting.delete(m.id); clearTimeout(w.timer)
          if (m.ok === true && m.data && typeof m.data === "object") w.resolve(m.data)
          else w.reject(new HTTPError(400, clean(m.error || "Couldn't read the file", 500)))
        } catch { ws.close(1008, "Invalid file-agent message") }
      })
    })
    return true
  }
  const publicRequest = async (req: IncomingMessage, res: ServerResponse, base: string) => {
    const p = new URL(req.url ?? "/", "http://localhost").pathname
    if (p === "/machines/agent.py" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/x-python; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
      res.end(fs.readFileSync(new URL("./dial.py", import.meta.url))); return true
    }
    if (p !== "/machines/enroll" || req.method !== "POST") return false
    const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); return true }
    expire()
    if (Date.now() - minute > 60000) { minute = Date.now(); attempts = 0 }
    if (++attempts > 30 || pending.size >= 30) return json(429, { error: "Try enrollment again in a minute" })
    let body = "", size = 0
    for await (const part of req) { size += part.length; if (size <= 8192) body += part.toString() }
    if (size > 8192) return json(413, { error: "Enrollment is at most 8 KB" })
    let b: Item
    try { b = JSON.parse(body) } catch { return json(400, { error: "Expected JSON" }) }
    if (!b || !ID.test(String(b.id)) || !HASH.test(String(b.hash))) return json(400, { error: "Expected a machine id and SHA-256 key hash" })
    if (entries().some((e) => e.id === b.id && !e.via)) return json(409, { error: "That id belongs to a Vaultite server" })
    let code: string
    do { code = String(crypto.randomInt(10000000, 100000000)) } while (pending.has(code))
    for (const [c, old] of pending) if (old.id === b.id) pending.delete(c)
    pending.set(code, { id: b.id, label: clean(b.label || b.id, 80), hash: b.hash, hello: helloOf(b.hello ?? {}), until: Date.now() + 600000 })
    return json(200, { code, url: `${base.replace(/\/+$/, "")}/machines/dial/${b.id}`, expires: 600 })
  }
  const approve = async (code: string, label?: string) => {
    expire()
    const p = pending.get(code)
    if (!p) throw new HTTPError(404, "No machine waits with that code (codes last ten minutes)")
    const via = await selfId()
    if (!via) throw new HTTPError(409, "List this Vaultite server in Machines before enrolling a file agent")
    const all = plugin.readSettings() ?? {}, list = Array.isArray(all.machines) ? all.machines as Item[] : []
    if (list.some((e) => e.id === p.id && !e.via)) throw new HTTPError(409, "That id belongs to a Vaultite server")
    const keyState = stored()
    plugin.saveSecrets({ ...keyState, keys: { ...hashes(), [p.id]: p.hash } })
    plugin.saveSettings({ ...all, machines: [...list.filter((e) => e.id !== p.id), { id: p.id, label: label?.trim() || p.label, via }] })
    pending.delete(code); connected.get(p.id)?.ws.terminate(); changed()
    return { id: p.id, label: label?.trim() || p.label, via }
  }
  const revoke = (id: string) => {
    const keys = { ...hashes() }; delete keys[id]
    plugin.saveSecrets({ ...stored(), keys })
    connected.get(id)?.ws.terminate(); changed()
    return { id, revoked: true }
  }
  plugin.provide("machines:public", publicRequest)
  plugin.provide("machines:upgrade", upgrade)
  const beat = setInterval(() => {
    for (const [id, c] of connected) {
      if (!hashes()[id] || !entries().some((e) => e.id === id && e.via) || !c.alive) { c.ws.terminate(); continue }
      c.alive = false; c.ws.ping()
    }
  }, 30000)
  beat.unref()
  plugin.onUnload(() => { clearInterval(beat); for (const c of connected.values()) c.ws.terminate(); server.close() })
  return { summary, request, approve, revoke, pending: () => { expire(); return [...pending].map(([code, p]) => ({ code, id: p.id, label: p.label, hello: p.hello, expires: p.until })) } }
}
