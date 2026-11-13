import { app } from "electron"
import { mayOpen, partitionOf } from "./browser/engine.ts"
import { lastVisits } from "./browser/history.ts"
import { ACCOUNTS, covers, nonempty, type Rule, type Who } from "./siteaccounts.ts"
import { writeAtomic } from "./setup.ts"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import { hostOfUrl, KNOWN, siteOf, FETCHED, type Known } from "./webwire.ts"
import { type Page, pages, sessions, web, type WebSite } from "./webbase.ts"
import { answer, loadAnswers } from "./webpermissions.ts"
import { readySession, webSession } from "./websession.ts"
import { iconBytes, iconOf, isIcon } from "./webicons.ts"

export const accounts = new Map<string, { at: number; login: string; who: Who | null }>()
const ASK_NAMED = 6 * 3_600_000, ASK_UNNAMED = 30 * 60_000, ASK_LOOK = 60_000

let known: Known | null = null
const knownFile = () => path.join(app.getPath("userData"), "web-accounts.json")
export function loadKnown(): Known {
  if (!known) { try { known = KNOWN.parse(JSON.parse(fs.readFileSync(knownFile(), "utf8"))) } catch { known = {} } }
  return known
}
export function keepKnown(profile: string, site: string, login: string, who: Who | null) {
  const k = loadKnown(), had = k[profile]?.[site]
  if (who ? had?.login === login && JSON.stringify(had.who) === JSON.stringify(who) && Date.now() - (had.at ?? 0) < ASK_NAMED / 2 : !had) return
  if (who) (k[profile] ??= {})[site] = { login, who, at: Date.now() }
  else delete k[profile]?.[site]
  try { writeAtomic(knownFile(), JSON.stringify(k)) } catch { /* asked again next time */ }
}
const loginHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16)
function loginOf(how: Rule, mine: Electron.Cookie[], login?: Electron.Cookie) {
  if (login) return loginHash(login.value)
  return how.url || how.read ? loginHash(mine.map((c) => c.name).sort().join(" ")) : "look"
}

async function accountOf(profile: string, site: string, cookies: Electron.Cookie[]): Promise<Who | null> {
  const how = ACCOUNTS[site]
  if (!how) return null
  const key = `${profile} ${site}`, now = Date.now()
  const mine = cookies.filter((c) => siteOf(c.domain ?? "") === site)
  const login = how.signed ? mine.find((c) => c.name.startsWith(how.signed!) && c.value) : undefined
  if (how.signed && !login) { accounts.set(key, { at: now, login: "", who: null }); keepKnown(profile, site, "", null); return null }
  const id = loginOf(how, mine, login), lookOnly = id === "look"
  const open = [...pages.values()].find((p) => p.profile === profile && !p.view.webContents.isDestroyed() && siteOf(hostOfUrl(p.view.webContents.getURL())) === site)
  const had = accounts.get(key), kept = loadKnown()[profile]?.[site]
  const wait = lookOnly ? ASK_LOOK : had?.who?.account ? ASK_NAMED : ASK_UNNAMED
  if (had && (had.login === id ? now - had.at < wait : now - had.at < ASK_LOOK)) return had.who
  if (!had && !lookOnly && kept?.login === id && now - (kept.at ?? 0) < ASK_NAMED) { accounts.set(key, { at: kept.at!, login: id, who: kept.who }); return kept.who }
  if (lookOnly && !open) return kept?.who ?? null // (as an open page last showed it)

  const s = webSession(profile)
  const found = await askWho(s, how, open).catch(() => null)
  let who: Who | null = null
  if (found === false) keepKnown(profile, site, "", null)
  else if (found?.account) {
    who = { account: found.account.slice(0, 200), ...(found.more?.length ? { more: found.more.map((m) => m.slice(0, 200)).slice(0, 9) } : {}) }
    const pic = found.avatar && /^https:\/\//.test(found.avatar) ? await iconBytes(s, found.avatar).then((b) => b && iconOf(b), () => null) : null
    if (pic && isIcon(pic)) who.avatar = pic
    keepKnown(profile, site, id, who)
  }
  else if (kept?.login === id && (!lookOnly || found === null)) who = kept.who
  else if (found || login) who = { account: "" }
  accounts.set(key, { at: now, login: id, who })
  return who
}

/** What a site's rule finds: who (an empty account: signed in, not named), false: signed out, null: it can't tell. */
export async function askWho(s: Electron.Session, how: Rule, open: Page | undefined): Promise<Who | false | null> {
  const inPage = <T>(code: string, as: z.ZodType<T>) => open!.view.webContents.executeJavaScriptInIsolatedWorld(1002, [{ code }]).then((v) => as.parse(v))
  const cookie = async (domain: string, name: string) => (await s.cookies.get({ domain, name }).catch(() => []))[0]?.value ?? ""
  if (how.look && open) {
    const w = how.look.read(await inPage(how.look.code, z.unknown()).catch(() => null))
    if (w !== null || !how.read) return w
  }
  if (!how.read) return null
  let res: z.infer<typeof FETCHED> = null
  if (how.url) {
    const as = how.text ? "text" : "json", headers = { accept: how.text ? "text/html,*/*" : "application/json", ...how.headers }
    if (how.page && open && !how.method) res = await inPage(`fetch(${JSON.stringify(how.url)}, { credentials: "include", headers: ${JSON.stringify(headers)} })
      .then(async (r) => r.ok ? { url: r.url, body: await r.${as}() } : null).catch(() => null)`, FETCHED).catch(() => null)
    res ??= await s.fetch(how.url, { method: how.method ?? "GET", credentials: "include", signal: AbortSignal.timeout(8000), headers })
      .then(async (r) => (r.ok ? { url: r.url, body: await (as === "text" ? r.text() : r.json()) } : null)).catch(() => null)
    if (!res?.body) return null
  }
  const v = await how.read(res?.body ?? null, cookie, res?.url ?? "")
  return typeof v === "string" ? (v ? { account: v } : null) : v && nonempty(v.account) ? { ...v, account: nonempty(v.account) } : null
}

export async function sitesOf(profile: string): Promise<WebSite[]> {
  const cookies = await (await readySession(profile)).cookies.get({})
  const names = [...new Set(cookies.map((c) => siteOf(c.domain ?? "")).filter(Boolean))]
  const been = visitedOf(profile)
  for (const p of pages.values()) if (p.profile === profile) been.add(siteOf(hostOfUrl(p.view.webContents.getURL())))
  const last = new Map<string, number>()
  for (const [host, at] of lastVisits(profile)) { const site = siteOf(host); if (at > (last.get(site) ?? 0)) last.set(site, at) }
  const out = await Promise.all(names.map(async (site): Promise<WebSite> => {
    const who = await accountOf(profile, site, cookies)
    const at = last.get(site)
    return { site, ...(who ? { signed: true, ...who, account: who.account || undefined } : {}), ...(at ? { last: at } : {}), ...(!who && !been.has(site) ? { other: true } : {}) }
  }))
  const joined = new Set<string>()
  for (const s of out) {
    const also = s.signed ? ACCOUNTS[s.site]?.with : undefined
    if (!also) continue
    const sites = names.filter((site) => site !== s.site && Object.entries(also).some(([k, name]) => covers(k, site) && cookies.some((c) => siteOf(c.domain ?? "") === site && c.name === name)))
    if (!sites.length) continue
    s.with = sites
    for (const x of sites) { joined.add(x); s.last = Math.max(s.last ?? 0, last.get(x) ?? 0) || undefined }
  }
  return out.filter((s) => !joined.has(s.site))
    .sort((a, b) => Number(!b.signed) - Number(!a.signed) || (b.last ?? 0) - (a.last ?? 0) || a.site.localeCompare(b.site))
}

const WHO_MS = 1500
export async function whoIn(site: string, profiles: string[]): Promise<Record<string, { account: string; more?: string[] } | null>> {
  const name = ACCOUNTS[site] ? site : Object.keys(ACCOUNTS).find((k) => Object.keys(ACCOUNTS[k].with ?? {}).some((w) => covers(w, site)))
  const used = (p: string) => sessions.has(p) || fs.existsSync(path.join(app.getPath("userData"), "Partitions", partitionOf(p).replace(/^persist:/, "")))
  const out: Record<string, { account: string; more?: string[] } | null> = {}
  await Promise.all([...new Set(profiles)].map(async (p) => {
    if (!name || !used(p) || !mayOpen(p)) return void (out[p] = null)
    const cookies = await (await readySession(p)).cookies.get({ domain: name }).catch(() => [])
    const late = new Promise<Who | null>((r) => setTimeout(() => r(loadKnown()[p]?.[name]?.who ?? null), WHO_MS).unref())
    const who = cookies.length ? await Promise.race([accountOf(p, name, cookies).catch(() => null), late]) : null
    out[p] = who ? { account: who.account, ...(who.more?.length ? { more: who.more } : {}) } : null
  }))
  return out
}

export async function forgetSite(prof: string, name: string) {
  const s = await readySession(prof)
  for (const c of await s.cookies.get({})) {
    const host = (c.domain ?? "").replace(/^\./, "")
    if (siteOf(host) !== name) continue
    await s.cookies.remove(`http${c.secure ? "s" : ""}://${host}${c.path ?? "/"}`, c.name).catch(() => {})
  }
  // (an address's site, 127.0.0.1, has no www.: clearData throws on an origin it can't parse)
  const origins = /^[\d.]+$|^localhost$/.test(name) ? [`http://${name}`, `https://${name}`] : [`https://${name}`, `https://www.${name}`]
  await Promise.resolve().then(() => s.clearData({ origins, dataTypes: ["cookies", "localStorage", "indexedDB", "serviceWorkers", "cache", "fileSystems"] })).catch(() => {})
  accounts.delete(`${prof} ${name}`)
  keepKnown(prof, name, "", null)
  for (const k of Object.keys(loadAnswers()[prof]?.[name] ?? {})) answer(prof, name, k, null) // what it may use is asked again
  reloadSite(prof, name)
}
export const reloadSite = (prof: string, name: string) => {
  for (const p of pages.values()) if (p.profile === prof && siteOf(hostOfUrl(p.view.webContents.getURL())) === name) p.view.webContents.reload()
}

type Visited = { sites: Record<string, string[]> }
let visited: Visited | null = null
const visitedFile = () => path.join(app.getPath("userData"), "web-sites.json")
function loadVisited(): Visited {
  if (!visited) {
    let j: Partial<Visited> = {}
    try { j = JSON.parse(fs.readFileSync(visitedFile(), "utf8")) } catch { /* none yet */ }
    visited = { sites: j.sites && typeof j.sites === "object" ? j.sites : {} }
  }
  return visited
}
const saveVisited = () => { try { fs.writeFileSync(visitedFile(), JSON.stringify(visited)) } catch { /* only the panel's split is lost */ } }
export const visitedOf = (profile: string) => new Set(loadVisited().sites[profile] ?? [])
export function addVisited(profile: string, sites: string[]) {
  const v = loadVisited(), been = visitedOf(profile)
  if (sites.every((s) => been.has(s))) return
  v.sites[profile] = [...new Set([...been, ...sites])].sort()
  saveVisited()
}
export function noteVisit(profile: string, url: string) {
  const site = web(url) ? siteOf(hostOfUrl(url)) : ""
  if (site) addVisited(profile, [site])
}
