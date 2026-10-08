// Links' server side: unlinked mentions (a file's name written as plain text elsewhere), which only the server can
// see, and linking one as a small edit of that line (409 if it changed since).
import fs from "node:fs"
import { HTTPError, Plugin } from "../../../core/plugins.ts"
import { sortBy, stemOf, writeAtomic } from "../../../core/vault.ts"
import { findMentions, linkMention } from "./mentions.ts"

export const plugin = new Plugin(import.meta.url)
const LIMIT = 300

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

plugin.route("GET", "backlinks/unlinked", (req) => {
  const rel = target(req.query.path)
  const names = namesOf(rel)
  const out: object[] = []
  const files = sortBy([...plugin.vault.entries.values()].filter((e) => e.rel !== rel), (e) => -Number(e.stat.ns / 1000000n))
  for (const e of files) {
    for (const m of findMentions(e.body, names)) {
      out.push({ path: e.rel, ...m })
      if (out.length >= LIMIT) return out
    }
  }
  return out
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
