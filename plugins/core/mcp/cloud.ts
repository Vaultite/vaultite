// Vaultite Cloud: this machine signed in to cloud.vaultite.com (a one-time code the user gets at /connect and types here), and
// a tunnel to its relay that forwards https://<handle>.vaultite.app to the public listener (public.ts), never the app's port.
import { execFile } from "node:child_process"
import http from "node:http"
import os from "node:os"
import WebSocket from "ws"
import type { Plugin } from "../../../core/plugins.ts"
import { RELAY_HEADER, RELAYED } from "./public.ts"

const RELAY = (process.env.VAULTITE_CLOUD || "https://cloud.vaultite.com").replace(/\/+$/, "")

/** What's kept in data/config.json (mcp.cloud): never in the vault, never logged. */
type Stored = { token: string; handle: string; url: string }
type Frame = { t: string; id?: string; method?: string; path?: string; headers?: [string, string][]; body?: string; key?: string
  text?: string; data?: string; code?: number; reason?: string }

type CloudState = "off" | "connecting" | "connected" | "reconnecting" | "offline" | "replaced"
export type CloudStatus = {
  state: CloudState
  handle: string | null
  /** The MCP address to add as a connector (<url>/mcp). */
  url: string | null
  /** Where the owner opens the app from anywhere (Connect), once Vaultite Cloud handed this machine its key. */
  app: string | null
  /** Where the user signs in and gets a code to type here. */
  connectUrl: string
  /** Why it's off or down (revoked, replaced by another machine, the last error). */
  message?: string
}

/** Headers that are one connection's, not the request's. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "content-length", "forwarded"])
/** Headers only this machine's own proxies may set (Tailscale Serve, the app): never from the internet. Vaultite Cloud's
 *  signed one (Connect) goes on: public.ts checks its signature. */
const OURS = /^(tailscale-|x-vaultite-(?!cloud$))/
/** A WebSocket's handshake headers, the ws package's own. */
const WS_OWN = /^sec-websocket-(key|version|extensions|accept)$/
const OFFLINE_AFTER = 30_000, MAX_BACKOFF = 60_000, SILENT = 75_000, HEARTBEAT = 30_000

/** This machine's name as the user knows it (System Settings, Sharing), for the relay's list of devices. */
function deviceName(): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") return resolve(os.hostname())
    execFile("scutil", ["--get", "ComputerName"], { timeout: 3000 }, (err, out) => resolve((!err && out.trim()) || os.hostname().replace(/\.local$/, "")))
  })
}

/** A close code a WebSocket may be closed with by its side (1000, 3000-4999), else 1000. */
const closeCode = (c: unknown) => (typeof c === "number" && (c === 1000 || (c >= 3000 && c <= 4999)) ? c : 1000)

export class Cloud {
  plugin: Plugin
  relay: string
  /** The public listener's port: where every request goes. */
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
  /** WebSockets relayed for Connect (the app's live channel), by the relay's id. */
  sockets = new Map<string, WebSocket>()
  /** Connect's key, handed over the tunnel by a relay that has it (memory only: the tunnel's up whenever it's used). */
  connectKey: string | null = null
  /** The 4000's reason ("Replaced by <Mac>"), until connected again. */
  replacedBy = ""
  /** Told when the state changes (plugin.ts: a notice for the owner). */
  onChange: (s: CloudStatus) => void = () => {}

  constructor(plugin: Plugin, target: () => Promise<number>, relay = RELAY) {
    this.plugin = plugin
    this.target = target
    this.relay = relay
  }

  stored(): Stored | null {
    const c = (this.plugin.secrets().mcp as { cloud?: Stored } | undefined)?.cloud
    return c?.token ? c : null
  }

  save(c: Stored | null) {
    const all = structuredClone((this.plugin.secrets().mcp ?? {}) as Record<string, unknown>)
    if (c) all.cloud = c; else delete all.cloud
    this.plugin.saveSecrets(all)
  }

  status(): CloudStatus {
    const s = this.stored()
    return {
      state: this.state, handle: s?.handle ?? null, url: s ? `${s.url.replace(/\/+$/, "")}/mcp` : null, connectUrl: `${this.relay}/connect`,
      app: s && this.connectKey ? s.url.replace(/\/+$/, "") : null,
      ...(this.message ? { message: this.message } : {}),
    }
  }

  set(state: CloudState, message = "") {
    const changed = state !== this.state || message !== this.message
    this.state = state
    this.message = message
    if (changed) this.onChange(this.status())
  }

  /** Connects when this machine is signed in. */
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
    const d = await r.json().catch(() => ({})) as Record<string, unknown>
    if (r.status === 429) throw Object.assign(new Error("Too many tries: wait a minute"), { status: 429 })
    if (!r.ok) throw Object.assign(new Error(String(d.error ?? d.message ?? `Vaultite Cloud answered ${r.status}`)), { status: r.status })
    return d
  }

  /** Trades the one-time code from /connect for this machine's token, and connects (it replaces the machine signed in before).
   *  Without a code, signed in: connects this machine again (after another took over). */
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
    if (old && old.token !== d.token) void this.post("/api/device/revoke", {}, old.token).catch(() => {}) // another account's, else gone already
    this.attempt = 0
    this.connect()
    return this.status()
  }

  /** Revokes this machine's token and forgets it (forgotten even when Vaultite Cloud can't be reached). */
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

  /** Signed out by Vaultite Cloud (the token was revoked, e.g. from its website). */
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
      ws.send(JSON.stringify({ t: "hello", features: ["app"] })) // a relay with Connect answers with its key
      this.beat = setInterval(() => {
        if (Date.now() - this.seen > SILENT) ws.terminate() // a connection gone quiet: start again
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
      else if (f.t === "connect" && typeof f.key === "string" && f.key) { const was = this.connectKey; this.connectKey = f.key; if (!was) this.onChange(this.status()) }
      else if (f.t === "ws") this.openSocket(ws, f).catch((e) => this.send(ws, { t: "wsno", id: String(f.id), status: 502, message: (e as Error).message }))
      else if (f.t === "wsmsg") { const s = this.sockets.get(String(f.id)); if (s?.readyState === WebSocket.OPEN) s.send(typeof f.data === "string" ? Buffer.from(f.data, "base64") : String(f.text ?? ""), { binary: typeof f.data === "string" }) }
      else if (f.t === "wsclose") { const s = this.sockets.get(String(f.id)); this.sockets.delete(String(f.id)); s?.close(closeCode(f.code), String(f.reason ?? "").slice(0, 120)) }
      else if (f.t === "cancel") { const r = this.inflight.get(String(f.id)); this.inflight.delete(String(f.id)); r?.destroy() }
      // (a request that can't be made, a header http refuses, is answered with why, not left to time out)
      else if (f.t === "req") this.forward(ws, f).catch((e) => {
        this.inflight.delete(String(f.id))
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "err", id: String(f.id), message: (e as Error).message }))
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
      // "replaced by <the new Mac's name>"
      if (code === 4000) {
        this.replacedBy = reason.length ? String(reason).replace(/^replaced/i, "Replaced") : "Another machine took over"
        return this.set("replaced", this.replacedBy)
      }
      if (code === 4001) return this.revoked()
      this.retry(this.message)
    })
  }

  /** Again after a while: 1 s doubling to a minute, each with jitter so many Macs don't come back at once. */
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

  /** The headers the relay sent, as the public listener gets them. */
  headersOf(f: Frame) {
    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Array.isArray(f.headers) ? f.headers : []) {
      const key = String(k).toLowerCase()
      if (HOP.has(key) || OURS.test(key)) continue
      const prev = headers[key]
      headers[key] = prev === undefined ? String(v) : [prev, String(v)].flat()
    }
    headers["x-forwarded-host"] ||= new URL(this.stored()?.url ?? "https://localhost").host
    headers["x-forwarded-proto"] ||= "https"
    headers[RELAY_HEADER] = RELAYED
    return headers
  }

  /** Connect: a WebSocket the relay opened (the app's live channel), to the public listener, its messages both ways. */
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
      const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      this.send(ws, binary ? { t: "wsmsg", id, data: buf.toString("base64") } : { t: "wsmsg", id, text: buf.toString("utf8") })
    })
    s.on("error", () => { if (live() && s.readyState !== WebSocket.OPEN) { this.sockets.delete(id); this.send(ws, { t: "wsno", id, status: 502 }) } })
    s.on("close", (code, reason) => { if (live()) { this.sockets.delete(id); this.send(ws, { t: "wsclose", id, code, reason: String(reason) }) } })
  }

  /** One request from the relay to the public listener, its answer streamed back as it comes (SSE too). */
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
        const full = ws.bufferedAmount > 1 << 20 // a slow relay: wait for this chunk to go out before reading on
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
