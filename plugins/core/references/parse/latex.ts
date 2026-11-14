import { ACCENTS, DOTLESS, ESCAPES, FORMATS, PUNCTUATION, SWITCHES, SYMBOLS } from "./latex-tables.ts"

type Cursor = { s: string; i: number; protect: boolean }

const WORD = /[a-zA-Z]+/y
const SPACES = /[ \t\r\n]*/y
const EMPTY_ARG = /[ \t\r\n]*\{\}|[ \t\r\n]+/y

function matchAt(c: Cursor, re: RegExp): string {
  re.lastIndex = c.i
  const m = re.exec(c.s)
  if (!m) return ""
  c.i = re.lastIndex
  return m[0]
}

function skipSpaces(c: Cursor) {
  matchAt(c, SPACES)
}

function seq(c: Cursor, depth: number): string {
  let out = ""
  while (c.i < c.s.length) {
    if (c.s[c.i] === "}") {
      c.i++
      if (depth > 0) return out
      continue
    }
    const wrap = switchAt(c)
    if (wrap) return out + wrap(seq(c, depth))
    out += piece(c, depth)
  }
  return out
}

function switchAt(c: Cursor): ((t: string) => string) | undefined {
  if (c.s[c.i] !== "\\") return undefined
  WORD.lastIndex = c.i + 1
  const m = WORD.exec(c.s)
  const wrap = m && m.index === c.i + 1 ? SWITCHES.get(m[0]) : undefined
  if (wrap) {
    c.i = WORD.lastIndex
    skipSpaces(c)
  }
  return wrap
}

function piece(c: Cursor, depth: number): string {
  const ch = c.s[c.i]
  if (ch === "\\") return command(c)
  if (ch === "{") return group(c, depth)
  for (const [from, to] of PUNCTUATION) {
    if (c.s.startsWith(from, c.i)) {
      c.i += from.length
      return to
    }
  }
  c.i++
  return ch
}

function group(c: Cursor, depth: number): string {
  c.i++
  const special = c.s[c.i] === "\\"
  const inner = seq(c, depth + 1)
  const protect = c.protect && depth === 0 && !special && /\p{L}/u.test(inner)
  return protect ? `<span class="nocase">${inner}</span>` : inner
}

function argument(c: Cursor): string {
  skipSpaces(c)
  if (c.s[c.i] !== "{") return ""
  c.i++
  return seq(c, 1)
}

function rawArgument(c: Cursor): string {
  skipSpaces(c)
  if (c.s[c.i] !== "{") return ""
  let depth = 0
  const start = c.i + 1
  for (; c.i < c.s.length; c.i++) {
    if (c.s[c.i] === "{") depth++
    else if (c.s[c.i] === "}" && --depth === 0) break
  }
  const raw = c.s.slice(start, c.i)
  c.i++
  return raw.replace(/\\([_%#&~$])/g, "$1")
}

function command(c: Cursor): string {
  c.i++
  const name = matchAt(c, WORD)
  if (!name) return symbolCommand(c)
  const mark = ACCENTS.get(name)
  if (mark) return accent(c, mark)
  return wordCommand(c, name)
}

function symbolCommand(c: Cursor): string {
  const ch = c.s[c.i] ?? ""
  c.i++
  const mark = ACCENTS.get(ch)
  if (mark) return accent(c, mark)
  return ESCAPES.get(ch) ?? ch
}

function wordCommand(c: Cursor, name: string): string {
  const symbol = SYMBOLS.get(name)
  if (symbol !== undefined) {
    matchAt(c, EMPTY_ARG)
    return symbol
  }
  const format = FORMATS.get(name)
  if (format) return format(argument(c))
  if (name === "url") return rawArgument(c)
  if (name === "href") {
    const url = rawArgument(c), text = argument(c)
    return text || url
  }
  skipSpaces(c)
  return c.s[c.i] === "{" ? argument(c) : ""
}

function accent(c: Cursor, mark: string): string {
  skipSpaces(c)
  const ch = c.s[c.i]
  let base = ""
  if (ch === "{") base = argument(c)
  else if (ch === "\\") base = command(c)
  else if (ch !== undefined) {
    base = ch
    c.i++
  }
  const chars = [...base]
  if (!chars.length) return ""
  const first = DOTLESS.get(chars[0]) ?? chars[0]
  return (first + mark).normalize("NFC") + chars.slice(1).join("")
}

export function latexToUnicode(text: string, protect = false): string {
  const c: Cursor = { s: text, i: 0, protect }
  return seq(c, 0).replace(/[ \t\r\n]+/g, " ").trim()
}

export function unescapeUrl(text: string): string {
  const url = /^\s*\\url\s*\{([^]*)\}\s*$/.exec(text)?.[1] ?? text
  return url.replace(/\\([_%#&~$])/g, "$1").replace(/[{}]/g, "").replace(/\s+/g, "")
}
