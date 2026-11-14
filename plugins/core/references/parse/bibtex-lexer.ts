export type RawEntry = { type: string; key: string; fields: Map<string, string>; at: number }

type Scan = { s: string; i: number; key: string; macros: Map<string, string>; problems: string[] }

const MONTHS = new Map([["jan", "January"], ["feb", "February"], ["mar", "March"], ["apr", "April"], ["may", "May"],
  ["jun", "June"], ["jul", "July"], ["aug", "August"], ["sep", "September"], ["oct", "October"], ["nov", "November"],
  ["dec", "December"]])
const TYPE = /[A-Za-z]+/y
const KEY = /[^\s,{}()"#=]*/y
const FIELD = /[^\s=,{}()"#]+/y
const NUMBER = /\d+(?![^\s,#}){("])/y
const MACRO = /[^\s,#=(){}"]+/y
const SPACE = /\s*/y
const NEXT_ENTRY = /\n[ \t]*@[a-zA-Z]+[ \t]*[{(]/y

class BibError extends Error {}

export function lineAt(s: string, at: number): number {
  let line = 1
  for (let i = s.indexOf("\n"); i >= 0 && i < at; i = s.indexOf("\n", i + 1)) line++
  return line
}

function take(sc: Scan, re: RegExp): string {
  re.lastIndex = sc.i
  const m = re.exec(sc.s)
  if (!m) return ""
  sc.i = re.lastIndex
  return m[0]
}

function runaway(sc: Scan, i: number): boolean {
  if (sc.s[i] !== "\n") return false
  NEXT_ENTRY.lastIndex = i
  return NEXT_ENTRY.test(sc.s)
}

function delimited(sc: Scan, quote: boolean): string {
  const start = ++sc.i
  let depth = quote ? 0 : 1
  for (; sc.i < sc.s.length; sc.i++) {
    const ch = sc.s[sc.i]
    if (runaway(sc, sc.i)) break
    if (ch === "{") depth++
    else if (ch === "}") depth--
    if ((quote && ch === '"' && depth === 0) || (!quote && depth === 0)) return sc.s.slice(start, sc.i++)
    if (depth < 0) throw new BibError("a closing brace has no opening one")
  }
  throw new BibError(quote ? "a quoted value never ends" : "its braces don't balance")
}

function part(sc: Scan): string {
  const ch = sc.s[sc.i]
  if (ch === "{") return delimited(sc, false)
  if (ch === '"') return delimited(sc, true)
  const number = take(sc, NUMBER)
  if (number) return number
  const name = take(sc, MACRO)
  if (!name) throw new BibError(ch === undefined ? "it never ends" : `a value is missing before "${ch}"`)
  const known = sc.macros.get(name.toLowerCase()) ?? MONTHS.get(name.toLowerCase())
  if (known !== undefined) return known
  sc.problems.push(`"${sc.key}" uses @string ${name}, which isn't defined: kept as text`)
  return name
}

function value(sc: Scan): string {
  let out = ""
  for (;;) {
    take(sc, SPACE)
    out += part(sc)
    take(sc, SPACE)
    if (sc.s[sc.i] !== "#") return out
    sc.i++
  }
}

function fields(sc: Scan, close: string): Map<string, string> {
  const out = new Map<string, string>()
  for (;;) {
    take(sc, SPACE)
    const ch = sc.s[sc.i]
    if (ch === close) {
      sc.i++
      return out
    }
    if (ch === ",") {
      sc.i++
      continue
    }
    const name = take(sc, FIELD).toLowerCase()
    if (!name) throw new BibError(ch === undefined ? "it never ends" : `unexpected "${ch}"`)
    take(sc, SPACE)
    if (sc.s[sc.i] !== "=") throw new BibError(`field "${name}" has no "="`)
    sc.i++
    const v = value(sc)
    if (!out.has(name)) out.set(name, v)
  }
}

function skipBalanced(sc: Scan, open: string, close: string) {
  let depth = 1
  for (; sc.i < sc.s.length && depth > 0; sc.i++) {
    if (runaway(sc, sc.i)) throw new BibError("its braces don't balance")
    if (sc.s[sc.i] === open) depth++
    else if (sc.s[sc.i] === close) depth--
  }
}

function entry(sc: Scan, type: string, at: number, close: string): RawEntry | null {
  if (type === "comment" || type === "preamble") {
    skipBalanced(sc, close === "}" ? "{" : "(", close)
    return null
  }
  if (type === "string") {
    sc.key = "@string"
    for (const [name, v] of fields(sc, close)) sc.macros.set(name, v)
    return null
  }
  take(sc, SPACE)
  sc.key = take(sc, KEY)
  take(sc, SPACE)
  if (sc.s[sc.i] === ",") sc.i++
  else if (sc.s[sc.i] !== close) throw new BibError(`expected "," after the key`)
  return { type, key: sc.key, fields: fields(sc, close), at }
}

function recover(sc: Scan, at: number): number {
  const next = /\n[ \t]*@/g
  next.lastIndex = at + 1
  const m = next.exec(sc.s)
  return m ? m.index + m[0].length - 1 : sc.s.length
}

export type Lexed = { entries: RawEntry[]; problems: string[] }

export function lexBibtex(text: string): Lexed {
  const sc: Scan = { s: text.replace(/^﻿/, ""), i: 0, key: "", macros: new Map(), problems: [] }
  const entries: RawEntry[] = []
  for (let at = sc.s.indexOf("@"); at >= 0; at = sc.s.indexOf("@", sc.i)) {
    sc.i = at + 1
    const type = take(sc, TYPE).toLowerCase()
    take(sc, SPACE)
    const open = sc.s[sc.i]
    if (!type || (open !== "{" && open !== "(")) continue
    sc.i++
    sc.key = ""
    try {
      const e = entry(sc, type, at, open === "{" ? "}" : ")")
      if (e) entries.push(e)
    } catch (err) {
      if (!(err instanceof BibError)) throw err
      const name = sc.key ? `"${sc.key}"` : `@${type}`
      sc.problems.push(`Skipped ${name} at line ${lineAt(sc.s, at)}: ${err.message}`)
      sc.i = recover(sc, at)
    }
  }
  return { entries, problems: sc.problems }
}
