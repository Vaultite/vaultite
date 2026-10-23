// The user's passkeys, approving agents' logins (logins.ts): a registration read and an assertion verified by WebAuthn's
// rules, in the app that fills (never the server, which only passes them on). Node only, so its tests run without the app.
import crypto from "node:crypto"
import { bytesAt, decode } from "./cbor.ts"
import { spki } from "./webauthn.ts"

/** A passkey the user registered: its site (rpId) and the page's origin it was made on, its public key (SPKI, base64). */
export type Passkey = { id: string; rpId: string; origin: string; key: string; counter: number; name: string; added: number }
export type Created = { clientDataJSON: string; attestationObject: string }
export type Asserted = { id: string; clientDataJSON: string; authenticatorData: string; signature: string }

const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest()
const bytes = (s: unknown) => Buffer.from(typeof s === "string" ? s : "", "base64url")
/** User present, user verified (Face ID, Touch ID, a PIN), a credential attested. */
const UP = 0x01, UV = 0x04, AT = 0x40

/** The page's client data: of this ceremony, for this challenge, from an https page; its origin. */
function clientOf(json: Buffer, type: string, challenge: Buffer) {
  let c: { type?: unknown; challenge?: unknown; origin?: unknown }
  try { c = JSON.parse(json.toString("utf8")) } catch { throw new Error("its client data doesn't read") }
  if (c.type !== type) throw new Error("it's another kind of answer")
  const got = bytes(c.challenge)
  if (got.length !== challenge.length || !crypto.timingSafeEqual(got, challenge)) throw new Error("it answers another request (an old one?)")
  let u: URL
  try { u = new URL(String(c.origin)) } catch { throw new Error("it names no page") }
  if (u.protocol !== "https:") throw new Error("it wasn't made on an https page")
  return u
}

/** authenticatorData: its site's hash, flags and counter; the user must have been there and verified. */
function dataOf(a: Buffer, rpId: string) {
  if (a.length < 37) throw new Error("its authenticator data is cut short")
  if (!sha(Buffer.from(rpId)).equals(a.subarray(0, 32))) throw new Error("it's for another site")
  const flags = a[32]
  if (!(flags & UP) || !(flags & UV)) throw new Error("the user wasn't verified (Face ID, Touch ID or the device's code)")
  return { flags, counter: a.readUInt32BE(33) }
}

/** A new passkey from navigator.credentials.create()'s answer to `challenge`. Its attestation isn't checked (synced
 *  passkeys have none): who may register is decided before (logins.ts: a code from the app, then Touch ID). */
export function register(given: Created, challenge: Buffer, name: string): Passkey {
  const origin = clientOf(bytes(given.clientDataJSON), "webauthn.create", challenge)
  const att = decode(bytes(given.attestationObject))
  const a = bytesAt(att, "authData")
  if (!a) throw new Error("its attestation has no authenticator data")
  const ad = Buffer.from(a), { flags, counter } = dataOf(ad, origin.hostname)
  if (!(flags & AT) || ad.length < 55) throw new Error("it holds no new passkey")
  const n = ad.readUInt16BE(53), id = ad.subarray(55, 55 + n)
  const key = spki(decode(ad.subarray(55 + n)))
  if (!id.length || !key) throw new Error("its key is of a kind this app can't check")
  return { id: id.toString("base64url"), rpId: origin.hostname, origin: origin.origin, key: key.toString("base64"), counter, name: name.slice(0, 60), added: Date.now() }
}

/** navigator.credentials.get()'s answer to `challenge`, verified against the registered passkeys: which one, and its
 *  counter now (a passkey that counts must count up: one going back is a copy). */
export function verify(given: Asserted, keys: Passkey[], challenge: Buffer): { passkey: Passkey; counter: number } {
  const passkey = keys.find((k) => k.id === given.id)
  if (!passkey) throw new Error("it isn't a passkey set up to approve agents' logins")
  const cd = bytes(given.clientDataJSON)
  const origin = clientOf(cd, "webauthn.get", challenge)
  if (origin.origin !== passkey.origin) throw new Error("it comes from another page than the passkey's")
  const ad = bytes(given.authenticatorData), { counter } = dataOf(ad, passkey.rpId)
  if ((counter || passkey.counter) && counter <= passkey.counter) throw new Error("its counter went back: a copied passkey, or a replay")
  const key = crypto.createPublicKey({ key: Buffer.from(passkey.key, "base64"), format: "der", type: "spki" })
  const data = Buffer.concat([ad, sha(cd)]), sig = bytes(given.signature)
  const ok = key.asymmetricKeyType === "ed25519" ? crypto.verify(null, data, key, sig)
    : key.asymmetricKeyType === "ec" ? crypto.verify("sha256", data, { key, dsaEncoding: "der" }, sig) : crypto.verify("sha256", data, key, sig)
  if (!ok) throw new Error("its signature isn't the passkey's")
  return { passkey, counter }
}
