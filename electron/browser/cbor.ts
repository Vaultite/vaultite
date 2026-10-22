// CBOR as CTAP2 speaks it (RFC 8949, CTAP2's canonical form: definite lengths, map keys sorted by their encoded bytes,
// shortest first), for passkeys over a phone (hybrid.ts, webauthn.ts). No Electron here: tools/test_web.ts runs it.

export type Cbor = number | bigint | string | boolean | null | undefined | Uint8Array | Cbor[] | CborMap
export type CborMap = Map<number | string, Cbor>

const head = (major: number, n: number | bigint): Buffer => {
  const v = BigInt(n)
  if (v < 24n) return Buffer.from([(major << 5) | Number(v)])
  if (v < 0x100n) return Buffer.from([(major << 5) | 24, Number(v)])
  if (v < 0x10000n) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(Number(v), 1); return b }
  if (v < 0x100000000n) { const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(Number(v), 1); return b }
  const b = Buffer.alloc(9); b[0] = (major << 5) | 27; b.writeBigUInt64BE(v, 1); return b
}

export function encode(v: Cbor): Buffer {
  if (v === false) return Buffer.from([0xf4])
  if (v === true) return Buffer.from([0xf5])
  if (v === null) return Buffer.from([0xf6])
  if (v === undefined) return Buffer.from([0xf7])
  if (typeof v === "number" || typeof v === "bigint") {
    if (typeof v === "number" && !Number.isInteger(v)) throw new Error("CBOR: only integers")
    return BigInt(v) >= 0n ? head(0, v) : head(1, -1n - BigInt(v))
  }
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]) }
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), v])
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(encode)])
  if (v instanceof Map) {
    const pairs = [...v].filter(([, x]) => x !== undefined).map(([k, x]) => [encode(k), encode(x)] as const)
    pairs.sort(([a], [b]) => a.length - b.length || Buffer.compare(a, b))
    return Buffer.concat([head(5, pairs.length), ...pairs.flat()])
  }
  throw new Error("CBOR: can't encode that")
}

/** One item from the start of `b`: the item and where it ended. */
export function decodeFirst(b: Uint8Array, at = 0): { value: Cbor; end: number } {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  const need = (n: number) => { if (at + n > buf.length) throw new Error("CBOR: cut short") }
  const item = (): Cbor => {
    need(1)
    const ib = buf[at++], major = ib >> 5, info = ib & 31
    const arg = (): bigint => {
      if (info < 24) return BigInt(info)
      const n = [1, 2, 4, 8][info - 24]
      if (n === undefined) throw new Error("CBOR: indefinite lengths aren't CTAP2's")
      need(n)
      const v = n === 1 ? BigInt(buf[at]) : n === 2 ? BigInt(buf.readUInt16BE(at)) : n === 4 ? BigInt(buf.readUInt32BE(at)) : buf.readBigUInt64BE(at)
      at += n
      return v
    }
    const small = (v: bigint) => (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v)
    if (major === 0) return small(arg())
    if (major === 1) return small(-1n - arg())
    if (major === 2 || major === 3) {
      const n = Number(arg()); need(n)
      const s = buf.subarray(at, at + n); at += n
      return major === 2 ? new Uint8Array(s) : s.toString("utf8")
    }
    if (major === 4) { const n = Number(arg()); const out: Cbor[] = []; for (let i = 0; i < n; i++) out.push(item()); return out }
    if (major === 5) {
      const n = Number(arg()), m: CborMap = new Map()
      for (let i = 0; i < n; i++) { const k = item(); if (typeof k !== "number" && typeof k !== "string") throw new Error("CBOR: a map key that isn't a number or text"); m.set(k, item()) }
      return m
    }
    if (major === 6) { arg(); return item() } // (a tag: its content)
    if (info === 20) return false
    if (info === 21) return true
    if (info === 22) return null
    if (info === 23) return undefined
    if (info === 25) { need(2); const h = buf.readUInt16BE(at); at += 2; return half(h) }
    if (info === 26) { need(4); const f = buf.readFloatBE(at); at += 4; return f }
    if (info === 27) { need(8); const f = buf.readDoubleBE(at); at += 8; return f }
    throw new Error("CBOR: an unknown simple value")
  }
  const value = item()
  return { value, end: at }
}

export function decode(b: Uint8Array): Cbor {
  const { value, end } = decodeFirst(b)
  if (end !== b.length) throw new Error("CBOR: bytes after the item")
  return value
}

function half(h: number) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024)
}

/** A map's value, typed (undefined: missing or another type). */
export const bytesAt = (m: Cbor, k: number | string) => { const v = m instanceof Map ? m.get(k) : undefined; return v instanceof Uint8Array ? v : undefined }
export const textAt = (m: Cbor, k: number | string) => { const v = m instanceof Map ? m.get(k) : undefined; return typeof v === "string" ? v : undefined }
export const numAt = (m: Cbor, k: number | string) => { const v = m instanceof Map ? m.get(k) : undefined; return typeof v === "number" ? v : undefined }
export const mapAt = (m: Cbor, k: number | string) => { const v = m instanceof Map ? m.get(k) : undefined; return v instanceof Map ? v : undefined }
