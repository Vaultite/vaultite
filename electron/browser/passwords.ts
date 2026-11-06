// Your passwords: the user's own KeePass file (the one KeePassXC and Strongbox open), for the Passwords page, filling
// their own logins and saving new ones. This computer's, set up here; never through the server, which agents can call.
import { app, dialog, powerMonitor, safeStorage, systemPreferences } from "electron"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { allPages, handle, tellAll } from "./engine.ts"
import type { Change, Full, Row } from "./kdbxedit.ts"
import type { Otp } from "./keepass.ts"

// (kdbxweb loads at the first use: a Mac that never opens the page never loads it)
const kdbx = () => Promise.all([import("./keepass.ts"), import("./kdbxedit.ts")]).then(([k, e]) => ({ ...k, ...e }))

const CONFIG = () => path.join(app.getPath("userData"), "passwords.json")
const BACKUPS = () => path.join(app.getPath("userData"), "passwords-backups")
type Config = { file: string; key: string | null }
/** With no keyring (a Linux without a Secret Service), the password is held only till the app quits. */
let held: { file: string; password: string } | null = null
const keyring = () => safeStorage.isEncryptionAvailable()
function config(): Config | null {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG(), "utf8")) as Partial<Config>
    return typeof c.file === "string" ? { file: c.file, key: typeof c.key === "string" ? c.key : null } : null
  } catch { return null }
}
function passwordOf(c: Config): string | null {
  if (c.key === null) return held?.file === c.file ? held.password : null
  try { return safeStorage.decryptString(Buffer.from(c.key, "base64")) } catch { return null }
}

// ---------- the lock: what shows a secret or lists entries waits for Touch ID or the file's password ----------

const OPEN_MS = 10 * 60_000
let openUntil = 0
const changed = () => tellAll({ type: "engine:passwords:changed" })
export const isUnlocked = () => openUntil > Date.now()
function need() {
  if (!isUnlocked()) throw new Error("locked")
  openUntil = Date.now() + OPEN_MS
}
function lock() {
  const was = isUnlocked()
  openUntil = 0
  if (was) changed()
}
app.whenReady().then(() => { powerMonitor.on("lock-screen", lock); powerMonitor.on("suspend", lock) }, () => {})
const touchId = () => process.platform === "darwin" && systemPreferences.canPromptTouchID()

// ---------- the file: read fresh for every call (KeePassXC, Strongbox or iCloud may have just written it) ----------

export const configured = () => !!config()

async function load() {
  const c = config()
  if (!c) throw new Error("no passwords file is set up on this computer")
  const password = passwordOf(c)
  if (password === null) throw new Error("its password isn't kept since the app started: type it again")
  let data: Buffer
  try { data = fs.readFileSync(c.file) } catch { throw new Error(`${path.basename(c.file)} isn't there`) }
  const k = await kdbx()
  return { k, c, password, data, db: await k.loadKdbx(data, password) }
}

const hash = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex")
function writeAtomic(file: string, data: Uint8Array) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.vaultite-${process.pid}.tmp`)
  fs.writeFileSync(tmp, data, { mode: 0o600 })
  fs.renameSync(tmp, file)
}
function backup(file: string, data: Buffer) {
  fs.mkdirSync(BACKUPS(), { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(BACKUPS(), `${Date.now()}-${path.basename(file)}`), data, { mode: 0o600 })
  const old = fs.readdirSync(BACKUPS()).sort().slice(0, -30)
  for (const f of old) fs.rmSync(path.join(BACKUPS(), f), { force: true })
}

let writing: Promise<unknown> = Promise.resolve()
/** Change the file: applied to it as it is now, saved only if it opens again, the old one kept (the last 30), never over
 *  a write that came in meanwhile (tried again on it). Then each KeeShare export is written as KeePassXC would. */
function write<T>(edit: (db: Awaited<ReturnType<typeof load>>["db"], k: Awaited<ReturnType<typeof kdbx>>) => T): Promise<T> {
  const run = writing.then(async () => {
    for (let i = 0; ; i++) {
      const { k, c, password, data, db } = await load()
      const out = edit(db, k)
      db.cleanup({ historyRules: true })
      const saved = new Uint8Array(await db.save())
      await k.loadKdbx(saved, password)
      let now: Buffer | null = null
      try { now = fs.readFileSync(c.file) } catch { /* moved meanwhile */ }
      if (!now || hash(now) !== hash(data)) {
        if (i < 2) continue
        throw new Error(`${path.basename(c.file)} kept changing while saving: try again`)
      }
      backup(c.file, data)
      writeAtomic(c.file, saved)
      for (const s of k.sharesOf(db, c.file)) {
        if (!fs.existsSync(path.dirname(s.path))) continue
        try { writeAtomic(s.path, new Uint8Array(await k.exportOf(db, s))) } catch (e) { console.error("vaultite: a KeeShare export wasn't written:", (e as Error).message) }
      }
      changed()
      return out
    }
  })
  writing = run.catch(() => {})
  return run
}

// ---------- for the browser (userlogins.ts): the user's own logins ----------

export async function entriesForUrl(url: string): Promise<Row[]> {
  const { k, c, db } = await load()
  const { groups, entries } = k.listOf(db, c.file)
  const bin = new Set(groups.filter((g) => g.bin).map((g) => g.id))
  return entries.filter((e) => !bin.has(e.group) && e.urls.some((u) => k.matchesSite(u, url)))
}

export async function secretsOf(id: string): Promise<{ username: string; password: string; otp: Otp | "steam" | null } | null> {
  need()
  const { k, db } = await load()
  const e = k.entryById(db, id)
  if (!e) return null
  const f = k.fieldsOf(e)
  return { username: f.UserName ?? "", password: f.Password ?? "", otp: k.otpOf(f) }
}

/** A login the user just signed in with: a new entry named after its site, or `id`'s password changed. */
export async function saveLogin(l: { url: string; username: string; password: string; id?: string }): Promise<{ id: string }> {
  const site = (() => { try { return new URL(l.url) } catch { return null } })()
  if (!site || !/^https?:$/.test(site.protocol)) throw new Error("only a web page's login is saved")
  return write((db, k) => {
    if (l.id) {
      const f = k.entryById(db, l.id)
      if (!f) throw new Error("that entry is gone from the file")
      const ff = k.fieldsOf(f)
      return { id: k.applyChange(db, { id: l.id, title: ff.Title ?? "", username: l.username || (ff.UserName ?? ""), password: l.password, urls: k.urlsOf(ff), tags: [...f.tags], notes: ff.Notes ?? "" }) }
    }
    const host = site.hostname.replace(/^www\./, "")
    return { id: k.applyChange(db, { title: host, username: l.username, password: l.password, urls: [`${site.protocol}//${site.host}`], tags: [], notes: "" }) }
  })
}

/** A secret the user gave an agent (`vau secret`), kept in a Secrets group under its prompt: the same prompt again
 *  changes it, its old value kept in its history. Writing shows nothing, so it needs no unlock. */
handle("passwords:keep-secret", async (_win, title, value) => {
  const name = String(title ?? "").trim().slice(0, 200)
  if (!name || typeof value !== "string" || !value) throw new Error("nothing to keep")
  return { id: await write((db, k) => {
    const root = db.getDefaultGroup()
    const group = root.groups.find((g) => g.name === "Secrets") ?? db.createGroup(root, "Secrets")
    const was = group.entries.find((e) => k.fieldsOf(e).Title === name)
    const f = was ? k.fieldsOf(was) : {}
    return k.applyChange(db, { id: was?.uuid.id, group: group.uuid.id, title: name, username: f.UserName ?? "", password: value, urls: k.urlsOf(f), tags: was ? [...was.tags] : [], notes: f.Notes ?? "" })
  }) }
})

// (handing one to an agent always takes the user's finger, unlocked or not: computer use could click the dialog)
handle("passwords:give", async (_win, id) => {
  need()
  const { k, db } = await load()
  const e = k.entryById(db, String(id))
  if (!e) throw new Error("that entry is gone from the file")
  const f = k.fieldsOf(e)
  if (!(!app.isPackaged && process.env.VAULTITE_TEST_TOUCHID === "yes")) {
    if (!touchId()) throw new Error("Touch ID confirms giving a password to an agent, and it can't be used now: type it instead")
    if (!await systemPreferences.promptTouchID(`give ${f.Title || "a password"} to an agent`).then(() => true, () => false)) throw new Error("Touch ID didn't confirm it")
  }
  return f.Password ?? ""
})

// ---------- the page's calls (the app's windows only) ----------

handle("passwords:status", async () => {
  const c = config()
  if (!c) return null
  const base = { file: c.file, locked: !isUnlocked(), touchId: touchId(), ...(c.key === null ? { held: true } : {}) }
  try { await load(); return base } catch (e) { return { ...base, error: (e as Error).message } }
})
handle("passwords:choose", async (win) => {
  const r = await dialog.showOpenDialog(win, { title: "Your passwords", buttonLabel: "Choose", properties: ["openFile"], filters: [{ name: "KeePass", extensions: ["kdbx", "*"] }] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
// (the password comes from the app's own page, checked by opening the file, then kept with the keyring's key)
handle("passwords:set", async (_win, file, password) => {
  if (typeof file !== "string" || !path.isAbsolute(file) || typeof password !== "string" || !password) throw new Error("give a KeePass file and its password")
  let data: Buffer
  try { data = fs.readFileSync(file) } catch { return { error: "the file can't be read" } }
  try { await (await kdbx()).loadKdbx(data, password) } catch (e) { return { error: (e as Error).message } }
  const kept = keyring()
  const tmp = `${CONFIG()}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ file, key: kept ? safeStorage.encryptString(password).toString("base64") : null }), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG())
  held = kept ? null : { file, password }
  openUntil = Date.now() + OPEN_MS
  changed()
  return { file, locked: false, touchId: touchId(), ...(kept ? {} : { held: true }) }
})
handle("passwords:forget", () => {
  fs.rmSync(CONFIG(), { force: true })
  held = null
  lock()
  changed()
})
handle("passwords:unlock", async (_win, given) => {
  const c = config()
  if (!c) return { error: "no passwords file is set up on this computer" }
  if (typeof given === "string" && given) {
    const kept = passwordOf(c)
    if (kept === null) {
      // (no keyring: what's typed is checked by opening the file, then held)
      try { await (await kdbx()).loadKdbx(fs.readFileSync(c.file), given) } catch (e) { return { error: (e as Error).message } }
      held = { file: c.file, password: given }
    } else if (kept.length !== given.length || !crypto.timingSafeEqual(Buffer.from(kept), Buffer.from(given))) return { error: "that isn't its password" }
  } else {
    if (!(!app.isPackaged && process.env.VAULTITE_TEST_TOUCHID === "yes")) {
      if (!touchId()) return { error: "Touch ID can't be used now: type the file's password" }
      if (!await systemPreferences.promptTouchID("unlock your passwords").then(() => true, () => false)) return { error: "Touch ID didn't confirm it" }
    }
    if (passwordOf(c) === null) return { error: "its password isn't kept since the app started: type it" }
  }
  openUntil = Date.now() + OPEN_MS
  changed()
  return { ok: true }
})
handle("passwords:lock", lock)
handle("passwords:list", async () => {
  need()
  const { k, c, db } = await load()
  return k.listOf(db, c.file)
})
handle("passwords:get", async (_win, id): Promise<Full> => {
  need()
  const { k, c, db } = await load()
  const f = k.fullOf(db, c.file, String(id))
  if (!f) throw new Error("that entry is gone from the file")
  return f
})
handle("passwords:save", async (_win, change) => {
  need()
  if (!change || typeof change !== "object") throw new Error("nothing to save")
  return { id: await write((db, k) => k.applyChange(db, change as Change)) }
})
handle("passwords:delete", async (_win, id) => {
  need()
  await write((db, k) => k.removeEntry(db, String(id)))
})
handle("passwords:for-page", async (_win, id) => {
  need()
  const p = allPages().find((x) => x.id === Number(id))
  return p ? entriesForUrl(p.wc.getURL()) : []
})
