// node:crypto for the demo's server: the hashes it keys caches and ids on, and random bytes.
import { hmac } from "@noble/hashes/hmac.js"
import { md5, sha1 } from "@noble/hashes/legacy.js"
import { sha256, sha512 } from "@noble/hashes/sha2.js"
import { needsApp } from "./stub.ts"

const ALGS = { sha1, sha256, sha512, md5 }
type Alg = keyof typeof ALGS
type Hasher = { update(b: Uint8Array): void; digest(): Uint8Array }
const input = (d: unknown, e?: BufferEncoding) => (typeof d === "string" ? Buffer.from(d, e ?? "utf8") : (d as Uint8Array))
const output = (b: Uint8Array, e?: BufferEncoding) => (e ? Buffer.from(b).toString(e) : Buffer.from(b))

function digester(h: Hasher) {
  const out = {
    update(d: unknown, e?: BufferEncoding) { h.update(input(d, e)); return out },
    digest: (e?: BufferEncoding) => output(h.digest(), e),
  }
  return out
}
export const createHash = (alg: Alg) => digester(ALGS[alg].create())
export const createHmac = (alg: Alg, key: unknown) => digester(hmac.create(ALGS[alg], input(key)))
export const hash = (alg: Alg, data: unknown, e: BufferEncoding = "hex") => output(ALGS[alg](input(data)), e)
export const randomBytes = (n: number) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n)))
export const randomUUID = () => globalThis.crypto.randomUUID()
export const randomInt = (a: number, b?: number) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a)))
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
export const sign = needsApp, createPrivateKey = needsApp
export default { createHash, createHmac, hash, randomBytes, randomUUID, randomInt, timingSafeEqual, sign, createPrivateKey }
