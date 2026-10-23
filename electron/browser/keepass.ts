// The agents' KeePass file (agents.kdbx, the user's KeeShare export), read for logins.ts: which entries name a page's site
// and, only as the app fills them, an entry's secrets. Node only (no Electron), so its tests run without the app.
import { argon2dAsync, argon2idAsync } from "@noble/hashes/argon2.js"
import crypto from "node:crypto"
import { CryptoEngine, Credentials, Kdbx, KdbxError, ProtectedValue, type KdbxEntry, type KdbxGroup } from "kdbxweb"
import { getDomain } from "tldts-experimental"

// Argon2, which KDBX 4 files are keyed with: Electron's crypto has none, so noble's (plain JS), yielding as it goes so
// the app's main process never stalls.
CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const fn = type === 2 ? argon2idAsync : argon2dAsync
  const key = await fn(new Uint8Array(password), new Uint8Array(salt), { m: memory, t: iterations, p: parallelism, dkLen: length, version, asyncTick: 10 })
  return key.slice().buffer
})

/** The tag (KeePassXC's Tags field) that lets agents use an entry without asking the user each time. */
export const FREE_TAG = "agent-free"

/** An entry as logins.ts lists it: never a secret. */
export type Entry = { id: string; title: string; username: string; urls: string[]; free: boolean; expired: boolean; otp: boolean }
export type Otp = { key: Buffer; period: number; digits: number; algorithm: "sha1" | "sha256" | "sha512" }
export type Secrets = { username: string; password: string; otp: Otp | "steam" | null }
export type Database = { entries: Entry[]; secrets: (id: string) => Secrets | null }

const text = (v: unknown) => (v instanceof ProtectedValue ? v.getText() : typeof v === "string" ? v : "")
const fieldsOf = (e: KdbxEntry) => Object.fromEntries([...e.fields].map(([k, v]) => [k, text(v)]))

/** The file opened with its password: its entries (the recycle bin's left out). Errors say what's wrong, never more (no
 *  library text, which might quote the file). */
export async function openDatabase(data: Uint8Array, password: string): Promise<Database> {
  let db: Kdbx
  try {
    db = await Kdbx.load(new Uint8Array(data).buffer, new Credentials(ProtectedValue.fromString(password)))
  } catch (e) {
    const code = e instanceof KdbxError ? e.code : ""
    throw new Error(code === "InvalidKey" ? "the password doesn't open it" : code === "Unsupported" ? "it's a KeePass file this app can't read (a key file or a hardware key?)"
      : "it isn't a KeePass database (.kdbx), or it's damaged")
  }
  const bin = db.meta.recycleBinUuid?.id
  const found: KdbxEntry[] = []
  const walk = (g: KdbxGroup) => {
    if (bin && g.uuid.id === bin) return
    found.push(...g.entries)
    for (const sub of g.groups) walk(sub)
  }
  walk(db.getDefaultGroup())
  const byId = new Map(found.map((e) => [e.uuid.id, e]))
  const now = Date.now()
  return {
    entries: found.map((e) => {
      const f = fieldsOf(e)
      return {
        id: e.uuid.id, title: f.Title ?? "", username: f.UserName ?? "",
        urls: Object.entries(f).filter(([k, v]) => (k === "URL" || /^KP2A_URL(_\d+)?$/.test(k)) && v.trim()).map(([, v]) => v.trim()),
        free: e.tags.some((t) => t.trim().toLowerCase() === FREE_TAG),
        expired: !!e.times.expires && !!e.times.expiryTime && e.times.expiryTime.getTime() < now,
        otp: otpOf(f) !== null,
      }
    }),
    secrets: (id) => {
      const e = byId.get(id)
      if (!e) return null
      const f = fieldsOf(e)
      return { username: f.UserName ?? "", password: f.Password ?? "", otp: otpOf(f) }
    },
  }
}

// ---------- which site an entry is for: a password manager's strict matching ----------

type Rule = { scheme: string; host: string; port: string; wild: boolean }
const bare = (host: string) => host.toLowerCase().replace(/\.$/, "")
const isIp = (host: string) => /^[\d.]+$/.test(host) || host.startsWith("[")

/** An entry's address as a rule: no scheme is https; `*.` before a domain (one owned by someone, never a public suffix
 *  like co.uk or github.io) names it and every subdomain; else that host only, and www. under a domain itself. */
function ruleOf(given: string): Rule | null {
  let s = given.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  const wild = /^[a-z]+:\/\/\*\./i.test(s)
  let u: URL
  try { u = new URL(wild ? s.replace("*.", "") : s) } catch { return null }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  const host = bare(u.hostname)
  if (!host) return null
  if (wild) {
    const owned = isIp(host) ? null : getDomain(host, { allowPrivateDomains: true })
    if (!owned || (host !== owned && !host.endsWith(`.${owned}`))) return null
  }
  return { scheme: u.protocol.slice(0, -1), host, port: u.port, wild }
}

/** Whether a page at `page` is the site the entry's address `entryUrl` names. An https page takes an http entry of the
 *  same host (an upgrade), an http page only an http entry; the port must be the entry's (none: the default). */
export function matchesSite(entryUrl: string, page: string): boolean {
  const r = ruleOf(entryUrl)
  let u: URL
  try { u = new URL(page) } catch { return false }
  if (!r || (u.protocol !== "https:" && u.protocol !== "http:")) return false
  if (u.protocol === "http:" && r.scheme !== "http") return false
  if (u.port !== r.port) return false
  const host = bare(u.hostname)
  if (r.wild) return host === r.host || host.endsWith(`.${r.host}`)
  if (host === r.host) return true
  return !isIp(r.host) && getDomain(r.host, { allowPrivateDomains: true }) === r.host && host === `www.${r.host}`
}

/** The entries for a page: those one of whose addresses names its site. */
export const entriesFor = (db: Database, page: string) => db.entries.filter((e) => e.urls.some((u) => matchesSite(u, page)))

// ---------- one-time codes ----------

function base32(s: string): Buffer | null {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase()
  if (!clean || /[^A-Z2-7]/.test(clean)) return null
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c)
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
const ALGORITHMS: Record<string, Otp["algorithm"]> = { sha1: "sha1", "hmac-sha-1": "sha1", sha256: "sha256", "hmac-sha-256": "sha256", sha512: "sha512", "hmac-sha-512": "sha512" }
function made(key: Buffer | null, period: unknown, digits: unknown, algorithm: unknown): Otp | null {
  const p = Number(period || 30), d = Number(digits || 6), a = ALGORITHMS[String(algorithm || "sha1").toLowerCase()]
  return key?.length && p > 0 && d >= 6 && d <= 10 && a ? { key, period: p, digits: d, algorithm: a } : null
}

/** An entry's one-time code setup, from what KeePassXC (otp: an otpauth:// address, or KeeOtp's key=), its older fields
 *  (TOTP Seed and Settings) or KeePass (TimeOtp-*) keep; "steam" for Steam's, which aren't digits; null when none. */
export function otpOf(f: Record<string, string>): Otp | "steam" | null {
  const otp = (f.otp ?? "").trim()
  if (otp) {
    let q: URLSearchParams
    if (/^otpauth:\/\//i.test(otp)) {
      try { q = new URL(otp).searchParams } catch { return null }
      if ((q.get("encoder") ?? "").toLowerCase() === "steam" || /^otpauth:\/\/totp\/steam:/i.test(otp)) return "steam"
      return made(base32(q.get("secret") ?? ""), q.get("period"), q.get("digits"), q.get("algorithm"))
    }
    if (/(^|&)key=/.test(otp)) {
      q = new URLSearchParams(otp)
      return made(base32(q.get("key") ?? ""), q.get("step"), q.get("size"), q.get("otpHashMode"))
    }
    return made(base32(otp), 30, 6, "sha1")
  }
  if (f["TOTP Seed"]) {
    const [period, size] = (f["TOTP Settings"] ?? "30;6").split(";")
    return size === "S" ? "steam" : made(base32(f["TOTP Seed"]), period, size, "sha1")
  }
  const key = f["TimeOtp-Secret-Base32"] ? base32(f["TimeOtp-Secret-Base32"]) : f["TimeOtp-Secret-Hex"] ? Buffer.from(f["TimeOtp-Secret-Hex"].replace(/\s/g, ""), "hex")
    : f["TimeOtp-Secret-Base64"] ? Buffer.from(f["TimeOtp-Secret-Base64"], "base64") : f["TimeOtp-Secret"] ? Buffer.from(f["TimeOtp-Secret"], "utf8") : null
  return key ? made(key, f["TimeOtp-Period"], f["TimeOtp-Length"], f["TimeOtp-Algorithm"]) : null
}

/** The code for `now` (RFC 6238). */
export function totp(o: Otp, now = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / o.period)))
  const h = crypto.createHmac(o.algorithm, o.key).update(counter).digest()
  const at = h[h.length - 1] & 15
  const n = (h.readUInt32BE(at) & 0x7fffffff) % 10 ** o.digits
  return String(n).padStart(o.digits, "0")
}
