// Session cookies (no expiry) kept across restarts, as Chrome does when it continues where you left off: Chromium drops
// them at each launch, and with them the logins of sites that use one (Apple's, HostGator's). Why so: CLAUDE.md.
import { safeStorage, type Cookie, type Session } from "electron"
import fs from "node:fs"
import path from "node:path"
import { eachSession, onFlush } from "./engine.ts"

const FILE = "Session Cookies.vaultite"
/** Written this long after the last change: a burst of a page's cookies is one write. */
const WRITE_MS = 1000
/** Pages wait for the restore at most this long (the Keychain slow to answer): then they open without. */
const RESTORE_MS = 3000
const VERSION = 1

/** What a session cookie is set again from. */
export type Kept = { name: string; value: string; domain: string; hostOnly: boolean; path: string; secure: boolean; httpOnly: boolean
  sameSite: Cookie["sameSite"] }
const SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"])
const keyOf = (c: { name: string; domain?: string; path?: string }) => `${c.name}\t${c.domain ?? ""}\t${c.path ?? "/"}`
export const keptOf = (c: Cookie): Kept => ({ name: c.name, value: c.value, domain: c.domain ?? "", hostOnly: !!c.hostOnly, path: c.path || "/",
  secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite })
/** Electron's cookies.set for a kept cookie: no expiry, so a session cookie again; a host-only one names no domain. */
export function setOf(k: Kept): Electron.CookiesSetDetails {
  const host = k.domain.replace(/^\./, "")
  return { url: `${k.secure ? "https" : "http"}://${host}${k.path}`, name: k.name, value: k.value, path: k.path, secure: k.secure,
    httpOnly: k.httpOnly, sameSite: k.sameSite, ...(k.hostOnly ? {} : { domain: k.domain }) }
}
/** The kept cookies a file's text holds (anything malformed left out). */
export function parseKept(text: string): Kept[] {
  const j = JSON.parse(text) as { v?: number; cookies?: unknown }
  if (j?.v !== VERSION || !Array.isArray(j.cookies)) return []
  return (j.cookies as Partial<Record<keyof Kept, unknown>>[]).filter((c) => !!c && typeof c === "object" && typeof c.name === "string"
    && typeof c.value === "string" && typeof c.domain === "string" && /^\.?[\w.:[\]-]+$/.test(c.domain) && typeof c.path === "string"
    && c.path.startsWith("/") && SAME_SITE.has(c.sameSite as string))
    .map((c) => ({ name: c.name as string, value: c.value as string, domain: c.domain as string, hostOnly: !!c.hostOnly, path: c.path as string,
      secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite as Kept["sameSite"] }))
}

type Jar = { s: Session; file: string; cookies: Map<string, Kept>; timer: NodeJS.Timeout | null; writing: Promise<void> | null; dirty: boolean }
const jars = new Set<Jar>()

eachSession((s) => {
  if (!s.isPersistent() || !s.storagePath) return
  const jar: Jar = { s, file: path.join(s.storagePath, FILE), cookies: new Map(), timer: null, writing: null, dirty: false }
  jars.add(jar)
  let restoring = true
  s.cookies.on("changed", (_e, c, _cause, removed) => {
    const key = keyOf(c)
    if (!removed && c.session) jar.cookies.set(key, keptOf(c))
    else if (!jar.cookies.delete(key)) return
    if (!restoring) later(jar)
  })
  const restore = (async () => {
    const kept = await read(jar.file)
    // (given up on, its pages open: what they set isn't put back over)
    for (const k of kept) if (restoring) await s.cookies.set(setOf(k)).catch(() => {})
    return true
  })().catch((e) => { console.error("vaultite: couldn't set the session cookies again:", e); return false })
  return Promise.race([restore, new Promise<boolean>((done) => setTimeout(() => done(false), RESTORE_MS))]).then((done) => {
    restoring = false
    // (the file is what the session has from now on; one that couldn't be read is left till the session changes)
    if (done) later(jar)
  })
})

/** A file's cookies, decrypted: none when there's no file, or the Keychain can't open it. */
async function read(file: string): Promise<Kept[]> {
  let data: Buffer
  try { data = await fs.promises.readFile(file) } catch { return [] }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return []
  const { result } = await safeStorage.decryptStringAsync(data)
  return parseKept(result)
}

function later(jar: Jar) {
  jar.dirty = true
  if (jar.timer) clearTimeout(jar.timer)
  jar.timer = setTimeout(() => void write(jar), WRITE_MS)
}

/** The jar's cookies on disk, encrypted, or no file when it has none. Never in plain text: without the Keychain's key
 *  nothing is written (the cookies are lost at the next restart, as Chromium loses them). */
async function write(jar: Jar): Promise<void> {
  if (jar.timer) { clearTimeout(jar.timer); jar.timer = null }
  while (jar.writing) await jar.writing
  if (!jar.dirty) return
  jar.dirty = false
  jar.writing = (async () => {
    if (!jar.cookies.size) { await fs.promises.rm(jar.file, { force: true }); return }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return
    const data = await safeStorage.encryptStringAsync(JSON.stringify({ v: VERSION, cookies: [...jar.cookies.values()] }))
    const tmp = `${jar.file}.${process.pid}.tmp`
    await fs.promises.writeFile(tmp, data, { mode: 0o600 })
    await fs.promises.rename(tmp, jar.file)
  })().catch((e) => console.error("vaultite: couldn't keep the session cookies:", e)).finally(() => { jar.writing = null })
  await jar.writing
}

onFlush(() => Promise.all([...jars].map(write)))
