// Who wrote which lines of a note: agents' writes kept beside it as spans of the lines they wrote, found again in its
// text by their words (so they follow edits, as companion comments do). Both halves use it: no Node, no DOM.

/** Who wrote a span: the agent's name as the user knows it (Opus, Claude), its kind, model, effort, colour, when; `guest`:
 *  a shared folder's guest wrote it (by: their name), text to treat as untrusted. */
export type Author = { by: string; agent?: string; model?: string; effort?: string; tint?: string; t: number; guest?: boolean }
/** Lines an agent wrote: as it wrote them, from line `line` (1-based, frontmatter counted) when it did. `mixed`: the
 *  indexes of lines it rewrote from the user's (both wrote them). */
export type Span = Author & { line: number; lines: string[]; mixed?: number[] }
/** A line of the note now, as authored: by span `span` (its index), alone or `mixed` with the user. */
export type Mark = { line: number; span: number; mixed: boolean }

/** At most this many spans per note: the oldest go first. */
export const MAX_SPANS = 400
/** How alike a line must be to one written to count as that line edited (mixed): 0 to 1. */
const ALIKE = 0.5
/** How far (lines) a span's lost line is looked for around where it was. */
const NEAR = 60

/** How alike two lines are, 0 to 1: what their starts and ends share, or their words, whichever says more. */
export function alike(a: string, b: string) {
  a = a.trim(); b = b.trim()
  if (a === b) return 1
  if (!a || !b) return 0
  let p = 0
  const n = Math.min(a.length, b.length)
  while (p < n && a[p] === b[p]) p++
  let q = 0
  while (q < n - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++
  // (all of a line kept, with more added: the user went on writing an agent's line, or the other way round)
  const ends = Math.max((p + q) / Math.max(a.length, b.length), Math.min(a.length, b.length) >= 8 ? 0.75 * (p + q) / Math.min(a.length, b.length) : 0)
  const wa = a.toLowerCase().split(/\s+/), wb = b.toLowerCase().split(/\s+/), left = new Map<string, number>()
  for (const w of wa) left.set(w, (left.get(w) ?? 0) + 1)
  let shared = 0
  for (const w of wb) { const k = left.get(w) ?? 0; if (k) { shared++; left.set(w, k - 1) } }
  return Math.max(ends, (2 * shared) / (wa.length + wb.length))
}

const blank = (s: string) => !s.trim()
/** The frontmatter's last line (1-based; 0: none): spans never mark it (Properties show it). */
export function frontmatterEnd(lines: string[]) {
  if (lines[0]?.trimEnd() !== "---") return 0
  for (let i = 1; i < lines.length; i++) if (/^(---|\.\.\.)\s*$/.test(lines[i])) return i + 1
  return 0
}

/** Where each span's lines are in `text` now: line -> its mark, the newest span's when two claim a line. A line edited
 *  since (alike, not the same) is mixed; one the user rewrote, or a span whose text is gone, marks nothing. */
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

/** A span's lines in `doc` (0-based index -> mixed). */
function place(doc: string[], at: Map<string, number[]>, s: Span): Map<number, boolean> {
  const L = Array.isArray(s.lines) ? s.lines : [], hint = Math.max(0, (s.line ?? 1) - 1), was = new Set(s.mixed ?? [])
  const found = new Map<number, boolean>()
  // Its start: where most of its lines are still as written in a row, nearest where it was.
  const starts = new Map<number, number>()
  L.forEach((l, j) => { if (!blank(l)) for (const d of at.get(l) ?? []) starts.set(d - j, (starts.get(d - j) ?? 0) + 1) })
  let start = -1, best = 0
  for (const [st, n] of starts) {
    if (n > best || (n === best && Math.abs(st - hint) < Math.abs(start - hint))) { start = st; best = n }
  }
  if (start === -1) {
    // None as written: each line where the most alike one is near where it was (a paragraph since edited).
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
  // From there, line by line: the same (or the same a few lines on: some added between), alike (edited), or gone.
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
    // (deleted: the next line written looks where this one was)
  }
  return found
}

/** The spans a write adds: the lines of `after` that aren't in `before` (frontmatter aside), in runs. A line rewritten
 *  from the user's (alike one that was there, not this agent's) is mixed; `marks` say whose `before`'s lines were. */
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
          // (the user's line, or one already mixed: still both; this agent's own line rewritten stays its)
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

/** A span's who, as its tip says it: "Opus · Opus 5.5 high · 19:36" (`time`: how to say when). */
export function authorText(a: Author, time: (t: number) => string) {
  const how = [a.model, a.effort].filter(Boolean).join(" ")
  return [a.guest ? `${a.by} (guest)` : a.by, how, a.t ? time(a.t) : ""].filter(Boolean).join(" · ")
}
