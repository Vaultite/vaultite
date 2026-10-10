// Connect: the whole app at https://<handle>.vaultite.app for its owner. Vaultite Cloud signs the owner in and sends each
// request with `x-vaultite-cloud` (HMAC with this machine's key, from the tunnel); with it the public listener hands the
// request to the app on loopback. What runs code on this machine stays off unless the owner turns it on (ownerTools).
import crypto from "node:crypto"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import net from "node:net"
import type { Duplex } from "node:stream"
import { CONNECT_HEADER } from "../../../core/plugins.ts"

export const SIGNED_HEADER = "x-vaultite-cloud"
export type ConnectClaims = { sub: string; handle: string; role: string; exp: number; email?: string | null }

/** MCP's own routes (public.ts, with their OAuth): never the app's, signed or not. Vaultite Cloud's list is the same. */
export const MCP_PATHS = /^\/(mcp|register|token|authorize(\/status)?|\.well-known\/oauth-[a-z-]+(\/mcp)?|upload\/.*|icon\.svg|icon\.png|favicon\.ico)\/?$/
/** What runs code or reaches the machine (as hosted vaults' proxy refuses them), refused here too while ownerTools is off;
 *  the app's own owner checks (core/owner.ts) refuse them anyway. */
const OWNER_PATHS = /^\/api\/(terminals?|dispatch|screens|herdr|bundles|machines|schedule|vaults|file\/open|vaultite-cloud\/export)(\/|$)/
const OWNER_OPS = /^(plugin|bundle|terminal|dispatch|screens|herdr|schedule|machines|vault-plugin|vaultite-cloud|settings)\.|^ui\.command$/
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "forwarded", "x-real-ip"])
const OURS = /^(x-vaultite-|tailscale-|x-forwarded-|cf-)/

/** The signed header's claims when it's this machine's key's, for its handle, the owner's and not expired; else null. */
export function verifyConnect(key: string | null, token: unknown, handle: string | null, at = Math.floor(Date.now() / 1000)): ConnectClaims | null {
  if (!key || !handle || typeof token !== "string") return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const want = crypto.createHmac("sha256", key).update(body).digest("base64url")
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as ConnectClaims
    if (c.handle !== handle || c.role !== "owner" || typeof c.exp !== "number" || c.exp <= at || c.exp > at + 3600) return null
    return c
  } catch { return null }
}

/** Why Connect refuses this while owner tools are off, or "". */
export function ownerOnly(pathname: string): string {
  if (OWNER_PATHS.test(pathname)) return "this only answers on this Mac (turn on owner tools over Connect in Connections)"
  const op = /^\/api\/ops\/([^/?]+)$/.exec(pathname)?.[1]
  let id = ""
  try { id = op ? decodeURIComponent(op) : "" } catch { /* a broken escape: no op */ }
  if (id && OWNER_OPS.test(id)) return "this only runs on this Mac (turn on owner tools over Connect in Connections)"
  return ""
}

export type ConnectOptions = { appPort: () => number; publicHost: () => string | null; ownerTools: () => boolean; from: (req: IncomingMessage) => string }

/** The request's headers as the app gets them: ours, the tunnel's and hop-by-hop ones out; local Host. Without owner
 *  tools it comes as through a proxy, marked Connect's, so the app's owner checks refuse it. */
function headersFor(req: IncomingMessage, o: ConnectOptions) {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k) && !OURS.test(k) && k !== "origin") out[k] = v
  out.host = `127.0.0.1:${o.appPort()}`
  if (!o.ownerTools()) { out["x-forwarded-for"] = o.from(req) || "unknown"; out[CONNECT_HEADER] = "1" }
  return out
}

/** Why not (status, message), or null: a write's or a socket's Origin must be the handle's address (its cookie is Lax). */
function refused(req: IncomingMessage, o: ConnectOptions, pathname: string, socket: boolean): [number, string] | null {
  const origin = req.headers.origin
  if (origin !== undefined && (socket || !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET"))) {
    let host = ""
    try { host = new URL(String(origin)).host.toLowerCase() } catch { /* "null" */ }
    if (!host || host !== o.publicHost()) return [403, "the page asking isn't this vault's"]
  }
  const why = o.ownerTools() ? "" : ownerOnly(pathname)
  return why ? [403, why] : null
}

/** A signed request: to the app, its answer streamed back. */
export function serveApp(req: IncomingMessage, res: ServerResponse, o: ConnectOptions) {
  const url = new URL((req.url ?? "/").replace(/^\/+/, "/"), "http://x")
  const no = refused(req, o, url.pathname, false)
  if (no) {
    res.writeHead(no[0], { "Content-Type": "application/json", "Cache-Control": "no-store" })
    return res.end(JSON.stringify({ error: no[1] }))
  }
  const up = http.request({ host: "127.0.0.1", port: o.appPort(), method: req.method, path: url.pathname + url.search, headers: headersFor(req, o) }, (r) => {
    const h: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !HOP.has(k)) h[k] = v
    res.writeHead(r.statusCode ?? 502, h)
    r.pipe(res)
  })
  up.on("error", (e) => {
    if (!res.headersSent) { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: `the app isn't answering: ${e.message}` })) }
    else res.destroy()
  })
  res.on("close", () => { if (!res.writableFinished) up.destroy() })
  req.pipe(up)
}

/** A signed WebSocket (the app's live channel): the same checks, then the bytes both ways. */
export function upgradeApp(req: IncomingMessage, socket: Duplex, head: Buffer, o: ConnectOptions) {
  const url = new URL((req.url ?? "/").replace(/^\/+/, "/"), "http://x")
  const no = refused(req, o, url.pathname, true)
  if (no) return socket.end(`HTTP/1.1 ${no[0]} ${http.STATUS_CODES[no[0]]}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(no[1])}\r\nConnection: close\r\n\r\n${no[1]}`)
  const up = net.connect(o.appPort(), "127.0.0.1", () => {
    const lines = [`${req.method} ${url.pathname}${url.search} HTTP/1.1`,
      ...Object.entries(headersFor(req, o)).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`)),
      "connection: Upgrade", `upgrade: ${req.headers.upgrade ?? "websocket"}`]
    up.write(lines.join("\r\n") + "\r\n\r\n")
    if (head.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on("error", () => socket.destroy())
  socket.on("error", () => up.destroy())
  socket.on("close", () => up.destroy())
}
