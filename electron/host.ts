// A vault a server on this Mac already serves (its service: core/serving.ts): the window attaches to that server rather
// than starting one, and answers the server's calls to its browser over /api/desktop/host (core/desktopapp.ts).
import { session } from "electron"
import fs from "node:fs"
import { WebSocket } from "ws"
import { DESKTOP_PROTOCOL } from "../core/desktopapp.ts"
import { serviceVault } from "../core/service.ts"
import { servingOf, type Serving } from "../core/serving.ts"

export type Call = { type?: string; rid?: number; name?: unknown; args?: unknown }
/** An attached window's server: what it's told (outside files it may open), and letting it go. */
export type Link = { port: number; send: (m: object) => void; stop: () => void }

const real = (p: string) => { try { return fs.realpathSync(p) } catch { return p } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isService = (vault: string) => { const s = serviceVault(); return !!s && real(s) === real(vault) }

/** Whether a window for `vault` attaches rather than starts a server (one serves it here, or its service will). */
export const attachable = (vault: string) => !!servingOf(vault) || isService(vault)

/** The server serving `vault` on this Mac: the one there, else its service's once it's up (it may be starting, at
 *  login); null when it's for this app to start one. */
export async function servedHere(vault: string): Promise<Serving | null> {
  const now = servingOf(vault)
  if (now || !isService(vault)) return now
  for (const end = Date.now() + 90_000; Date.now() < end; await sleep(500)) {
    const s = servingOf(vault)
    if (s) return s
  }
  throw new Error("its service (vau service) didn't start in 90 s: see ~/Library/Logs/vaultite.log")
}

/** Attach to the server serving `vault`, answering its calls with `answer`, and again whenever it restarts; `hello`:
 *  what it's told each time (the outside files the window may open). */
export async function attach(vault: string, s: Serving, answer: (m: Call) => Promise<unknown>, hello: () => object[]): Promise<Link> {
  // (the page's terminals say they're the desktop app's: plugins/core/terminal)
  await session.defaultSession.cookies.set({ url: `http://127.0.0.1:${s.port}`, name: "vaultite_client", value: "desktop",
    expirationDate: Date.now() / 1000 + 10 * 365 * 86400 })
  let ws: WebSocket | null = null, stopped = false, wait = 500
  const connect = () => {
    if (stopped) return
    const at = servingOf(vault) ?? s // (a restarted server has a new key)
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
      if (code === 4000 || code === 4001) console.error(`vaultite: ${vault}'s server let its browser go: ${String(why) || code}`)
      if (code === 4001) return // (another app attached: it's that one's)
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
