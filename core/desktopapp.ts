import type { WebSocket } from "ws"

/** Raised when what the two sides say to each other changes: an app and a server that differ don't attach. */
export const DESKTOP_PROTOCOL = 1

type Msg = { type?: string; rid?: number; value?: unknown; error?: string; [k: string]: unknown }
/** close codes: 4000 another protocol, 4001 another app attached (don't come back), 4002 come back later. */
type Host = { send: (m: Msg) => void; close: (why: string, code?: number) => void }

const pending = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
const handlers = new Map<string, (m: Msg) => void>()
const listeners = new Set<(name: string, data: unknown) => void>()
const comings = new Set<(how: "ipc" | "socket") => void>(), goings = new Set<(how: "ipc" | "socket") => void>()
let next = 1
let attached: Host | null = null
let refused = ""

const forked = (): Host | null => process.env.VAULTITE_DESKTOP === "1" && typeof process.send === "function" && process.connected
  ? { send: (m) => process.send!(m), close: () => {} } : null
const host = () => forked() ?? attached

export const inDesktop = () => !!host()

const NO_DESKTOP = "the browser is in Vaultite's desktop app, and none is attached to this server: open Vaultite on this Mac, or on an always-on one listed in Machines"
export const noDesktop = () => refused || NO_DESKTOP

export function onHostMessage(type: string, fn: (m: Msg) => void) {
  handlers.set(type, fn)
}

function heard(m: Msg) {
  if (m?.type !== "desktop:reply") return void (typeof m?.type === "string" && handlers.get(m.type)?.(m))
  const p = typeof m.rid === "number" ? pending.get(m.rid) : undefined
  if (!p) return
  pending.delete(m.rid!)
  clearTimeout(p.timer)
  if (typeof m.error === "string") p.fail(new Error(m.error)); else p.ok(m.value)
}
process.on("message", heard)
process.on("disconnect", () => { if (process.env.VAULTITE_DESKTOP === "1") for (const fn of goings) fn("ipc") })
forked()?.send({ type: "desktop:hello", protocol: DESKTOP_PROTOCOL })

function gone(why: string) {
  for (const [rid, p] of pending) { pending.delete(rid); clearTimeout(p.timer); p.fail(new Error(why)) }
}

export function attach(ws: WebSocket) {
  ws.once("message", (data) => {
    let hello: Msg = {}
    try { hello = JSON.parse(String(data)) } catch { /* not one */ }
    if (hello.type !== "hello" || hello.protocol !== DESKTOP_PROTOCOL) {
      refused = `the desktop app on this machine speaks protocol ${String(hello.protocol ?? "?")}, this server ${DESKTOP_PROTOCOL}: it attaches once it updates to the server's version`
      return ws.close(4000, "another protocol")
    }
    attached?.close("another desktop app attached", 4001)
    const h: Host = { send: (m) => ws.send(JSON.stringify(m)), close: (why, code = 4002) => ws.close(code, why.slice(0, 120)) }
    attached = h
    refused = ""
    ws.send(JSON.stringify({ type: "welcome", protocol: DESKTOP_PROTOCOL }))
    ws.on("message", (d) => { try { heard(JSON.parse(String(d))) } catch { /* not JSON */ } })
    ws.on("close", () => { if (attached === h) { attached = null; gone("the desktop app detached"); for (const fn of goings) fn("socket") } })
    for (const fn of comings) fn("socket")
  })
}

export function detach(why: string) {
  attached?.close(why)
}

const REPLY_MS = 90_000
/** How long a call's answer is awaited: 90 s, or for one that itself waits up to `waits` ms (agent:wait), that and a margin. */
export const replyWithin = (waits = 0) => Math.max(REPLY_MS, waits + 30_000)

export function desktopCall(name: string, args: unknown[], ms = REPLY_MS): Promise<unknown> {
  const h = host()
  if (!h) return Promise.reject(new Error(noDesktop()))
  const rid = next++
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { pending.delete(rid); fail(new Error(`the desktop app didn't answer ${name} in ${Math.round(ms / 1000)} s`)) }, ms)
    pending.set(rid, { ok, fail, timer })
    h.send({ type: "desktop:call", rid, name, args })
  })
}

onHostMessage("desktop:event", (m) => {
  if (typeof m.name !== "string") return
  for (const fn of listeners) try { fn(m.name, m.data) } catch (e) { console.error("vaultite: a desktop event's listener failed:", e) }
})

export function onDesktopEvent(fn: (name: string, data: unknown) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function onHost(came: (how: "ipc" | "socket") => void, went: (how: "ipc" | "socket") => void) {
  comings.add(came)
  goings.add(went)
}
