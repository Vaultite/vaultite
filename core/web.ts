// The web from the server: fetching public pages only (link previews, the clipper). Local and tailnet hosts are refused
// by name and again on what DNS answers at connect, so a route that fetches what it's asked can't look into the network.
import dns from "node:dns"
import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"
import zlib from "node:zlib"

/** A dotted IPv4 address as its four numbers, or null. */
function ipv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const n = m.slice(1).map(Number)
  return n.every((x) => x <= 255) ? n : null
}

/** An IPv6 address as its eight 16-bit groups ("::" expanded, a dotted IPv4 tail read, a zone "%en0" dropped), or null. */
function ipv6(s: string): number[] | null {
  s = s.replace(/%.*$/, "")
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (dotted) { // ::ffff:127.0.0.1 is ::ffff:7f00:1
    const v4 = ipv4(dotted[1])
    if (!v4) return null
    s = `${s.slice(0, dotted.index + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = s.split("::")
  if (halves.length > 2) return null
  const group = (h: string) => (h ? h.split(":") : []).map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN))
  const head = group(halves[0]), rest = halves.length === 2 ? group(halves[1]) : []
  if ([...head, ...rest].some(Number.isNaN)) return null
  if (halves.length === 1 ? head.length !== 8 : head.length + rest.length > 7) return null
  return [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest]
}

const inV4 = (n: number[], a: number, b: number, bits: number) => {
  const ip = ((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0
  const net = ((a << 24) | (b << 16)) >>> 0
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ip & mask) === (net & mask)
}
// Not on the public internet: "this network", private, the tailnet's CGNAT range, loopback, link-local, IETF and
// documentation ranges, benchmarking, multicast, reserved and broadcast.
const V4_BLOCKED: [number, number, number][] = [
  [0, 0, 8], [10, 0, 8], [100, 64, 10], [127, 0, 8], [169, 254, 16], [172, 16, 12], [192, 0, 24], [192, 168, 16],
  [198, 18, 15], [224, 0, 4], [240, 0, 4],
]
const V4_BLOCKED_24 = ["192.0.2", "198.51.100", "203.0.113"]

function blockedV4(n: number[]) {
  return V4_BLOCKED.some(([a, b, bits]) => inV4(n, a, b, bits)) || V4_BLOCKED_24.includes(n.slice(0, 3).join("."))
}

function blockedV6(g: number[]) {
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255]
  if (g.slice(0, 6).every((x) => x === 0)) return blockedV4(v4(g[6], g[7])) // ::, ::1, ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return blockedV4(v4(g[6], g[7])) // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(v4(g[6], g[7])) // NAT64
  if (g[0] === 0x2002) return blockedV4(v4(g[1], g[2])) // 6to4
  return (g[0] & 0xfe00) === 0xfc00 // unique local (the tailnet's fd7a:115c:a1e0::/48 among them)
    || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 // link-local, site-local
    || (g[0] & 0xff00) === 0xff00 // multicast
    || (g[0] === 0x2001 && g[1] === 0x0db8) // documentation
    || (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) // discard
}

/** Is this IP address (as DNS answers it) one the server must not fetch from? Anything it can't read is refused. */
export function blockedAddress(ip: string): boolean {
  const v4 = ipv4(ip)
  if (v4) return blockedV4(v4)
  const v6 = ip.includes(":") ? ipv6(ip) : null
  return v6 ? blockedV6(v6) : true
}

const LOCAL_NAMES = ["localhost", "local", "ts.net", "internal", "intranet", "lan", "home", "home.arpa", "corp", "localdomain"]

/** Whether the server must not fetch from this host: a non-public IP, or a local or tailnet name (`.local`, `.ts.net`,
 *  MagicDNS's one-word names). DNS answers are checked again at fetch (blockedAddress). */
export function blockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (!h) return true
  if (ipv4(h) || h.includes(":")) return blockedAddress(h)
  if (/^[\d.]+$/.test(h)) return true // a number that isn't a dotted address
  if (!h.includes(".")) return true
  return LOCAL_NAMES.some((s) => h === s || h.endsWith(`.${s}`))
}

/** A web address the server may fetch: http(s) only, no user or password, on a public host (by its name; its
 *  addresses are checked as it's fetched). The URL (without its #fragment), or why not. */
export function publicUrl(raw: string): URL | string {
  let u: URL
  try { u = new URL(raw) } catch { return "not a web address" }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "only http and https addresses"
  if (u.username || u.password) return "an address with a login"
  if (blockedHost(u.hostname)) return "a local address"
  u.hash = ""
  return u
}

/** dns.lookup that fails when any of the name's addresses isn't public. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, found) => {
    if (err) return callback(err, "", 0)
    if (!found.length || found.some((a) => blockedAddress(a.address))) {
      return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: "ENOTFOUND" }), "", 0)
    }
    if (options.all) (callback as unknown as (e: null, all: dns.LookupAddress[]) => void)(null, found)
    else callback(null, found[0].address, found[0].family)
  })
}

export const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

export type FetchOptions = {
  /** The most bytes of a body kept (decompressed); the rest isn't read. Default 1 MB, none with `to`. */
  max?: number
  /** For the whole thing, redirects included (ms). Default 5000. With `to`, how long the body may stop coming. */
  timeout?: number
  /** A file the body is written to as it comes (a download of any size), instead of `body`. */
  to?: string
  /** The body is read only when its Content-Type matches (default: HTML or XML); else it's empty. */
  types?: RegExp
  /** Default 5. */
  redirects?: number
  headers?: Record<string, string>
}
/** What fetchPublic got: the address it ended at, its status and type, and the body (empty when it wasn't 2xx or its
 *  type didn't match). `cut`: the body was longer than `max`. */
export type Fetched = { url: string; status: number; type: string; body: Buffer; cut: boolean; size: number }

type Once = { status: number; location?: string; type: string; body: Buffer; cut: boolean; size: number }
type OnceOptions = Required<Omit<FetchOptions, "timeout" | "redirects" | "to">> & { to?: string; heard: () => void }

/** GET one address (redirects not followed). */
function getOnce(u: URL, o: OnceOptions, signal: AbortSignal): Promise<Once> {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).get(u, {
      lookup: publicLookup, signal,
      headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "Accept-Language": "en", "Accept-Encoding": "gzip, deflate, br", ...o.headers },
    }, (res) => {
      const status = res.statusCode ?? 0
      const type = String(res.headers["content-type"] ?? "").toLowerCase()
      if (status < 200 || status >= 300 || !o.types.test(type)) {
        res.resume()
        return resolve({ status, location: res.headers.location, type, body: Buffer.alloc(0), cut: false, size: 0 })
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase()
      const stream = enc === "gzip" || enc === "x-gzip" ? res.pipe(zlib.createGunzip())
        : enc === "br" ? res.pipe(zlib.createBrotliDecompress())
          : enc === "deflate" ? res.pipe(zlib.createInflate()) : res
      const chunks: Buffer[] = []
      const file = o.to ? fs.createWriteStream(o.to) : null
      file?.on("error", (e) => { res.destroy(); reject(e) })
      let size = 0, done = false
      const finish = (cut: boolean) => {
        if (done) return
        done = true
        res.destroy()
        const out = { status, type, body: file ? Buffer.alloc(0) : Buffer.concat(chunks).subarray(0, o.max), cut, size: Math.min(size, o.max) }
        if (file) file.end(() => resolve(out))
        else resolve(out)
      }
      stream.on("data", (c: Buffer) => {
        o.heard()
        if (file) { if (!file.write(c)) { stream.pause(); file.once("drain", () => stream.resume()) } } else chunks.push(c)
        size += c.length
        if (size >= o.max) finish(true)
      })
      stream.on("end", () => finish(false))
      stream.on("error", (e) => (size ? finish(true) : reject(e)))
      res.on("error", (e) => (size ? finish(true) : reject(e)))
    })
    req.on("error", reject)
  })
}

/** GET a public page (publicUrl: else it throws, saying why), following redirects to public addresses too. Throws when
 *  it can't be reached (a name that isn't public fails as not found). */
export async function fetchPublic(raw: string | URL, options: FetchOptions = {}): Promise<Fetched> {
  const wait = options.timeout ?? 5000, stop = new AbortController()
  let timer = setTimeout(() => stop.abort(new Error("timed out")), wait)
  // (a download to a file goes on while its bytes keep coming)
  const heard = () => { if (options.to) { clearTimeout(timer); timer = setTimeout(() => stop.abort(new Error("timed out")), wait) } }
  const o: OnceOptions = { max: options.max ?? (options.to ? Infinity : 1024 * 1024), types: options.types ?? /html|xml/, headers: options.headers ?? {}, to: options.to, heard }
  try { return await follow(raw, o, stop.signal, options.redirects ?? 5) } finally { clearTimeout(timer) }
}

async function follow(raw: string | URL, o: OnceOptions, signal: AbortSignal, redirects: number): Promise<Fetched> {
  let u = publicUrl(String(raw))
  if (typeof u === "string") throw new Error(`can't fetch ${raw}: ${u}`)
  for (let hops = 0; hops <= redirects; hops++) {
    const r = await getOnce(u, o, signal)
    if (r.status >= 300 && r.status < 400 && r.location) {
      const next = publicUrl(new URL(r.location, u).href)
      if (typeof next === "string") throw new Error(`${u.href} redirects to ${r.location}: ${next}`)
      u = next
      continue
    }
    return { url: u.href, status: r.status, type: r.type, body: r.body, cut: r.cut, size: r.size }
  }
  throw new Error(`${raw}: too many redirects`)
}

/** A page's bytes as text, in the charset its header (`type`) or its <meta> names, else UTF-8. */
export function pageText(type: string, body: Buffer) {
  const named = /charset=["']?([\w-]+)/.exec(type)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1]
  try { return new TextDecoder(named ?? "utf-8").decode(body) } catch { return new TextDecoder().decode(body) }
}
