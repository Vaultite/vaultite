// A page's WebAuthn request as CTAP2 for a phone (hybrid.ts) and back, with a browser's part (RP ID check, client data,
// attestation "none"). Buffers travel as base64url, as in WebAuthn's JSON. No Electron here: tools/test_web.ts runs it.
import crypto from "node:crypto"
import { getPublicSuffix } from "tldts-experimental"
import { bytesAt, decode, decodeFirst, encode, mapAt, numAt, textAt, type Cbor, type CborMap } from "./cbor.ts"
import { CTAP, type RequestType } from "./hybrid.ts"

/** What the page's promise rejects with: a DOMException's name and message. */
export class WebAuthnError extends Error {
  name: string
  constructor(name: "NotAllowedError" | "SecurityError" | "InvalidStateError" | "NotSupportedError" | "TypeError" | "AbortError" | "OperationError", message: string) {
    super(message)
    this.name = name
  }
}

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url")
function bytes(v: unknown, what: string, max = 4096): Buffer {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]*$/.test(v)) throw new WebAuthnError("TypeError", `${what} isn't a buffer`)
  const b = Buffer.from(v, "base64url")
  if (b.length > max) throw new WebAuthnError("TypeError", `${what} is too long`)
  return b
}
const str = (v: unknown, what: string, max = 512) => {
  if (typeof v !== "string" || v.length > max) throw new WebAuthnError("TypeError", `${what} isn't text`)
  return v
}
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** The RP ID a page at `origin` may use: its host, or a registrable domain it's under (never a public suffix). */
export function rpIdFor(origin: string, asked: unknown): string {
  let u: URL
  try { u = new URL(origin) } catch { throw new WebAuthnError("SecurityError", "the page has no origin") }
  const host = u.hostname.toLowerCase()
  const secure = u.protocol === "https:" || (u.protocol === "http:" && (host === "localhost" || host.endsWith(".localhost")))
  if (!secure) throw new WebAuthnError("SecurityError", "passkeys need a secure page")
  if (/^[\d.]+$/.test(host) || host.includes(":")) throw new WebAuthnError("SecurityError", "an IP address can't have passkeys")
  if (asked === undefined || asked === null) return host
  const id = str(asked, "rp.id", 253).toLowerCase()
  if (id === host) return id
  if (host.endsWith(`.${id}`) && getPublicSuffix(id, { allowPrivateDomains: true }) !== id) return id
  throw new WebAuthnError("SecurityError", `${id} isn't this page's site`)
}

/** The client data the phone's signature covers, serialized as WebAuthn says (field order matters to some servers). */
export const clientData = (type: "webauthn.create" | "webauthn.get", challenge: Uint8Array, origin: string) =>
  `{"type":${JSON.stringify(type)},"challenge":${JSON.stringify(b64u(challenge))},"origin":${JSON.stringify(origin)},"crossOrigin":false}`

const descriptors = (list: unknown, what: string) => (Array.isArray(list) ? list : []).slice(0, 64).flatMap((c) => {
  const d = obj(c)
  return d.type === "public-key" ? [new Map<string, Cbor>([["id", bytes(d.id, `${what}.id`, 1023)], ["type", "public-key"]])] : []
})
const wantsUv = (uv: unknown) => uv !== "discouraged"

/** A request the page made, ready to go: the phone's command, what to check its answer against, and the QR's type. */
export type Prepared = { type: RequestType; command: Buffer; clientDataJSON: string; rpId: string; origin: string
  /** create: whether it asked for credProps, and what rk was. */
  credProps?: boolean; rk?: boolean; attestation?: string
  /** get: the one credential it allowed, when the phone leaves it out. */
  only?: Buffer }

export function prepareCreate(options: unknown, origin: string): Prepared {
  const o = obj(options), rp = obj(o.rp), user = obj(o.user), sel = obj(o.authenticatorSelection)
  const rpId = rpIdFor(origin, rp.id)
  if (sel.authenticatorAttachment === "platform") throw new WebAuthnError("NotAllowedError", "only a phone's passkeys are available here")
  const challenge = bytes(o.challenge, "challenge")
  if (challenge.length < 16) throw new WebAuthnError("TypeError", "the challenge is too short")
  const userId = bytes(user.id, "user.id", 64)
  if (!userId.length) throw new WebAuthnError("TypeError", "user.id is empty")
  const algs = (Array.isArray(o.pubKeyCredParams) ? o.pubKeyCredParams : []).map(obj)
    .filter((p) => p.type === "public-key" && Number.isInteger(p.alg)).map((p) => new Map<string, Cbor>([["alg", p.alg as number], ["type", "public-key"]]))
  if (!algs.length && Array.isArray(o.pubKeyCredParams) && o.pubKeyCredParams.length) throw new WebAuthnError("NotSupportedError", "no supported algorithm")
  if (!algs.length) algs.push(new Map<string, Cbor>([["alg", -7], ["type", "public-key"]]), new Map<string, Cbor>([["alg", -257], ["type", "public-key"]]))
  const rk = sel.residentKey === "required" || sel.residentKey === "preferred" || (sel.residentKey === undefined && sel.requireResidentKey === true)
  const clientDataJSON = clientData("webauthn.create", challenge, origin)
  const exclude = descriptors(o.excludeCredentials, "excludeCredentials")
  const options_ = new Map<string, Cbor>([["rk", rk || undefined], ["uv", wantsUv(sel.userVerification) || undefined]])
  const m = new Map<number, Cbor>([
    [1, crypto.createHash("sha256").update(clientDataJSON).digest()],
    [2, new Map<string, Cbor>([["id", rpId], ["name", typeof rp.name === "string" ? rp.name.slice(0, 256) : rpId]])],
    [3, new Map<string, Cbor>([["id", userId], ["name", str(user.name ?? "", "user.name", 256)], ["displayName", str(user.displayName ?? "", "user.displayName", 256)]])],
    [4, algs],
    [5, exclude.length ? exclude : undefined],
    [7, [...options_.values()].some((v) => v !== undefined) ? options_ : undefined],
  ])
  return { type: "mc", command: Buffer.concat([Buffer.from([CTAP.makeCredential]), encode(m)]), clientDataJSON, rpId, origin,
    credProps: obj(o.extensions).credProps === true, rk, attestation: typeof o.attestation === "string" ? o.attestation : "none" }
}

export function prepareGet(options: unknown, origin: string): Prepared {
  const o = obj(options)
  const rpId = rpIdFor(origin, o.rpId)
  const challenge = bytes(o.challenge, "challenge")
  if (challenge.length < 16) throw new WebAuthnError("TypeError", "the challenge is too short")
  const allow = descriptors(o.allowCredentials, "allowCredentials")
  const clientDataJSON = clientData("webauthn.get", challenge, origin)
  const m = new Map<number, Cbor>([
    [1, rpId],
    [2, crypto.createHash("sha256").update(clientDataJSON).digest()],
    [3, allow.length ? allow : undefined],
    [5, wantsUv(o.userVerification) ? new Map<string, Cbor>([["uv", true]]) : undefined],
  ])
  return { type: "ga", command: Buffer.concat([Buffer.from([CTAP.getAssertion]), encode(m)]), clientDataJSON, rpId, origin,
    only: allow.length === 1 ? allow[0].get("id") as Buffer : undefined }
}

/** The page's error for a CTAP2 status the phone answered. */
function failed(status: number): never {
  if (status === 0x19) throw new WebAuthnError("InvalidStateError", "this phone already has a passkey for this account")
  if (status === 0x2e) throw new WebAuthnError("NotAllowedError", "the phone has no passkey for this site")
  throw new WebAuthnError("NotAllowedError", `the phone said no (${status})`)
}

/** Its authenticator data: the RP ID's hash (checked), flags, and the new credential's id and key when there is one. */
function readAuthData(a: Uint8Array, rpId: string) {
  if (a.length < 37) throw new WebAuthnError("NotAllowedError", "the phone's answer was cut short")
  if (!crypto.timingSafeEqual(Buffer.from(a.subarray(0, 32)), crypto.createHash("sha256").update(rpId).digest())) throw new WebAuthnError("NotAllowedError", "the phone answered for another site")
  const flags = a[32]
  if (!(flags & 0x40)) return { flags }
  if (a.length < 55) throw new WebAuthnError("NotAllowedError", "the phone's answer was cut short")
  const n = Buffer.from(a).readUInt16BE(53), id = a.subarray(55, 55 + n)
  const key = decodeFirst(a, 55 + n)
  return { flags, credentialId: Buffer.from(id), cose: key.value }
}

/** A COSE key as SubjectPublicKeyInfo (what getPublicKey() gives), for EC2 P-256, Ed25519 and RSA; null otherwise. */
export function spki(cose: Cbor): Buffer | null {
  if (!(cose instanceof Map)) return null
  const kty = numAt(cose, 1), crv = numAt(cose, -1), x = bytesAt(cose, -2), y = bytesAt(cose, -3)
  let jwk: crypto.JsonWebKey | null = null
  if (kty === 2 && crv === 1 && x && y) jwk = { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) }
  else if (kty === 1 && crv === 6 && x) jwk = { kty: "OKP", crv: "Ed25519", x: b64u(x) }
  else if (kty === 3 && bytesAt(cose, -1) && bytesAt(cose, -2)) jwk = { kty: "RSA", n: b64u(bytesAt(cose, -1)!), e: b64u(bytesAt(cose, -2)!) }
  if (!jwk) return null
  try { return crypto.createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "der" }) } catch { return null }
}

/** What navigator.credentials.create() resolves with, as JSON (the page's script makes it a PublicKeyCredential). */
export function readCreate(answer: Uint8Array, p: Prepared) {
  if (!answer.length) throw new WebAuthnError("NotAllowedError", "the phone sent nothing")
  if (answer[0] !== 0) failed(answer[0])
  const m = decode(answer.subarray(1))
  const fmt = textAt(m, 1), authData = bytesAt(m, 2), attStmt = mapAt(m, 3)
  if (!fmt || !authData || !attStmt) throw new WebAuthnError("NotAllowedError", "the phone's answer is missing parts")
  const a = readAuthData(authData, p.rpId)
  if (!a.credentialId) throw new WebAuthnError("NotAllowedError", "the phone made no passkey")
  // (attestation the page didn't ask for is "none", as browsers send it)
  const keep = p.attestation === "direct" || p.attestation === "enterprise" || p.attestation === "indirect"
  const att = new Map<string, Cbor>([["fmt", keep ? fmt : "none"], ["attStmt", keep ? attStmt : new Map() as CborMap], ["authData", authData]])
  const key = spki(a.cose)
  return {
    id: b64u(a.credentialId), rawId: b64u(a.credentialId), type: "public-key", authenticatorAttachment: "cross-platform",
    response: { clientDataJSON: b64u(Buffer.from(p.clientDataJSON)), attestationObject: b64u(encode(att)), authenticatorData: b64u(authData),
      publicKey: key ? b64u(key) : null, publicKeyAlgorithm: numAt(a.cose, 3) ?? -7, transports: ["hybrid", "internal"] },
    clientExtensionResults: p.credProps ? { credProps: { rk: !!p.rk } } : {},
  }
}

/** What navigator.credentials.get() resolves with, as JSON. */
export function readGet(answer: Uint8Array, p: Prepared) {
  if (!answer.length) throw new WebAuthnError("NotAllowedError", "the phone sent nothing")
  if (answer[0] !== 0) failed(answer[0])
  const m = decode(answer.subarray(1))
  const authData = bytesAt(m, 2), signature = bytesAt(m, 3)
  const id = bytesAt(mapAt(m, 1) ?? new Map(), "id") ?? p.only
  if (!authData || !signature || !id) throw new WebAuthnError("NotAllowedError", "the phone's answer is missing parts")
  readAuthData(authData, p.rpId)
  const user = bytesAt(mapAt(m, 4) ?? new Map(), "id")
  return {
    id: b64u(id), rawId: b64u(id), type: "public-key", authenticatorAttachment: "cross-platform",
    response: { clientDataJSON: b64u(Buffer.from(p.clientDataJSON)), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: user ? b64u(user) : null },
    clientExtensionResults: {},
  }
}
