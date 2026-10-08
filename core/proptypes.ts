// Property types: a frontmatter key's type across the whole vault (`.vaultite/types.json`, Obsidian's types.json the same
// shape), alike on server and app (no Node). They pick the Properties editor's input, add quiet notes and sort queries.

export const PROP_TYPES = ["text", "list", "number", "checkbox", "date", "datetime", "tags", "aliases", "link"] as const
export type PropType = (typeof PROP_TYPES)[number]
export type PropTypes = Record<string, PropType>

/** What every vault has without saying so (Obsidian's too); a declared type wins. */
const IMPLIED: PropTypes = { tags: "tags", aliases: "aliases" }
// (Obsidian's names for ours)
const ALIASES: Record<string, PropType> = { multitext: "list" }

/** A type's name as written ("Date", Obsidian's "multitext"), or null when it isn't one. */
export function typeName(v: unknown): PropType | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : ""
  return (PROP_TYPES as readonly string[]).includes(t) ? t as PropType : ALIASES[t] ?? null
}

/** A types file's `types` ({"due": "date"}), read leniently: unknown types and odd keys are left out. */
export function readTypes(file: unknown): PropTypes {
  const map = file && typeof file === "object" && !Array.isArray(file) ? (file as Record<string, unknown>).types : null
  const out: PropTypes = {}
  if (!map || typeof map !== "object" || Array.isArray(map)) return out
  for (const [k, v] of Object.entries(map)) {
    const t = typeName(v)
    if (t && k.trim()) out[k] = t
  }
  return out
}

/** The type of `key`: declared (exactly, else in any case), else implied, else null (the value's own). */
export function typeOf(types: PropTypes | null | undefined, key: string): PropType | null {
  if (types) {
    if (Object.hasOwn(types, key)) return types[key]
    const low = key.toLowerCase()
    const k = Object.keys(types).find((x) => x.toLowerCase() === low)
    if (k) return types[k]
  }
  return Object.hasOwn(IMPLIED, key) ? IMPLIED[key] : null
}

const DATE = /^\d{4}-\d\d-\d\d$/
const DATETIME = /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/
const scalar = (v: unknown) => v === null || typeof v !== "object"
const blank = (v: unknown) => v === undefined || v === null || v === ""

/** Why a value isn't a `type` (a short phrase after its key), or null when it is or it's empty. */
export function typeProblem(type: PropType, v: unknown): string | null {
  if (blank(v)) return null
  const shown = typeof v === "string" ? `'${v.length > 40 ? `${v.slice(0, 40)}…` : v}'` : Array.isArray(v) ? "a list" : typeof v === "object" ? "a map" : String(v)
  switch (type) {
    case "text": return scalar(v) ? null : `is text, not ${shown}`
    case "link": return typeof v === "string" && /^\[\[[^\]]+\]\]$/.test(v.trim()) ? null : scalar(v) ? `is a link, written '[[Name]]'` : `is a link, not ${shown}`
    case "number": return typeof v === "number" ? null : `is a number, not ${shown}${typeof v === "string" && Number.isFinite(Number(v)) && v.trim() ? " (written without quotes)" : ""}`
    case "checkbox": return typeof v === "boolean" ? null : `is a checkbox (true or false), not ${shown}`
    case "date": return typeof v === "string" && DATE.test(v.trim()) ? null : `is a date (YYYY-MM-DD), not ${shown}`
    case "datetime": return typeof v === "string" && (DATETIME.test(v.trim()) || DATE.test(v.trim())) ? null : `is a date and time (YYYY-MM-DD HH:MM), not ${shown}`
    case "list": return Array.isArray(v) && v.every(scalar) ? null : `is a list, written [a, b], not ${shown}`
    case "tags":
    case "aliases": return typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) ? null : `is a list of ${type}, not ${shown}`
  }
}

/** What's wrong with a file's properties for the vault's types: one quiet note per key ("`due` is a date..."). */
export function typeNotes(types: PropTypes | null | undefined, fm: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(fm ?? {})) {
    const t = typeOf(types, k)
    const why = t && typeProblem(t, v)
    if (why) out.push(`\`${k}\` ${why}`)
  }
  return out
}

/** A date or a date and time as ms (this machine's time; ISO, `YYYY/MM/DD`, or what Date reads), or null. */
export function timeOf(v: unknown): number | null {
  if (typeof v !== "string" || !v.trim()) return null
  const s = v.trim()
  const m = /^(\d{4})[-/](\d\d?)[-/](\d\d?)(?:[ T](\d\d?):(\d\d)(?::(\d\d))?)?$/.exec(s)
  const ms = m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime() : Date.parse(s)
  return Number.isFinite(ms) ? ms : null
}

/** A value as its type sorts and compares it: numbers and dates as numbers (ms), checkboxes as true or false; undefined
 *  when the type doesn't change how it compares. One that isn't of its type is null, which sorts with the blanks. */
export function typedValue(type: PropType | string | null, v: unknown): unknown {
  if (!type || blank(v) || Array.isArray(v)) return undefined
  switch (type) {
    case "number": { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null }
    case "date":
    case "datetime": return timeOf(v)
    case "checkbox": return typeof v === "boolean" ? v : typeof v === "string" && /^(true|yes|on)$/i.test(v.trim()) ? true : typeof v === "string" && /^(false|no|off)$/i.test(v.trim()) ? false : null
  }
  return undefined
}
