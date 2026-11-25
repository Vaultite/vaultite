// The user's KeePass file, read fresh for every call: KeePassXC, Strongbox or iCloud may have just written it.
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { forgetKeys } from "./argon2.ts"
import { applyChange, entryById, exportOf, fullOf, listOf, removeEntry, sharesOf, type Row } from "./kdbxedit.ts"
import type { Access } from "./kdbxwire.ts"
import { fieldsOf, loadKdbx, openDatabase, urlsOf, type Database } from "./keepass.ts"
import type { Kdbx } from "./kdbx/index.ts"
import { matchesSite } from "./loginsites.ts"
import { messageOf } from "./messageof.ts"
import { otpOf } from "./otp.ts"
import { fingerprint } from "./passwordsindex.ts"
import type { Change } from "./passwordswire.ts"

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
  private writing: Promise<unknown> = Promise.resolve()

  constructor(backups: string) { this.backups = backups }

  async unlock(a: Agents): Promise<null> {
    const at = this.locks
    if (this.held?.file !== a.file) forgetKeys()
    await loadKdbx(read(a.file), a.password)
    if (at !== this.locks) throw new Error("locked")
    this.held?.password.fill(0)
    this.held = { file: a.file, password: a.password }
    return null
  }
  lock() {
    this.locks++
    this.held?.password.fill(0)
    this.held = null
    forgetKeys()
  }

  check(a: Access) { return this.opened(a, () => null) }
  list(a: Access) { return this.opened(a, (db) => listOf(db, a.file)) }
  get(a: Access, id: string) { return this.opened(a, (db) => fullOf(db, a.file, id)) }
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
  delete(a: Access, id: string) { return this.write(a, (db) => { removeEntry(db, id); return id }) }
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
  private opened<T>(a: Access, fn: (db: Kdbx) => T) { return this.using(a, async (password) => fn(await loadKdbx(read(a.file), password))) }
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
