// A phone's network in front of a server: a link with its round trip and bandwidth (bytes counted there), then a TLS
// proxy speaking HTTP/2 that adds a proxy's headers, as Tailscale Serve does (so answers are compressed, with ETags).
import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import http2 from "node:http2"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import tls from "node:tls"
import { portOf } from "../../core/listening.ts"

export type Profile = { name: string; rttMs: number; downKbps: number; upKbps: number }
export const PROFILES: Record<string, Profile> = {
  cellular: { name: "cellular", rttMs: 150, downKbps: 8_000, upKbps: 2_000 },
  tailnet: { name: "tailnet", rttMs: 40, downKbps: 50_000, upKbps: 20_000 },
}

class Link {
  free = 0
  bytes = 0
  kbps: number; delayMs: number
  constructor(kbps: number, delayMs: number) { this.kbps = kbps; this.delayMs = delayMs }
  release(n: number) {
    this.bytes += n
    const now = performance.now()
    const start = Math.max(now, this.free)
    this.free = start + (n * 8) / this.kbps // (kbit/s is bits per ms)
    return this.free + this.delayMs - now
  }
}

function carry(from: net.Socket, to: net.Socket, link: Link, count: (n: number) => void) {
  let last = Promise.resolve()
  from.on("data", (chunk: Buffer) => {
    count(chunk.length)
    const ms = link.release(chunk.length)
    const at = new Promise<void>((r) => setTimeout(r, ms))
    last = Promise.all([last, at]).then(() => { if (!to.destroyed) to.write(chunk) })
  })
  from.on("end", () => { void last.then(() => to.end()) })
  from.on("error", () => to.destroy())
  from.on("close", () => { void last.then(() => to.destroy()) })
}

/** A self-signed certificate for localhost, and its key's SPKI hash (Chrome's --ignore-certificate-errors-spki-list,
 *  which takes it as valid: with a certificate error Chrome caches nothing, and a warm load would measure a cold one). */
function certificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-netem-"))
  const key = path.join(dir, "key.pem"), cert = path.join(dir, "cert.pem")
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", cert,
    "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" })
  const pem = { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
  fs.rmSync(dir, { recursive: true, force: true })
  const spki = new crypto.X509Certificate(pem.cert).publicKey.export({ type: "spki", format: "der" })
  return { ...pem, spki: crypto.createHash("sha256").update(spki).digest("base64") }
}

const HOP = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "http2-settings", "te", "host"])
const forwarded = (h: http.IncomingHttpHeaders | http2.IncomingHttpHeaders, host: string) => {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(h)) if (!k.startsWith(":") && !HOP.has(k) && v !== undefined) out[k] = v as string | string[]
  return { ...out, host, "x-forwarded-for": "100.64.0.2", "x-forwarded-proto": "https" }
}

export type Netem = { url: string; spki: string; up: Link; down: Link; set(p: Profile): void; close(): Promise<void>
  retarget(target: string): void
  h1Bytes(): number
  dropSockets(): void }

export async function netem(target: string, profile: Profile): Promise<Netem> {
  let t = new URL(target)
  const { key, cert, spki } = certificate()
  let agent = new http.Agent({ keepAlive: true, maxSockets: 64 })
  const toServer = (method: string, url: string, headers: Record<string, string | string[]>) =>
    http.request({ host: t.hostname, port: t.port, method, path: url, headers, agent })

  // HTTP/2 from the browser, HTTP/1.1 to the server (as Tailscale Serve's Go proxy does)
  const h2 = http2.createServer()
  h2.on("stream", (stream, headers) => {
    const req = toServer(String(headers[":method"]), String(headers[":path"]), forwarded(headers, String(headers[":authority"] ?? "")))
    req.on("response", (res) => {
      const out: Record<string, string | string[]> = { ":status": String(res.statusCode) }
      for (const [k, v] of Object.entries(res.headers)) if (!HOP.has(k) && v !== undefined) out[k] = v
      if (stream.destroyed) return res.destroy()
      stream.respond(out)
      res.pipe(stream)
    })
    req.on("error", () => { if (!stream.destroyed) stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR) })
    stream.on("close", () => req.destroy())
    stream.pipe(req)
  })
  h2.on("sessionError", () => {})
  const h1 = http.createServer((req, res) => {
    const up = toServer(req.method ?? "GET", req.url ?? "/", forwarded(req.headers, req.headers.host ?? ""))
    up.on("response", (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res) })
    up.on("error", () => res.destroy())
    req.pipe(up)
  })
  h1.on("upgrade", (req, socket, head) => {
    const up = net.connect(Number(t.port), t.hostname, () => {
      const h = forwarded(req.headers, req.headers.host ?? "")
      const lines = [`${req.method} ${req.url} HTTP/1.1`, "Connection: Upgrade", `Upgrade: ${req.headers.upgrade}`,
        ...Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}`))]
      up.write(lines.join("\r\n") + "\r\n\r\n")
      if (head.length) up.write(head)
      up.pipe(socket).pipe(up)
    })
    up.on("error", () => socket.destroy())
    socket.on("error", () => up.destroy())
  })
  const alpn = new Map<number, string>()
  const secure = tls.createServer({ key, cert, ALPNProtocols: ["h2", "http/1.1"] }, (s) => {
    alpn.set(s.remotePort ?? 0, String(s.alpnProtocol))
    if (s.alpnProtocol === "h2") h2.emit("connection", s)
    else h1.emit("connection", s)
  })
  await new Promise<void>((r) => secure.listen(0, "127.0.0.1", r))
  const tlsPort = portOf(secure)

  const up = new Link(profile.upKbps, profile.rttMs / 2), down = new Link(profile.downKbps, profile.rttMs / 2)
  const sockets = new Set<net.Socket>()
  const conns: { port: number; bytes: number }[] = []
  const relay = net.createServer((client) => {
    client.setNoDelay(true)
    const server = net.connect(tlsPort, "127.0.0.1")
    server.setNoDelay(true)
    const c = { port: 0, bytes: 0 }
    conns.push(c)
    server.on("connect", () => { c.port = server.localPort ?? 0 })
    sockets.add(client).add(server)
    client.on("close", () => sockets.delete(client))
    server.on("close", () => sockets.delete(server))
    const count = (n: number) => { c.bytes += n }
    carry(client, server, up, count)
    carry(server, client, down, count)
  })
  await new Promise<void>((r) => relay.listen(0, "127.0.0.1", r))
  const port = portOf(relay)
  return {
    url: `https://localhost:${port}/`, spki, up, down,
    h1Bytes: () => conns.filter((c) => alpn.get(c.port) === "http/1.1").reduce((a, c) => a + c.bytes, 0),
    dropSockets() { for (const s of sockets) if (alpn.get((s as net.Socket).localPort ?? -1) === "http/1.1") s.destroy() },
    retarget(target) { t = new URL(target); agent.destroy(); agent = new http.Agent({ keepAlive: true, maxSockets: 64 }) },
    set(p) { up.kbps = p.upKbps; down.kbps = p.downKbps; up.delayMs = down.delayMs = p.rttMs / 2 },
    async close() {
      for (const s of sockets) s.destroy()
      agent.destroy()
      await Promise.all([relay, secure, h1].map((s) => new Promise((r) => s.close(() => r(null)))))
      h2.close()
    },
  }
}
