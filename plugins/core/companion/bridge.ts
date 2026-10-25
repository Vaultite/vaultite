// A note in a folder another machine of the vault shares is typed in its rooms, with its guests (a socket per window):
// it writes the file, this machine doesn't meanwhile. Gone, or no longer sharing it: the note is this one's (`y-gone`).
import type { RawData, WebSocket } from "ws"
import { MACHINE_CLIENT, type Machine, machineSocket, type Plugin } from "../../../core/plugins.ts"

/** A machine of this vault and the folders it shares. */
export type Host = { m: Machine; folders: string[] }
type Win = { open: Set<string>; routed: Map<string, string>; ups: Map<string, Up> }
type Up = { ws: WebSocket; early: string[] }

const REFRESH_MS = 30_000, DOWN_MS = 15_000

/** `local`: a window's message about a note handled here, as ever. `hosts`, `connect` and `downMs`: tests'. */
export function bridges(plugin: Plugin, local: (ws: WebSocket, m: Record<string, unknown>, path: string) => void,
  opts: { hosts?: () => Promise<Host[]>; connect?: (m: Machine) => WebSocket; downMs?: number } = {}) {
  let hosts: Host[] = [], asked = 0
  const down = new Map<string, number>()
  const wins = new Map<WebSocket, Win>()
  const connect = opts.connect ?? ((m: Machine) => machineSocket(m, "companion/live", { rooms: "1" }, { handshakeTimeout: 8000 }))

  /** The machine whose rooms `path` is typed in: one sharing its folder (none when this one shares it too). */
  function hostFor(path: string) {
    const ours = (plugin.service("share:folders")?.() ?? []) as string[]
    const inside = (f: string) => path.startsWith(f + "/")
    if (ours.some(inside)) return null
    return hosts.find((h) => (down.get(h.m.id) ?? 0) < Date.now() && h.folders.some(inside)) ?? null
  }

  const json = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
  function toUp(w: Win, ws: WebSocket, h: Host, m: Record<string, unknown>) {
    const up = w.ups.get(h.m.id) ?? open(w, ws, h), text = JSON.stringify(m)
    if (up.ws.readyState === up.ws.OPEN) up.ws.send(text)
    else up.early.push(text)
  }

  function open(w: Win, ws: WebSocket, h: Host): Up {
    const id = h.m.id, up: Up = { ws: connect(h.m), early: [] }
    w.ups.set(id, up)
    up.ws.on("open", () => { for (const t of up.early.splice(0)) up.ws.send(t) })
    up.ws.on("message", (data: RawData) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(String(data)) } catch { return }
      if (typeof m.t !== "string" || (!m.t.startsWith("y") && m.t !== "aw") || typeof m.path !== "string" || w.routed.get(m.path) !== id) return
      json(ws, { ...m, remote: true })
    })
    // (gone: each of its notes back to this machine's, a while before it's tried again)
    const gone = () => {
      if (w.ups.get(id) !== up) return
      w.ups.delete(id)
      down.set(id, Date.now() + (opts.downMs ?? DOWN_MS))
      for (const [path, at] of w.routed) if (at === id) { w.routed.delete(path); json(ws, { t: "y-gone", path }) }
    }
    up.ws.on("close", gone)
    up.ws.on("error", gone)
    return up
  }

  // (taken from the window's first: its socket closing on purpose isn't the machine gone)
  const end = (up: Up) => (up.ws.readyState === up.ws.CONNECTING ? up.ws.terminate() : up.ws.close())

  /** Done with `path` there; its socket closed when it has no notes left. */
  function leave(w: Win, path: string) {
    const id = w.routed.get(path)
    if (!id) return
    w.routed.delete(path)
    const up = w.ups.get(id)
    if (!up) return
    if (![...w.routed.values()].includes(id)) { w.ups.delete(id); end(up) }
    else if (up.ws.readyState === up.ws.OPEN) up.ws.send(JSON.stringify({ t: "y-close", path }))
    else up.early.push(JSON.stringify({ t: "y-close", path }))
  }

  /** Each open note where it should be typed in now: moved there (from this machine's rooms), or back. */
  function reconcile() {
    for (const [ws, w] of wins) for (const path of w.open) {
      const h = hostFor(path), at = w.routed.get(path) ?? null
      if ((h?.m.id ?? null) === at) continue
      if (at) { leave(w, path); json(ws, { t: "y-gone", path }) } // (it asks again, which lands where it should be)
      else if (h) { local(ws, { t: "y-close", path }, path); w.routed.set(path, h.m.id); toUp(w, ws, h, { t: "y-open", path }) }
    }
  }

  async function hostsNow(): Promise<Host[]> {
    const vault = await plugin.ask<string>("machines:vault", "")
    if (!vault) return []
    const ms = (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.url && m.vault === vault && m.plugins?.includes("share"))
    const got = await Promise.all(ms.map(async (m): Promise<Host | null> => {
      try {
        const r = await fetch(`${m.url}/api/share/folders`, { headers: MACHINE_CLIENT, signal: AbortSignal.timeout(5000) })
        const b = r.ok ? await r.json() as { folders?: unknown } : null
        const folders = Array.isArray(b?.folders) ? b.folders.filter((f): f is string => typeof f === "string" && !!f) : []
        return folders.length ? { m, folders } : null
      } catch { return null }
    }))
    return got.filter((h): h is Host => !!h)
  }

  // (asked only while notes are open: the first one opened after a while asks, and moves there if it's shared)
  async function refresh() {
    if (!opts.hosts && ![...wins.values()].some((w) => w.open.size)) return
    asked = Date.now()
    try { hosts = await (opts.hosts ?? hostsNow)() } catch { hosts = [] }
    reconcile()
    for (const w of wins.values()) for (const up of w.ups.values()) if (up.ws.readyState === up.ws.OPEN) up.ws.ping?.()
  }
  const timer = opts.hosts ? null : setInterval(() => void refresh(), REFRESH_MS)
  timer?.unref()

  return {
    /** A window's socket. */
    add(ws: WebSocket) {
      const w: Win = { open: new Set(), routed: new Map(), ups: new Map() }
      wins.set(ws, w)
      ws.on("close", () => { wins.delete(ws); const ups = [...w.ups.values()]; w.ups.clear(); ups.forEach(end) })
    },

    /** A window's message about a note (its vault path): true when it went to another machine's rooms. */
    heard(ws: WebSocket, m: Record<string, unknown>, path: string) {
      const w = wins.get(ws)
      if (!w) return false
      if (m.t === "y-open") {
        w.open.add(path)
        if (!opts.hosts && Date.now() - asked > REFRESH_MS) void refresh()
        const h = hostFor(path), at = w.routed.get(path)
        if (!h) { if (at) leave(w, path); return false }
        if (at !== h.m.id) { if (at) leave(w, path); local(ws, { t: "y-close", path }, path); w.routed.set(path, h.m.id) }
        toUp(w, ws, h, m)
        return true
      }
      if (m.t === "y-close") w.open.delete(path)
      const id = w.routed.get(path), up = id ? w.ups.get(id) : undefined
      if (!id || !up) return false
      if (m.t === "y-close") leave(w, path)
      else if (up.ws.readyState === up.ws.OPEN) up.ws.send(JSON.stringify(m))
      else up.early.push(JSON.stringify(m))
      return true
    },

    /** Ask the machines what they share again, and move notes accordingly (tests; else every half minute). */
    refresh,
    stop: () => { if (timer) clearInterval(timer) },
  }
}
