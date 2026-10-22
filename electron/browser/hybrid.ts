// FIDO's hybrid transport ("caBLE v2", Chromium's device/fido/cable), the computer's side: QR code, Bluetooth advert,
// tunnel, Noise handshake, one CTAP2 command. No Electron here (passkeys.ts is the feature): tools/test_web.ts runs it.
import crypto from "node:crypto"
import WebSocket from "ws"
import { decode, encode, type Cbor } from "./cbor.ts"

// ---------- the QR code ----------

/** Tunnel servers by the number a phone's advert names: Google's, Apple's. Above 255 a name is derived (`domainOf`). */
export const ASSIGNED = ["cable.ua5v.com", "cable.auth.com"]

/** Chromium's digits for binary in a QR code: each 7 bytes as a little-endian number in 17 digits (a short last chunk in
 *  fewer), so the code is numeric and the URL valid. */
export function base10(b: Uint8Array) {
  const WIDTH = [0, 3, 5, 8, 10, 13, 15, 17]
  let out = ""
  for (let i = 0; i < b.length; i += 7) {
    const chunk = b.subarray(i, i + 7)
    let v = 0n
    for (let j = chunk.length - 1; j >= 0; j--) v = (v << 8n) | BigInt(chunk[j])
    out += v.toString().padStart(WIDTH[chunk.length], "0")
  }
  return out
}

export function unbase10(s: string): Uint8Array {
  const LEN: Record<number, number> = { 3: 1, 5: 2, 8: 3, 10: 4, 13: 5, 15: 6, 17: 7 }
  if (!/^\d*$/.test(s)) throw new Error("not digits")
  const out: number[] = []
  for (let i = 0; i < s.length; i += 17) {
    const part = s.slice(i, i + 17), n = LEN[part.length]
    if (!n) throw new Error("a chunk of the wrong length")
    let v = BigInt(part)
    if (v >> BigInt(n * 8)) throw new Error("a chunk out of range")
    for (let j = 0; j < n; j++) { out.push(Number(v & 0xffn)); v >>= 8n }
  }
  return new Uint8Array(out)
}

/** What a QR code asks: "ga" (sign in) or "mc" (make a passkey). */
export type RequestType = "ga" | "mc"

/** The QR code's text: the computer's identity key (compressed), the secret, how many tunnel servers it knows, the time,
 *  that it can't be linked (the phone isn't remembered: each sign-in is a scan), and what's asked. */
export function qrText(o: { identity: Uint8Array; secret: Uint8Array; type: RequestType; now?: number }) {
  const m = new Map<number, Cbor>([
    [0, o.identity],
    [1, o.secret],
    [2, ASSIGNED.length],
    [3, Math.floor((o.now ?? Date.now()) / 1000)],
    [4, false],
    [5, o.type],
  ])
  return `FIDO:/${base10(encode(m))}`
}

export function parseQr(text: string) {
  const t = text.toUpperCase()
  if (!t.startsWith("FIDO:/") || t.length <= 6) throw new Error("not a hybrid QR code")
  const m = decode(unbase10(t.slice(6)))
  if (!(m instanceof Map)) throw new Error("not a hybrid QR code")
  return m
}

// ---------- keys from the secret ----------

const KEY = { eid: 1, tunnel: 2, psk: 3 } as const
/** HKDF-SHA256 of the QR secret, named by `type` (little-endian, as Chromium's info). */
export function derive(secret: Uint8Array, salt: Uint8Array, type: number, length: number) {
  const info = Buffer.alloc(4); info.writeUInt32LE(type)
  return Buffer.from(crypto.hkdfSync("sha256", secret, salt, info, length))
}
export const eidKey = (secret: Uint8Array) => derive(secret, Buffer.alloc(0), KEY.eid, 64)
export const tunnelId = (secret: Uint8Array) => derive(secret, Buffer.alloc(0), KEY.tunnel, 16)
/** The handshake's pre-shared key: the secret salted with the advert the phone sent. */
export const pskOf = (secret: Uint8Array, eid: Uint8Array) => derive(secret, eid, KEY.psk, 32)

// ---------- the phone's Bluetooth advert ----------

/** What a phone's advert says once decrypted: where its tunnel is and the nonce the handshake's key is salted with. */
export type Eid = { plain: Buffer; nonce: Buffer; routingId: Buffer; domain: number }

/** The advert's service data (20 bytes: one AES block and 4 bytes of HMAC), if it's for this QR code's key. */
export function readAdvert(advert: Uint8Array, key: Uint8Array): Eid | null {
  if (advert.length !== 20) return null
  const block = Buffer.from(advert.subarray(0, 16))
  const mac = crypto.createHmac("sha256", key.subarray(32, 64)).update(block).digest()
  if (!crypto.timingSafeEqual(mac.subarray(0, 4), Buffer.from(advert.subarray(16, 20)))) return null
  const d = crypto.createDecipheriv("aes-256-ecb", key.subarray(0, 32), null).setAutoPadding(false)
  const plain = Buffer.concat([d.update(block), d.final()])
  if (plain[0] !== 0) return null
  const eid = { plain, nonce: plain.subarray(1, 11), routingId: plain.subarray(11, 14), domain: plain.readUInt16LE(14) }
  return domainOf(eid.domain) ? eid : null
}

/** A phone's advert for `eid` (what the tests' phone sends). */
export function makeAdvert(eid: Uint8Array, key: Uint8Array) {
  const c = crypto.createCipheriv("aes-256-ecb", key.subarray(0, 32), null).setAutoPadding(false)
  const block = Buffer.concat([c.update(eid), c.final()])
  return Buffer.concat([block, crypto.createHmac("sha256", key.subarray(32, 64)).update(block).digest().subarray(0, 4)])
}

/** The tunnel server a phone named (null: none is). */
export function domainOf(id: number): string | null {
  if (id < 256) return ASSIGNED[id] ?? null
  const input = Buffer.from("caBLEv2 tunnel server domain\0\0\0", "latin1")
  input.writeUInt16LE(id, input.length - 3)
  let v = crypto.createHash("sha256").update(input).digest().readBigUInt64LE(0)
  const tld = [".com", ".org", ".net", ".info"][Number(v & 3n)]
  let out = "cable."
  for (v >>= 2n; v; v >>= 5n) out += "abcdefghijklmnopqrstuvwxyz234567"[Number(v & 31n)]
  return out + tld
}

export const connectUrl = (domain: string, routingId: Uint8Array, tunnel: Uint8Array) =>
  `wss://${domain}/cable/connect/${Buffer.from(routingId).toString("hex").toUpperCase()}/${Buffer.from(tunnel).toString("hex").toUpperCase()}`

// ---------- the handshake: Noise KNpsk0 over P-256, AES-GCM and SHA-256 ----------

const sha256 = (...parts: Uint8Array[]) => crypto.createHash("sha256").update(Buffer.concat(parts)).digest()
const hkdf = (salt: Uint8Array, ikm: Uint8Array, length: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.alloc(0), length))
/** An ECDH key on P-256: its public point uncompressed (65 bytes) and the shared x with another. */
export type P256 = crypto.ECDH
export const newKey = (): P256 => { const k = crypto.createECDH("prime256v1"); k.generateKeys(); return k }
export const publicOf = (k: P256, compressed = false) => k.getPublicKey(undefined, compressed ? "compressed" : "uncompressed")

/** Noise's symmetric state. Its cipher's nonce is the counter, big-endian, in the first 4 bytes (Chromium's). */
export class Noise {
  ck: Buffer
  h: Buffer
  private k: Buffer | null = null
  private n = 0
  constructor(kn: boolean) {
    const name = Buffer.alloc(32)
    name.write(kn ? "Noise_KNpsk0_P256_AESGCM_SHA256" : "Noise_NKpsk0_P256_AESGCM_SHA256", "latin1")
    this.ck = name
    this.h = Buffer.from(name)
  }
  mixHash(data: Uint8Array) { this.h = sha256(this.h, data) }
  mixKey(ikm: Uint8Array) { const o = hkdf(this.ck, ikm, 64); this.ck = o.subarray(0, 32); this.k = o.subarray(32, 64); this.n = 0 }
  mixKeyAndHash(ikm: Uint8Array) {
    const o = hkdf(this.ck, ikm, 96)
    this.ck = o.subarray(0, 32); this.mixHash(o.subarray(32, 64)); this.k = o.subarray(64, 96); this.n = 0
  }
  private nonce() { const b = Buffer.alloc(12); b.writeUInt32BE(this.n++, 0); return b }
  encryptAndHash(pt: Uint8Array) {
    if (!this.k) throw new Error("no key yet")
    const c = crypto.createCipheriv("aes-256-gcm", this.k, this.nonce()).setAAD(this.h)
    const ct = Buffer.concat([c.update(pt), c.final(), c.getAuthTag()])
    this.mixHash(ct)
    return ct
  }
  decryptAndHash(ct: Uint8Array) {
    if (!this.k || ct.length < 16) throw new Error("can't decrypt the handshake")
    const d = crypto.createDecipheriv("aes-256-gcm", this.k, this.nonce()).setAAD(this.h)
    d.setAuthTag(ct.subarray(ct.length - 16))
    const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
    this.mixHash(ct)
    return pt
  }
  /** The two traffic keys: the initiator writes with the first. */
  split() { const o = hkdf(this.ck, Buffer.alloc(0), 64); return [o.subarray(0, 32), o.subarray(32, 64)] as const }
}

/** The computer's first handshake message, and what reads the phone's answer into the session's keys. */
export function initiate(identity: P256, psk: Uint8Array) {
  const noise = new Noise(true)
  noise.mixHash(Buffer.from([1]))
  noise.mixHash(publicOf(identity))
  noise.mixKeyAndHash(psk)
  const eph = newKey(), ephPublic = publicOf(eph)
  noise.mixHash(ephPublic)
  noise.mixKey(ephPublic)
  const message = Buffer.concat([ephPublic, noise.encryptAndHash(Buffer.alloc(0))])
  const finish = (response: Uint8Array) => {
    if (response.length < 65 + 16) throw new Error("the phone's handshake was too short")
    const peer = response.subarray(0, 65)
    noise.mixHash(peer)
    noise.mixKey(peer)
    noise.mixKey(eph.computeSecret(peer))
    noise.mixKey(identity.computeSecret(peer))
    if (noise.decryptAndHash(response.subarray(65)).length) throw new Error("the phone's handshake had a payload")
    const [write, read] = noise.split()
    return new Crypter(read, write)
  }
  return { message, finish }
}

/** The phone's side of the handshake (what the tests' phone does). */
export function respond(identityPublic: Uint8Array, psk: Uint8Array, message: Uint8Array) {
  const noise = new Noise(true)
  noise.mixHash(Buffer.from([1]))
  noise.mixHash(identityPublic)
  noise.mixKeyAndHash(psk)
  const peer = message.subarray(0, 65)
  noise.mixHash(peer)
  noise.mixKey(peer)
  if (noise.decryptAndHash(message.subarray(65)).length) throw new Error("a payload in the handshake")
  const eph = newKey(), ephPublic = publicOf(eph)
  noise.mixHash(ephPublic)
  noise.mixKey(ephPublic)
  noise.mixKey(eph.computeSecret(peer))
  noise.mixKey(eph.computeSecret(identityPublic))
  const response = Buffer.concat([ephPublic, noise.encryptAndHash(Buffer.alloc(0))])
  const [read, write] = noise.split()
  return { response, crypter: new Crypter(read, write, "new") }
}

/** The tunnel's messages: padded to 32 bytes, AES-256-GCM, in the old nonce layout (LE counter first, AAD 2) or the new
 *  (BE counter last, no AAD): the first message read says which, and writing follows. */
export class Crypter {
  private r = 0
  private w = 0
  private readKey: Uint8Array
  private writeKey: Uint8Array
  private kind: "old" | "new"
  constructor(readKey: Uint8Array, writeKey: Uint8Array, kind: "old" | "new" = "old") {
    this.readKey = readKey
    this.writeKey = writeKey
    this.kind = kind
  }
  private nonce(n: number) {
    const b = Buffer.alloc(12)
    if (this.kind === "old") b.writeUInt32LE(n, 0); else b.writeUInt32BE(n, 8)
    return b
  }
  private aad() { return this.kind === "old" ? Buffer.from([2]) : Buffer.alloc(0) }
  encrypt(pt: Uint8Array) {
    const padded = Buffer.alloc((pt.length + 32) & ~31)
    padded.set(pt)
    padded[padded.length - 1] = padded.length - pt.length - 1
    const c = crypto.createCipheriv("aes-256-gcm", this.writeKey, this.nonce(this.w++)).setAAD(this.aad())
    return Buffer.concat([c.update(padded), c.final(), c.getAuthTag()])
  }
  decrypt(ct: Uint8Array): Buffer {
    if (ct.length < 16) throw new Error("a message too short")
    let pt: Buffer
    try {
      const d = crypto.createDecipheriv("aes-256-gcm", this.readKey, this.nonce(this.r)).setAAD(this.aad())
      d.setAuthTag(ct.subarray(ct.length - 16))
      pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
    } catch (e) {
      if (this.kind === "old" && this.r === 0) { this.kind = "new"; return this.decrypt(ct) }
      throw e
    }
    this.r++
    const pad = pt[pt.length - 1] + 1
    if (pad > pt.length) throw new Error("bad padding")
    return pt.subarray(0, pt.length - pad)
  }
}

// ---------- a request over the tunnel ----------

/** CTAP2's commands sent over it. */
export const CTAP = { makeCredential: 0x01, getAssertion: 0x02 } as const
/** A message's first byte: what it is. */
const FRAME = { shutdown: 0, ctap: 1, update: 2 } as const

export type Progress = "scan" | "connecting" | "phone"

/** Find the phone that scanned the QR code (`adverts`), meet it at its tunnel server, send it one CTAP2 command: its
 *  answer, the status byte first. `connect`: the tests' tunnel. */
export async function run(o: {
  secret: Uint8Array; identity: P256; command: Uint8Array
  adverts: (on: (advert: Uint8Array) => void) => () => void
  progress?: (p: Progress) => void
  signal: AbortSignal
  connect?: (url: string) => WebSocket
}): Promise<Buffer> {
  const key = eidKey(o.secret)
  o.progress?.("scan")
  const eid = await new Promise<Eid>((ok, fail) => {
    const stop = o.adverts((a) => { const e = readAdvert(a, key); if (e) { stop(); o.signal.removeEventListener("abort", abort); ok(e) } })
    const abort = () => { stop(); fail(o.signal.reason) }
    o.signal.addEventListener("abort", abort, { once: true })
  })
  o.progress?.("connecting")
  const url = connectUrl(domainOf(eid.domain)!, eid.routingId, tunnelId(o.secret))
  const ws = o.connect ? o.connect(url) : new WebSocket(url, "fido.cable", { handshakeTimeout: 20_000 })
  ws.binaryType = "nodebuffer"
  const inbox: Buffer[] = []
  let waiting: { ok: (b: Buffer) => void; fail: (e: unknown) => void } | null = null
  let ended: unknown = null
  const end = (e: unknown) => { ended ??= e; waiting?.fail(ended); waiting = null }
  ws.on("message", (data: Buffer) => { if (waiting) { const w = waiting; waiting = null; w.ok(data) } else inbox.push(data) })
  ws.on("close", () => end(new Error("the phone hung up")))
  ws.on("error", (e) => end(e))
  const abort = () => { end(o.signal.reason); ws.terminate() }
  o.signal.addEventListener("abort", abort, { once: true })
  const next = () => (inbox.length ? Promise.resolve(inbox.shift()!) : ended ? Promise.reject(ended) : new Promise<Buffer>((ok, fail) => { waiting = { ok, fail } }))
  try {
    await new Promise<void>((ok, fail) => {
      if (ws.readyState === WebSocket.OPEN) return ok()
      ws.once("open", () => ok())
      ws.once("error", fail)
      ws.once("close", () => fail(new Error("the tunnel server refused the connection")))
    })
    const hs = initiate(o.identity, pskOf(o.secret, eid.plain))
    ws.send(hs.message)
    const crypter = hs.finish(await next())
    // (its first message: a map with its getInfo, which a single command doesn't need)
    if (!(decode(crypter.decrypt(await next())) instanceof Map)) throw new Error("the phone's first message wasn't a map")
    o.progress?.("phone")
    ws.send(crypter.encrypt(Buffer.concat([Buffer.from([FRAME.ctap]), o.command])))
    for (;;) {
      const m = crypter.decrypt(await next())
      if (!m.length) continue
      if (m[0] === FRAME.ctap) {
        try { ws.send(crypter.encrypt(Buffer.from([FRAME.shutdown]))) } catch { /* gone */ }
        return m.subarray(1)
      }
      if (m[0] === FRAME.shutdown) throw new Error("the phone ended the request")
      // (an update: linking info, which isn't kept)
    }
  } finally {
    o.signal.removeEventListener("abort", abort)
    ws.close()
  }
}
