// Small edits to files people also write by hand, shared by the server (Vault.save) and the editor (no Node here).
// Each returns null when it can't edit safely; the caller then writes the whole thing.

// ---------- line diffs (Python's difflib.SequenceMatcher, without junk heuristics) ----------

export type Opcode = ["equal" | "replace" | "delete" | "insert", number, number, number, number]

/** Matching blocks of a and b, [i, j, size], ending with [a.length, b.length, 0]. */
function matchingBlocks<T>(a: T[], b: T[]): [number, number, number][] {
  const b2j = new Map<T, number[]>()
  b.forEach((x, j) => { const l = b2j.get(x); if (l) l.push(j); else b2j.set(x, [j]) })
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let bi = alo, bj = blo, size = 0
    let j2len = new Map<number, number>()
    for (let i = alo; i < ahi; i++) {
      const next = new Map<number, number>()
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue
        if (j >= bhi) break
        const k = (j2len.get(j - 1) ?? 0) + 1
        next.set(j, k)
        if (k > size) { bi = i - k + 1; bj = j - k + 1; size = k }
      }
      j2len = next
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; size++ }
    while (bi + size < ahi && bj + size < bhi && a[bi + size] === b[bj + size]) size++
    return [bi, bj, size]
  }
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]]
  const blocks: [number, number, number][] = []
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!
    const m = longest(alo, ahi, blo, bhi)
    const [i, j, k] = m
    if (k) {
      blocks.push(m)
      if (alo < i && blo < j) queue.push([alo, i, blo, j])
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi])
    }
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2])
  const out: [number, number, number][] = []
  let [i1, j1, k1] = [0, 0, 0]
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2
    else { if (k1) out.push([i1, j1, k1]); [i1, j1, k1] = [i2, j2, k2] }
  }
  if (k1) out.push([i1, j1, k1])
  out.push([a.length, b.length, 0])
  return out
}

/** How to turn a into b: equal runs and changed runs (replace / delete / insert). */
export function opcodes<T>(a: T[], b: T[]): Opcode[] {
  let i = 0, j = 0
  const out: Opcode[] = []
  for (const [ai, bj, size] of matchingBlocks(a, b)) {
    const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null
    if (tag) out.push([tag, i, ai, j, bj])
    i = ai + size; j = bj + size
    if (size) out.push(["equal", ai, i, bj, j])
  }
  return out
}

/** How alike two lines are, 0 to 1 (difflib's ratio, ignoring surrounding spaces). */
function similar(x: string, y: string) {
  const a = [...x.trim()], b = [...y.trim()]
  if (!a.length && !b.length) return 1
  const m = matchingBlocks(a, b).reduce((n, blk) => n + blk[2], 0)
  return (2 * m) / (a.length + b.length)
}

// ---------- body ----------

type Span = [number, number] | null

/** For each base line, the span of `actual` lines it became, or null. In a changed stretch each actual line goes to the
 *  most similar base line, and lines that look like nothing (a wrapped continuation) stay with the one before. */
function align(base: string[], actual: string[], fuzzy: boolean): Span[] {
  const span: Span[] = new Array(base.length).fill(null)
  for (const [tag, i1, i2, j1, j2] of opcodes(base, actual)) {
    if (tag === "equal") {
      for (let k = 0; k < i2 - i1; k++) span[i1 + k] = [j1 + k, j1 + k + 1]
    } else if (tag === "replace" && fuzzy) {
      let cur: number | null = null // the base line the previous actual line went to
      for (let j = j1; j < j2; j++) {
        let best: number | null = null, score = 0.5
        for (let i: number = cur ?? i1; i < i2; i++) {
          const s = similar(base[i], actual[j])
          if (s > score) { best = i; score = s }
        }
        if (best === null && cur !== null && /^[ \t]/.test(actual[j])) best = cur // an indented continuation
        if (best === null) continue
        const was = span[best]
        span[best] = was ? [was[0], j + 1] : [j, j + 1]
        cur = best
      }
    }
  }
  return span
}

/** Apply base -> mine onto `actual`, or null when a changed line was edited there too (a conflict). `fuzzy`: a line only
 *  rewritten canonically counts as found; leave it off for two people editing the same text. */
export function merge3(base: string, mine: string, actual: string, fuzzy = false): string | null {
  if (actual === base || actual === mine) return mine
  if (mine === base) return actual
  const b = base.split("\n"), n = mine.split("\n"), a = actual.split("\n")
  const span = align(b, a, fuzzy)
  const edits: [number, number, string[]][] = []
  for (const [tag, i1, i2, j1, j2] of opcodes(b, n)) {
    if (tag === "equal") continue
    let start: number, end: number
    if (i1 < i2) {
      const spans = span.slice(i1, i2)
      if (spans.some((s) => s === null)) return null
      start = Math.min(...spans.map((s) => s![0])); end = Math.max(...spans.map((s) => s![1]))
      if (!fuzzy && end - start !== i2 - i1) return null // the other side added lines inside the stretch we changed
    } else if (!fuzzy) {
      const before = i1 > 0 ? (span[i1 - 1] ? span[i1 - 1]![1] : null) : 0
      const after = i1 < b.length ? (span[i1] ? span[i1]![0] : null) : a.length
      if (before === null || after === null || before !== after) return null // they changed the lines right there
      start = end = after
    } else if (i1 < b.length && span[i1]) start = end = span[i1]![0]
    else if (i1 > 0 && span[i1 - 1]) start = end = span[i1 - 1]![1]
    else if (i1 === 0) start = end = 0
    else if (i1 === b.length) start = end = a.length
    else return null
    edits.push([start, end, n.slice(j1, j2)])
  }
  edits.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  for (let k = 1; k < edits.length; k++) if (edits[k][0] < edits[k - 1][1]) return null // two changes on the same lines
  const out = [...a]
  for (const [s, e, lines] of edits.reverse()) out.splice(s, e - s, ...lines)
  return out.join("\n")
}

// ---------- frontmatter ----------

const TOP_KEY = /^(?:'([^']*)'|"([^"]*)"|([^\s#'"-][^:]*?|-[^\s][^:]*?))\s*:(?:\s|$)/

export type Block = { key: string | null; lines: string[] }

/** Top-level blocks of a YAML header: a `key:` line plus the lines under it (indented lines, `- item` lines of a list,
 *  blank lines); comments at the top level are blocks of their own. */
export function blocks(raw: string): Block[] {
  const out: Block[] = []
  for (const line of raw ? raw.split("\n") : []) {
    const m = /^[ \t]/.test(line) ? null : TOP_KEY.exec(line)
    if (m) out.push({ key: (m[1] ?? m[2] ?? m[3]).trim(), lines: [line] })
    else if (out.length && (/^[ \t-]/.test(line) || !line.trim())) out[out.length - 1].lines.push(line)
    else out.push({ key: null, lines: [line] })
  }
  return out
}

/** Deep equality of plain values (what YAML reads). */
export function same(x: unknown, y: unknown): boolean {
  if (x === y) return true
  if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false
  if (Array.isArray(x) !== Array.isArray(y)) return false
  if (Array.isArray(x)) return x.length === (y as unknown[]).length && x.every((v, i) => same(v, (y as unknown[])[i]))
  const kx = Object.keys(x), ky = Object.keys(y)
  return kx.length === ky.length && kx.every((k) => k in y && same((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]))
}

/** The header `raw` with `changes` written and `removals` deleted, each key's own lines only; `order` places new keys.
 *  null if it can't be patched line by line (checked by parsing the result back with `load`). */
export function patchFrontmatter(raw: string, old: Record<string, unknown>, changes: Record<string, unknown>,
  removals: string[], order: string[], dump: (key: string, value: unknown) => string,
  load: (text: string) => Record<string, unknown>): string | null {
  let bs = blocks(raw)
  const keys = bs.map((b) => b.key).filter((k) => k !== null)
  if (new Set(keys).size !== keys.length) return null // duplicate keys: let YAML decide what they mean, don't guess
  bs = bs.filter((b) => b.key === null || !removals.includes(b.key))
  for (const [key, value] of Object.entries(changes)) {
    const lines = dump(key, value).split("\n")
    const at = bs.findIndex((b) => b.key === key)
    if (at >= 0) {
      // Keep blank lines that followed the old value.
      const tail: string[] = []
      for (const line of bs[at].lines.slice(1).reverse()) { if (line.trim()) break; tail.unshift(line) }
      bs[at] = { key, lines: [...lines, ...tail] }
      continue
    }
    const rank = order.includes(key) ? order.indexOf(key) : order.length
    const idx = (b: Block) => (b.key !== null && order.includes(b.key) ? order.indexOf(b.key) : -1)
    const before = bs.map((b, i) => [b, i] as const).filter(([b]) => idx(b) >= 0 && idx(b) < rank).map(([, i]) => i)
    const after = bs.map((b, i) => [b, i] as const).filter(([b]) => idx(b) > rank).map(([, i]) => i)
    const pos = before.length ? before[before.length - 1] + 1 : after.length ? after[0] : bs.length
    // (after the last key's value, not after the blank lines that close it)
    const prev = bs[pos - 1], blank: string[] = []
    while (prev && prev.lines.length > 1 && !prev.lines[prev.lines.length - 1].trim()) blank.unshift(prev.lines.pop()!)
    bs.splice(pos, 0, { key, lines: [...lines, ...blank] })
  }
  const joined = bs.flatMap((b) => b.lines).join("\n"), out = joined.trim() ? joined : ""
  const want: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(old)) if (!removals.includes(k)) want[k] = v
  for (const [k, v] of Object.entries(changes)) want[k] = load(dump(k, v))[k]
  let got: Record<string, unknown>
  try {
    got = out.trim() ? load(out) : {}
  } catch {
    return null
  }
  return same(got, want) ? out : null
}

/** A key as YAML writes it: plain when it can be, else 'single quoted'. */
const keyText = (k: string) => (/^[A-Za-z_][\w-]*(?: [\w-]+)*$/.test(k) ? k : `'${k.replace(/'/g, "''")}'`)

/** The header `raw` with key `from` renamed `to`, its value's lines, comments and place untouched. null when that isn't
 *  safe (no such key, `to` taken, duplicates, or it doesn't read back the same). */
export function renameKey(raw: string, from: string, to: string, load: (text: string) => Record<string, unknown>): string | null {
  if (!to.trim() || to === from) return null
  const bs = blocks(raw)
  const keys = bs.map((b) => b.key).filter((k) => k !== null)
  if (new Set(keys).size !== keys.length || keys.includes(to)) return null
  const b = bs.find((x) => x.key === from)
  const m = b ? TOP_KEY.exec(b.lines[0]) : null
  if (!b || !m) return null
  const colon = m[0].lastIndexOf(":")
  b.lines = [keyText(to) + b.lines[0].slice(colon), ...b.lines.slice(1)]
  const out = bs.flatMap((x) => x.lines).join("\n")
  let old: Record<string, unknown>, got: Record<string, unknown>
  try { old = load(raw) ?? {}; got = load(out) ?? {} } catch { return null }
  const want: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(old)) want[k === from ? to : k] = v
  return same(got, want) ? out : null
}
