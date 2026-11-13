import { type RawData, WebSocket } from "ws"
import { HTTPError, type Machine, MACHINE_CLIENT, machineSocket, splitMachine } from "../../../core/plugins.ts"
import { str } from "../../../core/vault.ts"
import { type InboxEvent } from "./model.ts"
import { machineList, plugin } from "./server.ts"
import { broadcast, message, remotes, watchers } from "./store.ts"

/** Sockets that stopped answering are ended: a laptop that slept, or a network that changed, leaves its connection open
 *  on the other end, silent (no close comes). Each is pinged every PING; one that didn't answer the last is dead. */
const PING = 15_000
const answered = new WeakMap<WebSocket, boolean>()
function alive(ws: WebSocket) {
  answered.set(ws, true)
  ws.on("pong", () => answered.set(ws, true))
}
function pingAll(socks: Iterable<WebSocket>) {
  for (const ws of socks) {
    if (ws.readyState !== ws.OPEN) continue
    if (!answered.get(ws)) { ws.terminate(); continue }
    answered.set(ws, false)
    try { ws.ping() } catch { ws.terminate() }
  }
}

const FOLLOW = 30_000

const theirs = (e: InboxEvent, m: Machine): InboxEvent => ({ ...e, id: `${e.id}@${m.id}`, machine: m.id, machineLabel: m.label,
  ...(e.terminal && !e.terminal.includes("@") ? { terminal: `${e.terminal}@${m.id}` } : {}) })

export async function followMachines() {
  const want = plugin.isOff() ? [] : (await machineList()).filter((m) => !m.self && m.online && m.plugins?.includes(plugin.id))
  for (const [id, r] of remotes) if (!want.some((m) => m.id === id)) { r.sock.terminate(); remotes.delete(id); broadcast(false) }
  await Promise.all(want.filter((m) => !remotes.has(m.id)).map((m) => new Promise<void>((resolve) => {
    const sock = machineSocket(m, "inbox/live", { local: "1" })
    const r: { sock: WebSocket; events: InboxEvent[]; raw?: string } = { sock, events: [] }
    remotes.set(m.id, r)
    alive(sock)
    let opened = false
    sock.on("open", () => { opened = true })
    const timer = setTimeout(resolve, 2500)
    sock.on("message", (data: RawData) => {
      const raw = String(data)
      if (raw === r.raw) return
      r.raw = raw
      let msg: { t?: string; events?: InboxEvent[] }
      try { msg = JSON.parse(raw) } catch { return }
      if (msg.t !== "events" || !Array.isArray(msg.events)) return
      r.events = msg.events.filter((e) => e && typeof e.id === "string" && typeof e.t === "number" && !e.id.includes("@")).map((e) => theirs(e, m))
      broadcast(false)
      clearTimeout(timer); resolve()
    })
    const gone = () => {
      clearTimeout(timer); resolve()
      if (remotes.get(m.id) !== r) return
      remotes.delete(m.id); broadcast(false)
      if (opened && plugin.loaded && first) setTimeout(() => { if (plugin.loaded && first) void followMachines() }, 3000).unref?.()
    }
    sock.on("close", gone)
    sock.on("error", gone)
  })))
}

let first: Promise<void> | null = null
let followTimer: ReturnType<typeof setInterval> | null = null
export async function others() {
  if (!first) {
    first = followMachines()
    followTimer = setInterval(() => { if (plugin.loaded) void followMachines() }, FOLLOW)
    followTimer.unref?.()
  }
  await first
}

export async function onMachine(id: string, method: string, route: string, body: unknown, local: (e: InboxEvent) => InboxEvent | null) {
  const m = await plugin.ask<Machine | null>("machines:machine", null, id)
  if (!m || m.self) throw new HTTPError(404, `no machine '${id}' (Machines)`)
  let r: Response
  try {
    r = await fetch(`${m.url}/api/${route}`, { method, headers: { ...MACHINE_CLIENT, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) })
  } catch {
    throw new HTTPError(502, `${m.label} doesn't answer: its events are kept there`)
  }
  if (!r.ok) {
    let why = ""
    try { why = str((await r.json()).error) } catch { /* not JSON */ }
    throw new HTTPError(r.status, `${m.label}: ${why || `answered ${r.status}`}`)
  }
  const kept = remotes.get(m.id)
  if (kept) { kept.events = kept.events.map(local).filter((e): e is InboxEvent => !!e); broadcast(false) }
  return r
}

export function byMachine(ids: string[]) {
  const out = new Map<string, string[]>()
  for (const full of ids) { const [id, at] = splitMachine(full); out.set(at, [...out.get(at) ?? [], id]) }
  return out
}
export const isOne = (e: InboxEvent, ids: string[]) => ids.includes(splitMachine(e.id)[0])

export function register() {
  plugin.socket("inbox/live", (ws, _req, { query }) => {
    const local = !!query.local
    watchers.set(ws, local)
    if (!local) void others().then(() => { if (ws.readyState === ws.OPEN) ws.send(message(false)) })
    else ws.send(message(true))
    ws.on("close", () => watchers.delete(ws))
    alive(ws)
  })

  const pingTimer = setInterval(() => { pingAll(watchers.keys()); pingAll([...remotes.values()].map((r) => r.sock)) }, PING)
  pingTimer.unref?.()
  plugin.onUnload(() => clearInterval(pingTimer))

  plugin.onUnload(() => {
    if (followTimer) clearInterval(followTimer)
    followTimer = null; first = null
    for (const r of remotes.values()) r.sock.terminate()
    remotes.clear()
  })
}
