import crypto from "node:crypto"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import net from "node:net"
import type { Duplex } from "node:stream"
import { z } from "zod"
import { CONNECT_HEADER } from "../../../core/plugins.ts"

export const SIGNED_HEADER = "x-vaultite-cloud"
const ConnectClaims = z.looseObject({ handle: z.string(), role: z.string(), exp: z.number() })
export type ConnectClaims = z.infer<typeof ConnectClaims>

export const MCP_PATHS = /^\/(mcp|register|token|authorize(\/status)?|\.well-known\/oauth-[a-z-]+(\/mcp)?|upload\/.*|icon\.svg|icon\.png|favicon\.ico)\/?$/
const OWNER_PATHS = /^\/api\/(terminals?|dispatch|screens|herdr|bundles|machines|schedule|vaults|ui|file\/open|vaultite-cloud\/export|web-viewer\/(tabs|live))(\/|$)/
const OWNER_OPS = /^(plugin|bundle|terminal|dispatch|screens|herdr|schedule|machines|vault-plugin|vaultite-cloud|settings)\.|^ui\.command$/
const MARK = crypto.randomBytes(24).toString("base64url")
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate", "host", "forwarded", "x-real-ip"])
const OURS = /^(x-vaultite-|tailscale-|x-forwarded-|cf-)/

export function verifyConnect(key: string | null, token: unknown, handle: string | null, at = Math.floor(Date.now() / 1000)): ConnectClaims | null {
  if (!key || !handle || typeof token !== "string") return null
  const [body, sig] = token.split(".")
  if (!body || !sig) return null
  const want = crypto.createHmac("sha256", key).update(body).digest("base64url")
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  try {
    const c = ConnectClaims.safeParse(JSON.parse(Buffer.from(body, "base64url").toString())).data
    if (!c || c.handle !== handle || c.role !== "owner" || c.exp <= at || c.exp > at + 3600) return null
    return c
  } catch { return null }
}

export function ownerOnly(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x) } catch { return x } })
  if (OWNER_PATHS.test(`/${parts.join("/")}`)) return "this only answers on this Mac (turn on owner tools over Connect in Connections)"
  if (parts[0] === "api" && parts[1] === "ops" && OWNER_OPS.test(parts[2] ?? "")) return "this only runs on this Mac (turn on owner tools over Connect in Connections)"
  return ""
}

export function viaConnect(req: IncomingMessage) {
  const v = req.headers[CONNECT_HEADER]
  return typeof v === "string" && v.length === MARK.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(MARK))
}

export type ConnectOptions = { appPort: () => number; publicHost: () => string | null; ownerTools: () => boolean; from: (req: IncomingMessage) => string }

function headersFor(req: IncomingMessage, o: ConnectOptions) {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k) && !OURS.test(k) && k !== "origin") out[k] = v
  out.host = `127.0.0.1:${o.appPort()}`
  if (!o.ownerTools()) { out["x-forwarded-for"] = o.from(req) || "unknown"; out[CONNECT_HEADER] = MARK }
  return out
}

/** Why not (status, message), or null: a write's or a socket's Origin must be the handle's address (its cookie is Lax). */
function refused(req: IncomingMessage, o: ConnectOptions, pathname: string, socket: boolean): [number, string] | null {
  const origin = req.headers.origin
  if (origin !== undefined && (socket || !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "GET"))) {
    let host = ""
    try { host = new URL(String(origin)).host.toLowerCase() } catch {}
    if (!host || host !== o.publicHost()) return [403, "the page asking isn't this vault's"]
  }
  const why = o.ownerTools() ? "" : ownerOnly(pathname)
  return why ? [403, why] : null
}

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
