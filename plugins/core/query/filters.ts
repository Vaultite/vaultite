
export type Cond = { t: "cond"; prop: string; op: Op; value: string; src?: string }
export type Raw = { t: "raw"; src: string }
export type Other = { t: "other"; value: unknown }
export type Group = { t: "group"; kind: "and" | "or" | "not"; items: Item[] }
export type Item = Cond | Raw | Other | Group

export const OPS = ["==", "!=", ">", "<", ">=", "<=", "contains", "!contains", "startsWith", "endsWith", "isEmpty", "!isEmpty",
  "hasTag", "!hasTag", "inFolder", "!inFolder", "hasLink", "!hasLink", "hasProperty", "!hasProperty"] as const
export type Op = typeof OPS[number]
export const FILE_OPS: Op[] = ["hasTag", "!hasTag", "inFolder", "!inFolder", "hasLink", "!hasLink", "hasProperty", "!hasProperty"]
export const NO_VALUE: Op[] = ["isEmpty", "!isEmpty"]

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function treeOf(f: unknown): Group {
  const item = itemOf(f)
  return item?.t === "group" ? item : { t: "group", kind: "and", items: item ? [item] : [] }
}
function itemOf(f: unknown, depth = 0): Item | null {
  if (f === undefined || f === null || f === "") return null
  if (typeof f === "string" || typeof f === "number" || typeof f === "boolean") {
    const src = String(f)
    return condOf(src) ?? { t: "raw", src }
  }
  if (Array.isArray(f)) return depth > 32 ? { t: "other", value: f } : { t: "group", kind: "and", items: f.map((x) => itemOf(x, depth + 1)).filter((x): x is Item => !!x) }
  if (obj(f) && Object.keys(f).length === 1 && ["and", "or", "not"].includes(Object.keys(f)[0]) && depth <= 32) {
    const kind = Object.keys(f)[0] as Group["kind"]
    const list = Array.isArray(f[kind]) ? f[kind] as unknown[] : f[kind] === null || f[kind] === undefined ? [] : [f[kind]]
    return { t: "group", kind, items: list.map((x) => itemOf(x, depth + 1)).filter((x): x is Item => !!x) }
  }
  return { t: "other", value: f }
}

export function valueOf(g: Group): unknown {
  const items = g.items.map(itemValue).filter((x) => x !== undefined)
  return items.length ? { [g.kind]: items } : undefined
}
function itemValue(i: Item): unknown {
  switch (i.t) {
    case "cond": return i.src ?? (!NO_VALUE.includes(i.op) && !i.value.trim() ? undefined : exprOf(i))
    case "raw": return i.src.trim() || undefined
    case "other": return i.value
    case "group": return { [i.kind]: i.items.map(itemValue).filter((x) => x !== undefined) }
  }
}

const NAME = String.raw`(?:(?:note|file|formula)\.[A-Za-z_][\w-]*|note\[(?:"[^"\\]*"|'[^'\\]*')\]|[A-Za-z_][\w-]*)`
const STR = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`
const VALUE = String.raw`(?:${STR}|-?\d+(?:\.\d+)?|true|false|date\(\s*${STR}\s*\))`
const CMP = new RegExp(String.raw`^(${NAME})\s*(==|!=|>=|<=|>|<)\s*(${VALUE})$`)
const FILE_FN = new RegExp(String.raw`^(!?)\s*file\.(hasTag|inFolder|hasLink|hasProperty)\(\s*(${STR})\s*\)$`)
const TEXT_FN = new RegExp(String.raw`^(!?)\s*(${NAME})\.(contains|startsWith|endsWith)\(\s*(${VALUE})\s*\)$`)
const EMPTY = new RegExp(String.raw`^(!?)\s*(${NAME})\.isEmpty\(\)$`)

const unquote = (s: string) => {
  if (s.startsWith('"')) { try { return JSON.parse(s) as string } catch { return s.slice(1, -1) } }
  return s.slice(1, -1).replace(/\\(.)/g, "$1")
}
const shown = (v: string) => (/^date\(/.test(v) ? unquote(v.replace(/^date\(\s*|\s*\)$/g, "")) : /^["']/.test(v) ? unquote(v) : v)
const nameOf = (n: string) => n.replace(/^note\[(["'])(.*)\1\]$/, "note.$2")

export function condOf(src: string): Cond | null {
  const s = src.trim()
  let m = CMP.exec(s)
  if (m) return { t: "cond", prop: nameOf(m[1]), op: m[2] as Op, value: shown(m[3]), src }
  if ((m = FILE_FN.exec(s))) return { t: "cond", prop: "file", op: `${m[1]}${m[2]}` as Op, value: unquote(m[3]), src }
  if ((m = TEXT_FN.exec(s))) {
    if (m[1] && m[3] !== "contains") return null
    return { t: "cond", prop: nameOf(m[2]), op: `${m[1]}${m[3]}` as Op, value: shown(m[4]), src }
  }
  if ((m = EMPTY.exec(s))) return { t: "cond", prop: nameOf(m[2]), op: `${m[1]}isEmpty` as Op, value: "", src }
  return null
}

export function nameExpr(prop: string): string {
  if (/^(?:(?:note|file|formula)\.)?[A-Za-z_][\w-]*$/.test(prop)) return prop
  const bare = prop.replace(/^note\./, "")
  return `note[${JSON.stringify(bare)}]`
}
function literal(v: string, op: Op): string {
  const t = v.trim()
  if (/^-?\d+(\.\d+)?$/.test(t) && !["contains", "!contains", "startsWith", "endsWith"].includes(op)) return t
  if ((op === "==" || op === "!=") && /^(true|false)$/.test(t)) return t
  if ([">", "<", ">=", "<="].includes(op) && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(t)) return `date(${JSON.stringify(t)})`
  return JSON.stringify(v)
}

export function exprOf(c: Cond): string {
  const not = c.op.startsWith("!") && c.op !== "!=" ? "!" : ""
  const op = not ? c.op.slice(1) : c.op
  if (c.prop === "file" && FILE_OPS.includes(c.op)) return `${not}file.${op}(${JSON.stringify(c.value)})`
  const p = nameExpr(c.prop)
  if (op === "isEmpty") return `${not}${p}.isEmpty()`
  if (["contains", "startsWith", "endsWith"].includes(op)) return `${not}${p}.${op}(${literal(c.value, c.op)})`
  return `${p} ${op} ${literal(c.value, c.op)}`
}

export function countOf(g: Group): number {
  return g.items.reduce((n, i) => n + (i.t === "group" ? countOf(i) : 1), 0)
}
