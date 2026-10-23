// Links' server side: unlinked mentions (a file's name written as plain text elsewhere) and notes linking a web page,
// which only the server can see, and linking a mention as a small edit of that line (409 if it changed since).
import fs from "node:fs"
import { HTTPError, Plugin } from "../../../core/plugins.ts"
import { sortBy, stemOf, writeAtomic, type Entry } from "../../../core/vault.ts"
import { findMentions, linkMention, type Mention } from "./mentions.ts"
import { pageKey, siteOf, sourcesOf, urlsIn } from "./weblinks.ts"

export const plugin = new Plugin(import.meta.url)
const PAGE = 100

/** The names a file answers to as text: its name and its aliases. */
function namesOf(rel: string): string[] {
  const e = plugin.vault.entries.get(rel)
  const a = e?.fm.aliases
  return [stemOf(rel), ...(Array.isArray(a) ? a : a ? [a] : []).map(String)]
}

function target(q: unknown) {
  const rel = String(q ?? "")
  if (!plugin.vault.entries.has(rel)) throw new HTTPError(404, `no note '${rel}'`)
  return rel
}

/** Each file's mentions of the last names asked for, by its stat: the list pages through them, so only changed files
 *  are read again. */
let found: { names: string; files: Map<string, { ns: bigint; ms: Mention[] }> } = { names: "", files: new Map() }
function mentionsIn(e: Entry, names: string[], lower: string[]): Mention[] {
  const hit = found.files.get(e.rel)
  if (hit && hit.ns === e.stat.ns) return hit.ms
  const body = e.body.toLowerCase()
  const ms = lower.some((n) => body.includes(n)) ? findMentions(e.body, names) : []
  found.files.set(e.rel, { ns: e.stat.ns, ms })
  return ms
}

/** GET backlinks/unlinked?path=&offset=&limit=: one page of the mentions, newest files first, with how many there are
 *  in all (`total`) and in how many files. */
plugin.route("GET", "backlinks/unlinked", (req) => {
  const rel = target(req.query.path)
  const names = namesOf(rel)
  const key = names.join("\0")
  if (found.names !== key) found = { names: key, files: new Map() }
  const lower = names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 2)
  const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0))
  const limit = Math.max(1, Math.floor(Number(req.query.limit) || PAGE))
  const mentions: object[] = []
  let total = 0, files = 0
  // (excluded files aren't searched for mentions, as in Obsidian)
  const all = sortBy([...plugin.vault.entries.values()].filter((e) => e.rel !== rel && !plugin.vault.excluded(e.rel)), (e) => -Number(e.stat.ns / 1000000n))
  for (const e of all) {
    const ms = mentionsIn(e, names, lower)
    if (ms.length) files++
    for (const m of ms) {
      if (total >= offset && mentions.length < limit) mentions.push({ path: e.rel, ...m })
      total++
    }
  }
  return { total, files, mentions }
})

/** Each note's web addresses (its sources, then its body's), by its stat: only changed notes are read again. */
const addresses = new Map<string, { ns: bigint; about: string[]; links: { url: string; line: string }[] }>()
function addressesOf(e: Entry) {
  const hit = addresses.get(e.rel)
  if (hit && hit.ns === e.stat.ns) return hit
  const next = { ns: e.stat.ns, about: sourcesOf(e.fm), links: /https?:\/\//i.test(e.body) ? urlsIn(e.body) : [] }
  addresses.set(e.rel, next)
  return next
}

/** GET backlinks/web?url=&limit=: the notes about a web page (`source:` it, newest first), those linking it (with the
 *  line), and up to `limit` links elsewhere on its site, with how many there are. */
plugin.route("GET", "backlinks/web", (req) => {
  const url = String(req.query.url ?? ""), key = pageKey(url), site = siteOf(url)
  if (!key) throw new HTTPError(400, `'${url}' isn't a web address`)
  const limit = Math.max(1, Math.floor(Number(req.query.limit) || PAGE))
  const about: { path: string }[] = [], linked: { path: string; line: string }[] = [], elsewhere: { path: string; url: string; line: string }[] = []
  let more = 0
  const all = sortBy([...plugin.vault.entries.values()].filter((e) => e.rel.endsWith(".md") && !plugin.vault.excluded(e.rel)), (e) => -Number(e.stat.ns / 1000000n))
  for (const e of all) {
    const a = addressesOf(e)
    if (a.about.some((u) => pageKey(u) === key)) about.push({ path: e.rel })
    const here = a.links.find((l) => pageKey(l.url) === key)
    if (here) linked.push({ path: e.rel, line: here.line })
    for (const l of a.links) {
      if (siteOf(l.url) !== site || pageKey(l.url) === key) continue
      if (elsewhere.length < limit) elsewhere.push({ path: e.rel, ...l }); else more++
    }
  }
  return { site, about, linked: linked.filter((l) => !about.some((x) => x.path === l.path)), elsewhere, total: elsewhere.length + more }
})

plugin.route("POST", "backlinks/link", (req) => {
  const b = req.body
  const to = target(b.target)
  const rel = String(b.path ?? "")
  if (!plugin.vault.entries.has(rel) || rel === to) throw new HTTPError(404, `no note '${rel}'`)
  const m = { line: String(b.line ?? ""), nth: Math.trunc(Number(b.nth) || 0), col: Math.trunc(Number(b.col) || 0),
    len: Math.trunc(Number(b.len) || 0), text: String(b.text ?? "") }
  if (!findMentions(m.text, namesOf(to)).length) throw new HTTPError(400, `'${m.text}' isn't a name of ${stemOf(to)}`)
  // [[Name]] when that's how it's written (the name or an alias), else [[Name|as written]]. A name another file has
  // too is linked by its path.
  const stem = stemOf(to)
  const shared = [...plugin.vault.entries.keys()].some((r) => r !== to && stemOf(r).toLowerCase() === stem.toLowerCase())
  const name = shared ? to.replace(/\.md$/, "") : stem
  const link = !shared && namesOf(to).includes(m.text) ? `[[${m.text}]]` : `[[${name}|${m.text}]]`
  const abs = plugin.vault.abs(rel)
  const next = linkMention(fs.readFileSync(abs, "utf8"), m, link) // as it is: a file with CRLF keeps them
  if (next === null) throw new HTTPError(409, `${rel} changed there since: look again`)
  writeAtomic(abs, next)
  return { path: rel, link }
})
