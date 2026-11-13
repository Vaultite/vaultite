import { execFile } from "node:child_process"
import http from "node:http"
import os from "node:os"
import WebSocket from "ws"
import { z } from "zod"
import type { Plugin } from "../../../core/plugins.ts"
import { RELAY_HEADER, RELAYED, RELAYED_GUEST } from "./public.ts"

const RELAY = (process.env.VAULTITE_CLOUD || "https://cloud.vaultite.com").replace(/\/+$/, "")

const STORED = z.object({ token: z.string(), handle: z.string(), url: z.string() })
type Stored = z.infer<typeof STORED>
type Frame = { t: string; id?: string; method?: string; path?: string; headers?: [string, string][]; body?: string; key?: string
  text?: string; data?: string; code?: number; reason?: string; guest?: boolean; handle?: string; url?: string }

type CloudState = "off" | "connecting" | "connected" | "reconnecting" | "offline" | "replaced"
export type CloudStatus = {
  state: CloudState
  handle: string | null
  url: string | null
  app: string | null
  guests: string | null
  connectUrl: string
  message?: string
}

/** HTTP's hop-by-hop headers: one connection's, not the request's. */
const ANSWER = z.record(z.string(), z.unknown()).catch({})

export class CloudError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "content-length", "forwarded"])
/** Headers only this machine's own proxies set (Tailscale Serve, the app): never from the internet. */
const OURS = /^(tailscale-|x-vaultite-(?!cloud$))/
/** A WebSocket's handshake headers, the ws package's own. */
const WS_OWN = /^sec-websocket-(key|version|extensions|accept)$/
const OFFLINE_AFTER = 30_000, MAX_BACKOFF = 60_000, SILENT = 75_000, HEARTBEAT = 30_000

function deviceName(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve(os.hostname())
    execFile("scutil", ["--get", "ComputerName"], { timeout: 3000 }, (err, out) => resolve((!err && out.trim()) || os.hostname().replace(/\.local$/, "")))
  })
}

/** A close code a WebSocket's side may send (1000, 3000-4999), else 1000. */
const closeCode = (c: unknown) => (typeof c === "number" && (c === 1000 || (c >= 3000 && c <= 4999)) ? c : 1000)

export class Cloud {
  plugin: Plugin
  relay: string
  target: () => Promise<number>
  state: CloudState = "off"
  message = ""
  ws: WebSocket | null = null
  timer: ReturnType<typeof setTimeout> | null = null
  beat: ReturnType<typeof setInterval> | null = null
  attempt = 0
  down = 0
  seen = 0
  inflight = new Map<string, http.ClientRequest>()
  sockets = new Map<string, WebSocket>()
  connectKey: string | null = null
  replacedBy = ""
  onChange: (s: CloudStatus) => void = () => {}

  constructor(plugin: Plugin, target: () => Promise<number>, relay = RELAY) {
    this.plugin = plugin
    this.target = target
    this.relay = relay
  }

  stored(): Stored | null {
    const c = STORED.safeParse(this.plugin.secrets().mcp?.cloud).data
    return c?.token ? c : null
  }

  save(c: Stored | null) {
    const all = structuredClone(this.plugin.secrets().mcp ?? {})
    if (c) all.cloud = c; else delete all.cloud
    this.plugin.saveSecrets(all)
  }

  status(): CloudStatus {
    const s = this.stored()
    return {
      state: this.state, handle: s?.handle ?? null, url: s ? `${s.url.replace(/\/+$/, "")}/mcp` : null, connectUrl: `${this.relay}/connect`,
      app: s && this.connectKey ? s.url.replace(/\/+$/, "") : null, guests: this.guestUrl(),
      ...(this.message ? { message: this.message } : {}),
    }
  }

  guestUrl(): string | null {
    const s = this.stored()
    if (!s || this.state === "replaced") return null
    try { const u = new URL(s.url); return `${u.protocol}//share-${u.host}` } catch { return null }
  }

  set(state: CloudState, message = "") {
    const changed = state !== this.state || message !== this.message
    this.state = state
    this.message = message
    if (changed) this.onChange(this.status())
  }

  moved(f: Frame) {
    const s = this.stored()
    if (!s || typeof f.handle !== "string" || typeof f.url !== "string" || !/^[a-z0-9-]{3,30}$/.test(f.handle)) return
    let u: URL, zone: string
    try { u = new URL(f.url); zone = new URL(s.url).hostname.slice(s.handle.length + 1) } catch { return }
    if (u.protocol !== "https:" || u.hostname !== `${f.handle}.${zone}` || (f.handle === s.handle && f.url === s.url)) return
    this.save({ ...s, handle: f.handle, url: f.url })
    this.onChange(this.status())
  }

  start() {
    if (this.stored()) this.connect()
  }

  stop() {
    this.close()
  }

  async post(route: string, body: unknown, token?: string) {
    const r = await fetch(`${this.relay}${route}`, {
      method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    const d = ANSWER.parse(await r.json().catch(() => ({})))
    if (r.status === 429) throw new CloudError("Too many tries: wait a minute", 429)
    if (!r.ok) throw new CloudError(String(d.error ?? d.message ?? `Vaultite Cloud answered ${r.status}`), r.status)
    return d
  }

  async signIn(code = ""): Promise<CloudStatus> {
    const old = this.stored()
    if (!code.trim()) {
      if (old && (this.state === "replaced" || !this.ws)) { this.attempt = 0; this.connect() }
      return this.status()
    }
    const d = await this.post("/api/device/redeem", { code: code.trim(), name: await deviceName() })
    if (typeof d.token !== "string" || typeof d.handle !== "string" || typeof d.url !== "string") throw new Error("Vaultite Cloud's answer has no token")
    this.close()
    this.connectKey = null
    this.save({ token: d.token, handle: d.handle, url: d.url })
    if (old && old.token !== d.token) void this.post("/api/device/revoke", {}, old.token).catch(() => {})
    this.attempt = 0
    this.connect()
    return this.status()
  }

  async signOut(): Promise<CloudStatus> {
    this.replacedBy = ""
    const s = this.stored()
    this.close()
    this.connectKey = null
    this.save(null)
    let message = ""
    if (s) await this.post("/api/device/revoke", {}, s.token).catch(() => { message = "Signed out on this machine; Vaultite Cloud couldn't be reached to end the sign-in there" })
    this.set("off", message)
    return this.status()
  }

  revoked() {
    const why = this.replacedBy ? `${this.replacedBy}, which signed this machine out` : "Signed out: this machine's sign-in was ended on Vaultite Cloud"
    this.replacedBy = ""
    this.close()
    this.connectKey = null
    this.save(null)
    this.set("off", `${why}. Sign in again with a new code to use this machine.`)
  }

  close() {
    if (this.timer) clearTimeout(this.timer)
    if (this.beat) clearInterval(this.beat)
    this.timer = this.beat = null
    const ws = this.ws
    this.ws = null
    ws?.terminate()
    for (const r of this.inflight.values()) r.destroy()
    this.inflight.clear()
    this.endSockets()
  }

  endSockets() {
    for (const s of this.sockets.values()) s.terminate()
    this.sockets.clear()
  }

  connect() {
    const s = this.stored()
    if (!s) return
    this.close()
    if (!this.attempt) this.set("connecting")
    const ws = new WebSocket(`${this.relay.replace(/^http/, "ws")}/api/tunnel`, { headers: { Authorization: `Bearer ${s.token}` }, handshakeTimeout: 15_000 })
    this.ws = ws
    ws.on("open", () => {
      if (this.ws !== ws) return
      this.attempt = 0
      this.down = 0
      this.seen = Date.now()
      this.replacedBy = ""
      this.set("connected")
      ws.send(JSON.stringify({ t: "hello", features: ["app", "share"] }))
      this.beat = setInterval(() => {
        if (Date.now() - this.seen > SILENT) ws.terminate()
        else ws.ping()
      }, HEARTBEAT)
    })
    ws.on("unexpected-response", (req, res) => {
      req.destroy()
      if (this.ws !== ws) return
      this.ws = null
      if (res.statusCode === 401 || res.statusCode === 403) this.revoked()
      else this.retry(`Vaultite Cloud answered ${res.statusCode}`)
    })
    ws.on("pong", () => { this.seen = Date.now() })
    ws.on("message", (data) => {
      if (this.ws !== ws) return
      this.seen = Date.now()
      let f: Frame
      try { f = JSON.parse(String(data)) } catch { return }
      if (f.t === "ping") ws.send(JSON.stringify({ t: "pong" }))
      else if (f.t === "handle") this.moved(f)
      else if (f.t === "connect" && typeof f.key === "string" && f.key) { const was = this.connectKey; this.connectKey = f.key; if (!was) this.onChange(this.status()) }
      else if (f.t === "ws") this.openSocket(ws, f).catch((e) => this.send(ws, { t: "wsno", id: String(f.id), status: 502, message: e instanceof Error ? e.message : String(e) }))
      else if (f.t === "wsmsg") { const s = this.sockets.get(String(f.id)); if (s?.readyState === WebSocket.OPEN) s.send(typeof f.data === "string" ? Buffer.from(f.data, "base64") : String(f.text ?? ""), { binary: typeof f.data === "string" }) }
      else if (f.t === "wsclose") { const s = this.sockets.get(String(f.id)); this.sockets.delete(String(f.id)); s?.close(closeCode(f.code), String(f.reason ?? "").slice(0, 120)) }
      else if (f.t === "cancel") { const r = this.inflight.get(String(f.id)); this.inflight.delete(String(f.id)); r?.destroy() }
      else if (f.t === "req") this.forward(ws, f).catch((e) => {
        this.inflight.delete(String(f.id))
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "err", id: String(f.id), message: e instanceof Error ? e.message : String(e) }))
      })
    })
    ws.on("error", (e) => { if (this.ws === ws) this.message = e.message })
    ws.on("close", (code, reason) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.beat) clearInterval(this.beat)
      for (const r of this.inflight.values()) r.destroy()
      this.inflight.clear()
      this.endSockets()
      if (code === 4000) {
        this.replacedBy = reason.length ? String(reason).replace(/^replaced/i, "Replaced") : "Another machine took over"
        return this.set("replaced", this.replacedBy)
      }
      if (code === 4001) return this.revoked()
      if (code === 4002) { this.attempt = 0; return this.connect() }
      this.retry(this.message)
    })
  }

  retry(why: string) {
    this.down ||= Date.now()
    this.attempt++
    const wait = Math.min(MAX_BACKOFF, 1000 * 2 ** (this.attempt - 1)) * (0.5 + Math.random() / 2)
    this.set(Date.now() - this.down > OFFLINE_AFTER ? "offline" : "reconnecting", why)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.connect(), wait)
  }

  send(ws: WebSocket, o: object, cb?: () => void) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o), cb); else cb?.()
  }

  headersOf(f: Frame) {
    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Array.isArray(f.headers) ? f.headers : []) {
      const key = String(k).toLowerCase()
      if (HOP.has(key) || OURS.test(key) || (f.guest && key === "x-vaultite-cloud")) continue
      const prev = headers[key]
      headers[key] = prev === undefined ? String(v) : [prev, String(v)].flat()
    }
    headers["x-forwarded-host"] ||= new URL(this.stored()?.url ?? "https://localhost").host
    headers["x-forwarded-proto"] ||= "https"
    headers[RELAY_HEADER] = f.guest === true ? RELAYED_GUEST : RELAYED
    return headers
  }

  async openSocket(ws: WebSocket, f: Frame) {
    const id = String(f.id)
    const path = String(f.path ?? "")
    if (!path.startsWith("/") || path.startsWith("//")) return this.send(ws, { t: "wsno", id, status: 400 })
    const headers = this.headersOf(f)
    const protocols = String(headers["sec-websocket-protocol"] ?? "").split(",").map((x) => x.trim()).filter(Boolean)
    for (const k of Object.keys(headers)) if (WS_OWN.test(k) || k === "sec-websocket-protocol") delete headers[k]
    const port = await this.target()
    const s = new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { headers: headers as Record<string, string>, handshakeTimeout: 15_000, perMessageDeflate: false })
    this.sockets.set(id, s)
    const live = () => this.sockets.get(id) === s
    s.on("open", () => { if (live()) this.send(ws, { t: "wsok", id, protocol: s.protocol || undefined }) })
    s.on("unexpected-response", (req, res) => {
      req.destroy()
      if (live()) { this.sockets.delete(id); this.send(ws, { t: "wsno", id, status: res.statusCode ?? 502 }) }
    })
    s.on("message", (data, binary) => {
      if (!live()) return
      const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      this.send(ws, binary ? { t: "wsmsg", id, data: buf.toString("base64") } : { t: "wsmsg", id, text: buf.toString("utf8") })
    })
    s.on("error", () => { if (live() && s.readyState !== WebSocket.OPEN) { this.sockets.delete(id); this.send(ws, { t: "wsno", id, status: 502 }) } })
    s.on("close", (code, reason) => { if (live()) { this.sockets.delete(id); this.send(ws, { t: "wsclose", id, code, reason: String(reason) }) } })
  }

  async forward(ws: WebSocket, f: Frame) {
    const id = String(f.id)
    const send = (o: object, cb?: () => void) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o), cb); else cb?.() }
    const path = String(f.path ?? "")
    if (!path.startsWith("/") || path.startsWith("//")) return send({ t: "err", id, message: "a path starts with one /" })
    const port = await this.target()
    const headers = this.headersOf(f)
    const body = f.body ? Buffer.from(f.body, "base64") : null
    if (body) headers["content-length"] = String(body.length)
    const req = http.request({ host: "127.0.0.1", port, method: String(f.method ?? "GET"), path, headers })
    this.inflight.set(id, req)
    const live = () => this.inflight.get(id) === req
    req.on("response", (res) => {
      const out: [string, string][] = []
      for (let i = 0; i < res.rawHeaders.length; i += 2) if (!HOP.has(res.rawHeaders[i].toLowerCase())) out.push([res.rawHeaders[i], res.rawHeaders[i + 1]])
      send({ t: "res", id, status: res.statusCode, headers: out })
      res.on("data", (c: Buffer) => {
        if (!live()) return
        const full = ws.bufferedAmount > 1 << 20
        send({ t: "data", id, chunk: c.toString("base64") }, full ? () => res.resume() : undefined)
        if (full) res.pause()
      })
      res.on("end", () => { if (live()) { this.inflight.delete(id); send({ t: "end", id }) } })
      res.on("error", () => { if (live()) { this.inflight.delete(id); send({ t: "err", id, message: "the answer broke off" }) } })
    })
    req.on("error", (e) => { if (live()) { this.inflight.delete(id); send({ t: "err", id, message: e.message }) } })
    req.end(body ?? undefined)
  }
}
