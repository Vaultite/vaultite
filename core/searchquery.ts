// Search queries in Obsidian's syntax (help.obsidian.md/plugins/search), shared by the server and the app (no Node).
// `parse` throws a SearchError saying what's wrong; terms match part of a word, without case unless asked.

export class SearchError extends Error {}

type Field = "any" | "file" | "path" | "content"
type Unit = "line" | "block" | "section" | "task" | "task-todo" | "task-done"
/** How a term matches a piece of text: every place it does, as [from, to) ranges. */
type Matcher = { label: string; ranges: (s: string) => [number, number][] }

export type Node =
  | { t: "and" | "or"; kids: Node[] }
  | { t: "not"; kid: Node }
  | { t: "all" }
  | { t: "term"; field: Field; m: Matcher }
  | { t: "tag"; tag: string }
  | { t: "prop"; key: string; value: Node | null }
  | { t: "scope"; unit: Unit; kid: Node }

/** What a query is matched against: a file. `name`: what a plain word matches besides the text (a note's name without
 *  .md); `file`: its name with the extension (file:); `path`: from the vault's top (path:). */
export type SearchDoc = { name: string; file: string; path: string; text: string; tags?: string[]; props?: Record<string, unknown> }

const OPS = new Set(["file", "path", "content", "tag", "line", "block", "section", "task", "task-todo", "task-done", "match-case", "ignore-case"])

// ---------- reading a query ----------

type Tok = { k: "word" | "phrase" | "regex" | "op" | "prop" | "(" | ")" | "-" | "or"; v: string; flags?: string; key?: string; neg?: boolean }

function tokens(q: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const space = (c: string | undefined) => c === undefined || /\s/.test(c)
  const quoted = (): string => {
    let s = ""
    for (i++; i < q.length && q[i] !== '"'; i++) s += q[i] === "\\" && q[i + 1] === '"' ? q[++i] : q[i]
    if (q[i] !== '"') throw new SearchError("A quote isn't closed")
    i++
    return s
  }
  const regex = (): { v: string; flags: string } | null => {
    // /.../ when there's a closing slash; else the slash is just a character
    let j = i + 1, s = ""
    for (; j < q.length && q[j] !== "/"; j++) s += q[j] === "\\" && q[j + 1] === "/" ? (j++, "\\/") : q[j]
    if (j >= q.length || !s) return null
    j++
    let flags = ""
    while (j < q.length && /[imsu]/.test(q[j])) flags += q[j++]
    if (!space(q[j]) && q[j] !== ")" && q[j] !== "]") return null
    i = j
    return { v: s, flags }
  }
  while (i < q.length) {
    const c = q[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "(" || c === ")") { out.push({ k: c, v: c }); i++; continue }
    if (c === "-" && !space(q[i + 1]) && q[i + 1] !== "-") { out.push({ k: "-", v: "-" }); i++; continue }
    if (c === '"') { out.push({ k: "phrase", v: quoted() }); continue }
    if (c === "/") { const r = regex(); if (r) { out.push({ k: "regex", v: r.v, flags: r.flags }); continue } }
    if (c === "[") {
      // [key] or [key:value]: the value is read later, as a query of its own
      let depth = 0, j = i, s = ""
      for (; j < q.length; j++) {
        if (q[j] === '"') { const end = q.indexOf('"', j + 1); if (end < 0) break; s += q.slice(j, end + 1); j = end; continue }
        if (q[j] === "[") depth++
        else if (q[j] === "]" && --depth === 0) break
        if (j > i) s += q[j]
      }
      if (j >= q.length) throw new SearchError("A [property] isn't closed")
      i = j + 1
      const colon = s.indexOf(":")
      const key = (colon < 0 ? s : s.slice(0, colon)).trim()
      if (!key) throw new SearchError("A [property] needs a name: [status] or [status:seed]")
      out.push({ k: "prop", v: colon < 0 ? "" : s.slice(colon + 1).trim(), key })
      continue
    }
    // a word, maybe op: followed by its value
    let j = i
    while (j < q.length && !/[\s()]/.test(q[j]) && !(q[j] === '"' && j > i && q[j - 1] !== ":")) j++
    const word = q.slice(i, j)
    const colon = word.indexOf(":")
    const op = colon > 0 ? word.slice(0, colon).toLowerCase() : ""
    if (OPS.has(op)) { out.push({ k: "op", v: op }); i += colon + 1; continue }
    i = j
    if (word === "OR") out.push({ k: "or", v: word })
    else out.push({ k: "word", v: word })
  }
  return out
}

type Ctx = { field: Field; matchCase: boolean }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function textMatcher(s: string, matchCase: boolean): Matcher {
  const want = matchCase ? s : s.toLowerCase()
  return {
    label: `"${s}"${matchCase ? " (match case)" : ""}`,
    ranges: (text) => {
      if (!want) return []
      const hay = matchCase ? text : text.toLowerCase()
      const out: [number, number][] = []
      for (let at = hay.indexOf(want); at >= 0; at = hay.indexOf(want, at + want.length)) out.push([at, at + want.length])
      return out
    },
  }
}

function regexMatcher(src: string, flags: string, matchCase: boolean): Matcher {
  let re: RegExp
  try {
    const f = new Set([...flags, "g"])
    if (!matchCase) f.add("i")
    re = new RegExp(src, [...f].join(""))
  } catch (e) {
    throw new SearchError(`/${src}/ isn't a regular expression (${(e as Error).message.replace(/^Invalid regular expression: \/.*\/\w*: /, "")})`)
  }
  return {
    label: `/${src}/${flags}`,
    ranges: (text) => {
      const out: [number, number][] = []
      re.lastIndex = 0
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0]) { re.lastIndex++; if (out.length > 10000) break; continue }
        out.push([m.index, m.index + m[0].length])
      }
      return out
    },
  }
}

class Parser {
  toks: Tok[]
  i = 0
  constructor(toks: Tok[]) { this.toks = toks }
  peek() { return this.toks[this.i] }

  or(ctx: Ctx, close = false): Node {
    const kids = [this.and(ctx, close)]
    while (this.peek()?.k === "or") { this.i++; kids.push(this.and(ctx, close)) }
    return kids.length === 1 ? kids[0] : { t: "or", kids }
  }
  and(ctx: Ctx, close: boolean): Node {
    const kids: Node[] = []
    for (let tok = this.peek(); tok && tok.k !== "or" && tok.k !== ")"; tok = this.peek()) kids.push(this.unary(ctx))
    if (this.peek()?.k === ")" && !close) throw new SearchError("There's a ) without a (")
    if (!kids.length) {
      if (this.peek()?.k === "or" || this.toks[this.i - 1]?.k === "or") throw new SearchError("OR needs something on both sides")
      if (this.i > 0) throw new SearchError("A ( isn't closed")
      return { t: "all" }
    }
    return kids.length === 1 ? kids[0] : { t: "and", kids }
  }
  unary(ctx: Ctx): Node {
    if (this.peek()?.k === "-") { this.i++; if (!this.peek() || this.peek().k === ")" || this.peek().k === "or") throw new SearchError("- needs something after it"); return { t: "not", kid: this.unary(ctx) } }
    return this.primary(ctx)
  }
  group(ctx: Ctx): Node {
    this.i++ // (
    if (this.peek()?.k === ")") { this.i++; return { t: "all" } }
    const n = this.or(ctx, true)
    if (this.peek()?.k !== ")") throw new SearchError("A ( isn't closed")
    this.i++
    return n
  }
  primary(ctx: Ctx): Node {
    const tok = this.peek()
    if (tok.k === "(") return this.group(ctx)
    this.i++
    if (tok.k === "word") return { t: "term", field: ctx.field, m: textMatcher(tok.v, ctx.matchCase) }
    if (tok.k === "phrase") return { t: "term", field: ctx.field, m: textMatcher(tok.v, ctx.matchCase) }
    if (tok.k === "regex") return { t: "term", field: ctx.field, m: regexMatcher(tok.v, tok.flags ?? "", ctx.matchCase) }
    if (tok.k === "prop") {
      const value = tok.v ? parseWith(tok.v, { field: "content", matchCase: ctx.matchCase }) : null
      return { t: "prop", key: tok.key!, value: value && value.t !== "all" ? value : null }
    }
    if (tok.k === "op") {
      const op = tok.v
      const next = this.peek()
      const empty = !next || next.k === ")" || next.k === "or" || next.k === "op"
      // an operator's value: a word, a phrase, a regex or a group, read with the operator's field and case
      const value = (c: Ctx): Node => (empty ? { t: "all" } : next.k === "-" ? this.unary(c) : this.primary(c))
      if (op === "tag") {
        if (empty) throw new SearchError("tag: needs a tag: tag:#project")
        if (next.k === "(") return mapTerms(this.group(ctx), (m) => ({ t: "tag", tag: tagOf(m) }))
        this.i++
        return { t: "tag", tag: next.v.replace(/^#/, "") }
      }
      if (op === "match-case" || op === "ignore-case") {
        if (empty) throw new SearchError(`${op}: needs something after it: ${op}:Word`)
        return value({ ...ctx, matchCase: op === "match-case" })
      }
      if (op === "file" || op === "path" || op === "content") {
        if (empty) throw new SearchError(`${op}: needs something after it: ${op}:word`)
        return value({ ...ctx, field: op })
      }
      return { t: "scope", unit: op as Unit, kid: value({ ...ctx, field: "content" }) }
    }
    throw new SearchError(tok.k === "or" ? "OR needs something on both sides" : `Unexpected ${tok.v}`)
  }
}

/** A tag: written in a group (tag:(a OR b)), each term's text. */
const tagOf = (n: Node) => (n.t === "term" ? n.m.label.replace(/^"|"( \(match case\))?$/g, "").replace(/^#/, "") : "")
function mapTerms(n: Node, f: (n: Node) => Node): Node {
  if (n.t === "term") return f(n)
  if (n.t === "and" || n.t === "or") return { ...n, kids: n.kids.map((k) => mapTerms(k, f)) }
  if (n.t === "not") return { ...n, kid: mapTerms(n.kid, f) }
  return n
}

function parseWith(q: string, ctx: Ctx): Node {
  const p = new Parser(tokens(q))
  if (!p.toks.length) return { t: "all" }
  const n = p.or(ctx)
  if (p.i < p.toks.length) throw new SearchError(p.peek().k === ")" ? "There's a ) without a (" : `Unexpected ${p.peek().v}`)
  return n
}

/** A query as a tree (throws SearchError). `matchCase`: words match in their case unless ignore-case: says otherwise. */
export function parse(q: string, opts: { matchCase?: boolean } = {}): Node {
  return parseWith(q, { field: "any", matchCase: !!opts.matchCase })
}

/** A query that's only words (no operator, quote, regex, OR or -): the quick switcher finds names for those. */
export function isPlain(n: Node): boolean {
  if (n.t === "all") return true
  if (n.t === "term") return n.field === "any" && n.m.label.startsWith('"') && !n.m.label.includes(" (match case)") && !n.m.label.slice(1, -1).includes(" ")
  if (n.t === "and") return n.kids.every(isPlain)
  return false
}

// ---------- matching ----------

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\]\s?(.*)$/

function unitsOf(text: string, unit: Unit): string[] {
  if (unit === "line") return text.split("\n")
  if (unit === "block") return text.split(/\n[ \t]*\n/)
  if (unit === "section") {
    const out: string[] = []
    let cur: string[] = []
    let fence = false
    for (const l of text.split("\n")) {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence
      if (!fence && /^#{1,6}\s/.test(l) && cur.length) { out.push(cur.join("\n")); cur = [] }
      cur.push(l)
    }
    out.push(cur.join("\n"))
    return out
  }
  const out: string[] = []
  for (const l of text.split("\n")) {
    const m = TASK.exec(l)
    if (!m) continue
    const done = m[1] !== " "
    if (unit === "task" || (unit === "task-done") === done) out.push(m[2])
  }
  return out
}

function propValue(props: Record<string, unknown> | undefined, key: string): unknown {
  if (!props) return undefined
  if (key in props) return props[key]
  const k = Object.keys(props).find((x) => x.toLowerCase() === key.toLowerCase())
  return k === undefined ? undefined : props[k]
}
const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)
const textOfValue = (v: unknown): string => (v && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : String(v))

function hasTag(tags: string[], want: string) {
  const w = want.toLowerCase().replace(/^\/+|\/+$/g, "")
  return tags.some((t) => { const x = t.toLowerCase(); return x === w || x.startsWith(`${w}/`) })
}

/** Whether a file matches. */
export function matches(n: Node, d: SearchDoc): boolean {
  switch (n.t) {
    case "all": return true
    case "and": return n.kids.every((k) => matches(k, d))
    case "or": return n.kids.some((k) => matches(k, d))
    case "not": return !matches(n.kid, d)
    case "term": {
      const hit = (s: string) => n.m.ranges(s).length > 0
      if (n.field === "file") return hit(d.file)
      if (n.field === "path") return hit(d.path)
      if (n.field === "content") return hit(d.text)
      return hit(d.name) || hit(d.text)
    }
    case "tag": return hasTag(d.tags ?? [], n.tag)
    case "prop": {
      const v = propValue(d.props, n.key)
      if (blank(v)) return false
      if (!n.value) return true
      return (Array.isArray(v) ? v : [v]).some((x) => matches(n.value!, { name: "", file: "", path: "", text: textOfValue(x) }))
    }
    case "scope": return unitsOf(d.text, n.unit).some((u) => matches(n.kid, { ...d, name: "", file: "", path: "", text: u }))
  }
}

// ---------- marking what matched ----------

/** The terms that say why a file matched, for marking: the ones not under a "not", in a file's text (`text`) or its
 *  name (`name`). A tag marks its #tag in the text. */
function markers(n: Node, where: "text" | "name", out: Matcher[] = [], neg = false): Matcher[] {
  if (n.t === "and" || n.t === "or") for (const k of n.kids) markers(k, where, out, neg)
  else if (n.t === "not") markers(n.kid, where, out, !neg)
  else if (n.t === "scope" && where === "text") markers(n.kid, where, out, neg)
  else if (n.t === "term" && !neg) {
    if (where === "text" ? n.field === "any" || n.field === "content" : n.field === "any" || n.field === "file" || n.field === "path") out.push(n.m)
  } else if (n.t === "tag" && !neg && where === "text") {
    out.push(regexMatcher(`(?<![\\p{L}\\p{N}_/-])#${escapeRe(n.tag)}(?:/[\\p{L}\\p{N}_\\-/]*)?(?![\\p{L}\\p{N}_-])`, "u", false))
  }
  return out
}

/** A function giving the ranges to mark in a piece of text (sorted, merged), for a query. */
export function highlighter(n: Node, where: "text" | "name" = "text"): (s: string) => [number, number][] {
  const ms = markers(n, where)
  return (s) => {
    if (!ms.length || !s) return []
    const all = ms.flatMap((m) => m.ranges(s)).sort((a, b) => a[0] - b[0] || b[1] - a[1])
    const out: [number, number][] = []
    for (const r of all) {
      const last = out[out.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else out.push([r[0], r[1]])
    }
    return out
  }
}

// ---------- saying what a query does ----------

const FIELD: Record<Field, string> = { any: "the name or text has", file: "the file name has", path: "the path has", content: "the text has" }
const UNIT: Record<Unit, string> = { line: "a line", block: "a paragraph", section: "a section", task: "a task", "task-todo": "an unticked task", "task-done": "a ticked task" }

/** The query in words ("Files where the name or text has "budget", and it's tagged #finance"): "Explain search term". */
export function explain(n: Node): string {
  // what a piece of text has (inside line:(), a property's value): just the terms
  const inner = (n: Node): string => {
    if (n.t === "term") return n.m.label
    if (n.t === "and") return n.kids.map(inner).join(" and ")
    if (n.t === "or") return `either ${n.kids.map(inner).join(" or ")}`
    if (n.t === "not") return `not ${inner(n.kid)}`
    return say(n)
  }
  const say = (n: Node): string => {
    switch (n.t) {
      case "all": return "anything"
      case "term": return `${FIELD[n.field]} ${n.m.label}`
      case "tag": return `it's tagged #${n.tag}`
      case "prop": return n.value ? `its property ${n.key} has ${inner(n.value)}` : `it has the property ${n.key}`
      case "scope": return n.kid.t === "all" ? `it has ${UNIT[n.unit]}` : `${UNIT[n.unit]} has ${inner(n.kid)}`
      case "not": return `not (${say(n.kid)})`
      case "and": return n.kids.map((k) => (k.t === "or" ? `(${say(k)})` : say(k))).join(", and ")
      case "or": return `either ${n.kids.map((k) => (k.t === "and" ? `(${say(k)})` : say(k))).join(", or ")}`
    }
  }
  return n.t === "all" ? "Every file" : `Files where ${say(n)}`
}

// ---------- showing where it matched ----------

/** Character indexes of ranges, for drawing marks (the app's <Marked>). */
export const marksOf = (ranges: [number, number][]) => ranges.flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + k))

/** Every place one of `words` is in `text`, without case, merged. */
export function wordRanges(text: string, words: string[]): [number, number][] {
  const low = text.toLowerCase()
  const all: [number, number][] = []
  for (const w of words) if (w) for (let at = low.indexOf(w); at >= 0; at = low.indexOf(w, at + w.length)) all.push([at, at + w.length])
  all.sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const r of all) { const last = out[out.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([...r]) }
  return out
}

/** The part of a long text from just before its first match, so the match shows when the line is cut to `max`
 *  characters ("…" where something was left out), with the ranges moved to match. */
export function excerpt(text: string, ranges: [number, number][], max = 160, before = 24): { text: string; ranges: [number, number][] } {
  const first = ranges[0]?.[0] ?? 0
  // a little before the match (a row is cut at its end, so the match must come early), at a word's start
  let from = Math.max(0, first - before)
  if (from > 0) { const sp = text.indexOf(" ", from); if (sp >= 0 && sp < first) from = sp + 1 }
  const to = Math.min(text.length, from + max)
  const lead = from > 0 ? "…" : ""
  const shift = lead.length - from
  return {
    text: `${lead}${text.slice(from, to)}${to < text.length ? "…" : ""}`,
    ranges: ranges.filter(([a, b]) => b > from && a < to).map(([a, b]) => [Math.max(a, from) + shift, Math.min(b, to) + shift]),
  }
}
