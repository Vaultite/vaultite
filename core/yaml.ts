// YAML for frontmatter the way Obsidian and PyYAML read it (YAML 1.1: `23:15` is a number), written in one style
// (one key per line, small lists inline, quotes only when needed) so files look the same whoever wrote them.
import { parse as parseYaml, type ScalarTag } from "yaml"

// ---------- reading ----------

const TIMESTAMP = /^(\d{4})-(\d\d?)-(\d\d?)(?:(?:[Tt]|[ \t]+)(\d\d?):(\d\d):(\d\d)(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)?$/

/** Timestamps read as text: a date "YYYY-MM-DD", a time "YYYY-MM-DD HH:MM:SS" (the time as written, zone dropped). */
const timestamp: ScalarTag = {
  tag: "tag:yaml.org,2002:timestamp",
  default: true,
  test: /^(?:\d{4}-\d\d-\d\d|\d{4}-\d\d?-\d\d?(?:[Tt]|[ \t]+)\d\d?:\d\d:\d\d(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d\d)?))?)$/,
  resolve(s: string) {
    const m = TIMESTAMP.exec(s)!
    const p = (x: string) => x.padStart(2, "0")
    const date = `${m[1]}-${p(m[2])}-${p(m[3])}`
    return m[4] === undefined ? date : `${date} ${p(m[4])}:${m[5]}:${m[6]}`
  },
}

/** A plain scalar's sign and digits: "-1_000" -> [-1, "1000"]. */
function signed(s: string, lower = false): [number, string] {
  let v = s.replaceAll("_", "")
  if (lower) v = v.toLowerCase()
  const sign = v[0] === "-" ? -1 : 1
  return [sign, "+-".includes(v[0]) ? v.slice(1) : v]
}

const base60 = (v: string, part: (x: string) => number) =>
  v.split(":").reverse().reduce((sum, x, i) => sum + part(x) * 60 ** i, 0)

// Plain scalars that aren't strings, exactly as YAML 1.1 (and PyYAML) reads them: "07:15" and "1e3" stay text,
// "23:15" is 1395, "y" is a letter, not true.
const SCALARS: ScalarTag[] = [
  {
    tag: "tag:yaml.org,2002:bool", default: true,
    test: /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
    resolve: (s: string) => ["yes", "true", "on"].includes(s.toLowerCase()),
  },
  {
    tag: "tag:yaml.org,2002:float", default: true,
    test: /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
    resolve(s: string) {
      const [sign, v] = signed(s, true)
      if (v === ".inf") return sign * Infinity
      if (v === ".nan") return NaN
      return sign * (v.includes(":") ? base60(v, Number) : Number(v))
    },
  },
  {
    tag: "tag:yaml.org,2002:int", default: true,
    test: /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
    resolve(s: string) {
      const [sign, v] = signed(s)
      if (v === "0") return 0
      if (v.startsWith("0b")) return sign * parseInt(v.slice(2), 2)
      if (v.startsWith("0x")) return sign * parseInt(v.slice(2), 16)
      if (v[0] === "0") return sign * parseInt(v, 8)
      return sign * (v.includes(":") ? base60(v, (x) => parseInt(x, 10)) : parseInt(v, 10))
    },
  },
  { tag: "tag:yaml.org,2002:null", default: true, test: /^(?:~|null|Null|NULL|)$/, resolve: () => null },
  timestamp,
]
const REPLACED = new Set(SCALARS.map((t) => t.tag))

export class YAMLError extends Error {}

/** A YAML document -> plain values (null for an empty one). Throws YAMLError when it doesn't parse. The usual
 *  frontmatter (loadPlain) is read without the YAML library, which would take most of the time a vault takes to open. */
export function load(text: string): unknown {
  return loadPlain(text) ?? loadYaml(text)
}

/** load() with the YAML library, whatever the document. */
export function loadYaml(text: string): unknown {
  try {
    return parseYaml(text, {
      version: "1.1", schema: "yaml-1.1",
      customTags: (tags) => [...tags.filter((t) => typeof t !== "string" && !REPLACED.has(t.tag)), ...SCALARS],
      uniqueKeys: false, merge: true, maxAliasCount: -1, prettyErrors: false,
    }) ?? null
  } catch (e) {
    throw new YAMLError((e as Error).message)
  }
}

/** A plain scalar's value, as the YAML library resolves it (SCALARS, else text). */
function plain(s: string): unknown {
  for (const t of SCALARS) if ((t.test as RegExp).test(s)) return t.resolve(s, () => {}, {})
  return s
}

// What a plain scalar can't start or have in it here: an indicator, a comment, a mapping, a tab.
const NOT_PLAIN = /^[,[\]{}#&*!|>'"%@`?:]|^-(?: |$)|: |:$| #|\t/
const KEY = /^([A-Za-z_][\w-]*):(?: +(.*))?$/

/** The usual frontmatter (plain, quoted or flow-list scalars) read by hand, fast, giving what the YAML library would
 *  (tools/test_web.ts checks); undefined for anything else, which the library then reads. */
export function loadPlain(text: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  let keys = 0
  for (const line of text.split("\n")) {
    if (!line.trim() || line[0] === "#") continue
    const m = KEY.exec(line.trimEnd())
    if (!m || m[1] === "__proto__" || plain(m[1]) !== m[1]) return undefined
    const v = m[2] ?? ""
    let value: unknown
    if (v[0] === "'") {
      const inner = v.slice(1, -1)
      if (v.length < 2 || !v.endsWith("'") || inner.replaceAll("''", "").includes("'")) return undefined
      value = inner.replaceAll("''", "'")
    } else if (v[0] === '"') {
      const inner = v.slice(1, -1)
      if (v.length < 2 || !v.endsWith('"') || /["\\]/.test(inner)) return undefined
      value = inner
    } else if (v[0] === "[") {
      const inner = v.slice(1, -1).trim()
      if (!v.endsWith("]") || /[[\]{}'"#:&*!|>%@`\t]/.test(inner)) return undefined
      const items = inner ? inner.split(",").map((x) => x.trim()) : []
      if (items.some((x) => !x || NOT_PLAIN.test(x) || x[0] === "-" && !/^-[\d.]/.test(x))) return undefined
      value = items.map(plain)
    } else {
      if (NOT_PLAIN.test(v) || v === "<<") return undefined
      value = plain(v)
    }
    out[m[1]] = value
    keys++
  }
  return keys ? out : undefined
}

// ---------- writing ----------

/** A date written plain (`date: 2026-09-29`), not quoted like a string that looks like one. */
export class YDate {
  value: string
  constructor(value: string) { this.value = value }
}

const DATE = /^\d{4}-\d\d-\d\d$/

/** 'YYYY-MM-DD' strings -> dates, so they're written unquoted (Obsidian shows them as date properties). */
export function dates(v: unknown): unknown {
  if (typeof v === "string" && DATE.test(v)) {
    const d = new Date(v + "T00:00:00Z")
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v ? new YDate(v) : v
  }
  if (Array.isArray(v)) return v.map(dates)
  if (v && typeof v === "object" && !(v instanceof YDate)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dates(x)]))
  return v
}

type Style = "" | "'" | '"'

// What a plain scalar would be read back as (YAML 1.1): anything but a string must be quoted to stay a string.
const IMPLICIT = [
  /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/,
  /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/,
  /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/,
  /^(?:<<)$/, /^(?:~|null|Null|NULL|)$/, /^(?:=)$/, /^(?:!|&|\*)$/,
  /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/,
]
const looksTyped = (s: string) => IMPLICIT.some((r) => r.test(s))

const BREAKS = "\n\x85\u2028\u2029"
const WS = "\0 \t\r\n\x85\u2028\u2029"

/** Which styles a string allows (PyYAML's analysis, with unicode allowed). */
function analyze(s: string) {
  if (!s) return { empty: true, multiline: false, flowPlain: false, blockPlain: true, single: true }
  let block = false, flow = false, lineBreaks = false, special = false
  let leadSpace = false, leadBreak = false, trailSpace = false, trailBreak = false, breakSpace = false, spaceBreak = false
  if (s.startsWith("---") || s.startsWith("...")) block = flow = true
  const chars = [...s]
  let preceded = true
  let followed = chars.length === 1 || WS.includes(chars[1])
  let prevSpace = false, prevBreak = false
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (i === 0) {
      if ("#,[]{}&*!|>'\"%@`".includes(ch)) flow = block = true
      if ("?:".includes(ch)) { flow = true; if (followed) block = true }
      if (ch === "-" && followed) flow = block = true
    } else {
      if (",?[]{}".includes(ch)) flow = true
      if (ch === ":") { flow = true; if (followed) block = true }
      if (ch === "#" && preceded) flow = block = true
    }
    if (BREAKS.includes(ch)) lineBreaks = true
    const c = ch.codePointAt(0)!
    if (!(ch === "\n" || (c >= 0x20 && c <= 0x7e))) {
      // (YAML 1.2's printable set: emoji are written as they are, not as \U escapes)
      const uni = (c === 0x85 || (c >= 0xa0 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff)) && c !== 0xfeff
      if (!uni) special = true
    }
    if (ch === " ") {
      if (i === 0) leadSpace = true
      if (i === chars.length - 1) trailSpace = true
      if (prevBreak) breakSpace = true
      prevSpace = true; prevBreak = false
    } else if (BREAKS.includes(ch)) {
      if (i === 0) leadBreak = true
      if (i === chars.length - 1) trailBreak = true
      if (prevSpace) spaceBreak = true
      prevSpace = false; prevBreak = true
    } else {
      prevSpace = prevBreak = false
    }
    preceded = WS.includes(ch)
    followed = i + 2 >= chars.length || WS.includes(chars[i + 2])
  }
  let flowPlain = true, blockPlain = true, single = true
  if (leadSpace || leadBreak || trailSpace || trailBreak) flowPlain = blockPlain = false
  if (breakSpace) flowPlain = blockPlain = single = false
  if (spaceBreak || special) flowPlain = blockPlain = single = false
  if (lineBreaks) flowPlain = blockPlain = false
  if (flow) flowPlain = false
  if (block) blockPlain = false
  return { empty: false, multiline: lineBreaks, flowPlain, blockPlain, single }
}

function style(s: string, inFlow: boolean, key: boolean): Style {
  const a = analyze(s)
  if (!looksTyped(s) && !(key && (a.empty || a.multiline)) && (inFlow ? a.flowPlain : a.blockPlain)) return ""
  if (a.single && !(key && a.multiline)) return "'"
  return '"'
}

const ESCAPES: Record<string, string> = {
  "\0": "0", "\x07": "a", "\x08": "b", "\x09": "t", "\x0A": "n", "\x0B": "v", "\x0C": "f", "\x0D": "r", "\x1B": "e",
  '"': '"', "\\": "\\", "\x85": "N", "\xA0": "_", "\u2028": "L", "\u2029": "P",
}

function doubleQuoted(s: string) {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff)
    if (ch === '"' || ch === "\\" || ch === "\x85" || ch === "\u2028" || ch === "\u2029" || ch === "\uFEFF" || !ok) {
      if (ESCAPES[ch]) out += "\\" + ESCAPES[ch]
      else if (c <= 0xff) out += "\\x" + c.toString(16).toUpperCase().padStart(2, "0")
      else if (c <= 0xffff) out += "\\u" + c.toString(16).toUpperCase().padStart(4, "0")
      else out += "\\U" + c.toString(16).toUpperCase().padStart(8, "0")
    } else out += ch
  }
  return out + '"'
}

/** 'single quoted': quotes doubled; a line break is written as a blank line, the text going on at `indent`. */
function singleQuoted(s: string, indent: number) {
  let out = "'"
  const pad = " ".repeat(indent)
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (BREAKS.includes(ch)) {
      let j = i
      while (j < s.length && BREAKS.includes(s[j])) j++
      const run = s.slice(i, j)
      if (run[0] === "\n") out += "\n"
      for (const br of run) out += br === "\n" ? "\n" : br
      out += pad
      i = j
      continue
    }
    out += ch === "'" ? "''" : ch
    i++
  }
  return out + "'"
}

function pyFloat(n: number) {
  if (Number.isNaN(n)) return ".nan"
  if (n === Infinity) return ".inf"
  if (n === -Infinity) return "-.inf"
  let r = String(n).toLowerCase()
  const a = Math.abs(n)
  if (a !== 0 && (a >= 1e16 || a < 1e-4)) {
    // Python's repr switches to exponents at other magnitudes than JavaScript does
    const [m, e] = n.toExponential().split("e")
    r = `${m}e${e[0] === "-" ? "-" : "+"}${e.replace(/^[-+]/, "").padStart(2, "0")}`
  }
  if (!r.includes(".") && r.includes("e")) r = r.replace("e", ".0e")
  return r
}

function scalar(v: unknown, inFlow: boolean, indent: number, key = false): string {
  if (v === null || v === undefined) return "null"
  if (v === true) return "true"
  if (v === false) return "false"
  if (v instanceof YDate) return v.value
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 1e16 ? String(v) : pyFloat(v)
  const s = String(v)
  const st = style(s, inFlow, key)
  return st === "" ? s : st === "'" ? singleQuoted(s, indent) : doubleQuoted(s)
}

const isMap = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof YDate)
const leafy = (xs: unknown[]) => xs.every((x) => !Array.isArray(x) && !isMap(x))

function flow(v: unknown, indent: number): string {
  if (Array.isArray(v)) return `[${v.map((x) => flow(x, indent)).join(", ")}]`
  if (isMap(v)) return `{${Object.entries(v).map(([k, x]) => `${scalar(k, true, indent + 2, true)}: ${flow(x, indent)}`).join(", ")}}`
  return scalar(v, true, indent + 2)
}

const inline = (v: unknown) => !(Array.isArray(v) || isMap(v)) || leafy(Array.isArray(v) ? v : Object.values(v))

/** A mapping in block style at `indent` (the top level of a frontmatter, or a record with lists in it). */
function blockMap(m: Record<string, unknown>, indent: number, first = ""): string[] {
  const pad = " ".repeat(indent)
  const out: string[] = []
  Object.entries(m).forEach(([k, v], n) => {
    const head = (n === 0 && first ? first : pad) + scalar(k, false, indent, true) + ":"
    if (inline(v)) {
      out.push(`${head} ${Array.isArray(v) || isMap(v) ? flow(v, indent + 2) : scalar(v, false, indent + 2)}`)
    } else if (Array.isArray(v)) {
      out.push(head, ...blockSeq(v, indent))
    } else {
      out.push(head, ...blockMap(v as Record<string, unknown>, indent + 2))
    }
  })
  return out
}

function blockSeq(xs: unknown[], indent: number, first = ""): string[] {
  const pad = " ".repeat(indent)
  const out: string[] = []
  xs.forEach((x, n) => {
    const dash = (n === 0 && first ? first : pad) + "- "
    if (inline(x)) out.push(dash + (Array.isArray(x) || isMap(x) ? flow(x, indent + 2) : scalar(x, false, indent + 2)))
    else if (Array.isArray(x)) out.push(...blockSeq(x, indent + 2, dash))
    else out.push(...blockMap(x as Record<string, unknown>, indent + 2, dash))
  })
  return out
}

/** A frontmatter's YAML (without the --- lines): one key per line, in the object's order. */
export function dump(data: Record<string, unknown>): string {
  if (!Object.keys(data).length) return "{}"
  return blockMap(data, 0).join("\n")
}
