// A login sealed for another Mac's app (Machines): X25519 to that app's key, then AES-GCM, so the servers passing it on
// read nothing. Node only, so its tests run without the app.
import crypto from "node:crypto"

const INFO = Buffer.from("vaultite sealed login v1")
const b64 = (b: Buffer) => b.toString("base64url")
const bytes = (s: unknown) => Buffer.from(typeof s === "string" ? s : "", "base64url")
const pubOf = (der: Buffer) => crypto.createPublicKey({ key: der, format: "der", type: "spki" })

/** A new key pair: the public key to hand out, the private one to keep (both DER, base64url). */
export function newKeys(): { pub: string; priv: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519")
  return { pub: b64(publicKey.export({ format: "der", type: "spki" })), priv: b64(privateKey.export({ format: "der", type: "pkcs8" })) }
}

/** The AES key for a sealed box: both public keys salt it, so it's for this sender's box to this key only. */
function keyFor(secret: Buffer, from: Buffer, to: Buffer) {
  return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.concat([from, to]), INFO, 32))
}

/** `data` sealed for the holder of `pub`, bound to `aad` (what it's for: opening it for anything else fails). */
export function seal(pub: string, data: unknown, aad: string): string {
  const to = bytes(pub)
  const them = pubOf(to)
  if (them.asymmetricKeyType !== "x25519") throw new Error("that isn't a key to seal for")
  const mine = crypto.generateKeyPairSync("x25519")
  const from = mine.publicKey.export({ format: "der", type: "spki" })
  const key = keyFor(crypto.diffieHellman({ privateKey: mine.privateKey, publicKey: them }), from, to)
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()])
  return JSON.stringify({ v: 1, from: b64(from), iv: b64(iv), ct: b64(ct), tag: b64(c.getAuthTag()) })
}

/** What `seal` sealed for this key pair's public key, for `aad`: throws for anything else (another key, changed, not for
 *  `aad`). `from`: the sender's one-off key, which no box shares. */
export function open(keys: { pub: string; priv: string }, sealed: string, aad: string): { data: unknown; from: string } {
  let box: { v?: unknown; from?: unknown; iv?: unknown; ct?: unknown; tag?: unknown }
  try { box = JSON.parse(sealed) } catch { throw new Error("it isn't a sealed login") }
  if (box?.v !== 1) throw new Error("it isn't a sealed login")
  const from = bytes(box.from), iv = bytes(box.iv), tag = bytes(box.tag)
  if (iv.length !== 12 || tag.length !== 16) throw new Error("it isn't a sealed login")
  let them: crypto.KeyObject
  try { them = pubOf(from) } catch { throw new Error("it isn't a sealed login") }
  if (them.asymmetricKeyType !== "x25519") throw new Error("it isn't a sealed login")
  const priv = crypto.createPrivateKey({ key: bytes(keys.priv), format: "der", type: "pkcs8" })
  const key = keyFor(crypto.diffieHellman({ privateKey: priv, publicKey: them }), from, bytes(keys.pub))
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad)).setAuthTag(tag)
  let text: string
  try { text = Buffer.concat([d.update(bytes(box.ct)), d.final()]).toString("utf8") } catch { throw new Error("it wasn't sealed for this Mac, or for this") }
  return { data: JSON.parse(text), from: String(box.from) }
}
