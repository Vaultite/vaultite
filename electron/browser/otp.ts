import crypto from "node:crypto"

export type Otp = { key: Uint8Array; period: number; digits: number; algorithm: "sha1" | "sha256" | "sha512" }

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
