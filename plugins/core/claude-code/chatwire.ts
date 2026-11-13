import crypto from "node:crypto"
import type net from "node:net"
import os from "node:os"
import path from "node:path"
import { runtimeDir } from "../../../core/plugins.ts"
import { eachMessage } from "./chathost.ts"

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
  constructor(sock: net.Socket, hear: (m: Record<string, unknown>) => void, gone: () => void) {
    this.sock = sock
    eachMessage(sock, (m) => {
      const w = typeof m.re === "number" ? this.waiting.get(m.re) : undefined
      if (w) { this.waiting.delete(m.re as number); if (typeof m.error === "string") w.fail(new Error(m.error)); else w.ok(m) } else hear(m)
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
  request(op: string, params: Record<string, unknown> = {}, ms = 15000): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("the chat keeper went away"))
    const re = ++this.seq
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => { this.waiting.delete(re); fail(new Error(`the chat keeper didn't answer ${op}`)) }, ms)
      this.waiting.set(re, { ok: (v) => { clearTimeout(timer); ok(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.sock.write(JSON.stringify({ op, re, ...params }) + "\n")
    })
  }
  close() { this.sock.destroy() }
}
