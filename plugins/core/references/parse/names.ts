import type { CslName } from "../csl.ts"
import { latexToUnicode } from "./latex.ts"

type Text = (raw: string) => string
type Pieces = { first: string[]; von: string[]; last: string[]; jr: string[] }
type VonLast = { von: string[]; last: string[] }

const AND = /\s+and\s+/iy
const COMMA = /\s*,\s*/y
const SPACE = /[\s~]+/y
const KEYED = /^\s*(family|given|prefix|suffix|useprefix)\s*=\s*(.*)$/is

export function topSplit(s: string, sep: RegExp): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "{") depth++
    else if (ch === "}") depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      sep.lastIndex = i
      if (sep.exec(s) && sep.lastIndex > i) {
        out.push(s.slice(start, i))
        start = sep.lastIndex
        i = start - 1
      }
    }
  }
  out.push(s.slice(start))
  return out
}

function closesAtEnd(s: string): boolean {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++
    else if (s[i] === "}" && --depth === 0) return i === s.length - 1
  }
  return false
}

function isLower(token: string, text: Text): boolean {
  if (token.startsWith("{") && token[1] !== "\\") return false
  const letter = /\p{L}/u.exec(text(token))?.[0] ?? ""
  return letter !== "" && letter === letter.toLowerCase() && letter !== letter.toUpperCase()
}

function firstVonLast(tokens: string[], lower: boolean[]): Pieces {
  const n = tokens.length
  let start = -1, end = -1
  for (let i = 0; i < n - 1; i++) {
    if (!lower[i]) continue
    if (start < 0) start = i
    end = i
  }
  if (start < 0) return { first: tokens.slice(0, n - 1), von: [], last: tokens.slice(n - 1), jr: [] }
  return { first: tokens.slice(0, start), von: tokens.slice(start, end + 1), last: tokens.slice(end + 1), jr: [] }
}

function vonLast(tokens: string[], lower: boolean[]): VonLast {
  let end = -1
  for (let i = 0; i < tokens.length - 1 && lower[0]; i++) if (lower[i]) end = i
  return { von: tokens.slice(0, end + 1), last: tokens.slice(end + 1) }
}

function words(s: string): string[] {
  return topSplit(s.trim(), SPACE).filter(Boolean)
}

function pieces(parts: string[], text: Text): Pieces {
  const head = words(parts[0])
  const lower = head.map((t) => isLower(t, text))
  if (parts.length === 1) return firstVonLast(head, lower)
  const first = words(parts[parts.length - 1])
  const jr = parts.length > 2 ? words(parts.slice(1, -1).join(" ")) : []
  return { ...vonLast(head, lower), first, jr }
}

function build(p: Pieces, text: Text, comma: boolean): CslName {
  const name: CslName = {}
  let trailing = p.first.length
  while (comma && trailing > 0 && isLower(p.first[trailing - 1], text)) trailing--
  const set = (key: "family" | "given" | "non-dropping-particle" | "dropping-particle" | "suffix", tokens: string[]) => {
    const value = text(tokens.join(" "))
    if (value) name[key] = value
  }
  set("given", p.first.slice(0, trailing))
  set("dropping-particle", p.first.slice(trailing))
  set("non-dropping-particle", p.von)
  set("family", p.last)
  set("suffix", p.jr)
  return name
}

function keyedName(parts: string[], text: Text): CslName {
  const name: CslName = {}
  const keys = new Map([["family", "family"], ["given", "given"], ["prefix", "non-dropping-particle"], ["suffix", "suffix"]])
  for (const part of parts) {
    const m = KEYED.exec(part)
    const key = m ? keys.get(m[1].toLowerCase()) : undefined
    if (m && key) name[key] = text(m[2])
  }
  return name
}

function nameFrom(raw: string, text: Text, bare: "literal" | "split"): CslName | null {
  const s = raw.trim()
  if (!s || s.toLowerCase() === "others") return null
  if (s.startsWith("{") && s[1] !== "\\" && closesAtEnd(s)) return { literal: text(s.slice(1, -1)) }
  const parts = topSplit(s, COMMA)
  if (parts.every((p) => KEYED.test(p))) return keyedName(parts, text)
  if (parts.length === 1 && bare === "literal") return { literal: text(s) }
  const name = build(pieces(parts.slice(0, 3), text), text, parts.length > 1)
  return Object.keys(name).length ? name : null
}

export function bibtexNames(raw: string): CslName[] {
  return topSplit(raw, AND).flatMap((n) => toList(nameFrom(n, (t) => latexToUnicode(t), "split")))
}

export function toList(name: CslName | null): CslName[] {
  return name ? [name] : []
}

export function plainName(text: string, bare: "literal" | "split" = "split"): CslName | null {
  return nameFrom(text, (t) => t.replace(/[{}]/g, "").replace(/\s+/g, " ").trim(), bare)
}
