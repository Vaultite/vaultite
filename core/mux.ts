import { EventEmitter } from "node:events"
import type { RawData, WebSocket } from "ws"
import { isNumber, isText } from "./values.ts"
import { ABNORMAL, bytePieces, MAX_MESSAGE, NO_STATUS, readBinary, readText, textPieces, writeBinary, writeText, type TextFrame } from "./muxwire.ts"

type Sent = (e?: Error) => void
type Sendable = string | Buffer | ArrayBuffer | ArrayBufferView
export type SocketEvents = { message: [data: RawData, binary: boolean]; close: [code: number, reason: Buffer]; error: [e: Error]; pong: [] }
export interface ServedSocket {
  readonly readyState: 0 | 1 | 2 | 3
  readonly bufferedAmount: number
  readonly CONNECTING: 0
  readonly OPEN: 1
  readonly CLOSING: 2
  readonly CLOSED: 3
  send(data: Sendable, cb?: Sent): void
  send(data: Sendable, opts: { binary?: boolean }, cb?: Sent): void
  close(code?: number, reason?: string | Buffer): void
  terminate(): void
  ping(): void
  on<K extends keyof SocketEvents>(event: K, fn: (...args: SocketEvents[K]) => void): this
  once<K extends keyof SocketEvents>(event: K, fn: (...args: SocketEvents[K]) => void): this
  off<K extends keyof SocketEvents>(event: K, fn: (...args: SocketEvents[K]) => void): this
  removeListener<K extends keyof SocketEvents>(event: K, fn: (...args: SocketEvents[K]) => void): this
  emit<K extends keyof SocketEvents>(event: K, ...args: SocketEvents[K]): boolean
}
export type Serve = (path: string) => Promise<(ws: ServedSocket) => void>
type Out = { frame: string | Uint8Array; size: number; sent?: Sent }

export const MAX_CHANNELS = 256
const IN_FLIGHT = 128 * 1024
const HEARTBEAT_MS = 30_000

const bytes = (data: RawData) => (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data))
const asBuffer = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)

export class MuxChannel extends EventEmitter {
  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3
  private state: 0 | 1 | 2 | 3 = 0
  queued = 0
  readonly id: number
  private mux: Mux

  constructor(mux: Mux, id: number) {
    super()
    this.mux = mux
    this.id = id
  }

  get readyState() { return this.state }
  get bufferedAmount() { return this.queued }

  send(data: Sendable, opts?: { binary?: boolean } | Sent, cb?: Sent) {
    const done = opts instanceof Function ? opts : cb, binary = (opts instanceof Function ? undefined : opts?.binary) ?? !isText(data)
    if (this.state === 0) throw new Error("WebSocket is not open: readyState 0 (CONNECTING)")
    if (this.state !== 1) return done?.(new Error(`WebSocket is not open: readyState ${this.state}`))
    if (!binary) return this.mux.text(this, isText(data) ? data : bufferOf(data).toString(), done)
    this.mux.binary(this, isText(data) ? Buffer.from(data) : bufferOf(data), done)
  }

  close(code?: number, reason: string | Buffer = "") {
    if (this.state >= 2) return
    this.state = 2
    const c = code ?? NO_STATUS, why = String(reason).slice(0, 120)
    this.mux.queue(this, { frame: writeText({ kind: "close", ch: this.id, code: c, reason: why }), size: 0, sent: () => this.ended(c, why) })
  }

  terminate() {
    if (this.state === 3) return
    this.state = 2
    this.mux.cut(this)
    setImmediate(() => this.ended(ABNORMAL, ""))
  }

  ping() { this.mux.ping() }

  opened() { if (this.state === 0) this.state = 1 }
  ended(code: number, reason: string) {
    if (this.state === 3) return
    this.state = 3
    this.mux.forget(this)
    this.emit("close", code, Buffer.from(reason))
  }
  heard(data: Buffer, binary: boolean) { if (this.state === 1 || this.state === 2) this.emit("message", data, binary) }
}

const bufferOf = (d: Buffer | ArrayBuffer | ArrayBufferView) =>
  Buffer.isBuffer(d) ? d : d instanceof ArrayBuffer ? Buffer.from(d) : Buffer.from(d.buffer, d.byteOffset, d.byteLength)

type Pieces = { parts: Buffer[]; size: number; binary: boolean }

class Mux {
  private ws: WebSocket
  private serve: Serve
  private channels = new Map<number, MuxChannel>()
  private partial = new Map<number, Pieces>()
  private waiting = new Map<MuxChannel, Out[]>()
  private inFlight = 0
  private alive = true
  private beat: ReturnType<typeof setInterval>

  constructor(ws: WebSocket, serve: Serve) {
    this.ws = ws
    this.serve = serve
    ws.on("message", (data, binary) => this.heard(bytes(data), binary))
    ws.on("pong", () => { this.alive = true; for (const c of this.channels.values()) c.emit("pong") })
    ws.on("close", () => this.end())
    this.beat = setInterval(() => {
      if (!this.alive) return ws.terminate()
      this.alive = false
      this.ping()
    }, HEARTBEAT_MS)
    this.beat.unref?.()
  }

  ping() { if (this.ws.readyState === this.ws.OPEN) this.ws.ping() }

  private say(f: TextFrame) { if (this.ws.readyState === this.ws.OPEN) this.ws.send(writeText(f)) }

  private heard(data: Buffer, binary: boolean) {
    if (binary) {
      const f = readBinary(data)
      if (f) this.piece(f.ch, asBuffer(f.data), true, f.more)
      return
    }
    const f = readText(data.toString())
    if (!f) return
    if (f.kind === "ping") return this.say({ kind: "pong" })
    if (f.kind === "open") return void this.open(f.ch, f.path)
    if (f.kind === "text") return this.piece(f.ch, Buffer.from(f.data), false, f.more)
    if (f.kind === "close") this.channels.get(f.ch)?.ended(f.code, f.reason)
  }

  private piece(ch: number, data: Buffer, binary: boolean, more: boolean) {
    const c = this.channels.get(ch)
    if (!c) return
    const p = this.partial.get(ch)
    if (!p && !more) return c.heard(data, binary)
    const into = p ?? { parts: [], size: 0, binary }
    into.parts.push(data)
    into.size += data.length
    if (into.size > MAX_MESSAGE) { this.partial.delete(ch); return c.close(1009, "message too big") }
    if (more) return void this.partial.set(ch, into)
    this.partial.delete(ch)
    c.heard(Buffer.concat(into.parts, into.size), into.binary)
  }

  private async open(ch: number, path: string) {
    if (this.channels.has(ch)) return
    if (this.channels.size >= MAX_CHANNELS) return this.say({ kind: "refused", ch, status: 429, reason: "too many sockets" })
    const c = new MuxChannel(this, ch)
    this.channels.set(ch, c)
    let run: (ws: ServedSocket) => void
    try {
      run = await this.serve(path)
    } catch (e) {
      if (this.channels.get(ch) !== c) return
      this.channels.delete(ch)
      return this.say({ kind: "refused", ch, status: e instanceof Error && "status" in e && isNumber(e.status) ? e.status : 500, reason: e instanceof Error ? e.message.slice(0, 200) : "refused" })
    }
    if (this.channels.get(ch) !== c) return
    c.opened()
    this.queue(c, { frame: writeText({ kind: "opened", ch }), size: 0 })
    run(c)
  }

  text(c: MuxChannel, s: string, sent?: Sent) {
    const pieces = textPieces(s)
    pieces.forEach((data, i) => this.queue(c, { frame: writeText({ kind: "text", ch: c.id, data, more: i < pieces.length - 1 }), size: data.length, sent: i === pieces.length - 1 ? sent : undefined }))
  }

  binary(c: MuxChannel, b: Buffer, sent?: Sent) {
    const pieces = bytePieces(b)
    pieces.forEach((data, i) => this.queue(c, { frame: writeBinary(c.id, i < pieces.length - 1, data), size: data.length, sent: i === pieces.length - 1 ? sent : undefined }))
  }

  queue(c: MuxChannel, out: Out) {
    const q = this.waiting.get(c)
    if (q) q.push(out)
    else this.waiting.set(c, [out])
    c.queued += out.size
    this.pump()
  }

  private pump() {
    while (this.inFlight < IN_FLIGHT && this.waiting.size) {
      const [c, q] = this.waiting.entries().next().value!
      const out = q.shift()!
      this.waiting.delete(c)
      if (q.length) this.waiting.set(c, q)
      c.queued -= out.size
      if (this.ws.readyState !== this.ws.OPEN) { out.sent?.(new Error("the window's socket closed")); continue }
      const size = Math.max(out.size, 1)
      this.inFlight += size
      this.ws.send(out.frame, (e) => { this.inFlight -= size; out.sent?.(e ?? undefined); this.pump() })
    }
  }

  cut(c: MuxChannel) {
    this.waiting.delete(c)
    c.queued = 0
    this.say({ kind: "close", ch: c.id, code: ABNORMAL, reason: "" })
  }

  forget(c: MuxChannel) {
    if (this.channels.get(c.id) === c) this.channels.delete(c.id)
    this.partial.delete(c.id)
    this.waiting.delete(c)
  }

  private end() {
    clearInterval(this.beat)
    for (const c of this.channels.values()) c.ended(ABNORMAL, "")
    this.waiting.clear()
    this.partial.clear()
  }
}

export function serveMux(ws: WebSocket, serve: Serve) {
  new Mux(ws, serve)
}
