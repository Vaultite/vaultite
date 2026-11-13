import crypto from "node:crypto"
import type net from "node:net"
import os from "node:os"
import path from "node:path"
import { logger, runtimeDir } from "../../../core/plugins.ts"
import { eachMessage } from "./chathost.ts"
import { Answers, Event, issues, type Op, type Params, type Reply } from "./chatprotocol.ts"
const log = logger("chat")

export const SESSION = /^[\w-]{1,80}$/

export const port = Number(process.env.PORT) || 0
export const NAME = port === 8793 ? "vaultite" : `vaultite-${port || `x${process.pid}`}`
export const WIN = process.platform === "win32"
export const FILES = path.join(runtimeDir(), `vaultite-chatd1-${NAME}.sock`)
export const CHAT_SOCKET = WIN ? `\\\\.\\pipe\\vaultite-chatd1-${NAME}-${crypto.createHash("sha256").update(os.userInfo().username).digest("hex").slice(0, 8)}` : FILES

export class Wire {
  sock: net.Socket
  seq = 0
  waiting = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>()
  closed = false
  constructor(sock: net.Socket, hear: (e: Event) => void, gone: () => void) {
    this.sock = sock
    eachMessage(sock, (m) => {
      const re = typeof m.re === "number" ? m.re : NaN, w = this.waiting.get(re)
      if (w) { this.waiting.delete(re); if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m); return }
      const e = Event.safeParse(m)
      if (e.success) hear(e.data)
      else log.error("a message from the chat keeper it can't read", new Error(issues(e.error)), { t: String(m.t) })
    })
    const end = () => {
      if (this.closed) return
      this.closed = true
      for (const w of this.waiting.values()) w.fail(new Error("the chat keeper went away"))
      this.waiting.clear()
      gone()
    }
    sock.on("close", end)
    sock.on("error", end)
  }
  request<O extends Op>(op: O, params: Params<O>, ms = 15000): Promise<Reply<O>> {
    if (this.closed) return Promise.reject(new Error("the chat keeper went away"))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(re); fail(new Error(`the chat keeper didn't answer ${op}`)) }, ms)
      const answered = (v: Record<string, unknown>) => {
        const a = Answers[op].safeParse(v)
        if (a.success) ok(a.data); else fail(new Error(`the chat keeper's answer to ${op} can't be read: ${issues(a.error)}`))
      }
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); answered(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.sock.write(JSON.stringify({ op, re, ...params }) + "\n")
    })
  }
  close() { this.sock.destroy() }
}
