// Ours, past upstream's: every fixture and format written and read again, wrong passwords, damaged and hostile files
// (cut, flipped, lying headers, zip bombs, DTDs), and KeePassXC reading what we write and the other way round.
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as k from "../../../electron/browser/kdbx/index.ts"
import { gunzip, gzip } from "../../../electron/browser/kdbx/gzip.ts"
import { argon2dAsync, argon2idAsync } from "@noble/hashes/argon2.js"
import { argon2, forgetKeys } from "../../../electron/browser/argon2.ts"
import { MaxArgon2Memory } from "../../../electron/browser/kdbx/key-encryptor-kdf.ts"
import { MaxDepth, parseXml, serializeXml } from "../../../electron/browser/kdbx/xml.ts"
import { check, section, skip } from "../lib.ts"
import { fixture } from "./mocha.ts"

const cred = (pw: string | null, key?: string) => new k.Credentials(pw === null ? null : k.ProtectedValue.fromString(pw), key ? fixture(key) : null)
const text = (v: unknown) => (v instanceof k.ProtectedValue ? v.getText() : typeof v === "string" ? v : "")
const sha = (b: ArrayBuffer | Uint8Array) => crypto.createHash("sha256").update(new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))).digest("hex")

/** The error code a promise ends with ("ok" if none): a KdbxError's code, or the name of any other error. */
async function codeOf(p: Promise<unknown>) {
  try { await p; return "ok" } catch (e) { return e instanceof k.KdbxError ? e.code : `not a KdbxError: ${(e as Error)?.name} ${(e as Error)?.message}` }
}

function binaryBytes(db: k.Kdbx, b: unknown): Uint8Array {
  const v = k.KdbxBinaries.isKdbxBinaryWithHash(b as k.KdbxBinaryWithHash) ? (b as k.KdbxBinaryWithHash).value
    : k.KdbxBinaries.isKdbxBinaryRef(b as k.KdbxBinaryOrRef) ? db.binaries.getByRef(b as k.KdbxBinaryRef)?.value : b
  return v instanceof k.ProtectedValue ? v.getBinary() : new Uint8Array(v as ArrayBuffer)
}

/** Where two snapshots first differ, for a failure's note. */
function diff(a: string, b: string) {
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return [a.slice(Math.max(0, i - 60), i + 60), b.slice(Math.max(0, i - 60), i + 60)]
}

// (KeePass keeps times to the second)
const secs = (d: Date | undefined) => (d ? Math.floor(d.getTime() / 1000) : null)

/** What a database holds, as plain data to compare: groups, entries (their fields' text, attachments' hashes, history). */
function snapshot(db: k.Kdbx) {
  const entry = (e: k.KdbxEntry): unknown => ({
    uuid: e.uuid.id, tags: e.tags, icon: e.icon, modified: secs(e.times.lastModTime), expires: e.times.expires, expiry: secs(e.times.expiryTime),
    // (an empty protected value reads as plain text, as upstream always did: nothing to hide)
    fields: Object.fromEntries([...e.fields].map(([n, v]) => [n, [text(v), v instanceof k.ProtectedValue && !!v.byteLength]]).sort()),
    binaries: Object.fromEntries([...e.binaries].map(([n, b]) => [n, sha(binaryBytes(db, b))]).sort()),
    customData: e.customData ? Object.fromEntries([...e.customData].map(([n, v]) => [n, v.value])) : null,
    history: e.history.map(entry),
  })
  const group = (g: k.KdbxGroup): unknown => ({ uuid: g.uuid.id, name: g.name, notes: g.notes ?? "", entries: g.entries.map(entry), groups: g.groups.map(group),
    customData: g.customData ? Object.fromEntries([...g.customData].map(([n, v]) => [n, v.value])) : null })
  return JSON.stringify({ name: db.meta.name, bin: db.meta.recycleBinUuid?.id, root: db.groups.map(group), deleted: db.deletedObjects.length,
    customData: Object.fromEntries([...db.meta.customData].map(([n, v]) => [n, v.value])), icons: [...db.meta.customIcons.keys()] })
}

// Upstream's fixtures and what opens them (upstream's kdbx tests).
const FIXTURES: [string, string | null, string?][] = [
  ["demo.kdbx", "demo", "demo.key"], ["cyrillic.kdbx", "пароль"], ["binkey.kdbx", "test", "binkey.key"], ["EmptyPass.kdbx", ""],
  ["EmptyPassWithKeyFile.kdbx", "", "EmptyPassWithKeyFile.key"], ["NoPassWithKeyFile.kdbx", null, "NoPassWithKeyFile.key"],
  ["Key32.kdbx", "test", "Key32.key"], ["Key64.kdbx", "test", "Key64.key"], ["KeyWithBom.kdbx", "test", "KeyWithBom.key"], ["KeyV2.kdbx", null, "KeyV2.keyx"],
  ["Argon2.kdbx", "demo", "demo.key"], ["Argon2id.kdbx", "demo", "demo.key"], ["AesChaCha.kdbx", "demo", "demo.key"], ["AesKdfKdbx4.kdbx", "demo"],
  ["Argon2ChaCha.kdbx", "demo", "demo.key"], ["KDBX4.1.kdbx", "test"],
]

/** A made-up database with what files hold: groups in groups, attachments (one protected), history, custom data. */
async function madeUp(pw: string) {
  const db = k.Kdbx.create(cred(pw), "Lighthouse")
  const work = db.createGroup(db.getDefaultGroup(), "Work"), deep = db.createGroup(work, "Deep")
  const e = db.createEntry(work)
  e.fields.set("Title", "Lighthouse"); e.fields.set("UserName", "alice"); e.fields.set("Password", k.ProtectedValue.fromString("Lighthouse-7!pw"))
  e.fields.set("URL", "https://lighthouse.example.com"); e.fields.set("Notes", "tab\there, CR\r\nLF, <tags> & \"quotes\" 'apos' ]]> 😀 ü")
  e.fields.set("otp", k.ProtectedValue.fromString("otpauth://totp/Lighthouse:alice?secret=GEZDGNBVGY3TQOJQ"))
  e.tags = ["agent-free", "work"]
  e.binaries.set("notes.txt", await db.createBinary(k.ByteUtils.arrayToBuffer(k.ByteUtils.stringToBytes("made-up attachment"))))
  e.binaries.set("key.bin", await db.createBinary(k.ProtectedValue.fromBinary(crypto.randomBytes(3000))))
  e.pushHistory()
  e.fields.set("Password", k.ProtectedValue.fromString("Lighthouse-8!pw"))
  e.times.update()
  const d = db.createEntry(deep)
  d.fields.set("Title", "Harbor"); d.fields.set("Password", k.ProtectedValue.fromString(""))
  d.customData = new Map([["KPXC_X", { value: "made-up" }]])
  db.meta.customData.set("KeeShare/Active", { value: "x", lastModified: new Date("2026-01-02T03:04:05Z") })
  const gone = db.createEntry(db.getDefaultGroup())
  db.remove(gone)
  return db
}

await section("kdbx round trips", async () => {
  for (const [file, pw, key] of FIXTURES) {
    const c = cred(pw, key)
    const db = await k.Kdbx.load(fixture(file), c)
    const before = snapshot(db), version = `${db.versionMajor}.${db.versionMinor}`
    const again = await k.Kdbx.load(await db.save(), c)
    check(`round trip: ${file} (KDBX ${version}) reads back the same`, snapshot(again) === before && again.versionMajor === db.versionMajor, version)
    if (db.versionMajor === 3) {
      db.upgrade()
      const up = await k.Kdbx.load(await db.save(), c)
      check(`round trip: ${file} upgraded to KDBX 4 reads back the same`, snapshot(up) === before && up.versionMajor === 4)
    }
  }
  const variants: [string, (db: k.Kdbx) => void][] = [
    ["KDBX 4, AES, Argon2d", () => {}],
    ["KDBX 4, AES, Argon2id", (db) => db.setKdf(k.Consts.KdfId.Argon2id)],
    ["KDBX 4, AES, AES-KDF", (db) => db.setKdf(k.Consts.KdfId.Aes)],
    ["KDBX 4, ChaCha20, Argon2d", (db) => { db.header.dataCipherUuid = new k.KdbxUuid(k.Consts.CipherId.ChaCha20) }],
    ["KDBX 4.1, ChaCha20, Argon2id", (db) => { db.header.dataCipherUuid = new k.KdbxUuid(k.Consts.CipherId.ChaCha20); db.setKdf(k.Consts.KdfId.Argon2id); db.header.versionMinor = 1 }],
    ["KDBX 4, no compression", (db) => { db.header.compression = k.Consts.CompressionAlgorithm.None }],
    ["KDBX 3.1, AES", (db) => db.setVersion(3)],
    ["KDBX 3.1, ChaCha20", (db) => { db.setVersion(3); db.header.dataCipherUuid = new k.KdbxUuid(k.Consts.CipherId.ChaCha20) }],
  ]
  for (const [name, set] of variants) {
    const db = await madeUp("made-up pw")
    set(db)
    const before = snapshot(db)
    const bytes = await db.save()
    const back = await k.Kdbx.load(bytes, cred("made-up pw"))
    check(`round trip: a made-up database as ${name} reads back the same`, snapshot(back) === before, diff(before, snapshot(back)))
    const twice = await k.Kdbx.load(await back.save(), cred("made-up pw"))
    check(`round trip: ${name} saved a second time still reads the same`, snapshot(twice) === before)
    check(`wrong password: ${name} says InvalidKey`, await codeOf(k.Kdbx.load(bytes, cred("not it"))) === "InvalidKey")
  }
  for (const [file, pw, key] of FIXTURES) {
    if (file === "NoPassWithKeyFile.kdbx" || file === "KeyV2.kdbx") continue
    const code = await codeOf(k.Kdbx.load(fixture(file), cred(`${pw}x`, key)))
    check(`wrong password: ${file} says InvalidKey`, code === "InvalidKey", code)
  }
})

await section("kdbx 4.1 dates", async () => {
  const db = await madeUp("pw")
  db.header.versionMinor = 1
  const icon = k.KdbxUuid.random()
  db.meta.customIcons.set(icon.id, { data: new Uint8Array([1, 2, 3]).buffer, name: "made-up", lastModified: new Date("2026-03-04T05:06:07Z") })
  const back = await k.Kdbx.load(await db.save(), cred("pw"), { preserveXml: true })
  const times = [...serializeXml(back.xml!).matchAll(/<LastModificationTime>([^<]*)</g)].map((m) => m[1])
  check("4.1: custom data's and icons' LastModificationTime are binary dates, as KeePass requires (upstream PR 62)", times.length >= 2 && times.every((t) => !t.includes(":")), times)
  check("4.1: custom data's date reads back", back.meta.customData.get("KeeShare/Active")?.lastModified?.toISOString() === "2026-01-02T03:04:05.000Z")
  const node = k.XmlUtils.parse("<d>JoU/Fe4cIAA=</d>").documentElement
  check("a date past what a Date holds (KeePassDX's) reads as KeePass's latest, not an error (upstream issue 48)", k.XmlUtils.getDate(node)?.toISOString() === "9999-12-31T23:59:59.000Z")
})

/** A small file, quick to open (AES-KDF, one round): for the damage tests, which open it hundreds of times. */
async function quick(version: 3 | 4) {
  const db = await madeUp("pw")
  if (version === 3) db.setVersion(3)
  else db.setKdf(k.Consts.KdfId.Aes)
  if (version === 3) db.header.keyEncryptionRounds = 1
  else db.header.kdfParameters!.set("R", k.VarDictionary.ValueType.UInt64, new k.Int64(1))
  return new Uint8Array(await db.save())
}
const ERRORS = ["FileCorrupt", "InvalidKey", "BadSignature", "InvalidVersion", "Unsupported"]

/** Where a KDBX 3 header's TransformRounds value is: a flip there only asks for a slower key (2^48 rounds), as in KeePass. */
function roundsField(file: Uint8Array): [number, number] {
  const dv = new DataView(file.buffer, file.byteOffset)
  for (let at = 12; at < file.length; ) {
    const id = file[at], size = dv.getUint16(at + 1, true)
    if (id === 6) return [at + 3, at + 3 + size]
    at += 3 + size
  }
  return [-1, -1]
}

await section("kdbx damaged files", async () => {
  for (const v of [3, 4] as const) {
    const file = await quick(v)
    check(`damaged: the KDBX ${v} sample opens whole`, await codeOf(k.Kdbx.load(file.slice().buffer, cred("pw"))) === "ok")
    const cuts: string[] = [], flips: string[] = []
    for (let n = 0; n < file.length; n += n < 300 ? 1 : 7) {
      const code = await codeOf(k.Kdbx.load(file.slice(0, n).buffer, cred("pw")))
      if (!ERRORS.includes(code)) cuts.push(`${n}: ${code}`)
    }
    check(`damaged: KDBX ${v} cut anywhere is refused with a clear error, never read`, !cuts.length, cuts.slice(0, 5))
    const rounds = v === 3 ? roundsField(file) : [-1, -1]
    for (let i = 0; i < file.length; i += i < 300 ? 1 : 5) {
      if (i >= rounds[0] && i < rounds[1]) continue
      const bad = file.slice()
      bad[i] ^= 1 << (i % 8)
      const code = await codeOf(k.Kdbx.load(bad.buffer, cred("pw")))
      if (!ERRORS.includes(code)) flips.push(`${i}: ${code}`)
    }
    check(`damaged: KDBX ${v} with any one bit flipped is refused, never read`, !flips.length, flips.slice(0, 5))
  }
  for (const [what, bytes] of [["an empty file", new Uint8Array(0)], ["random bytes", crypto.randomBytes(5000)],
    ["a KeePass 1 file", Buffer.from("03d9a29a65fb4bb5" + "00".repeat(120), "hex")]] as const) {
    const code = await codeOf(k.Kdbx.load(new Uint8Array(bytes).buffer, cred("pw")))
    check(`damaged: ${what} is refused clearly`, ERRORS.includes(code), code)
  }
  // KDBX 4's last block is its end mark, keyed like the rest: one forged there (upstream never checked it) is refused.
  const file = await quick(4)
  const forged = file.slice()
  forged.set(crypto.randomBytes(32), file.length - 36)
  check("damaged: KDBX 4 with its end block's HMAC forged is refused (upstream read it)", await codeOf(k.Kdbx.load(forged.buffer, cred("pw"))) === "FileCorrupt")
  const block = (index: number, data: Uint8Array, hash?: Uint8Array) => {
    const out = new Uint8Array(40 + data.length), dv = new DataView(out.buffer)
    dv.setUint32(0, index, true); out.set(hash ?? crypto.createHash("sha256").update(data).digest(), 4); dv.setUint32(36, data.length, true); out.set(data, 40)
    return out
  }
  const ok = Buffer.concat([block(0, Buffer.from("abc")), block(1, new Uint8Array(0), new Uint8Array(32))])
  check("hashed blocks (KDBX 3): whole ones read", k.ByteUtils.bytesToString(await k.HashedBlockTransform.decrypt(new Uint8Array(ok).buffer)) === "abc")
  const swapped = Buffer.concat([block(1, Buffer.from("abc")), block(2, new Uint8Array(0), new Uint8Array(32))])
  check("hashed blocks: out of order is refused", await codeOf(k.HashedBlockTransform.decrypt(new Uint8Array(swapped).buffer)) === "FileCorrupt")
  const endHash = Buffer.concat([block(0, Buffer.from("abc")), block(1, new Uint8Array(0), crypto.randomBytes(32))])
  check("hashed blocks: an end mark with a hash is refused", await codeOf(k.HashedBlockTransform.decrypt(new Uint8Array(endHash).buffer)) === "FileCorrupt")
  const lying = block(0, Buffer.from("abcdef")).slice(0, 43)
  check("hashed blocks: a length past the data is refused", await codeOf(k.HashedBlockTransform.decrypt(new Uint8Array(lying).buffer)) === "FileCorrupt")
})

/** `file` (KDBX 4) with its KDF parameters edited and its header's SHA-256 made right again (its HMAC needs the key). */
function withKdf(file: Uint8Array, edit: (p: k.VarDictionary) => void) {
  const header = k.KdbxHeader.read(new k.BinaryStream(file.slice().buffer), new k.KdbxContext({ kdbx: new k.Kdbx() }))
  const end = header.endPos!, stm = new k.BinaryStream()
  edit(header.kdfParameters!)
  header.write(stm)
  const head = new Uint8Array(stm.getWrittenBytes())
  return Buffer.concat([head, crypto.createHash("sha256").update(head).digest(), file.slice(end + 32)])
}

await section("kdbx hostile headers", async () => {
  const argon = new Uint8Array(await (await madeUp("pw")).save())
  const big = withKdf(argon, (p) => p.set("M", k.VarDictionary.ValueType.UInt64, k.Int64.from(MaxArgon2Memory * 4)))
  check("hostile: Argon2 asking for 4 GiB is refused before it runs (Unsupported)", await codeOf(k.Kdbx.load(new Uint8Array(big).buffer, cred("pw"))) === "Unsupported")
  const par = withKdf(argon, (p) => p.set("P", k.VarDictionary.ValueType.UInt32, 0x1000000))
  check("hostile: Argon2 parallelism past its range is refused", await codeOf(k.Kdbx.load(new Uint8Array(par).buffer, cred("pw"))) === "FileCorrupt")
  const ctx = () => new k.KdbxContext({ kdbx: new k.Kdbx() })
  const read = (hex: string) => { try { k.KdbxHeader.read(new k.BinaryStream(k.ByteUtils.arrayToBuffer(k.ByteUtils.hexToBytes(hex))), ctx()); return "ok" } catch (e) { return e instanceof k.KdbxError ? e.code : String(e) } }
  const sig4 = "03d9a29a67fb4bb500000400"
  check("hostile: a header field longer than the file is refused", read(sig4 + "04ffffff7f0000") === "FileCorrupt")
  check("hostile: a 3-byte compression flag is refused, not read past", read(sig4 + "0303000000010000") === "FileCorrupt")
  check("hostile: a master seed of 4 bytes is refused", read(sig4 + "040400000001020304") === "FileCorrupt")
  check("hostile: an IV of 5 bytes is refused", read(sig4 + "07050000000102030405") === "FileCorrupt")
  // A header KeePass would read: an unknown field (id 99) is skipped, as KeePass and KeePassXC do.
  const db = await madeUp("pw"), stm = new k.BinaryStream()
  db.header.generateSalts(); db.header.write(stm)
  const head = new Uint8Array(stm.getWrittenBytes())
  const withUnknown = Buffer.concat([head.slice(0, 12), Buffer.from("6303000000616263", "hex"), head.slice(12)])
  check("hostile: an unknown header field is skipped", read(Buffer.from(withUnknown).toString("hex")) === "ok")
  const nodeOk = k.VarDictionary.read(new k.BinaryStream(k.ByteUtils.arrayToBuffer(k.ByteUtils.hexToBytes("000104010000004104000000ffffffff00"))))
  check("hostile: KDF parameters read within their bounds", nodeOk.get("A") === 0xffffffff)
  let lie = "?"
  try { k.VarDictionary.read(new k.BinaryStream(k.ByteUtils.arrayToBuffer(k.ByteUtils.hexToBytes("0001420100000041ffff0000")))) } catch (e) { lie = (e as k.KdbxError).code }
  check("hostile: a KDF parameter longer than its dictionary is refused", lie === "FileCorrupt", lie)
})

await section("kdbx argon2", async () => {
  const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(b)).toString("hex")
  for (const [name, type, version] of [["Argon2d 1.3", 0, 0x13], ["Argon2id 1.3", 2, 0x13], ["Argon2d 1.0", 0, 0x10], ["Argon2id 1.0", 2, 0x10]] as const) {
    const pw = crypto.randomBytes(32), salt = crypto.randomBytes(32)
    const want = hex(await (type === 2 ? argon2idAsync : argon2dAsync)(pw, salt, { m: 1024, t: 3, p: 2, dkLen: 32, version }))
    check(`argon2: ${name} is noble's (the reference)`, hex(await argon2(pw.buffer.slice(pw.byteOffset, pw.byteOffset + 32), salt.buffer.slice(salt.byteOffset, salt.byteOffset + 32), 1024, 3, 32, 2, type, version)) === want)
  }
  const pw = crypto.randomBytes(32).buffer, salt = crypto.randomBytes(32).buffer
  const first = new Uint8Array(await argon2(pw, salt, 8192, 4, 32, 2, 0, 0x13)), want = hex(first)
  first.fill(0)
  let t = Date.now()
  const again = await argon2(pw, salt, 8192, 4, 32, 2, 0, 0x13)
  check("argon2: the same inputs again come kept, unharmed by the caller zeroing the first", hex(again) === want && Date.now() - t < 20, Date.now() - t)
  check("argon2: another salt derives anew", hex(await argon2(pw, crypto.randomBytes(32).buffer, 8192, 4, 32, 2, 0, 0x13)) !== want)
  forgetKeys()
  check("argon2: forgotten keys derive again, the same", hex(await argon2(pw, salt, 8192, 4, 32, 2, 0, 0x13)) === want)
  const both = await Promise.all([argon2(pw, salt, 1024, 1, 32, 1, 2, 0x13), argon2(pw, salt, 1024, 1, 32, 1, 2, 0x13)])
  check("argon2: two asks at once share one derivation", hex(both[0]) === hex(both[1]))
})

await section("kdbx decompression", async () => {
  const bomb = gzip(new Uint8Array(20 * 1024 * 1024))
  let code = "ok"
  try { gunzip(bomb, 1024 * 1024) } catch (e) { code = (e as k.KdbxError).code + " " + (e as Error).message }
  check("zip bomb: inflating past the limit stops there (FileCorrupt), never all of it", code.startsWith("FileCorrupt") && code.includes("over"), [bomb.length, code])
  check("zip bomb: under the limit inflates whole", gunzip(bomb).length === 20 * 1024 * 1024)
  try { gunzip(crypto.randomBytes(100)); code = "ok" } catch (e) { code = (e as k.KdbxError).code }
  check("gzip: garbage is FileCorrupt", code === "FileCorrupt", code)
})

await section("kdbx xml", async () => {
  const refused = (xml: string) => { try { k.XmlUtils.parse(xml); return "read" } catch (e) { return e instanceof k.KdbxError ? `${e.code}: ${e.message}` : String(e) } }
  const lol = `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]><KeePassFile>&c;</KeePassFile>`
  for (const [what, xml] of [["a DTD's entities (billion laughs)", lol],
    ["an external entity (XXE)", `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><KeePassFile>&e;</KeePassFile>`],
    ["any DTD, even one declaring nothing", "<!DOCTYPE KeePassFile><KeePassFile/>"], ["an undefined entity", "<KeePassFile>&e;</KeePassFile>"], ["a bare &", "<a>x & y</a>"], ["mismatched tags", "<a><b></a></b>"],
    ["two roots", "<a/><b/>"], ["a repeated attribute", '<a x="1" x="2"/>'], ["an unclosed element", "<a><b>"], ["text outside the root", "<a/>x"],
    ["a bad character reference", "<a>&#0;</a>"], ["nesting past the limit", "<a>".repeat(MaxDepth + 2) + "</a>".repeat(MaxDepth + 2)]] as const) {
    const r = refused(xml)
    check(`xml: ${what} is refused`, r.startsWith("FileCorrupt: Error FileCorrupt: bad xml"), r)
  }
  check("xml: nesting under the limit reads", refused("<a>".repeat(MaxDepth - 1) + "</a>".repeat(MaxDepth - 1)) === "read")
  const doc = parseXml('<?xml version="1.0" encoding="utf-8"?><r a="x&amp;y&#10;z\t1" __proto__="p"><!-- c --><s><![CDATA[a<b]]>&lt;&#x1F600;</s>\r\n<t>a\r\nb</t></r>')
  const r = doc.documentElement
  check("xml: text, CDATA, references and line ends read as XML says", r.childNodes[1].textContent === "a<b<😀" && r.childNodes[3].textContent === "a\nb" && r.getAttribute("a") === "x&y\nz 1", [r.textContent])
  check("xml: an attribute named __proto__ is just an attribute", r.getAttribute("__proto__") === "p" && !("p" in {}) && Object.getPrototypeOf({}) === Object.prototype)
  check("xml: what's written reads back as the same tree", serializeXml(parseXml(serializeXml(doc))) === serializeXml(doc), serializeXml(doc))
  const tab = k.XmlUtils.parse("<a>x\ty</a>").documentElement.textContent
  check("xml: a tab in a value is kept (upstream dropped it: issue PR 63)", tab === "x\ty", tab)
  const n = parseXml("<a/>").documentElement
  n.textContent = "bell\u0007 cr\r lt< amp& gt>"
  n.setAttribute("q", "tab\t nl\n quote\" lt<")
  const back = parseXml(serializeXml(n)).documentElement
  check("xml: a carriage return, tab, newline and quotes survive writing; characters XML can't carry are dropped", back.textContent === "bell cr\r lt< amp& gt>" && back.getAttribute("q") === "tab\t nl\n quote\" lt<", [back.textContent, back.getAttribute("q")])
})

// ---------- KeePassXC itself, where it's installed: it reads what we write, we read what it writes ----------
const cli = spawnSync("keepassxc-cli", ["--version"], { encoding: "utf8" })
if (cli.status !== 0) skip("kdbx keepassxc", "keepassxc-cli isn't on PATH")
else await section("kdbx keepassxc", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vau-kdbx-"))
  const env = { ...process.env, HOME: dir, XDG_CONFIG_HOME: dir }
  const kpx = (args: string[], input = "pw\n") => spawnSync("keepassxc-cli", args, { input, encoding: "utf8", env, timeout: 60_000 })
  try {
    for (const [name, set] of [["KDBX 4, Argon2d", () => {}], ["KDBX 4, ChaCha20, Argon2id", (db: k.Kdbx) => { db.header.dataCipherUuid = new k.KdbxUuid(k.Consts.CipherId.ChaCha20); db.setKdf(k.Consts.KdfId.Argon2id) }],
      ["KDBX 4.1, AES-KDF", (db: k.Kdbx) => { db.setKdf(k.Consts.KdfId.Aes); db.header.versionMinor = 1 }], ["KDBX 3.1", (db: k.Kdbx) => db.setVersion(3)]] as const) {
      const db = await madeUp("pw")
      set(db)
      const file = path.join(dir, "ours.kdbx")
      fs.writeFileSync(file, new Uint8Array(await db.save()))
      const shown = kpx(["show", "-q", "-s", "-a", "Password", "-a", "Notes", file, "Work/Lighthouse"])
      // (to a file: its --stdout writes text, mangling bytes that aren't UTF-8)
      const out = path.join(dir, "key.bin")
      fs.rmSync(out, { force: true })
      const att = kpx(["attachment-export", "-q", file, "Work/Lighthouse", "key.bin", out])
      const xml = kpx(["export", "-q", "-f", "xml", file])
      const want = db.getDefaultGroup().groups.find((g) => g.name === "Work")!.entries[0]
      check(`keepassxc: reads our ${name}: the password, notes, history and a protected attachment`, shown.status === 0 && shown.stdout.split("\n")[0] === "Lighthouse-8!pw"
        && shown.stdout.includes("😀") && att.status === 0 && sha(fs.readFileSync(out)) === sha(binaryBytes(db, want.binaries.get("key.bin"))) && xml.status === 0 && xml.stdout.includes("<History>"),
        [shown.stderr, att.status, att.stderr, xml.status, xml.stderr.slice(0, 200)])
    }
    // KeePassXC's own file (its XML import, so made-up content of every kind), read here, edited, and read by KeePassXC again.
    const xmlIn = path.join(dir, "in.xml"), theirs = path.join(dir, "theirs.kdbx")
    fs.writeFileSync(xmlIn, await (await madeUp("pw")).saveXml())
    const made = kpx(["import", "-q", "-p", "-t", "100", xmlIn, theirs], "pw\npw\n")
    check("keepassxc: makes its own file from our XML export", made.status === 0, made.stderr)
    const db = await k.Kdbx.load(new Uint8Array(fs.readFileSync(theirs)).buffer, cred("pw"))
    const e = db.getDefaultGroup().groups.find((g) => g.name === "Work")!.entries[0]
    check("keepassxc: its file reads here: fields, history and both attachments", text(e.fields.get("Password")) === "Lighthouse-8!pw" && e.history.length === 1 && e.binaries.size === 2
      && text(e.fields.get("Notes")).includes("😀"), [db.versionMajor, db.versionMinor, e.history.length, e.binaries.size])
    e.pushHistory()
    e.fields.set("Password", k.ProtectedValue.fromString("changed here"))
    e.times.update()
    fs.writeFileSync(theirs, new Uint8Array(await db.save()))
    const after = kpx(["show", "-q", "-s", "-a", "Password", theirs, "Work/Lighthouse"])
    check("keepassxc: reads our edit of its file", after.status === 0 && after.stdout.trim() === "changed here", after.stderr)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
