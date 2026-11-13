export type Author = { by: string; agent?: string; model?: string; effort?: string; tint?: string; t: number; guest?: boolean }
export type Span = Author & { line: number; lines: string[]; mixed?: number[] }
export type Mark = { line: number; span: number; mixed: boolean }

export const MAX_SPANS = 400
const ALIKE = 0.5
const NEAR = 60

export function alike(a: string, b: string) {
  a = a.trim(); b = b.trim()
  if (a === b) return 1
  if (!a || !b) return 0
  let p = 0
  const n = Math.min(a.length, b.length)
  while (p < n && a[p] === b[p]) p++
  let q = 0
  while (q < n - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  const ends = Math.max((p + q) / Math.max(a.length, b.length), Math.min(a.length, b.length) >= 8 ? 0.75 * (p + q) / Math.min(a.length, b.length) : 0)
  const wa = a.toLowerCase().split(/\s+/), wb = b.toLowerCase().split(/\s+/), left = new Map<string, number>()
  for (const w of wa) left.set(w, (left.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of wb) { const k = left.get(w) ?? 0; if (k) { shared++; left.set(w, k - 1) } }
  return Math.max(ends, (2 * shared) / (wa.length + wb.length))
}

const blank = (s: string) => !s.trim()
export function frontmatterEnd(lines: string[]) {
  if (lines[0]?.trimEnd() !== "---") return 0
  for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1
  return 0
}

export function resolve(text: string, spans: Span[]): Map<number, Mark> {
  const doc = text.replace(/\r\n/g, "\n").split("\n")
  const at = new Map<string, number[]>()
  doc.forEach((l, i) => { if (!blank(l)) { const k = at.get(l); if (k) k.push(i); else at.set(l, [i]) } })
  const out = new Map<number, Mark>()
  const order = spans.map((_, i) => i).sort((a, b) => (spans[a].t ?? 0) - (spans[b].t ?? 0) || a - b)
  for (const si of order) {
    const s = spans[si]
    for (const [i, mixed] of place(doc, at, s)) out.set(i + 1, { line: i + 1, span: si, mixed })
  }
  return out
}

function place(doc: string[], at: Map<string, number[]>, s: Span): Map<number, boolean> {
  const L = Array.isArray(s.lines) ? s.lines : [], hint = Math.max(0, (s.line ?? 1) - 1), was = new Set(s.mixed ?? [])
  const found = new Map<number, boolean>()
  const starts = new Map<number, number>()
  L.forEach((l, j) => { if (!blank(l)) for (const d of at.get(l) ?? []) starts.set(d - j, (starts.get(d - j) ?? 0) + 1) })
  let start = -1, best = 0
  for (const [st, n] of starts) {
    if (n > best || (n === best && Math.abs(st - hint) < Math.abs(start - hint))) { start = st; best = n }
  }
  if (start === -1) {
    let from = Math.max(0, hint - NEAR)
    L.forEach((l, j) => {
      if (blank(l)) return
      let bi = -1, bs = ALIKE
      for (let d = from; d < Math.min(doc.length, hint + j + NEAR); d++) {
        if (found.has(d) || blank(doc[d])) continue
        const sc = alike(l, doc[d])
        if (sc > bs || (sc === bs && bi >= 0 && Math.abs(d - hint - j) < Math.abs(bi - hint - j))) { bi = d; bs = sc }
      }
      if (bi >= 0) { found.set(bi, true); from = bi + 1 }
    })
    return found
  }
  let d = start
  for (let j = 0; j < L.length; j++) {
    const l = L[j]
    if (blank(l)) { if (d >= 0 && d < doc.length && blank(doc[d])) d++; continue }
    if (d < 0) { d++; continue }
    if (doc[d] === l) { found.set(d, was.has(j)); d++; continue }
    let skip = -1
    for (let k = 1; k <= 3 && d + k < doc.length; k++) if (doc[d + k] === l) { skip = d + k; break }
    if (skip >= 0) { found.set(skip, was.has(j)); d = skip + 1; continue }
    if (d < doc.length && !blank(doc[d]) && alike(l, doc[d]) >= ALIKE) { found.set(d, true); d++; continue }
  }
  return found
}

export function written(before: string | null, after: string, author: Author, diff: (a: string[], b: string[]) => [string, number, number, number, number][],
  marks?: Map<number, Mark>): Span[] {
  const a = (before ?? "").replace(/\r\n/g, "\n").split("\n"), b = after.replace(/\r\n/g, "\n").split("\n")
  const fm = frontmatterEnd(b), out: Span[] = []
  const ops = before === null || before === "" ? [["insert", 0, 0, 0, b.length] as [string, number, number, number, number]] : diff(a, b)
  for (const [tag, i1, i2, j1, j2] of ops) {
    if (tag !== "insert" && tag !== "replace") continue
    let lo = Math.max(j1, fm), hi = j2
    while (lo < hi && blank(b[lo])) lo++
    while (hi > lo && blank(b[hi - 1])) hi--
    if (lo >= hi) continue
    const lines = b.slice(lo, hi), mixed: number[] = []
    if (tag === "replace") {
      lines.forEach((l, k) => {
        if (blank(l)) return
        for (let i = i1; i < i2; i++) {
          if (blank(a[i]) || alike(a[i], l) < ALIKE) continue
          const m = marks?.get(i + 1)
          if (!m || m.mixed) { mixed.push(k); break }
          if (m) break
        }
      })
    }
    out.push({ ...author, line: lo + 1, lines, ...(mixed.length ? { mixed } : {}) })
  }
  return out
}

export function authorText(a: Author, time: (t: number) => string) {
  const how = [a.model, a.effort].filter(Boolean).join(" ")
  return [a.guest ? `${a.by} (guest)` : a.by, how, a.t ? time(a.t) : ""].filter(Boolean).join(" · ")
}
