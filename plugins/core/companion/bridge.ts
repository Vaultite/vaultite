import type { RawData, WebSocket } from "ws"
import { z } from "zod"
import { type Machine, machineSocket, type Plugin } from "../../../core/plugins.ts"
import { type Message, messageFrom } from "./rooms.ts"

export type Host = { m: Machine; folders: string[] }
type Win = { open: Set<string>; routed: Map<string, string>; ups: Map<string, Up> }
type Up = { ws: WebSocket; early: string[] }

const REFRESH_MS = 30_000, DOWN_MS = 15_000

export function bridges(plugin: Plugin, local: (ws: WebSocket, m: Message, path: string) => void,
  opts: { hosts?: () => Promise<Host[]>; connect?: (m: Machine) => WebSocket; downMs?: number } = {}) {
  let hosts: Host[] = [], asked = 0
  const down = new Map<string, number>()
  const wins = new Map<WebSocket, Win>()
  const connect = opts.connect ?? ((m: Machine) => machineSocket(m, "companion/live", { rooms: "1" }, { handshakeTimeout: 8000 }))

  function hostFor(path: string) {
    const ours = z.array(z.string()).safeParse(plugin.service("share:folders")?.() ?? []).data ?? []
    const inside = (f: string) => f === "" || path.startsWith(f + "/")
    if (ours.some(inside)) return null
    return hosts.find((h) => (down.get(h.m.id) ?? 0) < Date.now() && h.folders.some(inside)) ?? null
  }

  const json = (ws: WebSocket, m: object) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)) }
  function toUp(w: Win, ws: WebSocket, h: Host, m: Message) {
    const up = w.ups.get(h.m.id) ?? open(w, ws, h), text = JSON.stringify(m)
    if (up.ws.readyState === up.ws.OPEN) up.ws.send(text)
    else up.early.push(text)
  }

  function open(w: Win, ws: WebSocket, h: Host): Up {
    const id = h.m.id, up: Up = { ws: connect(h.m), early: [] }
    w.ups.set(id, up)
    up.ws.on("open", () => { for (const t of up.early.splice(0)) up.ws.send(t) })
    up.ws.on("message", (data: RawData) => {
      const m = messageFrom(data)
      if (!m || (!m.t.startsWith("y") && m.t !== "aw") || typeof m.path !== "string" || w.routed.get(m.path) !== id) return
      json(ws, { ...m, remote: true })
    })
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

  const end = (up: Up) => (up.ws.readyState === up.ws.CONNECTING ? up.ws.terminate() : up.ws.close())

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

  function reconcile() {
    for (const [ws, w] of wins) for (const path of w.open) {
      const h = hostFor(path), at = w.routed.get(path) ?? null
      if ((h?.m.id ?? null) === at) continue
      if (at) { leave(w, path); json(ws, { t: "y-gone", path }) }
      else if (h) { local(ws, { t: "y-close", path }, path); w.routed.set(path, h.m.id); toUp(w, ws, h, { t: "y-open", path }) }
    }
  }

  const hostsNow = async () => {
    const [shared, hub] = await Promise.all([plugin.ask<Host[]>("share:hosts", [], true), plugin.ask<Host | null>("sync:rooms", null)])
    return hub && !shared.some((h) => h.m.id === hub.m.id) ? [...shared, hub] : shared
  }

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
    add(ws: WebSocket) {
      const w: Win = { open: new Set(), routed: new Map(), ups: new Map() }
      wins.set(ws, w)
      ws.on("close", () => { wins.delete(ws); const ups = [...w.ups.values()]; w.ups.clear(); ups.forEach(end) })
    },

    heard(ws: WebSocket, m: Message, path: string) {
      const w = wins.get(ws)
      if (!w) return false
      if (m.t === "y-open") {
        w.open.add(path)
        if (!opts.hosts && Date.now() - asked > REFRESH_MS) void refresh()
        const h = hostFor(path), at = w.routed.get(path)
        if (!h) { if (at) leave(w, path); return false }
        if (at !== h.m.id) { if (at) leave(w, path); local(ws, { t: "y-close", path }, path); w.routed.set(path, h.m.id) }
        toUp(w, ws, h, { t: "y-open", path: m.path })
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

    refresh,
    stop: () => { if (timer) clearInterval(timer) },
  }
}
