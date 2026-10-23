// Browsing history: every page's visits, kept on this Mac (userData/web-history.sqlite, never the vault), ranked by
// frecency for the address bar's suggestions and listed by day for the History tab.
import { app } from "electron"
import { AppWindow } from "../appwindow.ts"
import { DatabaseSync, type StatementSync } from "node:sqlite"
import path from "node:path"
import { eachPage, handle, tell } from "./engine.ts"
import { hasSecret, scrub } from "./pagesecrets.ts"

/** How a visit came: typed in the address (or picked from its suggestions), a link, a bookmark, a form, or the app
 *  (a link in a note, back and forward). */
export type How = "typed" | "link" | "bookmark" | "form" | "other"
const HOWS = new Set<string>(["typed", "link", "bookmark", "form", "other"])
export type Visit = { id: number; url: string; title: string; host: string; at: number; profile: string; how: How }
/** A visit as deleting it answers it, to put back (Undo). */
export type Removed = { url: string; title: string; at: number; profile: string; how: How; source: string }
export type Suggestion = { url: string; title: string; host: string; visits: number; typed: number; last: number }

let db: DatabaseSync | null = null
const q = new Map<string, StatementSync>()
/** A statement, prepared once. */
const sql = (text: string) => { let s = q.get(text); if (!s) q.set(text, s = open().prepare(text)); return s }

function open() {
  if (db) return db
  db = new DatabaseSync(path.join(app.getPath("userData"), "web-history.sqlite"))
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '', visits INTEGER NOT NULL DEFAULT 0, typed INTEGER NOT NULL DEFAULT 0,
      last INTEGER NOT NULL DEFAULT 0, frecency REAL NOT NULL DEFAULT 0, scored INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, url INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
      at INTEGER NOT NULL, profile TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT 'link', source TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS visits_once ON visits(url, at);
    CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
    CREATE INDEX IF NOT EXISTS urls_host ON urls(host);
    CREATE INDEX IF NOT EXISTS urls_frecency ON urls(frecency);`)
  rescoreStale()
  setInterval(rescoreStale, 6 * 3600_000).unref()
  return db
}

/** Runs `fn` in one transaction (a page's visit, an import's thousands). */
function tx<T>(fn: () => T): T {
  const d = open()
  d.exec("BEGIN")
  try { const r = fn(); d.exec("COMMIT"); return r } catch (e) { d.exec("ROLLBACK"); throw e }
}

// ---------- frecency: Firefox's, as Chrome's omnibox ranks by visits, typed visits and recency ----------

const DAY = 86_400_000
const today = () => Math.floor(Date.now() / DAY)
/** A visit's worth by its age, and by how it came (a reload is worth nothing, a typed address double). */
const ageWeight = (age: number) => (age <= 4 * DAY ? 100 : age <= 14 * DAY ? 70 : age <= 31 * DAY ? 50 : age <= 90 * DAY ? 30 : 10)
const HOW_BONUS: Record<string, number> = { typed: 2, bookmark: 1.4, link: 1, other: 1, form: 0.6 }
/** Its last ten visits' worth, as an average, times how many visits it has. */
function frecencyOf(count: number, recent: { at: number; how: string }[]) {
  if (!count || !recent.length) return 0
  const now = Date.now()
  const points = recent.reduce((n, v) => n + ageWeight(now - v.at) * (HOW_BONUS[v.how] ?? 1), 0)
  return Math.ceil((count * points) / recent.length)
}

/** One address's counts and frecency from its visits; gone when it has none left. */
function rescore(urlId: number) {
  const n = sql("SELECT count(*) AS n, sum(how = 'typed') AS typed, max(at) AS last FROM visits WHERE url = ?").get(urlId) as { n: number; typed: number | null; last: number | null }
  if (!n.n) { sql("DELETE FROM urls WHERE id = ?").run(urlId); return }
  const recent = sql("SELECT at, how FROM visits WHERE url = ? ORDER BY at DESC LIMIT 10").all(urlId) as { at: number; how: string }[]
  sql("UPDATE urls SET visits = ?, typed = ?, last = ?, frecency = ?, scored = ? WHERE id = ?").run(n.n, n.typed ?? 0, n.last ?? 0, frecencyOf(n.n, recent), today(), urlId)
}

/** Frecency drops as days pass: what wasn't scored today is scored again (at start, then every few hours). */
function rescoreStale() {
  const stale = sql("SELECT id FROM urls WHERE scored < ?").all(today()) as { id: number }[]
  if (!stale.length) return
  tx(() => { for (const { id } of stale) rescore(id) })
}

// ---------- recording ----------

const web = (u: string) => /^https?:\/\//i.test(u)
/** The host as sites are matched and deleted: lower case, without "www.". */
export const hostKey = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" } }

/** A visit to `url`: its address kept (or its title updated), the visit added, its score again. */
function addVisit(url: string, title: string, at: number, profile: string, how: How, source = "") {
  sql("INSERT INTO urls (url, title, host) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END")
    .run(url, title, hostKey(url))
  const { id } = sql("SELECT id FROM urls WHERE url = ?").get(url) as { id: number }
  const r = sql("INSERT OR IGNORE INTO visits (url, at, profile, how, source) VALUES (?, ?, ?, ?, ?)").run(id, at, profile, how, source)
  return { id, added: Number(r.changes) > 0 }
}

/** Addresses the app is about to open from the address bar, and how (typed, a bookmark), till their page starts it. */
const asked = new Map<string, { how: How; at: number }>()
const ASKED_FOR = 15_000

/** Windows are told the history changed (the History tab, the bar's suggestions), at most once a second. */
let telling: ReturnType<typeof setTimeout> | null = null
function changed() {
  telling ??= setTimeout(() => {
    telling = null
    for (const w of AppWindow.getAllWindows()) tell(w, { type: "engine:history:changed" })
  }, 1000)
}

// (an address a login the app filled put its password in, a GET form's, is never kept: nor a title showing one)
function record(url: string, title: string, profile: string, how: How) {
  if (!web(url) || hasSecret(url)) return
  try {
    tx(() => { const v = addVisit(url, scrub(title), Date.now(), profile, how); if (v.added) rescore(v.id) })
    changed()
  } catch (e) { console.error("vaultite: a visit wasn't kept in the history:", e) }
}

/** A page's title, as it changes (a visit's title is its page's last). */
function retitle(url: string, title: string) {
  if (!web(url) || !title || hasSecret(url)) return
  const t = scrub(title)
  try { if (Number(sql("UPDATE urls SET title = ? WHERE url = ? AND title <> ?").run(t, url, t).changes)) changed() } catch { /* kept as it was */ }
}

const noHash = (u: string) => u.replace(/#.*$/, "")

eachPage(({ wc, profile }) => {
  // (agents' pages aren't the user's history: their runs are kept for replay instead, agent.ts)
  if (profile === "c-agents") return
  // What started the navigation under way (Chromium may start one twice): the address bar (typed, a bookmark), the
  // page (will-navigate, after it starts: a link, a form), or neither (the app, back and forward).
  let starting = "", byPage = false, last = ""
  wc.on("did-start-navigation", (d) => {
    if (!d.isMainFrame || d.isSameDocument || d.url === starting) return
    starting = d.url
    byPage = false
  })
  wc.on("will-navigate", (e) => { if (e.isMainFrame) byPage = true })
  wc.on("did-navigate", (_e, url) => {
    const a = asked.get(starting)
    const how: How = a && Date.now() - a.at < ASKED_FOR ? a.how : byPage ? "link" : "other"
    asked.delete(starting)
    starting = ""
    byPage = false
    // (a reload isn't a visit: Chrome keeps it, but worth nothing)
    if (url === last && how === "other") return
    last = url
    record(url, wc.getTitle(), profile, how)
  })
  // A page's own route change (a single-page app) is a visit; a jump within the page (#section) isn't.
  wc.on("did-navigate-in-page", (_e, url, main) => {
    if (!main || noHash(url) === noHash(last)) return
    last = url
    record(url, wc.getTitle(), profile, "link")
  })
  wc.on("page-title-updated", (_e, title) => retitle(wc.getURL(), title))
})

// ---------- reading ----------

/** When each host was last visited in a profile's logins (the Sites panel's order). */
export function lastVisits(profile: string): Map<string, number> {
  try {
    const rows = sql("SELECT u.host AS host, max(v.at) AS at FROM visits v JOIN urls u ON u.id = v.url WHERE v.profile = ? GROUP BY u.host").all(profile) as { host: string; at: number }[]
    return new Map(rows.map((r) => [r.host, r.at]))
  } catch { return new Map() }
}

/** "https://www.youtube.com/watch" -> "youtube.com/watch": what the address bar completes and matches against. */
export const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** Whether `w` starts a word of `hay` ("tube" doesn't in "youtube", "you" does). */
const startsWord = (hay: string, w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}`, "u").test(hay)

/** Matches for what's typed in the address bar, best first, and the address to complete it to inline: a site visited
 *  while what's typed is part of its name (as Firefox), a deeper address only once typed or visited often (as Chrome). */
export function search(text: string, limit = 8): { complete: { text: string; url: string } | null; rows: Suggestion[] } {
  const t = text.trim().toLowerCase(), ws = words(t)
  if (!ws.length) return { complete: null, rows: [] }
  const where = ws.map(() => "(instr(lower(url), ?) > 0 OR instr(lower(title), ?) > 0)").join(" AND ")
  const found = sql(`SELECT url, title, host, visits, typed, last, frecency FROM urls WHERE frecency > 0 AND ${where} ORDER BY frecency DESC LIMIT 400`)
    .all(...ws.flatMap((w) => [w, w])) as (Suggestion & { frecency: number })[]
  const scored = found.flatMap((r) => {
    const b = bare(r.url).toLowerCase(), title = r.title.toLowerCase()
    // A word matched only in the middle of another (a short one, "ub" in "youtube") doesn't count, as Chrome has it.
    if (!ws.every((w) => w.length >= 3 || startsWord(b, w) || startsWord(title, w))) return []
    const q = b.startsWith(t) ? 4 : ws.some((w) => startsWord(r.host, w)) ? 2.5 : ws.every((w) => startsWord(title, w) || startsWord(b, w)) ? 1.5 : 1
    return [{ r, score: r.frecency * q }]
  }).sort((a, b) => b.score - a.score)
  const complete = completion(t, found)
  const rows = scored.map((x) => x.r)
  if (complete) { const i = rows.findIndex((r) => r.url === complete.url); if (i > 0) rows.unshift(...rows.splice(i, 1)) }
  return { complete, rows: rows.slice(0, limit).map(({ frecency: _f, ...r }) => r) }
}

function completion(t: string, rows: (Suggestion & { frecency: number })[]) {
  if (/\s/.test(t) || t.length < 1) return null
  const fit = rows.filter((r) => bare(r.url).toLowerCase().startsWith(t))
  if (!fit.length) return null
  if (!t.includes("/")) {
    // The site: the host with the most worth among those starting so, its front page if it has one.
    const byHost = new Map<string, { worth: number; best: Suggestion & { frecency: number } }>()
    for (const r of fit) {
      const h = bare(r.url).split("/")[0].toLowerCase(), had = byHost.get(h)
      if (!had) byHost.set(h, { worth: r.frecency, best: r })
      else { had.worth += r.frecency; if (bare(r.url).length < bare(had.best.url).length) had.best = r }
    }
    const [host, top] = [...byHost.entries()].sort((a, b) => b[1].worth - a[1].worth)[0]
    const front = rows.find((r) => /^[^/]+\/?$/.test(bare(r.url)) && bare(r.url).toLowerCase().replace(/\/$/, "") === host)
    const url = front?.url ?? new URL("/", top.best.url).href
    return { text: host, url }
  }
  const best = fit.filter((r) => r.typed > 0 || r.visits >= 2).sort((a, b) => b.frecency - a.frecency || a.url.length - b.url.length)[0]
  return best ? { text: bare(best.url).replace(/\/$/, ""), url: best.url } : null
}

/** The sites visited most, one address each (a new tab's). */
export function top(limit = 8): Suggestion[] {
  const rows = sql("SELECT url, title, host, visits, typed, last FROM urls WHERE frecency > 0 ORDER BY frecency DESC LIMIT 200").all() as Suggestion[]
  const seen = new Set<string>(), out: Suggestion[] = []
  for (const r of rows) { if (seen.has(r.host)) continue; seen.add(r.host); out.push(r); if (out.length >= limit) break }
  return out
}

/** Visits, newest first, before `before` (ms; a page's last `at`), matching `text` when given. */
export function list(opts: { before?: number; text?: string; limit?: number }) {
  const ws = words(opts.text ?? ""), limit = Math.min(Math.max(1, opts.limit ?? 200), 1000)
  const where = ["v.at < ?", ...ws.map(() => "(instr(lower(u.url), ?) > 0 OR instr(lower(u.title), ?) > 0)")].join(" AND ")
  const rows = sql(`SELECT v.id, v.at, v.profile, v.how, u.url, u.title, u.host FROM visits v JOIN urls u ON u.id = v.url WHERE ${where} ORDER BY v.at DESC LIMIT ?`)
    .all(opts.before ?? Number.MAX_SAFE_INTEGER, ...ws.flatMap((w) => [w, w]), limit + 1) as Visit[]
  return { visits: rows.slice(0, limit), more: rows.length > limit }
}

// ---------- deleting ----------

/** Visits (by id) and addresses (every visit of each) taken out of the history: what was taken, to put back. */
export function remove(o: { visits?: number[]; urls?: string[] }): Removed[] {
  const ids = (o.visits ?? []).filter((n) => Number.isInteger(n)).slice(0, 100_000)
  const urls = (o.urls ?? []).filter((u) => typeof u === "string").slice(0, 10_000)
  const out = tx(() => {
    const gone: (Removed & { urlId: number; id: number })[] = []
    for (const id of ids) {
      const r = sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE v.id = ?").get(id)
      if (r) gone.push(r as unknown as Removed & { urlId: number; id: number })
    }
    for (const url of urls) gone.push(...sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.url = ?").all(url) as unknown as (Removed & { urlId: number; id: number })[])
    return takeOut(gone)
  })
  changed()
  return out
}

/** Every visit to a site ("example.com": its subdomains too). */
export function removeSite(site: string): Removed[] {
  const s = site.toLowerCase().replace(/^www\./, "")
  if (!s) return []
  const out = tx(() => takeOut(sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.host = ? OR u.host LIKE ?")
    .all(s, `%.${s}`) as unknown as (Removed & { urlId: number; id: number })[]))
  changed()
  return out
}

function takeOut(gone: (Removed & { urlId: number; id: number })[]): Removed[] {
  const del = sql("DELETE FROM visits WHERE id = ?"), touched = new Set<number>(), seen = new Set<number>()
  const out: Removed[] = []
  for (const g of gone) {
    if (seen.has(g.id)) continue
    seen.add(g.id)
    del.run(g.id)
    touched.add(g.urlId)
    out.push({ url: g.url, title: g.title, at: g.at, profile: g.profile, how: g.how, source: g.source })
  }
  for (const id of touched) rescore(id)
  return out
}

/** Visits from `from` up to `to` (ms; either open). How many went. */
export function clear(from?: number | null, to?: number | null): number {
  const lo = typeof from === "number" ? from : 0, hi = typeof to === "number" ? to : Number.MAX_SAFE_INTEGER
  const n = tx(() => {
    const touched = sql("SELECT DISTINCT url FROM visits WHERE at >= ? AND at < ?").all(lo, hi) as { url: number }[]
    const r = sql("DELETE FROM visits WHERE at >= ? AND at < ?").run(lo, hi)
    for (const { url } of touched) rescore(url)
    return Number(r.changes)
  })
  if (lo === 0 && hi === Number.MAX_SAFE_INTEGER) open().exec("VACUUM")
  changed()
  return n
}

/** Visits put back (Undo), or brought in (an import): how many were new. */
export function add(visits: Removed[]): number {
  const n = tx(() => {
    const touched = new Set<number>()
    let added = 0
    for (const v of visits) {
      if (!v || typeof v.url !== "string" || !web(v.url) || !Number.isFinite(v.at)) continue
      const r = addVisit(v.url, typeof v.title === "string" ? v.title : "", v.at, typeof v.profile === "string" ? v.profile : "",
        HOWS.has(v.how) ? v.how : "other", typeof v.source === "string" ? v.source : "")
      if (r.added) { added++; touched.add(r.id) }
    }
    for (const id of touched) rescore(id)
    return added
  })
  changed()
  return n
}

// ---------- the app's calls ----------

const text = (x: unknown, n = 2000) => (typeof x === "string" ? x.slice(0, n) : "")
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)

handle("history:search", (_w, t, limit) => search(text(t, 500), Math.min(20, num(limit) ?? 8)))
handle("history:top", (_w, limit) => top(Math.min(24, num(limit) ?? 8)))
handle("history:list", (_w, o) => {
  const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>
  return list({ before: num(x.before), text: text(x.text, 500), limit: num(x.limit) })
})
// The address bar is opening `url` (typed, or a suggestion: a bookmark's is a bookmark visit).
handle("history:typed", (_w, url, how) => {
  const u = text(url)
  if (!web(u)) return
  for (const [k, v] of asked) if (Date.now() - v.at > ASKED_FOR) asked.delete(k)
  asked.set(u, { how: how === "bookmark" ? "bookmark" : "typed", at: Date.now() })
})
handle("history:remove", (_w, o) => {
  const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>
  return remove({ visits: Array.isArray(x.visits) ? x.visits.map(Number) : [], urls: Array.isArray(x.urls) ? x.urls.map(String) : [] })
})
handle("history:remove-site", (_w, site) => removeSite(text(site, 300)))
handle("history:clear", (_w, from, to) => clear(num(from) ?? null, num(to) ?? null))
handle("history:restore", (_w, visits) => add(Array.isArray(visits) ? visits as Removed[] : []))
