import { z } from "zod"
import { HTTPError, Plugin } from "../../../core/plugins.ts"
import { type Entry, readText, renameProperty, setPropertyText, sortBy, writeAtomic, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

export type PropType = "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "object" | "empty"
const TYPES = ["text", "number", "checkbox", "date", "list"] as const

export function typeOf(v: unknown): PropType {
  if (v === null || v === undefined || v === "") return "empty"
  if (typeof v === "boolean") return "checkbox"
  if (typeof v === "number") return "number"
  if (Array.isArray(v)) return "list"
  if (v instanceof Date) return "datetime"
  if (typeof v === "object") return "object"
  const s = String(v)
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return "date"
  if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(s)) return "datetime"
  return "text"
}

const isNote = (rel: string) => rel[0] !== "." && !rel.includes("/.")
const files = (vault: Vault) => [...vault.entries].filter(([rel]) => isNote(rel))

type Summary = { key: string; count: number; type: PropType; types: Partial<Record<PropType, number>> }
let cached: { vault: Vault; version: number; list: Summary[] } | null = null
const typed = new WeakMap<Entry, [string, PropType][]>()

let tally: { vault: Vault; of: Map<string, Entry>; counts: Map<string, Map<PropType, number>> } | null = null
const keysOf = (e: Entry) => {
  let keys = typed.get(e)
  if (!keys) typed.set(e, keys = Object.entries(e.fm ?? {}).map(([key, v]) => [key, typeOf(v)]))
  return keys
}

export function summary(vault: Vault): Summary[] {
  if (cached && cached.vault === vault && cached.version === vault.version) return cached.list
  if (tally?.vault !== vault) tally = { vault, of: new Map(), counts: new Map() }
  const { of, counts } = tally
  const count = (e: Entry, by: number) => {
    for (const [key, t] of keysOf(e)) {
      let c = counts.get(key)
      if (!c) counts.set(key, c = new Map())
      const n = (c.get(t) ?? 0) + by
      if (n) c.set(t, n); else c.delete(t)
      if (!c.size) counts.delete(key)
    }
  }
  let seen = 0
  for (const [rel, e] of vault.entries) {
    if (!isNote(rel)) continue
    seen++
    const was = of.get(rel)
    if (was === e) continue
    if (was) count(was, -1)
    count(e, 1)
    of.set(rel, e)
  }
  if (seen !== of.size) for (const [rel, e] of of) if (!vault.entries.has(rel)) { count(e, -1); of.delete(rel) }
  const byKey = new Map<string, Summary>()
  for (const [key, c] of counts) {
    const types: Partial<Record<PropType, number>> = {}
    for (const [t, n] of c) types[t] = n
    const known = [...c].filter(([t]) => t !== "empty").sort((a, b) => b[1] - a[1])
    byKey.set(key, { key, count: [...c.values()].reduce((a, b) => a + b, 0), type: known[0]?.[0] ?? "empty", types })
  }
  const list = sortBy([...byKey.values()], (s) => [-s.count, s.key.toLowerCase()])
  cached = { vault, version: vault.version, list }
  return list
}

export const chips = () => {
  const list = plugin.settings().chips
  return Array.isArray(list) ? list.filter((c) => c && typeof c === "object" && typeof c.key === "string" && c.key.trim()) : []
}

plugin.state(() => ({ properties: summary(plugin.vault), propertyChips: chips() }))

let chippable: { vault: Vault; version: number; list: { key: string; count: number; values: number }[] } | null = null
plugin.route("GET", "properties/chippable", () => {
  const vault = plugin.vault
  if (chippable?.vault === vault && chippable.version === vault.version) return chippable.list
  const seen = new Map<string, { count: number; values: Set<string> }>()
  for (const [, e] of files(vault)) for (const [key, v] of Object.entries(e.fm ?? {})) {
    if (key === "type" || key === "origin" || typeof v !== "string" || !v.trim()) continue
    const s = seen.get(key) ?? { count: 0, values: new Set<string>() }
    s.count++
    if (s.values.size <= 12) s.values.add(v.trim())
    seen.set(key, s)
  }
  const list = sortBy([...seen].filter(([, s]) => s.values.size >= 2 && s.values.size <= 12 && s.values.size < s.count).map(([key, s]) => ({ key, count: s.count, values: s.values.size })),
    (r) => [-r.count, r.key.toLowerCase()])
  chippable = { vault, version: vault.version, list }
  return list
})

const valuesOf = (vault: Vault, key: string) =>
  sortBy(files(vault).filter(([, e]) => e.fm && key in e.fm).map(([path, e]) => ({ path, value: e.fm[key] })), (r) => r.path.toLowerCase())

plugin.route("GET", "properties", (req) => (req.query.key === undefined ? summary(plugin.vault) : valuesOf(plugin.vault, String(req.query.key))))

async function each(key: string, edit: (text: string, path: string, value: unknown, fm: Entry["fm"]) => string | { skip: string } | null) {
  const changed: string[] = [], skipped: { path: string; reason: string }[] = []
  for (const [path, e] of files(plugin.vault)) {
    if (!e.fm || !(key in e.fm)) continue
    let text: string
    try { text = readText(plugin.vault.abs(path)) } catch { skipped.push({ path, reason: "couldn't be read" }); continue }
    const out = edit(text, path, e.fm[key], e.fm)
    if (out === null) continue
    if (typeof out !== "string") { skipped.push({ path, reason: out.skip }); continue }
    if (out === text) continue
    writeAtomic(plugin.vault.abs(path), out)
    changed.push(path)
  }
  return { changed, skipped }
}

const keyOf = (v: unknown, what: string) => {
  const k = typeof v === "string" ? v.trim() : ""
  if (!k) throw new HTTPError(400, `${what}: a property name`)
  if (/[\n\r]/.test(k) || k.startsWith("#")) throw new HTTPError(400, `${what}: not a property name`)
  return k
}

plugin.route("POST", "properties/rename", async (req) => {
  const from = keyOf(req.body?.from, "from"), to = keyOf(req.body?.to, "to")
  if (from === to) return { changed: [], skipped: [] }
  return each(from, (text, _path, _value, fm) => {
    if (to in fm) return { skip: `it has ${to} already` }
    return renameProperty(text, from, to) ?? { skip: "its properties can't be changed line by line" }
  })
})

export function convert(v: unknown, type: (typeof TYPES)[number]): unknown {
  const t = typeOf(v)
  if (t === "empty") return undefined
  switch (type) {
    case "text":
      if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object") ? v.join(", ") : undefined
      return t === "object" ? undefined : String(v)
    case "number": {
      if (t === "number") return v
      if (typeof v !== "string" || v.trim() === "") return undefined
      const n = Number(v)
      return Number.isFinite(n) && String(n) === v.trim() ? n : undefined
    }
    case "checkbox":
      if (t === "checkbox") return v
      if (typeof v === "string" && /^(true|yes|on)$/i.test(v.trim())) return true
      if (typeof v === "string" && /^(false|no|off)$/i.test(v.trim())) return false
      return undefined
    case "date":
      return t === "date" ? v : t === "datetime" ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : undefined
    case "list":
      return t === "list" ? v : t === "object" ? undefined : typeof v === "string" && v.includes(",") ? v.split(",").map((x) => x.trim()).filter(Boolean) : [v]
  }
}

plugin.route("POST", "properties/retype", async (req) => {
  const key = keyOf(req.body?.key, "key")
  const type = TYPES.find((t) => t === String(req.body?.type ?? ""))
  if (!type) throw new HTTPError(400, `type: one of ${TYPES.join(", ")}`)
  const before: { path: string; value: unknown }[] = []
  const r = await each(key, (text, path, value) => {
    const neu = convert(value, type)
    if (neu === undefined) return typeOf(value) === "empty" ? null : { skip: `${JSON.stringify(value)} isn't a ${type}` }
    if (JSON.stringify(neu) === JSON.stringify(value)) return null
    const out = setPropertyText(text, key, neu)
    if (out === null) return { skip: "its properties can't be changed line by line" }
    before.push({ path, value })
    return out
  })
  return { changed: before.filter((b) => r.changed.includes(b.path)), skipped: r.skipped }
})

const Restore = z.array(z.object({ path: z.string(), value: z.unknown().optional() }).nullable().catch(null)).catch([])

plugin.route("POST", "properties/restore", async (req) => {
  const key = keyOf(req.body?.key, "key")
  const changed: string[] = []
  for (const v of Restore.parse(req.body?.values)) {
    if (!v || !plugin.vault.entries.has(v.path)) continue
    const { path, value } = v
    const text = readText(plugin.vault.abs(path))
    const out = setPropertyText(text, key, value === null ? undefined : value)
    if (out !== null && out !== text) { writeAtomic(plugin.vault.abs(path), out); changed.push(path) }
  }
  return { changed }
})

type Skipped = { path: string; reason: string }
const nFiles = (n: number) => `${n} file${n === 1 ? "" : "s"}`

plugin.op({
  id: "property.list",
  cli: "properties",
  summary: "Every property (frontmatter key) in the vault with how many files have it and its type; or one key's files and values.",
  help: `All properties: the keys, most used first, with their type (mixed when files disagree); with a key,
the files that have it and its value in each.

  vau properties            every key, most used first
  vau properties status     the files with status, and their values`,
  kind: "read",
  params: { key: { type: "string", description: "one key: the files that have it, and their values" } },
  args: ["key"],
  run: ({ key }, ctx) => (key ? { key, files: valuesOf(ctx.vault, key) } : { properties: summary(ctx.vault) }),
  text: (r) => {
    if (r.files) return r.files.length ? r.files.map((x) => `${x.path}  ${JSON.stringify(x.value)}`).join("\n") : `No file has ${r.key}.`
    const ps = r.properties ?? []
    const w = Math.max(4, ...ps.map((p) => p.key.length))
    return ps.length ? ps.map((p) => `${p.key.padEnd(w)}  ${String(p.count).padStart(5)}  ${p.type}${Object.keys(p.types).filter((t) => t !== "empty").length > 1 ? " (mixed)" : ""}`).join("\n") : "No properties yet."
  },
})

plugin.op({
  id: "property.rename",
  cli: "properties rename",
  summary: "Rename a property in every file that has it: only that key's text changes (values, comments and order stay).",
  help: `A file that already has the new name is left alone and listed, so nothing is overwritten. Never a bulk find and
replace: this changes only the key's own lines.

  vau properties rename status stage`,
  kind: "write",
  params: {
    from: { type: "string", required: true, description: "the key as it is now" },
    to: { type: "string", required: true, description: "its new name" },
  },
  args: ["from", "to"],
  run: async ({ from, to }, ctx) => await ctx.api("POST", "properties/rename", { from, to }),
  text: (r: { changed: string[]; skipped: Skipped[] }, p) => [`Renamed ${p.from} to ${p.to} in ${nFiles(r.changed.length)}.`,
    ...r.skipped.map((s) => `  left alone: ${s.path} (${s.reason})`)].join("\n"),
  did: ({ from, to }) => ({ action: "edit", text: `Renamed the property ${from} to ${to}` }),
})

plugin.op({
  id: "property.retype",
  cli: "properties retype",
  summary: "Change a property's type in every file: its values rewritten as text, number, checkbox, date or list where they convert without loss.",
  help: `Values that don't convert are left as they are and listed. The answer has each changed file's value before (POST
/api/properties/restore puts them back).

  vau properties retype rating number`,
  kind: "write",
  params: {
    key: { type: "string", required: true, description: "the key" },
    type: { type: "string", required: true, enum: [...TYPES], description: "its new type" },
  },
  args: ["key", "type"],
  run: async ({ key, type }, ctx) => await ctx.api("POST", "properties/retype", { key, type }),
  text: (r: { changed: { path: string }[]; skipped: Skipped[] }, p) => [`Made ${p.key} a ${p.type} in ${nFiles(r.changed.length)}.`,
    ...r.skipped.map((s) => `  left alone: ${s.path} (${s.reason})`)].join("\n"),
  did: ({ key, type }) => ({ action: "edit", text: `Made the property ${key} a ${type}` }),
})
