// Your passwords: the user's own KeePass file (the one KeePassXC and Strongbox open), for the Passwords page, filling
// their own logins and saving new ones; never through the server, which agents can call. Opened only in kdbxproc.ts.
import { app, clipboard, dialog, powerMonitor, safeStorage, systemPreferences } from "electron"
import fs from "node:fs"
import path from "node:path"
import { allPages, enclave, handle, tellAll, logger } from "./engine.ts"
import { kdbx, onCrash } from "./kdbxhost.ts"
import { OPS, type Access, type SAVED } from "./kdbxwire.ts"
import type { z } from "zod"
import { MasterKey } from "./masterkey.ts"
import { messageOf } from "./messageof.ts"
import { indexedFor, indexedSame, indexOf, newSalt, type Index } from "./passwordsindex.ts"
import { openFor } from "./passwordslock.ts"
import { CHANGE } from "./passwordswire.ts"

const log = logger("passwords")

const test = () => !app.isPackaged && process.env.VAULTITE_TEST_TOUCHID === "yes" // (QA: no finger in a test)
const touchId = () => process.platform === "darwin" && systemPreferences.canPromptTouchID()
const finger = {
  can: () => test() || touchId(),
  ask: async (reason: string) => test() || systemPreferences.promptTouchID(reason).then(() => true, () => false),
}
let key: MasterKey | undefined
const master = () => key ??= new MasterKey({ dir: app.getPath("userData"), safe: safeStorage, finger,
  unsealed: (why) => log.error(`its password isn't behind Touch ID yet: ${why}`), enclave: () => enclave().catch((e) => { log.warn(`no Secure Enclave: ${messageOf(e)}`); return null }) })

// ---------- the lock: what shows a secret or lists entries waits for Touch ID or the file's password ----------

const OPEN_MS = 10 * 60_000
const opened = openFor(OPEN_MS, () => lock())
const changed = () => tellAll({ type: "engine:passwords:changed" })
export const isUnlocked = () => opened.isOpen()
function need() {
  if (!isUnlocked()) throw new Error("locked")
  opened.open()
}
function lock() {
  const was = opened.close()
  kdbx().lock()
  if (was) changed()
}
onCrash(() => { log.error("the passwords process stopped"); lock() })
app.whenReady().then(() => { powerMonitor.on("lock-screen", lock); powerMonitor.on("suspend", lock) }, () => {})


export const configured = () => !!master().config()
function config() {
  const c = master().config()
  if (!c) throw new Error("no passwords file is set up on this computer")
  return c
}
async function access(reason: string): Promise<Access> {
  const { file } = config()
  if (isUnlocked()) return { file }
  const password = master().gated() ? reason ? await master().ask(reason) : null : master().silent()
  if (password) return { file, password }
  throw new Error(master().gated() ? "locked" : "its password isn't kept since the app started: type it again")
}

async function reach<T>(reason: string, fn: (a: Access) => Promise<T>): Promise<T> {
  const a = await access(reason)
  try { return await fn(a) } finally { a.password?.fill(0) }
}
async function shown<T>(fn: (a: Access) => Promise<T>): Promise<T> {
  need()
  const out = await reach("", fn)
  if (!isUnlocked()) throw new Error("locked")
  return out
}

async function open(file: string, password: Uint8Array) {
  await kdbx().call(OPS.unlock, { file, password })
  if (!kdbx().unlocked()) throw new Error("locked")
  opened.open()
}


const INDEX = () => path.join(app.getPath("userData"), "passwords-index.bin")
let index: Index | null = null
function indexed(): Index {
  const { file } = config()
  try { index ??= indexOf(safeStorage.decryptString(fs.readFileSync(INDEX()))) } catch { index = null }
  if (index?.file !== file) throw new Error("locked")
  return index
}
async function reindex(a: Access) {
  if (!master().gated()) return forgetIndex()
  try {
    const salt = newSalt()
    index = { file: a.file, salt, rows: await kdbx().call(OPS.index, { ...a, salt }) }
    const tmp = `${INDEX()}.${process.pid}.tmp`
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(index)), { mode: 0o600 })
    fs.renameSync(tmp, INDEX())
  } catch (e) { log.error(`what's for which site wasn't kept: ${messageOf(e)}`) }
}
function forgetIndex() {
  index = null
  fs.rmSync(INDEX(), { force: true })
}
const byIndex = () => !isUnlocked() && master().gated()

const saved = (reason: string, save: (a: Access) => Promise<z.output<typeof SAVED>>) => reach(reason, async (a) => {
  const { id, warnings } = await save(a)
  for (const w of warnings) log.error(w)
  await reindex(a)
  changed()
  return { id }
})

// ---------- for the browser (userlogins.ts): the user's own logins ----------

export const entriesForUrl = async (url: string) =>
  byIndex() ? indexedFor(indexed(), url) : reach("", (a) => kdbx().call(OPS.entriesForUrl, { ...a, url }))

export const secretsOf = (id: string) => shown((a) => kdbx().call(OPS.secretsOf, { ...a, id }))

export const samePassword = async (ids: string[], given: string) =>
  new Set(byIndex() ? indexedSame(indexed(), ids, given) : await reach("", (a) => kdbx().call(OPS.samePassword, { ...a, ids, given })))

export const saveLogin = (l: { url: string; username: string; password: string; id?: string }) =>
  saved("save a login to your passwords", (a) => kdbx().call(OPS.saveLogin, { ...a, url: l.url, username: l.username, given: l.password, id: l.id }))

handle("passwords:keep-secret", async (_win, title, value) => {
  const name = String(title ?? "").trim().slice(0, 200)
  if (!name || typeof value !== "string" || !value) throw new Error("nothing to keep")
  return saved("keep a secret in your passwords", (a) => kdbx().call(OPS.keepSecret, { ...a, title: name, value }))
})

// (handing one to an agent always takes the user's finger, unlocked or not: computer use could click the dialog)
handle("passwords:give", async (_win, id) => {
  const e = await shown((a) => kdbx().call(OPS.get, { ...a, id: String(id) }))
  if (!e) throw new Error("that entry is gone from the file")
  if (!finger.can()) throw new Error("Touch ID confirms giving a password to an agent, and it can't be used now: type it instead")
  if (!await finger.ask(`give ${e.title || "a password"} to an agent`)) throw new Error("Touch ID didn't confirm it")
  return e.password
})

// (copied here, not by the page: a window in the background can't touch the clipboard, so it never cleared it on time)
let copied: { text: string; timer: NodeJS.Timeout } | null = null
handle("passwords:copy", async (_win, text) => {
  if (typeof text !== "string" || !text) return
  await clipboard.writeText(text)
  if (copied) clearTimeout(copied.timer)
  const mine = { text, timer: setTimeout(async () => { if (copied === mine) { copied = null; if (await clipboard.readText() === text) await clipboard.clear() } }, 30_000) }
  copied = mine
})

// ---------- the page's calls (the app's windows only) ----------

const held = () => (master().onlyHeld() ? { held: true } : {})
handle("passwords:status", async () => {
  const c = master().config()
  if (!c) return null
  const base = { file: c.file, locked: !isUnlocked(), touchId: touchId(), ...held() }
  try {
    if (isUnlocked()) await reach("", (a) => kdbx().call(OPS.check, a))
    else if (!fs.existsSync(c.file)) throw new Error(`${path.basename(c.file)} isn't there`)
    else if (!master().gated() && !master().silent()) throw new Error("its password isn't kept since the app started: type it again")
    return base
  } catch (e) { return { ...base, error: messageOf(e) } }
})
handle("passwords:choose", async (win) => {
  const r = await dialog.showOpenDialog(win, { title: "Your passwords", buttonLabel: "Choose", properties: ["openFile"], filters: [{ name: "KeePass", extensions: ["kdbx", "*"] }] })
  return r.canceled ? null : r.filePaths[0] ?? null
})
async function openTyped(file: string, typed: string): Promise<string | null> {
  const password = new TextEncoder().encode(typed)
  try { await open(file, password) } catch (e) { return messageOf(e) }
  try { await master().keep(file, password) } catch (e) { lock(); return messageOf(e) } finally { password.fill(0) }
  await reindex({ file })
  changed()
  return null
}
handle("passwords:set", async (_win, file, password) => {
  if (typeof file !== "string" || !path.isAbsolute(file) || typeof password !== "string" || !password) throw new Error("give a KeePass file and its password")
  const error = await openTyped(file, password)
  if (error) return { error }
  return { file, locked: false, touchId: touchId(), ...held() }
})
handle("passwords:forget", async () => {
  master().forget()
  forgetIndex()
  lock()
  changed()
})
handle("passwords:unlock", async (_win, given) => {
  const c = master().config()
  if (!c) return { error: "no passwords file is set up on this computer" }
  if (typeof given === "string" && given) {
    const error = await openTyped(c.file, given)
    return error ? { error } : { ok: true }
  }
  let password: Uint8Array | undefined
  try {
    password = await master().ask("unlock your passwords")
    await open(c.file, password)
    if (await master().couldBeGated()) await master().keep(c.file, password)
  } catch (e) { return { error: messageOf(e) } } finally { password?.fill(0) }
  await reindex({ file: c.file })
  changed()
  return { ok: true }
})
handle("passwords:lock", lock)
handle("passwords:list", () => shown((a) => kdbx().call(OPS.list, a)))
handle("passwords:get", async (_win, id) => {
  const f = await shown((a) => kdbx().call(OPS.get, { ...a, id: String(id) }))
  if (!f) throw new Error("that entry is gone from the file")
  return f
})
handle("passwords:save", async (_win, change) => {
  need()
  const c = CHANGE.safeParse(change)
  if (!c.success) throw new Error("nothing to save")
  return saved("", (a) => kdbx().call(OPS.save, { ...a, change: c.data }))
})
handle("passwords:delete", async (_win, id) => {
  need()
  await saved("", (a) => kdbx().call(OPS.delete, { ...a, id: String(id) }))
})
handle("passwords:for-page", async (_win, id) => {
  need()
  const p = allPages().find((x) => x.id === Number(id))
  return p ? entriesForUrl(p.wc.getURL()) : []
})
