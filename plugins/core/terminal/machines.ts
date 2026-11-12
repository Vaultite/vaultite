import type { IncomingMessage } from "node:http"
import { type RawData, WebSocket } from "ws"
import { HTTPError, machineSocket, pipeSockets, splitMachine, type Machine } from "../../../core/plugins.ts"
import { EXITED, GONE, REFUSED, type Session, TERMINAL_ID, clamp, plugin, sessions } from "./shared.ts"
import { LOCAL, agentOf, backendOf, context, env, fromReq, ownerOf, pluginBackend, runsHere } from "./backends.ts"
import { attach, closesTabs, end, endHere, resize, start } from "./start.ts"
import { type Listed, remotes } from "./list.ts"

const machineOf = (id: string) => plugin.ask<Machine | null>("machines:machine", null, id)
export const terminalMachines = async () => (await plugin.ask<Machine[]>("machines", [])).filter((m) => !m.self && m.online && m.plugins?.includes("terminal"))

function joinRemote(ws: WebSocket, m: Machine | null, id: string, path: string, query: Record<string, string>) {
  if (!m || !m.online || !m.plugins?.includes("terminal")) {
    if (!m) { ws.send(JSON.stringify({ t: "refused", reason: `this terminal runs on '${id}', which isn't one of this vault's machines` })); return ws.close(REFUSED, "refused") }
    ws.send(JSON.stringify({ t: "unreachable", machine: m.id, label: m.label, reason: !m.online ? "isn't answering" : "has its terminal turned off" }))
    return ws.close(1013, "unavailable")
  }
  pipeSockets(ws, machineSocket(m, path, query), () => {
    ws.send(JSON.stringify({ t: "unreachable", machine: m.id, label: m.label, reason: "isn't answering" }))
    ws.close(1011, "unreachable")
  })
}


function sessionsOn(m: Machine, ms = 2500): Promise<Listed[] | null> {
  const r = remotes.get(m.id)
  if (r?.list.length) return Promise.resolve(r.list.map((x) => ({ ...x, id: splitMachine(x.id)[0] })))
  return new Promise((resolve) => {
    const sock = machineSocket(m, "terminals", { local: "1" })
    const done = (v: Listed[] | null) => { clearTimeout(timer); sock.terminate(); resolve(v) }
    const timer = setTimeout(() => done(null), ms)
    sock.on("message", (data: RawData) => {
      try { const msg = JSON.parse(String(data)); if (msg.t === "sessions" && Array.isArray(msg.list)) done(msg.list) } catch {}
    })
    sock.on("error", () => done(null))
    sock.on("close", () => done(null))
  })
}

/** The machine a session runs on: this one's id (Machines' "machines:self"), another's whose list has it, or null (none
 *  that answers has it, or there are no machines). */
async function locate(id: string): Promise<string | null> {
  if (!TERMINAL_ID.test(id) || id.includes("@")) return null
  const self = await plugin.ask<unknown>("machines:self", null)
  if (await runsHere(id)) return typeof self === "string" && self ? self : null
  const others = await terminalMachines()
  const found = await Promise.all(others.map(async (m) => ((await sessionsOn(m))?.some((x) => x.id === id) ? m.id : null)))
  return found.find(Boolean) ?? null
}
plugin.provide("terminal:locate", locate)
/** What an agent the app runs outside a terminal gets as its environment (Claude Code's chat sessions): a shell's here,
 *  Vaultite's variables and the app's vau first on PATH, so its commands run as they would in a terminal. */
plugin.provide("terminal:agent-env", (): Record<string, string> => ({ ...env(), ...context(null, LOCAL) }))

export const starting = new Map<string, Promise<{ s: Session; fresh: boolean }>>()

/** Refuse this socket if its request may not have a shell (in the socket, not before it: a refused upgrade reaches the
 *  page only as "closed", so it would retry forever). True when it may go on. */
export async function allowed(ws: WebSocket, req: IncomingMessage) {
  const why = await plugin.refusal(req, "the terminal")
  if (why) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "refused", reason: why }))
    ws.close(REFUSED, "refused")
    return false
  }
  return ws.readyState === ws.OPEN
}

plugin.socket("terminal/*", async (ws, req, { wild, query }) => {
  const [id, at] = splitMachine(wild[0])
  if (!(await allowed(ws, req))) return
  if (at) {
    const m = await machineOf(at)
    const savedHere = !m && !plugin.service("machines:machine") && (await runsHere(id))
    if (!savedHere && !m?.self) return joinRemote(ws, m, at, `terminal/${encodeURIComponent(id)}`, query)
  }
  if (query.end) {
    const s = sessions.get(id)
    if (s) end(s)
    else { const b = await backendOf(id); if (b) await endHere(b, id).catch(() => {}) }
    return ws.close(EXITED, "ended")
  }
  const cols = clamp(query.cols, 2, 1000, 80), rows = clamp(query.rows, 1, 500, 24)
  const cell = query.cw && query.ch ? { width: clamp(query.cw, 1, 200, 8), height: clamp(query.ch, 1, 200, 16) } : undefined
  const s = sessions.get(id)
  if (s) {
    resize(s, cols, rows, cell)
    return attach(s, ws, false)
  }
  const agent = agentOf(id), ended = closesTabs(id)
  if (query.attach && (ended || (agent && !agent.resume)) && !starting.has(id) && !(await runsHere(id))) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "gone", ...(ended ? { ended: true } : {}) }))
    return ws.close(GONE, "gone")
  }
  const owned = ownerOf(id)
  if (owned && !starting.has(id) && !(await runsHere(id))) {
    const b = pluginBackend()
    if (b?.name === owned.backend && (await b.ready().catch(() => false))) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "gone" }))
      return ws.close(GONE, "gone")
    }
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "unreachable", backend: owned.backend, label: owned.label, reason: "isn't running here (or its plugin is off)" }))
    return ws.close(1013, "unavailable")
  }
  const first = !starting.has(id)
  if (first) starting.set(id, start(id, cols, rows, fromReq(req), null, query.dark === "1" ? true : query.dark === "0" ? false : null).finally(() => starting.delete(id)))
  starting.get(id)!.then(({ s, fresh }) => { if (ws.readyState !== ws.OPEN) return; if (cell) resize(s, s.link.cols, s.link.rows, cell); attach(s, ws, first && fresh) }, (e) => {
    console.error("terminal:", e)
    if (ws.readyState !== ws.OPEN) return
    ws.send(Buffer.from(`\r\nCouldn't start a shell: ${(e as Error).message}\r\n`))
    ws.close(EXITED, "failed")
  })
}, {
  accept: (_req, { wild }) => {
    if (!TERMINAL_ID.test(wild[0])) throw new HTTPError(400, "a terminal id is letters, digits, - and _ (then @machine for another machine's)")
  },
})

