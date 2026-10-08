// The block contract: what a ```block-<name> fence may say, declared in each plugin's manifest (format:
// core/docs/vault-plugins.md), read by server and app alike (no Node). Bad options still pass, with a note to fix them.
import { blocksIn, scan } from "./sections.ts"
import { load } from "./yaml.ts"

export type OptionType = "string" | "number" | "boolean" | "list" | "map" | "enum"
export type OptionDecl = {
  type: OptionType | OptionType[]
  description: string
  /** enum: the values it may be; list: the items its list may have (left out: any). */
  values?: (string | number)[]
  /** What it is when left out: the block gets it filled in (resolveOptions). */
  default?: unknown
  min?: number
  max?: number
  /** The block can't draw anything without it. */
  required?: boolean
}
export type BlockDecl = { description: string; options?: Record<string, OptionDecl>
  /** Where its live data comes from, in words ("GitHub's API"), when it shows what isn't in the vault: "Show source"
   *  says it (core/sources.ts). */
  live?: string
  /** Vault paths it reads that its text side can't show it reading (a block drawn only in the app). */
  reads?: string[] }
/** A manifest's `blocks`: name -> declaration. */
export type BlockDecls = Record<string, BlockDecl>

const TYPES: OptionType[] = ["string", "number", "boolean", "list", "map", "enum"]

/** Options every block takes, read by the core rather than the block: the dashboard grid's layout and `file:`. */
export const COMMON: Record<string, OptionDecl> = {
  wide: { type: "boolean", description: "on a dashboard, the block takes the whole row" },
  stack: { type: "boolean", description: "on a dashboard, the block goes under the one before it, in the same column" },
  file: { type: "string", description: "draws it for another file: a name or path like a [[link]], or a folder ending in / for its newest file" },
}

/** Which of a file's kind's blocks (its view: `Kind.blocksFor`) are drawn on top of it: those its body doesn't place
 *  somewhere itself. They're never written into the file; a fence of one moves it there. */
export function onTop(view: string[] | undefined, body: string): string[] {
  if (!view?.length) return []
  const placed = new Set(blocksIn(body).map((b) => b.name))
  return view.filter((n) => !placed.has(n))
}

/** A body without the fences on its top that only repeat its kind's blocks (in their order, without options), which are
 *  drawn there anyway; null when it has none to take out. One its body places again further down stays. */
export function tidyKindBlocks(view: string[] | undefined, body: string): string | null {
  if (!view?.length) return null
  const s = scan(body), placed = blocksIn(body, s)
  let i = 0, n = 0
  const blank = () => { while (i < s.lines.length && !s.lines[i].trim()) i++ }
  blank()
  for (const b of placed) {
    if (b.open !== i || b.name !== view[n] || b.text.trim()) break
    n++; i = b.close + 1; blank()
  }
  const later = new Set(placed.slice(n).map((b) => b.name))
  while (n && later.has(view[n - 1])) n--
  if (!n) return null
  return s.lines.slice(placed[n - 1].close + 1).join("\n").replace(/^\s*\n/, "")
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const types = (d: OptionDecl) => (Array.isArray(d.type) ? d.type : [d.type])

/** A manifest's `blocks` as declarations ({} when it has none, or they aren't an object). Entries that aren't objects
 *  are left out here; declProblems says what's wrong with them. */
export function declsOf(manifest: unknown): BlockDecls {
  const b = isMap(manifest) ? manifest.blocks : null
  return isMap(b) ? Object.fromEntries(Object.entries(b).filter(([, d]) => isMap(d))) as BlockDecls : {}
}

/** Every option a block takes: its own, then the common ones. */
export function allOptions(decl: BlockDecl | null | undefined): Record<string, OptionDecl> {
  return { ...(decl?.options ?? {}), ...COMMON }
}

/** A block's text read as options: {} when it's empty; `error` when it isn't YAML or isn't `key: value` lines (the
 *  block still gets {}). The way both the server and the app read them. */
export function parseOptions(text: string): { options: Record<string, unknown>; error?: string } {
  if (!text.trim()) return { options: {} }
  let o: unknown
  try {
    o = load(text)
  } catch (e) {
    return { options: {}, error: `its options aren't YAML (${String((e as Error).message ?? e).split("\n")[0]})` }
  }
  if (o === null || o === undefined) return { options: {} }
  return isMap(o) ? { options: o } : { options: {}, error: "its options should be `key: value` lines" }
}

/** The options as a block gets them: the declared defaults filled in where one is left out (or empty), and a number
 *  made text where only a text is declared (`title: 2026`: YAML reads a number). */
export function resolveOptions(decl: BlockDecl | null | undefined, options: Record<string, unknown>): Record<string, unknown> {
  const out = { ...options }
  for (const [k, d] of Object.entries(decl?.options ?? {})) {
    if ((out[k] === undefined || out[k] === null) && d.default !== undefined) out[k] = d.default
    else if (typeof out[k] === "number" && types(d).includes("string") && !types(d).includes("number")) out[k] = String(out[k])
  }
  return out
}

const say = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v))

/** What an option takes, in words: "a number", "true or false", "one of table, list", "a text or a list". */
export function typeText(d: OptionDecl): string {
  const ts = types(d)
  // (true, false and an enum's values read as one choice: "true, false or only")
  const both = ts.includes("boolean") && ts.includes("enum")
  const words = ts.flatMap((t) => both && t === "boolean" ? [] : t === "enum"
    ? [both ? ["true", "false", ...(d.values ?? [])].join(", ").replace(/, ([^,]*)$/, " or $1") : `one of ${(d.values ?? []).join(", ")}`]
    : [t === "string" ? "a text" : t === "number" ? "a number" : t === "boolean" ? "true or false" : t === "list" ? "a list" : "a map"])
  return words.join(" or ")
}

/** Whether a value fits an option's declaration ("" when it does, else what's wrong). Empty (null) always fits. */
export function valueProblem(d: OptionDecl, v: unknown): string {
  if (v === null || v === undefined) return ""
  const ts = types(d)
  const fits = ts.some((t) => {
    if (t === "string") return typeof v === "string" || typeof v === "number"
    if (t === "number") return typeof v === "number" && Number.isFinite(v)
    if (t === "boolean") return typeof v === "boolean"
    if (t === "list") return Array.isArray(v) && (!d.values || v.every((x) => d.values!.includes(x as string)))
    if (t === "map") return isMap(v)
    return (d.values ?? []).includes(v as string)
  })
  if (!fits) {
    if (Array.isArray(v) && ts.includes("list") && d.values) return `takes only ${d.values.join(", ")}`
    return `should be ${typeText(d)}, not ${say(v)}`
  }
  if (typeof v === "number") {
    if (d.min !== undefined && v < d.min) return `should be at least ${d.min}`
    if (d.max !== undefined && v > d.max) return `should be at most ${d.max}`
  }
  return ""
}

/** The closest name to a mistyped one (an edit or two away, or one it starts), or null. */
export function closest(name: string, names: string[]): string | null {
  const low = name.toLowerCase()
  let best: string | null = null, score = 3
  for (const n of names) {
    const d = n.startsWith(low) || low.startsWith(n) ? 1 : distance(low, n)
    if (d < score) { best = n; score = d }
  }
  return best
}

/** Edit distance (Levenshtein) between two strings. */
export function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

/** What's wrong with a block's options against its declaration, one lowercase fragment each ("unknown option `isues`
 *  (did you mean `issues`?)"). [] when nothing is or there's no declaration; `error` (parseOptions') comes first. */
export function optionNotes(decl: BlockDecl | null | undefined, options: Record<string, unknown>, error?: string): string[] {
  const out = error ? [error] : []
  if (!decl) return out
  const all = allOptions(decl)
  for (const [k, v] of Object.entries(options)) {
    const d = Object.hasOwn(all, k) ? all[k] : null
    if (!d) {
      const near = closest(k, Object.keys(all))
      out.push(`unknown option \`${k}\`${near ? ` (did you mean \`${near}\`?)` : ""}`)
      continue
    }
    const why = valueProblem(d, v)
    if (why) out.push(`\`${k}\` ${why}`)
  }
  for (const [k, d] of Object.entries(decl.options ?? {})) {
    if (d.required && (options[k] === undefined || options[k] === null)) out.push(`\`${k}\` is required`)
  }
  return out
}

/** The notes as one italic line for /api/render, under the block's text: "_(github block: unknown option `isues`)_". */
export function notesText(name: string, notes: string[]) {
  return notes.length ? `_(${name} block: ${notes.join("; ")})_` : ""
}

/** What /api/render shows for a block drawn only in the app (its plugin has no text side): its declaration's
 *  description, so an AI knows what's there. */
export function fallbackText(pluginName: string, decl: BlockDecl | null | undefined) {
  return decl?.description ? `_(${pluginName}: ${decl.description}; drawn in the app only)_` : `_(${pluginName} draws this block in the app only)_`
}

const ONE_LINE = (s: unknown) => typeof s === "string" && !!s.trim() && !s.includes("\n")

/** What's wrong with a manifest's `blocks` (a plugin's own declarations), as messages naming `where`. */
export function declProblems(blocks: unknown, where: string): string[] {
  if (blocks === undefined) return []
  if (!isMap(blocks)) return [`${where}: blocks must be an object, {"<name>": {"description": "...", "options": {...}}}`]
  const out: string[] = []
  for (const [name, d] of Object.entries(blocks)) {
    const at = `${where}: block '${name}'`
    if (!/^[\w-]+$/.test(name)) out.push(`${at}: a block's name is letters, digits, - and _`)
    if (!isMap(d)) { out.push(`${at} must be an object with a description and its options`); continue }
    if (!ONE_LINE(d.description)) out.push(`${at} needs a description (one line: what it shows)`)
    if (d.live !== undefined && !ONE_LINE(d.live)) out.push(`${at}: live is one line, where its live data comes from ("GitHub's API")`)
    if (d.reads !== undefined && (!Array.isArray(d.reads) || d.reads.some((r) => typeof r !== "string" || !r))) out.push(`${at}: reads is a list of vault paths`)
    if (d.options === undefined) continue
    if (!isMap(d.options)) { out.push(`${at}: options must be an object, {"<option>": {"type": ..., "description": ...}}`); continue }
    for (const [k, o] of Object.entries(d.options)) {
      const ok = `${at}, option '${k}'`
      if (Object.hasOwn(COMMON, k)) { out.push(`${ok}: every block takes it already (core/blocks.ts, COMMON)`); continue }
      out.push(...optionProblems(o, ok))
    }
  }
  return out
}

/** What's wrong with one option's declaration (a block's option or a setting), as messages starting with `ok`. */
function optionProblems(o: unknown, ok: string): string[] {
  if (!isMap(o)) return [`${ok} must be an object with a type and a description`]
  const out: string[] = []
  const ts = Array.isArray(o.type) ? o.type : [o.type]
  if (!ts.length || ts.some((t) => !TYPES.includes(t as OptionType))) out.push(`${ok}: type must be one of ${TYPES.join(", ")} (or a list of them)`)
  if (!ONE_LINE(o.description)) out.push(`${ok} needs a description (one line)`)
  if (o.values !== undefined && (!Array.isArray(o.values) || !o.values.length || o.values.some((v) => typeof v !== "string" && typeof v !== "number"))) {
    out.push(`${ok}: values must be a list of texts or numbers`)
  }
  if (ts.includes("enum") && !Array.isArray(o.values)) out.push(`${ok}: an enum needs its values`)
  for (const m of ["min", "max"]) if (o[m] !== undefined && typeof o[m] !== "number") out.push(`${ok}: ${m} must be a number`)
  if (o.required !== undefined && typeof o.required !== "boolean") out.push(`${ok}: required must be true or false`)
  if (o.default !== undefined && o.default !== null && ts.every((t) => TYPES.includes(t as OptionType))) {
    const why = valueProblem(o as OptionDecl, o.default)
    if (why) out.push(`${ok}: its default ${why}`)
  }
  return out
}

/** One option for people and AIs: "`issues` (a number, default 0): how many open issues to list". */
export function optionText(k: string, d: OptionDecl) {
  const bits = [typeText(d)]
  if (d.default !== undefined) bits.push(`default ${typeof d.default === "string" ? d.default : JSON.stringify(d.default)}`)
  if (d.min !== undefined && d.max !== undefined) bits.push(`${d.min} to ${d.max}`)
  else if (d.min !== undefined) bits.push(`at least ${d.min}`)
  else if (d.max !== undefined) bits.push(`at most ${d.max}`)
  if (d.required) bits.push("required")
  return `\`${k}\` (${bits.join(", ")}): ${d.description}`
}

/** A plugin's blocks as Markdown, for its docs (`vau docs <id>`, core/docs.ts; generated from the declarations, so it can't drift):
 *  one bullet per block, its options under it. "" when it has none. */
export function blocksDoc(decls: BlockDecls): string {
  const names = Object.keys(decls)
  if (!names.length) return ""
  const lines = [names.length > 1 ? "Blocks:" : "Block:"]
  for (const n of names) {
    const d = decls[n]
    lines.push(`- \`${n}\`: ${d.description}`)
    for (const [k, o] of Object.entries(d.options ?? {})) lines.push(`  - ${optionText(k, o)}`)
  }
  return lines.join("\n")
}

// ---------- a plugin's settings

/** A plugin's settings declared like a block's options plus `label`, `labels` and `local` (this machine's own: bundles skip
 *  it). Choosing the `default` removes the key, so a vault only holds what the user chose. */
export type SettingDecl = OptionDecl & { label: string; labels?: Record<string, string>; local?: boolean }
export type SettingDecls = Record<string, SettingDecl>

/** A manifest's `settings` as declarations ({} when it has none). */
export function settingsOf(manifest: unknown): SettingDecls {
  const s = isMap(manifest) ? manifest.settings : null
  return isMap(s) ? Object.fromEntries(Object.entries(s).filter(([, d]) => isMap(d))) as SettingDecls : {}
}

/** What's wrong with a manifest's `settings`, as messages naming `where`: each like a block option (declProblems),
 *  plus its `label` and an enum's `labels`. */
export function settingDeclProblems(settings: unknown, where: string): string[] {
  if (settings === undefined) return []
  if (!isMap(settings)) return [`${where}: settings must be an object, {"<key>": {"type": ..., "label": ..., "description": ...}}`]
  const out: string[] = []
  for (const [k, d] of Object.entries(settings)) {
    const at = `${where}: setting '${k}'`
    if (!isMap(d)) { out.push(`${at} must be an object with a type, a label and a description`); continue }
    const { local, ...opt } = d
    if (local !== undefined && typeof local !== "boolean") out.push(`${at}: local must be true or false`)
    out.push(...optionProblems(opt, at))
    if (d.required !== undefined) out.push(`${at}: a setting is never required (left out, it's its default)`)
    if (!ONE_LINE(d.label)) out.push(`${at} needs a label (a few words, sentence case: what the settings form calls it)`)
    if (d.labels !== undefined) {
      if (!isMap(d.labels) || Object.values(d.labels).some((l) => !ONE_LINE(l))) out.push(`${at}: labels must map values to their names, {"auto": "Automatic"}`)
      else for (const v of Object.keys(d.labels)) if (!(d.values as unknown[] | undefined)?.map(String).includes(v)) out.push(`${at}: labels names '${v}', which isn't one of its values`)
    }
  }
  return out
}

/** A plugin's settings as Markdown, for its docs (generated, like blocksDoc): where they're kept, then a
 *  bullet per key. "" when it declares none. */
export function settingsDoc(id: string, decls: SettingDecls): string {
  const keys = Object.keys(decls)
  if (!keys.length) return ""
  return [`Settings, \`.vaultite/plugins/${id}/data.json\` (each optional; the plugin's settings in the app too):`,
    ...keys.map((k) => `- ${optionText(k, decls[k])}${decls[k].local ? " (this machine's own: bundles never save or set it)" : ""}`)].join("\n")
}
