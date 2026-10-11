// Only the owner may reach this machine's shell or screen: from loopback with no proxy headers, or through Tailscale Serve
// whose Tailscale-User-Login (Serve strips client-sent ones; loopback required so none is forged) is the owner's.
import { execFile } from "node:child_process"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip"]

const TAILSCALE = ["/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale", "/usr/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale"].find((p) => fs.existsSync(p)) ?? "tailscale"

/** `tailscale status --json`, read once (again a minute after it didn't answer). */
let status: Promise<{ Self?: { UserID?: unknown; DNSName?: unknown; CertDomains?: unknown[] }; User?: Record<string, { LoginName?: unknown }> } | null> | null = null
function tailscale() {
  status ??= new Promise((resolve) => {
    execFile(TAILSCALE, ["status", "--json"], { timeout: 10000, maxBuffer: 16 << 20 }, (err, stdout) => {
      let st = null
      try { st = err ? null : JSON.parse(stdout) } catch { /* not running */ }
      if (!st?.Self) setTimeout(() => { status = null }, 60_000)
      resolve(st?.Self ? st : null)
    })
  })
  return status
}

/** The tailnet login of this machine's owner ("" if Tailscale isn't there or doesn't say). */
export async function ownerLogin(): Promise<string> {
  const st = await tailscale()
  return String(st?.User?.[String(st.Self?.UserID)]?.LoginName ?? "").toLowerCase()
}

/** This machine's names on the tailnet ("m1.tail1234.ts.net", "m1"), lowercase: what Tailscale Serve asks for. */
export async function tailnetNames(): Promise<string[]> {
  const self = (await tailscale())?.Self ?? {}
  const out = [self.DNSName, ...(self.CertDomains ?? [])].filter((n): n is string => typeof n === "string" && !!n).map((n) => n.toLowerCase().replace(/\.$/, ""))
  return [...new Set([...out, ...out.map((n) => n.split(".")[0])])]
}

/** A Host header's name, without its port or an IPv6 address's brackets. */
export const hostName = (host: unknown) => String(host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "")

/** The host of the request's Origin header: "" when it has none or it isn't a URL ("null": a sandboxed frame). */
export function originHost(req: IncomingMessage) {
  try { return new URL(String(req.headers.origin ?? "")).host.toLowerCase() } catch { return "" }
}

/** Asked from another machine, or through a proxy (Tailscale Serve connects from loopback too, but says so). */
export function overNetwork(req: IncomingMessage) {
  const h = req.headers
  return !LOOPBACK.has(req.socket.remoteAddress ?? "") || PROXY_HEADERS.some((k) => k in h) || Object.keys(h).some((k) => k.startsWith("tailscale-"))
}

/** A local name for this machine: localhost, a loopback address or its own host name. */
const localName = (name: string) => name === "localhost" || name.endsWith(".localhost") || LOOPBACK.has(name) || name === os.hostname().toLowerCase()

/** Asked from this machine itself: loopback, no proxy, a local host name, from this app's own page. */
export const fromThisMachine = (req: IncomingMessage) =>
  !overNetwork(req) && localName(hostName(req.headers.host)) && originHost(req) === String(req.headers.host ?? "").toLowerCase()

export type Access = { allowRemote?: boolean; allowUsers?: string[]; owner: string }

/** Requests from apps on the internet (MCP's public listener): never the owner, whatever their headers say. */
const internet = new WeakSet<IncomingMessage>()
export const fromInternet = (req: IncomingMessage) => { internet.add(req) }
/** Set by Connect (plugins/core/mcp/connect.ts) on what it hands the app while the owner's tools are off over it. */
export const CONNECT_HEADER = "x-vaultite-connect"

/** Why this request may not have what `what` ("the terminal") hands out, or "" when it may. */
export function refusal(req: IncomingMessage, { allowRemote, allowUsers, owner }: Access, what = "this"): string {
  if (internet.has(req)) return `${what} only answers this machine's owner, not an app on the internet`
  if (CONNECT_HEADER in req.headers) return `${what} is off over Vaultite Connect (turn on owner tools in Connections on this Mac)`
  const h = req.headers
  if (h.origin !== undefined && originHost(req) !== String(h.host ?? "").toLowerCase()) return "the page asking isn't this app"
  if (allowRemote) return ""
  const local = LOOPBACK.has(req.socket.remoteAddress ?? "")
  const login = h["tailscale-user-login"]
  if (typeof login === "string" && login) {
    // Through Tailscale Serve (it runs on this machine, so it connects from loopback).
    const who = login.toLowerCase()
    const users = (allowUsers ?? []).map((u) => String(u).toLowerCase())
    if (local && ((owner && who === owner) || users.includes(who))) return ""
    return `${what} only answers this machine's owner on the tailnet, not ${login} (add them to allowUsers in its settings)`
  }
  if (PROXY_HEADERS.some((k) => k in h) || Object.keys(h).some((k) => k.startsWith("tailscale-"))) {
    return `${what} only answers this machine, or its owner through Tailscale Serve (this came through another proxy, a tagged device or Funnel)`
  }
  if (!local) return `${what} only answers this machine`
  const name = hostName(h.host)
  return localName(name) ? "" : `${what} doesn't answer for ${name || "no host"}`
}

/** refusal() with the owner looked up (only when it matters: a tailnet login asking, `allowRemote` off). */
export async function ownerRefusal(req: IncomingMessage, access: Omit<Access, "owner">, what = "this") {
  const needs = typeof req.headers["tailscale-user-login"] === "string" && !access.allowRemote
  return refusal(req, { ...access, owner: needs ? await ownerLogin() : "" }, what)
}
