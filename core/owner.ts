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

/** The tailnet login of this machine's owner ("" if Tailscale isn't there or doesn't say), read once. */
let owner: Promise<string> | null = null
export function ownerLogin(): Promise<string> {
  owner ??= new Promise((resolve) => {
    execFile(TAILSCALE, ["status", "--json"], { timeout: 10000, maxBuffer: 16 << 20 }, (err, stdout) => {
      let login = ""
      try {
        const st = JSON.parse(stdout)
        login = String(st.User?.[String(st.Self?.UserID)]?.LoginName ?? "")
      } catch { /* not running */ }
      if (err || !login) owner = null // try again next time
      resolve(login.toLowerCase())
    })
  })
  return owner
}

/** This machine's names on the tailnet ("m1.tail1234.ts.net", "m1"), lowercase, read once: what Tailscale Serve asks for. */
let names: Promise<string[]> | null = null
export function tailnetNames(): Promise<string[]> {
  names ??= new Promise((resolve) => {
    execFile(TAILSCALE, ["status", "--json"], { timeout: 10000, maxBuffer: 16 << 20 }, (err, stdout) => {
      let out: string[] = []
      try {
        const self = JSON.parse(stdout).Self ?? {}
        out = [self.DNSName, ...(self.CertDomains ?? [])].filter((n): n is string => typeof n === "string" && !!n).map((n) => n.toLowerCase().replace(/\.$/, ""))
        out = [...new Set([...out, ...out.map((n) => n.split(".")[0])])]
      } catch { /* not running */ }
      if (err || !out.length) setTimeout(() => { names = null }, 60_000) // try again in a while
      resolve(out)
    })
  })
  return names
}

export type Access = { allowRemote?: boolean; allowUsers?: string[]; owner: string }

/** Requests from apps on the internet (MCP's public listener): never the owner, whatever their headers say. */
const internet = new WeakSet<IncomingMessage>()
export const fromInternet = (req: IncomingMessage) => { internet.add(req) }

/** Why this request may not have what `what` ("the terminal") hands out, or "" when it may. */
export function refusal(req: IncomingMessage, { allowRemote, allowUsers, owner }: Access, what = "this"): string {
  if (internet.has(req)) return `${what} only answers this machine's owner, not an app on the internet`
  const h = req.headers
  const host = String(h.host ?? "").toLowerCase()
  const origin = h.origin
  if (origin !== undefined) {
    let from = ""
    try { from = new URL(origin).host.toLowerCase() } catch { /* not a URL */ }
    if (from !== host) return "the page asking isn't this app"
  }
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
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "")
  if (!(name === "localhost" || name.endsWith(".localhost") || LOOPBACK.has(name) || name === os.hostname().toLowerCase())) {
    return `${what} doesn't answer for ${name || "no host"}`
  }
  return ""
}
