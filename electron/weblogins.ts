import { app, safeStorage, type Session } from "electron"
import { handle, mayOpen } from "./browser/engine.ts"
import { newKeys, open as openSealed, seal } from "./browser/sealed.ts"
import { ACCOUNTS, type Who } from "./siteaccounts.ts"
import fs from "node:fs"
import path from "node:path"
import { cookiesFrom, knownFrom, SEAL_KEYS, SEALED_LOGIN, siteOf } from "./webwire.ts"
import { profileOf, str, type WebSite } from "./webbase.ts"
import { readySession } from "./websession.ts"
import { accounts, addVisited, askWho, forgetSite, keepKnown, loadKnown, reloadSite, sitesOf, visitedOf } from "./webaccounts.ts"

/** cookies.set for a cookie read from another session: a host-only one names no domain (a __Host- one must not). */
const setOfCookie = (c: Electron.Cookie): Electron.CookiesSetDetails => ({
  url: `${c.secure ? "https" : "http"}://${(c.domain ?? "").replace(/^\./, "")}${c.path || "/"}`, name: c.name, value: c.value,
  path: c.path || "/", secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite,
  ...(c.hostOnly ? {} : { domain: c.domain }), ...(c.session || !c.expirationDate ? {} : { expirationDate: c.expirationDate }) })
async function setCookies(s: Session, list: Electron.Cookie[]) {
  let failed = 0
  for (const c of list) await s.cookies.set(setOfCookie(c)).catch(() => { failed++ })
  return failed
}
async function dropCookies(s: Session, names: string[]) {
  for (const c of await s.cookies.get({})) {
    if (!names.includes(siteOf(c.domain ?? ""))) continue
    await s.cookies.remove(`http${c.secure ? "s" : ""}://${(c.domain ?? "").replace(/^\./, "")}${c.path ?? "/"}`, c.name).catch(() => {})
  }
}

type Leaving = { names: string[]; cookies: Electron.Cookie[]; account: string | null; known: Record<string, { login: string; who: Who }>; visited: string[] }

async function loginOut(from: string, names: string[]): Promise<Leaving> {
  if (!names.length) throw new Error("nothing to move")
  if (!mayOpen(from)) throw new Error("this container is locked")
  const src = await readySession(from)
  const cookies = (await src.cookies.get({})).filter((c) => names.includes(siteOf(c.domain ?? "")))
  if (!cookies.length) throw new Error("no cookies to move")
  const how = ACCOUNTS[names[0]]
  const before = (how?.url ? await askWho(src, how, undefined).catch(() => null) : null) || null
  const known: Leaving["known"] = {}
  for (const n of names) { const k = loadKnown()[from]?.[n]; if (k) known[n] = { login: k.login, who: k.who } }
  return { names, cookies, account: before?.account ?? null, known, visited: names.filter((n) => visitedOf(from).has(n)) }
}

async function loginIn(to: string, l: Leaving): Promise<{ ok: boolean; account?: string }> {
  if (!mayOpen(to)) throw new Error("this container is locked")
  const { names } = l, dst = await readySession(to)
  const had = (await dst.cookies.get({})).filter((c) => names.includes(siteOf(c.domain ?? "")))
  const how = ACCOUNTS[names[0]]
  await dropCookies(dst, names)
  if (await setCookies(dst, l.cookies) > l.cookies.length / 2) { await dropCookies(dst, names); await setCookies(dst, had); throw new Error("couldn't set its cookies") }
  if (l.account && how) {
    const after = await askWho(dst, how, undefined).catch(() => null)
    if (!after || after.account !== l.account) {
      await dropCookies(dst, names)
      await setCookies(dst, had)
      return { ok: false, account: l.account }
    }
  }
  for (const n of names) {
    accounts.delete(`${to} ${n}`)
    const k = l.known[n]
    if (k) keepKnown(to, n, k.login, k.who)
  }
  addVisited(to, l.visited.concat(names[0]))
  for (const n of names) reloadSite(to, n)
  return { ok: true, account: l.account ?? undefined }
}

export async function moveLogins(from: string, to: string, names: string[], copy: boolean): Promise<{ ok: boolean; account?: string }> {
  if (from === to) throw new Error("nothing to move")
  if (!mayOpen(to)) throw new Error("this container is locked")
  const r = await loginIn(to, await loginOut(from, names))
  if (r.ok && !copy) for (const n of names) await forgetSite(from, n)
  return r
}

// A login leaves only sealed for the other app (browser/sealed.ts), on the user's act in this window; taking one in
// (remote:take) the server may ask: like an agent signing in, it adds a login of the sites named and reads none.

const SEALED_MS = 5 * 60_000
const taken = new Map<string, number>()

/** This app's key pair for sealed logins, made once and kept encrypted with the keyring's key (userData). With no keyring
 *  (a Linux without a Secret Service), held only till the app quits, as agents' logins are (browser/logins.ts). */
let sealKeys: { pub: string; priv: string } | null = null
function keysForSealing() {
  if (sealKeys) return sealKeys
  if (!safeStorage.isEncryptionAvailable()) return (sealKeys = newKeys())
  const file = path.join(app.getPath("userData"), "Login Key.vaultite")
  try { sealKeys = SEAL_KEYS.parse(JSON.parse(safeStorage.decryptString(fs.readFileSync(file)))) }
  catch {
    sealKeys = newKeys()
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(sealKeys)), { mode: 0o600 })
  }
  return sealKeys
}

const sealedFor = (to: string) => `vaultite login for ${to}`

handle("remote:key", () => ({ key: keysForSealing().pub }))
handle("remote:sites", async (_win, profiles) => {
  const out: Record<string, WebSite[]> = {}
  for (const p of new Set((Array.isArray(profiles) ? profiles : []).slice(0, 50).map(profileOf))) {
    if (!mayOpen(p)) continue
    const sites = (await sitesOf(p)).filter((s) => !s.other) // (trackers stay this Mac's business)
    if (sites.length) out[p] = sites
  }
  return out
})
handle("remote:take", async (_win, to, sealed) => {
  const prof = profileOf(to)
  const { data, from } = openSealed(keysForSealing(), str(sealed).slice(0, 4 << 20), sealedFor(prof))
  const d = SEALED_LOGIN.parse(data)
  const now = Date.now()
  for (const [k, at] of taken) if (now - at > SEALED_MS) taken.delete(k)
  if (typeof d.at !== "number" || Math.abs(now - d.at) > SEALED_MS) throw new Error("the login took too long to come: copy it again")
  if (taken.has(from)) throw new Error("that login was copied here already")
  taken.set(from, now)
  const names = d.names ?? []
  const cookies = cookiesFrom(d.cookies ?? [], names)
  if (!names.length || !cookies.length) throw new Error("no cookies to move")
  const known = knownFrom(d.known ?? {}, names)
  return loginIn(prof, { names, cookies, account: typeof d.account === "string" ? d.account : null, known, visited: (d.visited ?? []).filter((n) => names.includes(n)) })
})

export async function sealLogin(from: string, names: string[], to: string, key: string) {
  const l = await loginOut(from, names)
  return seal(key, { ...l, at: Date.now() }, sealedFor(to))
}
