// Chrome's extension packages: a CRX (a signed header, then a zip) checked against the id it was asked for, and the zip
// unpacked with node:zlib, so no dependency is added for it.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"

/** An extension's id from its public key (DER): the first 16 bytes of its SHA-256, each nibble a letter a-p. */
export function idOfKey(key: Buffer) {
  return [...crypto.createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("")
}

/** The fields of a protobuf message: number → raw values (only length-delimited ones are kept). */
function fields(buf: Buffer) {
  const out = new Map<number, Buffer[]>()
  let i = 0
  const varint = () => {
    let n = 0, shift = 0, b = 0
    do { b = buf[i++]; n += (b & 0x7f) * 2 ** shift; shift += 7 } while (b & 0x80 && i < buf.length)
    return n
  }
  while (i < buf.length) {
    const tag = varint(), field = Math.floor(tag / 8), type = tag & 7
    if (type === 0) varint()
    else if (type === 1) i += 8
    else if (type === 5) i += 4
    else if (type === 2) { const n = varint(); out.set(field, [...(out.get(field) ?? []), buf.subarray(i, i + n)]); i += n }
    else throw new Error("not a CRX header")
  }
  return out
}

/** A CRX's zip and its public key, once its signature by the key behind `id` is checked (CRX3, or the older CRX2);
 *  without an id (a file the user picked), the one the package names. */
export function openCrx(crx: Buffer, want?: string): { zip: Buffer; key: Buffer } {
  if (crx.length < 16 || crx.toString("latin1", 0, 4) !== "Cr24") throw new Error("not a Chrome extension package")
  const version = crx.readUInt32LE(4)
  if (version === 2) {
    const keyLen = crx.readUInt32LE(8), sigLen = crx.readUInt32LE(12)
    const key = crx.subarray(16, 16 + keyLen), sig = crx.subarray(16 + keyLen, 16 + keyLen + sigLen), zip = crx.subarray(16 + keyLen + sigLen)
    if (want && idOfKey(key) !== want) throw new Error("the package isn't that extension")
    if (!crypto.verify("sha1", zip, { key, format: "der", type: "spki" }, sig)) throw new Error("the package's signature is wrong")
    return { zip, key }
  }
  if (version !== 3) throw new Error(`a package of an unknown kind (CRX${version})`)
  const headerLen = crx.readUInt32LE(8), header = crx.subarray(12, 12 + headerLen), zip = crx.subarray(12 + headerLen)
  const f = fields(header)
  const signed = f.get(10000)?.[0] ?? Buffer.alloc(0)
  const named = fields(signed).get(1)?.[0]
  const id = want ?? (named?.length === 16 ? [...named].map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15))).join("") : "")
  // (proofs: 2 is RSA, 3 ECDSA; the developer's key is the one whose hash is the id, the store adds its own)
  for (const [n, hash] of [[2, "sha256"], [3, "sha256"]] as const) {
    for (const proof of f.get(n) ?? []) {
      const p = fields(proof), key = p.get(1)?.[0], sig = p.get(2)?.[0]
      if (!key || !sig || idOfKey(key) !== id) continue
      const len = Buffer.alloc(4)
      len.writeUInt32LE(signed.length)
      const data = Buffer.concat([Buffer.from("CRX3 SignedData\x00", "latin1"), len, signed, zip])
      if (!crypto.verify(hash, data, { key, format: "der", type: "spki" }, sig)) throw new Error("the package's signature is wrong")
      return { zip, key }
    }
  }
  throw new Error("the package isn't that extension")
}

/** Unpack a zip into `dir` (made fresh). Names that would land outside it are refused. */
export function unzip(zip: Buffer, dir: string) {
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error("the package's archive is damaged")
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  if (count === 0xffff || at === 0xffffffff) throw new Error("the package's archive is too large")
  fs.mkdirSync(dir, { recursive: true })
  const root = path.resolve(dir)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("the package's archive is damaged")
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20), full = zip.readUInt32LE(at + 24)
    const nameLen = zip.readUInt16LE(at + 28), extraLen = zip.readUInt16LE(at + 30), commentLen = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString("utf8", at + 46, at + 46 + nameLen).replace(/\\/g, "/")
    at += 46 + nameLen + extraLen + commentLen
    const to = path.resolve(root, name)
    if (!to.startsWith(root + path.sep) && to !== root) throw new Error("the package's archive names a file outside it")
    if (name.endsWith("/")) { fs.mkdirSync(to, { recursive: true }); continue }
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("the package's archive is damaged")
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const raw = zip.subarray(start, start + size)
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null
    if (!data || data.length !== full) throw new Error("the package's archive is damaged")
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.writeFileSync(to, data)
  }
}
