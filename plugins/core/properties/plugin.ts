// All properties' server side: keys with counts and types (in /api/state, so the panel is live), rename and retype
// across files as one-key small edits (a file that can't be edited safely is skipped), and restore for Undo.
import { HTTPError, Plugin } from "../../../core/plugins.ts"
import { readText, renameProperty, setPropertyText, sortBy, writeAtomic, type Vault } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)

export type PropType = "text" | "number" | "checkbox" | "date" | "datetime" | "list" | "object" | "empty"
const TYPES = ["text", "number", "checkbox", "date", "list"] as const

/** What kind of value this is, as the app's Properties show it. */
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

/** The vault's Markdown files that are notes (no hidden folders: settings, the trash). */
const files = (vault: Vault) => [...vault.entries].filter(([rel]) => !rel.split("/").some((p) => p.startsWith(".")))

type Summary = { key: string; count: number; type: PropType; types: Partial<Record<PropType, number>> }
let cached: { vault: Vault; version: number; list: Summary[] } | null = null

/** Every key, most used first (kept until the vault's files change). */
export function summary(vault: Vault): Summary[] {
  if (cached && cached.vault === vault && cached.version === vault.version) return cached.list
  const byKey = new Map<string, Summary>()
  for (const [, e] of files(vault)) {
    for (const [key, v] of Object.entries(e.fm ?? {})) {
      const s = byKey.get(key) ?? { key, count: 0, type: "empty" as PropType, types: {} }
      s.count++
      const t = typeOf(v)
      s.types[t] = (s.types[t] ?? 0) + 1
      byKey.set(key, s)
    }
  }
  for (const s of byKey.values()) {
    const known = Object.entries(s.types).filter(([t]) => t !== "empty").sort((a, b) => b[1] - a[1])
    s.type = (known[0]?.[0] ?? "empty") as PropType
  }
  const list = sortBy([...byKey.values()], (s) => [-s.count, s.key.toLowerCase()])
  cached = { vault, version: vault.version, list }
  return list
}

/** The properties pinned to files' headers as chips (its settings' `chips`: [{key, values, types, status_bar,
 *  show_unset}], in order), the ones with no key left out; the app reads the rest leniently. */
export const chips = () => {
  const list = plugin.settings().chips
  return Array.isArray(list) ? list.filter((c) => c && typeof c === "object" && typeof c.key === "string" && c.key.trim()) : []
}

plugin.state(() => ({ properties: summary(plugin.vault), propertyChips: chips() }))

plugin.route("GET", "properties", (req) => {
  const key = req.query.key === undefined ? null : String(req.query.key)
  if (key === null) return summary(plugin.vault)
  return sortBy(files(plugin.vault).filter(([, e]) => e.fm && key in e.fm).map(([path, e]) => ({ path, value: e.fm[key] })), (r) => r.path.toLowerCase())
})

/** Change every file that has `key` with `edit` (its text -> the new text, a reason it's skipped, or null: nothing to
 *  do), each read from disk as it is now and written whole only when it changed. */
async function each(key: string, edit: (text: string, path: string, value: unknown, fm: Record<string, unknown>) => string | { skip: string } | null) {
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

/** `v` as `type`, or undefined when it doesn't convert without losing something. */
export function convert(v: unknown, type: (typeof TYPES)[number]): unknown {
  const t = typeOf(v)
  if (t === "empty") return undefined
  switch (type) {
    case "text":
      if (t === "list") return (v as unknown[]).every((x) => x === null || typeof x !== "object") ? (v as unknown[]).join(", ") : undefined
      return t === "object" ? undefined : String(v)
    case "number": {
      if (t === "number") return v
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
      return Number.isFinite(n) ? n : undefined
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
  const type = String(req.body?.type ?? "")
  if (!(TYPES as readonly string[]).includes(type)) throw new HTTPError(400, `type: one of ${TYPES.join(", ")}`)
  const before: { path: string; value: unknown }[] = []
  const r = await each(key, (text, path, value) => {
    const neu = convert(value, type as (typeof TYPES)[number])
    if (neu === undefined) return typeOf(value) === "empty" ? null : { skip: `${JSON.stringify(value)} isn't a ${type}` }
    if (JSON.stringify(neu) === JSON.stringify(value)) return null
    const out = setPropertyText(text, key, neu)
    if (out === null) return { skip: "its properties can't be changed line by line" }
    before.push({ path, value })
    return out
  })
  return { changed: before.filter((b) => r.changed.includes(b.path)), skipped: r.skipped }
})

plugin.route("POST", "properties/restore", async (req) => {
  const key = keyOf(req.body?.key, "key")
  const values = Array.isArray(req.body?.values) ? req.body.values as { path: string; value: unknown }[] : []
  const changed: string[] = []
  for (const { path, value } of values) {
    if (typeof path !== "string" || !plugin.vault.entries.has(path)) continue
    const text = readText(plugin.vault.abs(path))
    const out = setPropertyText(text, key, value === null ? undefined : value)
    if (out !== null && out !== text) { writeAtomic(plugin.vault.abs(path), out); changed.push(path) }
  }
  return { changed }
})

// ---------- operations (core/ops.ts): `vau properties`, `vau properties rename`, `vau properties retype`

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
  run: async ({ key }, ctx) => (key
    ? { key, files: await ctx.api("GET", `properties?key=${encodeURIComponent(key)}`) }
    : { properties: await ctx.api("GET", "properties") }),
  text: (r) => {
    if (r.key) return r.files.length ? r.files.map((x: { path: string; value: unknown }) => `${x.path}  ${JSON.stringify(x.value)}`).join("\n") : `No file has ${r.key}.`
    const ps = r.properties as Summary[]
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
})
