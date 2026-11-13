// A window attached to a server on this Mac that already serves its vault (core/serving.ts).
import { session } from "electron"
import fs from "node:fs"
import { WebSocket } from "ws"
import { DESKTOP_PROTOCOL } from "../core/desktopapp.ts"
import { serviceVault } from "../core/service.ts"
import { servingOf, type Serving } from "../core/serving.ts"
import { logger } from "../core/log.ts"

const log = logger("host")

export type Call = { type?: string; rid?: number; name?: unknown; args?: unknown }
export type Link = { port: number; send: (m: object) => void; stop: () => void }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return p } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isService = (vault: string) => { const s = serviceVault(); return !!s && real(s) === real(vault) }

export const attachable = (vault: string) => !!servingOf(vault) || isService(vault)

export async function servedHere(vault: string): Promise<Serving | null> {
  const now = servingOf(vault)
  if (now || !isService(vault)) return now
  for (const end = Date.now() + 90_000; Date.now() < end; await sleep(500)) {
    const s = servingOf(vault)
    if (s) return s
  }
  throw new Error("its service (vau service) didn't start in 90 s: see ~/Library/Logs/vaultite.log")
}

export async function attach(vault: string, s: Serving, answer: (m: Call) => Promise<unknown>, hello: () => object[], refused?: () => void): Promise<Link> {
  await session.defaultSession.cookies.set({ url: `http://127.0.0.1:${s.port}`, name: "vaultite_client", value: "desktop",
    expirationDate: Date.now() / 1000 + 10 * 365 * 86400 })
  let ws: WebSocket | null = null, stopped = false, wait = 500
  const connect = () => {
    if (stopped) return
    const at = servingOf(vault) ?? s
    const sock = new WebSocket(`ws://127.0.0.1:${at.port}/api/desktop/host`, { headers: { "x-vaultite-host-key": at.key } })
    ws = sock
    const send = (m: object) => { if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(m)) }
    sock.on("open", () => {
      wait = 500
      send({ type: "hello", protocol: DESKTOP_PROTOCOL })
      for (const m of hello()) send(m)
    })
    sock.on("message", (d) => {
      let m: Call
      try { m = JSON.parse(String(d)) } catch { return }
      if (m?.type !== "desktop:call" || typeof m.rid !== "number") return
      answer(m).then((value) => send({ type: "desktop:reply", rid: m.rid, value }),
        (e) => send({ type: "desktop:reply", rid: m.rid, error: e instanceof Error ? e.message : String(e) }))
    })
    sock.on("error", () => { /* its close follows */ })
    sock.on("close", (code, why) => {
      if (ws === sock) ws = null
      if (stopped) return
      if (code === 4000 || code === 4001) log.error(`${vault}'s server let its browser go: ${String(why) || code}`)
      if (code === 4001) return
      if (code === 4000 && refused) return refused()
      setTimeout(connect, wait)
      wait = Math.min(wait * 2, code === 4000 ? 60_000 : 5000)
    })
  }
  connect()
  return {
    port: s.port,
    send: (m) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) },
    stop: () => { stopped = true; ws?.close() },
  }
}
