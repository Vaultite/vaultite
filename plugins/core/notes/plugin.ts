import fs from "node:fs"
import { z } from "zod"
import { OpError, Plugin } from "../../../core/plugins.ts"
import { hasTag, isArchived, type Item, Kind, nowStamp, safeName, slug, sortBy, splitTags, str, tagsOf, truthy } from "../../../core/vault.ts"

const Saved = z.looseObject({ id: z.string(), ext_id: z.unknown().optional(), title: z.unknown().optional() })

export const plugin = new Plugin(import.meta.url)

const KINDS = ["idea", "note"]
const STATUSES = ["seed", "exploring", "parked", "done"]
const CONTENT = ["title", "body", "tags", "kind", "status"]
const oneOf = (xs: string[]) => [...xs].sort().map((x) => `\`${x}\``).join(", ").replace(/, ([^,]*)$/, " or $1")

function parse(fm: Item, body: string, stem: string): [Item, string[]] {
  const problems: string[] = []
  const kind = truthy(fm.kind) ? fm.kind : "note"
  if (!KINDS.includes(kind)) problems.push(`kind \`${str(kind)}\` isn't one of ${oneOf(KINDS)}`)
  const status = truthy(fm.status) ? fm.status : null
  if (status && !STATUSES.includes(status)) problems.push(`status \`${str(status)}\` isn't one of ${oneOf(STATUSES)}`)
  return [{
    title: truthy(fm.title) ? str(fm.title) : stem, body, tags: splitTags(fm.tags).join(", "),
    kind, status, journal: hasTag(tagsOf(fm, body), "journal"),
    source: truthy(fm.source) ? fm.source : "claude", ext_id: truthy(fm.id) ? str(fm.id) : null,
    aliases: splitTags(fm.aliases),
    created_at: truthy(fm.created) ? str(fm.created) : null,
    updated_at: truthy(fm.updated) ? str(fm.updated) : null,
  }, problems]
}

function render(n: Item): [Item, string] {
  const owned: Item = {
    title: null, kind: n.kind || "note", status: n.status, tags: splitTags(n.tags),
    id: n.ext_id, created: n.created_at, updated: n.updated_at,
    source: [null, undefined, "", "claude"].includes(n.source) ? null : n.source,
    aliases: splitTags(n.aliases),
  }
  if (safeName(n.title) !== n.title) {
    owned.title = n.title // Obsidian resolves [[Real: title]] by alias when the file name can't hold it
    owned.aliases = [n.title, ...owned.aliases.filter((a: string) => a !== n.title)]
  }
  return [owned, n.body || ""]
}

function newId(title: unknown, taken: Set<string>) {
  const base = "note-" + (slug(title) || "untitled")
  let out = base, n = 2
  while (taken.has(out)) out = `${base}-${n++}`
  return out
}

const keyOf = (n: Item): string | null => n.ext_id ?? (n.id ? newId(n.title, new Set()) : null)

const ids = (but: string | null = null) =>
  new Set(plugin.vault.items("notes").filter((n) => n.id !== but).map(keyOf).filter((k): k is string => k !== null))

function copied(n: Item) {
  if (!n.ext_id) return false
  const others: Item[] = []
  for (const { kind, item } of plugin.vault.entries.values()) {
    if (kind?.collection === "notes" && item && item.ext_id === n.ext_id && item.id !== n.id) others.push(item)
  }
  if (!others.length) return false
  const age = (id: string): [number, string] => {
    try { const st = fs.statSync(plugin.vault.abs(`${id}.md`)); return [st.birthtimeMs || st.mtimeMs, id] } catch { return [Infinity, id] }
  }
  const [t, id] = age(n.id)
  return others.some((o) => { const [u, oid] = age(o.id); return u < t || (u === t && oid < id) })
}

const changed = (a: Item, b: Item, trim = false) =>
  CONTENT.some((k) => { const x = str(a[k] || ""), y = str(b[k] || ""); return trim ? x.trim() !== y.trim() : x !== y })

plugin.kind(new Kind({
  type: "note", collection: "notes", folder: "Notes", parse, render,
  prepare(n, before) {
    n.title ??= "Untitled"
    if (n.kind === "journal") {
      n.kind = "note"
      const tags = splitTags(n.tags)
      if (!tags.some((t) => t.toLowerCase() === "journal")) n.tags = [...tags, "Journal"].join(", ")
    }
    if (before !== null && n.ext_id === before.ext_id && copied(before)) {
      n.ext_id = newId(before.id.split("/").pop(), ids(before.id))
      n.created_at = n.updated_at = nowStamp()
      return n
    }
    n.ext_id = n.ext_id || before?.ext_id || newId(n.title, ids())
    n.created_at = n.created_at || nowStamp()
    if (before === null) n.updated_at = n.updated_at || n.created_at
    else if (changed(n, before) && (n.updated_at ?? null) === (before.updated_at ?? null)) n.updated_at = nowStamp()
    return n
  },
  fill(n, before) {
    if (!n.ext_id && plugin.vault.entries.get(`${n.id}.md`)?.fm.type == null) return null
    const out = { ...n }
    if (copied(n)) {
      out.ext_id = newId(n.id.split("/").pop(), ids(n.id))
      out.created_at = out.updated_at = nowStamp()
      return out
    }
    if (!n.ext_id) out.ext_id = newId(n.id.split("/").pop(), ids(n.id))
    if (!n.created_at) out.created_at = nowStamp()
    if (!n.updated_at) out.updated_at = out.created_at
    else if (before && n.updated_at === before.updated_at && changed(n, before, true)) out.updated_at = nowStamp()
    return CONTENT.concat(["ext_id", "created_at", "updated_at"]).some((k) => out[k] !== n[k]) ? out : null
  },
  key: keyOf,
  stamps: ["created", "updated"],
  order: (ns) => sortBy(sortBy(ns, (n) => n.id, true), (n) => n.updated_at || n.modified || "", true),
}))

plugin.route("GET", "notes", (req) => {
  let out = plugin.vault.items("notes")
  if (req.query.archived !== "true") out = out.filter((n) => !isArchived(n))
  for (const w of (req.query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
    out = out.filter((n) => `${n.title} ${n.body} ${n.tags}`.toLowerCase().includes(w))
  }
  if ("kind" in req.query) out = out.filter((n) => (req.query.kind === "journal" ? n.journal : n.kind === req.query.kind))
  if ("tag" in req.query) out = out.filter((n) => splitTags(n.tags).some((t) => t.toLowerCase() === req.query.tag.toLowerCase()))
  return out
})

function jsonObject(v: unknown): Item | null {
  if (typeof v !== "string" || !v.trim().startsWith("{")) return null
  try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? o : null } catch { return null }
}

plugin.op({
  id: "note.create",
  cli: "note",
  mcp: "write_note",
  summary: "Save a note in Notes/: an idea, a longer note or a journal entry. The same title (or id) again updates it.",
  help: `Writes Notes/<Title>.md (or where the user keeps notes). It upserts on its id (default: <kind>-<the title as a
slug>), so saving the same title again updates it, replacing its body. Body: Markdown with ## headings, bullets and
[[links]] to people and notes; no "# Title" line. A brain-dumped idea is kind idea, status seed; a reflection on the
day is a journal entry (kind journal, or journal: a note tagged Journal). Its source is who wrote it (you: claude,
codex...). The API's JSON as the one argument works too.

  vau note "Voice-first journaling" --kind idea --status seed --tags Product --body "Talk, and it writes the day."
  cat draft.md | vau note "Trip notes" --body -
  vau note "A good day" --journal --body "Climbed, then dinner with Bob."`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "the note's title (its file name; a colon becomes \" -\")" },
    body: { type: "string", stdin: true, description: "the note's Markdown (saving again replaces it)" },
    kind: { type: "string", enum: ["idea", "note", "journal"], description: "idea or note (default note); journal: a note tagged Journal" },
    status: { type: "string", enum: STATUSES, description: "an idea's: seed, exploring, parked or done" },
    tags: { type: "array", items: { type: "string" }, description: "tags, in sentence case (Product, Health)" },
    journal: { type: "boolean", description: "a journal entry (tagged Journal)" },
    id: { type: "string", description: "its stable id (the file's `id`), to update one whatever its title; default <kind>-<title as a slug>" },
    extId: { type: "string", description: "the same as id (vau's --ext-id)" },
    source: { type: "string", description: "who wrote it; default: the caller (claude, codex, cli...)" },
  },
  args: ["title"],
  run: async (p, ctx) => {
    const json = jsonObject(p.title)
    const g: Item = json ? { ...p, ...json } : p
    const title = str(g.title).trim()
    if (!title) throw new OpError("title is missing: the note's title")
    const kind = str(g.kind).trim() || "note"
    const tags = Array.isArray(g.tags) ? g.tags.map((t: unknown) => str(t).trim()).filter(Boolean) : splitTags(g.tags)
    if (g.journal === true && !tags.some((t) => t.toLowerCase() === "journal")) tags.push("Journal")
    const { id: _id, extId: _ext, journal: _j, ...rest } = g
    const note: Item = { ...rest, title, kind, source: str(g.source).trim() || ctx.who.source,
      ext_id: str(g.id ?? g.extId ?? g.ext_id).trim() || `${kind}-${slug(title) || "untitled"}` }
    if (g.body !== undefined) note.body = str(g.body)
    if (tags.length) note.tags = tags.join(", ")
    else delete note.tags
    const r = Saved.parse(await ctx.api("POST", "notes", note))
    return { path: `${r.id}.md`, id: r.ext_id ?? note.ext_id, title: r.title ?? title }
  },
  text: (r) => `Saved ${r.path} (id: ${r.id}).`,
  did: (p) => ({ action: "save", text: `Saved the note ${p.title.trim().slice(0, 120) || "untitled"}` }),
})
