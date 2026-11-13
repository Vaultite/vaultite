// Browsing history: every page's visits, ranked by frecency for the address bar and listed by day.
import { app } from "electron"
import { DatabaseSync, type StatementSync } from "node:sqlite"
import path from "node:path"
import { eachPage, handle, tellAll, logger } from "./engine.ts"
import { literal } from "./mask.ts"
import { hasSecret, scrub } from "./pagesecrets.ts"
import { COUNTS, GONE, HOST_LAST, ID_ROW, ID_ROWS, LIST_ASK, RANKED, RECENT, REMOVE_ASK, RESTORED, SUGGESTIONS, TABLES, URL_ROWS, VISITS,
  type How, type Removed, type Suggestion } from "./historyrows.ts"

const log = logger("history")

let db: DatabaseSync | null = null
const q = new Map<string, StatementSync>()
const sql = (text: string) => { let s = q.get(text); if (!s) q.set(text, s = open().prepare(text)); return s }

function open() {
  if (db) return db
  db = new DatabaseSync(path.join(app.getPath("userData"), "web-history.sqlite"))
  db.exec(TABLES)
  rescoreStale()
  setInterval(rescoreStale, 6 * 3600_000).unref()
  return db
}

function tx<T>(fn: () => T): T {
  const d = open()
  d.exec("BEGIN")
  try { const r = fn(); d.exec("COMMIT"); return r } catch (e) { d.exec("ROLLBACK"); throw e }
}

const DAY = 86_400_000
const today = () => Math.floor(Date.now() / DAY)
const ageWeight = (age: number) => (age <= 4 * DAY ? 100 : age <= 14 * DAY ? 70 : age <= 31 * DAY ? 50 : age <= 90 * DAY ? 30 : 10)
const HOW_BONUS: Record<string, number> = { typed: 2, bookmark: 1.4, link: 1, other: 1, form: 0.6 }
function frecencyOf(count: number, recent: { at: number; how: string }[]) {
  if (!count || !recent.length) return 0
  const now = Date.now()
  const points = recent.reduce((n, v) => n + ageWeight(now - v.at) * (HOW_BONUS[v.how] ?? 1), 0)
  return Math.ceil((count * points) / recent.length)
}

function rescore(urlId: number) {
  const n = COUNTS.parse(sql("SELECT count(*) AS n, sum(how = 'typed') AS typed, max(at) AS last FROM visits WHERE url = ?").get(urlId))
  if (!n.n) { sql("DELETE FROM urls WHERE id = ?").run(urlId); return }
  const recent = RECENT.parse(sql("SELECT at, how FROM visits WHERE url = ? ORDER BY at DESC LIMIT 10").all(urlId))
  sql("UPDATE urls SET visits = ?, typed = ?, last = ?, frecency = ?, scored = ? WHERE id = ?").run(n.n, n.typed ?? 0, n.last ?? 0, frecencyOf(n.n, recent), today(), urlId)
}

function rescoreStale() {
  const stale = ID_ROWS.parse(sql("SELECT id FROM urls WHERE scored < ?").all(today()))
  if (!stale.length) return
  tx(() => { for (const { id } of stale) rescore(id) })
}

const web = (u: string) => /^https?:\/\//i.test(u)
export const hostKey = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" } }

function addVisit(url: string, title: string, at: number, profile: string, how: How, source = "") {
  sql("INSERT INTO urls (url, title, host) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE title END")
    .run(url, title, hostKey(url))
  const { id } = ID_ROW.parse(sql("SELECT id FROM urls WHERE url = ?").get(url))
  const r = sql("INSERT OR IGNORE INTO visits (url, at, profile, how, source) VALUES (?, ?, ?, ?, ?)").run(id, at, profile, how, source)
  return { id, added: Number(r.changes) > 0 }
}

const asked = new Map<string, { how: How; at: number }>()
const ASKED_FOR = 15_000

let telling: ReturnType<typeof setTimeout> | null = null
function changed() {
  telling ??= setTimeout(() => {
    telling = null
    tellAll({ type: "engine:history:changed" })
  }, 1000)
}

function record(url: string, title: string, profile: string, how: How) {
  if (!web(url) || hasSecret(url)) return
  try {
    tx(() => { const v = addVisit(url, scrub(title), Date.now(), profile, how); if (v.added) rescore(v.id) })
    changed()
  } catch (e) { log.error("a visit wasn't kept in the history", e) }
}

function retitle(url: string, title: string) {
  if (!web(url) || !title || hasSecret(url)) return
  const t = scrub(title)
  try { if (Number(sql("UPDATE urls SET title = ? WHERE url = ? AND title <> ?").run(t, url, t).changes)) changed() } catch {}
}

const noHash = (u: string) => u.replace(/#.*$/, "")

eachPage(({ wc, profile }) => {
  if (profile === "c-agents") return
  // Chromium may start one navigation twice, and tells will-navigate only after did-start-navigation.
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
    if (url === last && how === "other") return
    last = url
    record(url, wc.getTitle(), profile, how)
  })
  wc.on("did-navigate-in-page", (_e, url, main) => {
    if (!main || noHash(url) === noHash(last)) return
    last = url
    record(url, wc.getTitle(), profile, "link")
  })
  wc.on("page-title-updated", (_e, title) => retitle(wc.getURL(), title))
})

export function lastVisits(profile: string): Map<string, number> {
  try {
    const rows = HOST_LAST.parse(sql("SELECT u.host AS host, max(v.at) AS at FROM visits v JOIN urls u ON u.id = v.url WHERE v.profile = ? GROUP BY u.host").all(profile))
    return new Map(rows.map((r) => [r.host, r.at]))
  } catch { return new Map() }
}

export const bare = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "")
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
const startsWord = (hay: string, w: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${literal(w)}`, "u").test(hay)

export function search(text: string, limit = 8): { complete: { text: string; url: string } | null; rows: (Suggestion & { score: number })[] } {
  const t = text.trim().toLowerCase(), ws = words(t)
  if (!ws.length) return { complete: null, rows: [] }
  const where = ws.map(() => "(instr(lower(url), ?) > 0 OR instr(lower(title), ?) > 0)").join(" AND ")
  const found = RANKED.parse(sql(`SELECT url, title, host, visits, typed, last, frecency FROM urls WHERE frecency > 0 AND ${where} ORDER BY frecency DESC LIMIT 400`)
    .all(...ws.flatMap((w) => [w, w])))
  const scored = found.flatMap((r) => {
    const b = bare(r.url).toLowerCase(), title = r.title.toLowerCase()
    if (!ws.every((w) => w.length >= 3 || startsWord(b, w) || startsWord(title, w))) return []
    const q = b.startsWith(t) ? 4 : ws.some((w) => startsWord(r.host, w)) ? 2.5 : ws.every((w) => startsWord(title, w) || startsWord(b, w)) ? 1.5 : 1
    return [{ r, score: r.frecency * q }]
  }).sort((a, b) => b.score - a.score)
  const complete = completion(t, found)
  if (complete) { const i = scored.findIndex((x) => x.r.url === complete.url); if (i > 0) scored.unshift(...scored.splice(i, 1)) }
  return { complete, rows: scored.slice(0, limit).map(({ r: { frecency: _f, ...r }, score }) => ({ ...r, score: Math.round(score * 100) / 100 })) }
}

function completion(t: string, rows: (Suggestion & { frecency: number })[]) {
  if (/\s/.test(t) || t.length < 1) return null
  const fit = rows.filter((r) => bare(r.url).toLowerCase().startsWith(t))
  if (!fit.length) return null
  if (!t.includes("/")) {
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

export function top(limit = 8): Suggestion[] {
  const rows = SUGGESTIONS.parse(sql("SELECT url, title, host, visits, typed, last FROM urls WHERE frecency > 0 ORDER BY frecency DESC LIMIT 200").all())
  const seen = new Set<string>(), out: Suggestion[] = []
  for (const r of rows) { if (seen.has(r.host)) continue; seen.add(r.host); out.push(r); if (out.length >= limit) break }
  return out
}

export function list(opts: { before?: number; text?: string; limit?: number }) {
  const ws = words(opts.text ?? ""), limit = Math.min(Math.max(1, opts.limit ?? 200), 1000)
  const where = ["v.at < ?", ...ws.map(() => "(instr(lower(u.url), ?) > 0 OR instr(lower(u.title), ?) > 0)")].join(" AND ")
  const rows = VISITS.parse(sql(`SELECT v.id, v.at, v.profile, v.how, u.url, u.title, u.host FROM visits v JOIN urls u ON u.id = v.url WHERE ${where} ORDER BY v.at DESC LIMIT ?`)
    .all(opts.before ?? Number.MAX_SAFE_INTEGER, ...ws.flatMap((w) => [w, w]), limit + 1))
  return { visits: rows.slice(0, limit), more: rows.length > limit }
}

export function remove(o: { visits: number[]; urls: string[] }): Removed[] {
  const ids = o.visits.filter((n) => Number.isInteger(n)).slice(0, 100_000)
  const urls = o.urls.slice(0, 10_000)
  const out = tx(() => {
    const gone: Gone = []
    for (const id of ids) gone.push(...GONE.parse(sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE v.id = ?").all(id)))
    for (const url of urls) gone.push(...GONE.parse(sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.url = ?").all(url)))
    return takeOut(gone)
  })
  changed()
  return out
}

export function removeSite(site: string): Removed[] {
  const s = site.toLowerCase().replace(/^www\./, "")
  if (!s) return []
  const out = tx(() => takeOut(GONE.parse(sql("SELECT v.id, v.url AS urlId, v.at, v.profile, v.how, v.source, u.url, u.title FROM visits v JOIN urls u ON u.id = v.url WHERE u.host = ? OR u.host LIKE ?")
    .all(s, `%.${s}`))))
  changed()
  return out
}

type Gone = ReturnType<typeof GONE.parse>
function takeOut(gone: Gone): Removed[] {
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

export function clear(from?: number | null, to?: number | null): number {
  const lo = typeof from === "number" ? from : 0, hi = typeof to === "number" ? to : Number.MAX_SAFE_INTEGER
  const n = tx(() => {
    const touched = URL_ROWS.parse(sql("SELECT DISTINCT url FROM visits WHERE at >= ? AND at < ?").all(lo, hi))
    const r = sql("DELETE FROM visits WHERE at >= ? AND at < ?").run(lo, hi)
    for (const { url } of touched) rescore(url)
    return Number(r.changes)
  })
  if (lo === 0 && hi === Number.MAX_SAFE_INTEGER) open().exec("VACUUM")
  changed()
  return n
}

export function add(visits: Removed[]): number {
  const n = tx(() => {
    const touched = new Set<number>()
    let added = 0
    for (const v of visits) {
      if (!web(v.url) || !Number.isFinite(v.at)) continue
      const r = addVisit(v.url, v.title, v.at, v.profile, v.how, v.source)
      if (r.added) { added++; touched.add(r.id) }
    }
    for (const id of touched) rescore(id)
    return added
  })
  changed()
  return n
}

const text = (x: unknown, n = 2000) => (typeof x === "string" ? x.slice(0, n) : "")
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined)

handle("history:search", (_w, t, limit) => search(text(t, 500), Math.min(20, num(limit) ?? 8)))
handle("history:top", (_w, limit) => top(Math.min(24, num(limit) ?? 8)))
handle("history:list", (_w, o) => {
  const x = LIST_ASK.parse(o)
  return list({ before: num(x.before), text: text(x.text, 500), limit: num(x.limit) })
})
handle("history:typed", (_w, url, how) => {
  const u = text(url)
  if (!web(u)) return
  for (const [k, v] of asked) if (Date.now() - v.at > ASKED_FOR) asked.delete(k)
  asked.set(u, { how: how === "bookmark" ? "bookmark" : "typed", at: Date.now() })
})
handle("history:remove", (_w, o) => remove(REMOVE_ASK.parse(o)))
handle("history:remove-site", (_w, site) => removeSite(text(site, 300)))
handle("history:clear", (_w, from, to) => clear(num(from) ?? null, num(to) ?? null))
handle("history:restore", (_w, visits) => add(RESTORED.parse(visits)))
