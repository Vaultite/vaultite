// The user's KeePass file, read for every call: KeePassXC, Strongbox or iCloud may have just written it.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { forgetKeys } from "./argon2.ts"
import { applyChange, entryById, exportOf, fullOf, listOf, moveEntries, removeEntry, removeGroup, saveGroup, sharesOf, type Row } from "./kdbxedit.ts"
import { hashesOf, healthOf, leaked, setExcluded, type Hashes } from "./kdbxhealth.ts"
import { passwordAt, restoreVersion, versionOf } from "./kdbxhistory.ts"
import type { Access } from "./kdbxwire.ts"
import { fieldsOf, loadKdbx, openDatabase, urlsOf, type Database } from "./keepass.ts"
import type { Kdbx } from "./kdbx/index.ts"
import { matchesSite } from "./loginsites.ts"
import { messageOf } from "./messageof.ts"
import { otpOf, totp } from "./otp.ts"
import { fingerprint } from "./passwordsindex.ts"
import type { Change, GroupChange, Moves, Removal } from "./passwordswire.ts"

const BACKUPS_KEPT = 30
const hash = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest()

function writeAtomic(file: string, data: Uint8Array) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.vaultite-${process.pid}.tmp`)
  fs.writeFileSync(tmp, data, { mode: 0o600 })
  fs.renameSync(tmp, file)
}
function backup(dir: string, file: string, data: Buffer) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, `${Date.now()}-${path.basename(file)}`), data, { mode: 0o600 })
  for (const f of fs.readdirSync(dir).sort().slice(0, -BACKUPS_KEPT)) fs.rmSync(path.join(dir, f), { force: true })
}
function read(file: string) {
  try { return fs.readFileSync(file) } catch { throw new Error(`${path.basename(file)} isn't there`) }
}
async function exportShares(db: Kdbx, file: string): Promise<string[]> {
  const warnings: string[] = []
  for (const s of sharesOf(db, file)) {
    if (!fs.existsSync(path.dirname(s.path))) continue
    try { writeAtomic(s.path, new Uint8Array(await exportOf(db, s))) } catch (e) { warnings.push(`a KeeShare export wasn't written: ${messageOf(e)}`) }
  }
  return warnings
}

type Agents = { file: string; password: Uint8Array }

export class KdbxFiles {
  private readonly backups: string
  private held: { file: string; password: Uint8Array } | null = null
  private locks = 0
  private hashes: Hashes = new Map()
  private bits = new Map<string, number>()
  private parsed: { sum: string; db: Kdbx } | null = null
  private writing: Promise<unknown> = Promise.resolve()

  constructor(backups: string) { this.backups = backups }

  async unlock(a: Agents): Promise<null> {
    const at = this.locks
    if (this.held?.file !== a.file) forgetKeys()
    await loadKdbx(read(a.file), a.password)
    if (at !== this.locks) throw new Error("locked")
    this.held?.password.fill(0)
    this.held = { file: a.file, password: a.password }
    this.parsed = null
    return null
  }
  lock() {
    this.locks++
    this.held?.password.fill(0)
    this.held = null
    this.hashes.clear()
    this.bits.clear()
    this.parsed = null
    forgetKeys()
  }

  check(a: Access) { return this.opened(a, () => null) }
  list(a: Access) { return this.opened(a, (db) => listOf(db, a.file)) }
  get(a: Access, id: string) { return this.opened(a, (db) => fullOf(db, a.file, id)) }
  password(a: Access, id: string, at?: number) {
    return this.opened(a, (db) => { const p = at === undefined ? passwordIn(db, id) : passwordAt(db, id, at); if (p === null) throw new Error("that entry is gone from the file"); return p })
  }
  code(a: Access, id: string) {
    return this.opened(a, (db) => {
      const e = entryById(db, id), otp = e && otpOf(fieldsOf(e))
      return otp && otp !== "steam" ? { code: totp(otp), period: otp.period } : null
    })
  }
  secretsOf(a: Access, id: string) {
    return this.opened(a, (db) => {
      const e = entryById(db, id)
      if (!e) return null
      const f = fieldsOf(e)
      return { username: f.UserName ?? "", password: f.Password ?? "", otp: otpOf(f) }
    })
  }
  entriesForUrl(a: Access, url: string) { return this.opened(a, (db) => logins(db, a.file).filter((e) => e.urls.some((u) => matchesSite(u, url)))) }
  samePassword(a: Access, ids: string[], given: string) {
    return this.opened(a, (db) => {
      const want = hash(Buffer.from(given))
      return ids.filter((id) => { const p = passwordIn(db, id); return p !== null && crypto.timingSafeEqual(hash(Buffer.from(p)), want) })
    })
  }
  index(a: Access, salt: string) { return this.opened(a, (db) => logins(db, a.file).map((r) => ({ ...r, fp: fingerprint(salt, r.id, passwordIn(db, r.id) ?? "") }))) }
  save(a: Access, change: Change) { return this.write(a, (db) => applyChange(db, change)) }
  saveLogin(a: Access, l: LoginToSave) { return this.write(a, (db) => saveLogin(db, l)) }
  keepSecret(a: Access, title: string, value: string) { return this.write(a, (db) => keepSecret(db, title, value)) }
  move(a: Access, moves: Moves) { return this.write(a, (db) => moveEntries(db, moves)) }
  delete(a: Access, r: Removal) { return this.write(a, (db) => { for (const id of r.ids) removeEntry(db, id, r.forever); return r.ids[0] }) }
  saveGroup(a: Access, g: GroupChange) { return this.write(a, (db) => saveGroup(db, g)) }
  removeGroup(a: Access, id: string) { return this.write(a, (db) => removeGroup(db, id)) }
  version(a: Access, id: string, at: number) { return this.opened(a, (db) => versionOf(db, id, at)) }
  restore(a: Access, id: string, at: number) { return this.write(a, (db) => restoreVersion(db, id, at)) }
  exclude(a: Access, id: string, on: boolean) { return this.write(a, (db) => setExcluded(db, id, on)) }
  async health(a: Access) {
    const { bitsOf } = await import("./strength.ts")
    const bits = (p: string) => { const was = this.bits.get(p); if (was !== undefined) return was; const n = bitsOf(p); this.bits.set(p, n); return n }
    return this.opened(a, (db) => healthOf(db, bits))
  }
  async hashStarts(a: Access) {
    const at = this.locks, hashes = await this.opened(a, hashesOf)
    if (at !== this.locks) throw new Error("locked")
    this.hashes = hashes
    return [...hashes.keys()]
  }
  leaked(start: string, range: string) { return leaked(this.hashes, start, range) }
  async agents<T>(a: Agents, fn: (db: Database) => T) {
    try { return fn(await openDatabase(read(a.file), a.password)) } finally { a.password.fill(0) }
  }

  private async using<T>(a: Access, fn: (password: Uint8Array) => Promise<T>): Promise<T> {
    const given = a.password ?? (this.held?.file === a.file ? this.held.password : null)
    if (!given) throw new Error("locked")
    // (a copy: a lock zeroes the one held, and a save under way finishes)
    const password = given.slice()
    a.password?.fill(0)
    try { return await fn(password) } finally { password.fill(0) }
  }
  private opened<T>(a: Access, fn: (db: Kdbx) => T) {
    const unlocked = !a.password
    return this.using(a, async (password) => {
      const data = read(a.file)
      if (!unlocked) return fn(await loadKdbx(data, password))
      const at = this.locks, sum = hash(data).toString("hex")
      if (this.parsed?.sum === sum) return fn(this.parsed.db)
      const db = await loadKdbx(data, password)
      if (at === this.locks) this.parsed = { sum, db }
      return fn(db)
    })
  }
  /** Applied to the file as it is now, saved only if it opens again, never over a write that came in meanwhile. */
  private write(a: Access, edit: (db: Kdbx) => string): Promise<{ id: string; warnings: string[] }> {
    const run = this.writing.then(() => this.using(a, (password) => this.edited(a.file, password, edit)))
    this.writing = run.catch(() => {})
    return run
  }
  private async edited(file: string, password: Uint8Array, edit: (db: Kdbx) => string) {
    for (let i = 0; ; i++) {
      const data = read(file), db = await loadKdbx(data, password)
      const id = edit(db)
      db.cleanup({ historyRules: true })
      const saved = new Uint8Array(await db.save())
      await loadKdbx(saved, password)
      let now: Buffer | null = null
      try { now = fs.readFileSync(file) } catch { now = null }
      if (!now || !hash(now).equals(hash(data))) {
        if (i < 2) continue
        throw new Error(`${path.basename(file)} kept changing while saving: try again`)
      }
      backup(this.backups, file, data)
      writeAtomic(file, saved)
      return { id, warnings: await exportShares(db, file) }
    }
  }
}

function logins(db: Kdbx, file: string): Row[] {
  const { groups, entries } = listOf(db, file)
  const bin = new Set(groups.filter((g) => g.bin).map((g) => g.id))
  return entries.filter((e) => !bin.has(e.group))
}
const passwordIn = (db: Kdbx, id: string) => { const e = entryById(db, id); return e ? fieldsOf(e).Password ?? "" : null }

type LoginToSave = { url: string; username: string; given: string; id?: string }
function saveLogin(db: Kdbx, l: LoginToSave): string {
  let site: URL | null = null
  try { site = new URL(l.url) } catch { site = null }
  if (!site || !/^https?:$/.test(site.protocol)) throw new Error("only a web page's login is saved")
  if (l.id) {
    const e = entryById(db, l.id)
    if (!e) throw new Error("that entry is gone from the file")
    const f = fieldsOf(e)
    return applyChange(db, { id: l.id, title: f.Title ?? "", username: l.username || (f.UserName ?? ""), password: l.given, urls: urlsOf(f), tags: [...e.tags], notes: f.Notes ?? "" })
  }
  return applyChange(db, { title: site.hostname.replace(/^www\./, ""), username: l.username, password: l.given, urls: [`${site.protocol}//${site.host}`], tags: [], notes: "" })
}

function keepSecret(db: Kdbx, title: string, value: string): string {
  const root = db.getDefaultGroup()
  const group = root.groups.find((g) => g.name === "Secrets") ?? db.createGroup(root, "Secrets")
  const was = group.entries.find((e) => fieldsOf(e).Title === title)
  const f = was ? fieldsOf(was) : {}
  return applyChange(db, { id: was?.uuid.id, group: group.uuid.id, title, username: f.UserName ?? "", password: value, urls: urlsOf(f), tags: was ? [...was.tags] : [], notes: f.Notes ?? "" })
}
