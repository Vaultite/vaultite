import { share } from "@/core/share"
import { isText } from "../../../core/values.ts"
import { ABNORMAL, MUX_PATH, NO_STATUS, readBinary, readText, writeBinary, writeText } from "../../../core/muxwire.ts"

export interface Socket {
  readonly readyState: 0 | 1 | 2 | 3
  binaryType: BinaryType
  readonly bufferedAmount: number
  onopen: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onclose: ((e: CloseEvent) => void) | null
  onerror: ((e: Event) => void) | null
  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void
  close(code?: number, reason?: string): void
}

const PING_MS = 25_000, QUIET_MS = 5_000, ANSWER_MS = 4_000, MAX_BACKOFF_MS = 30_000

const urlOf = (path: string) => {
  const url = new URL(`api/${path}`, location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url
}

class Channel extends EventTarget implements Socket {
  binaryType: BinaryType = "blob"
  onopen: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readonly id: number
  readonly path: string
  openSent = false
  private state: 0 | 1 | 2 | 3 = 0
  private hub: Hub

  constructor(hub: Hub, id: number, path: string) {
    super()
    this.hub = hub
    this.id = id
    this.path = path
    this.addEventListener("open", (e) => this.onopen?.(e))
    this.addEventListener("message", (e) => { if (e instanceof MessageEvent) this.onmessage?.(e) })
    this.addEventListener("error", (e) => this.onerror?.(e))
    this.addEventListener("close", (e) => { if (e instanceof CloseEvent) this.onclose?.(e) })
  }

  get readyState() { return this.state }
  get bufferedAmount() { return this.hub.buffered() }

  send(data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>) {
    if (this.state === 0) throw new DOMException("Still in CONNECTING state.", "InvalidStateError")
    if (this.state === 1) this.hub.send(this, data)
  }

  close(code?: number, reason = "") {
    if (this.state >= 2) return
    const connecting = this.state === 0
    this.state = 2
    this.hub.closing(this, code ?? NO_STATUS, reason)
    setTimeout(() => this.ended(connecting ? ABNORMAL : code ?? NO_STATUS, connecting ? "" : reason))
  }

  opened() {
    if (this.state !== 0) return
    this.state = 1
    this.dispatchEvent(new Event("open"))
  }
  heard(data: string | ArrayBuffer) {
    if (this.state !== 1) return
    const binary = data instanceof ArrayBuffer && this.binaryType === "blob" ? new Blob([data]) : data
    this.dispatchEvent(new MessageEvent("message", { data: binary }))
  }
  ended(code: number, reason: string) {
    if (this.state === 3) return
    this.state = 3
    this.hub.forget(this)
    if (code === ABNORMAL) this.dispatchEvent(new Event("error"))
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean: code !== ABNORMAL }))
  }
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out.buffer
}
const bytesOf = (d: ArrayBuffer | ArrayBufferView) => (ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d))

class Hub {
  private ws: WebSocket | null = null
  private channels = new Map<number, Channel>()
  private texts = new Map<number, string[]>()
  private bytes = new Map<number, Uint8Array[]>()
  private next = 1
  private tries = 0
  private notBefore = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private heardAt = 0
  private asking: ReturnType<typeof setTimeout> | null = null
  private watching = false

  open(path: string): Channel {
    const c = new Channel(this, this.next++, path)
    this.channels.set(c.id, c)
    this.watch()
    if (this.ws?.readyState === WebSocket.OPEN) { this.ask(c); this.check() }
    else this.connect()
    return c
  }

  buffered() { return this.ws?.bufferedAmount ?? 0 }

  send(c: Channel, data: string | ArrayBuffer | ArrayBufferView<ArrayBuffer>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(isText(data) ? writeText({ kind: "text", ch: c.id, data, more: false }) : writeBinary(c.id, false, bytesOf(data)))
  }

  closing(c: Channel, code: number, reason: string) {
    if (c.openSent && this.ws?.readyState === WebSocket.OPEN) this.ws.send(writeText({ kind: "close", ch: c.id, code, reason }))
    this.forget(c)
  }

  forget(c: Channel) {
    if (this.channels.get(c.id) === c) this.channels.delete(c.id)
    this.texts.delete(c.id)
    this.bytes.delete(c.id)
  }

  check() {
    const ws = this.ws
    if (!ws) { if (this.channels.size) this.connect(); return }
    if (ws.readyState !== WebSocket.OPEN || this.asking || Date.now() - this.heardAt < QUIET_MS) return
    const asked = Date.now()
    ws.send(writeText({ kind: "ping" }))
    this.asking = setTimeout(() => { this.asking = null; if (this.ws === ws && this.heardAt < asked) this.lost() }, ANSWER_MS)
  }

  private ask(c: Channel) {
    c.openSent = true
    this.ws?.send(writeText({ kind: "open", ch: c.id, path: c.path }))
  }

  private connect() {
    if (this.ws || this.retry) return
    const wait = this.notBefore - Date.now()
    if (wait > 0) { this.retry = setTimeout(() => { this.retry = null; this.connect() }, wait); return }
    const ws = new WebSocket(urlOf(MUX_PATH))
    ws.binaryType = "arraybuffer"
    this.ws = ws
    ws.onopen = () => {
      this.heardAt = Date.now()
      for (const c of this.channels.values()) if (!c.openSent) this.ask(c)
    }
    ws.onmessage = (e) => { if (this.ws === ws) this.heard(e.data) }
    ws.onclose = () => { if (this.ws === ws) this.lost() }
  }

  private lost() {
    const ws = this.ws
    this.ws = null
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; ws.close() }
    if (this.asking) { clearTimeout(this.asking); this.asking = null }
    this.notBefore = Date.now() + Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.tries++)
    this.texts.clear()
    this.bytes.clear()
    for (const c of Array.from(this.channels.values())) c.ended(ABNORMAL, "")
    if (this.channels.size) this.connect()
  }

  private heard(data: string | ArrayBuffer) {
    this.heardAt = Date.now()
    if (data instanceof ArrayBuffer) {
      const f = readBinary(new Uint8Array(data))
      if (f) this.gather(this.bytes, f.ch, f.data, f.more, concat)
      return
    }
    const f = readText(data)
    if (!f || f.kind === "ping" || f.kind === "pong" || f.kind === "open") return
    const c = this.channels.get(f.ch)
    if (!c) return
    if (f.kind === "opened") { this.tries = 0; c.opened() }
    else if (f.kind === "refused") c.ended(ABNORMAL, f.reason)
    else if (f.kind === "close") c.ended(f.code, f.reason)
    else this.gather(this.texts, f.ch, f.data, f.more, (all) => all.join(""))
  }

  private gather<T>(into: Map<number, T[]>, ch: number, data: T, more: boolean, whole: (all: T[]) => string | ArrayBuffer) {
    const c = this.channels.get(ch)
    if (!c) return
    const before = into.get(ch)
    if (more) { if (before) before.push(data); else into.set(ch, [data]); return }
    into.delete(ch)
    c.heard(whole(before ? [...before, data] : [data]))
  }

  private watch() {
    if (this.watching || !globalThis.document) return
    this.watching = true
    const check = () => this.check()
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check() })
    addEventListener("online", check)
    addEventListener("offline", check)
    addEventListener("pageshow", check)
    setInterval(() => { if (document.visibilityState === "visible" && this.channels.size) check() }, PING_MS)
  }
}

let hub: Hub | null = null
let direct = !!share

export function directSockets() { direct = true }

export function openSocket(path: string): Socket {
  if (direct) return new WebSocket(urlOf(path))
  hub ??= new Hub()
  return hub.open(path)
}
