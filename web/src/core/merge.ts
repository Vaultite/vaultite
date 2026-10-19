// Line diffs and three-way merges for the editor, so a change on disk while you type keeps both. The server's code
// (core/textedit.ts) in strict mode: a line both sides changed is a conflict.
import { opcodes } from "../../../core/textedit.ts"

export { hasEdits, merge3, opcodes } from "../../../core/textedit.ts"

/** The changes that turn a into b, one per changed run, trimmed to the differing characters: one stretch over two
 *  distant changes would swallow the cursor, and the next letter typed would land wrong. */
export function textChanges(a: string, b: string): { from: number; to: number; insert: string }[] {
  if (a === b) return []
  const A = a.split("\n"), B = b.split("\n")
  const starts = (ls: string[]) => { const o = [0]; for (const l of ls) o.push(o[o.length - 1] + l.length + 1); return o }
  const sa = starts(A), sb = starts(B)
  const out: { from: number; to: number; insert: string }[] = []
  for (const [tag, i1, i2, j1, j2] of opcodes(A, B)) {
    if (tag === "equal") continue
    // Lines i1..i2 of a, with their line breaks, become lines j1..j2 of b. The last line has no break after it: lines
    // added at the end go after the one before them, and the last lines removed take the break before them.
    let from = Math.min(sa[i1], a.length), to = Math.min(sa[i2], a.length), bf = sb[j1]
    const bt = Math.min(sb[j2], b.length)
    if (i1 === A.length) bf--
    else if (j1 === B.length) from--
    const old = a.slice(from, to), neu = b.slice(bf, bt)
    let s = 0
    while (s < old.length && s < neu.length && old[s] === neu[s]) s++
    let e = 0
    while (e < old.length - s && e < neu.length - s && old[old.length - 1 - e] === neu[neu.length - 1 - e]) e++
    out.push({ from: from + s, to: to - e, insert: neu.slice(s, neu.length - e) })
  }
  return out
}

/** Where both sides changed the same lines: `at`, the first of `mine`'s lines in the merged text. */
export type Clash = { at: number; mine: string[]; theirs: string[] }

/** A three-way merge that keeps going past conflicts (diff3): every change one side made is applied, and lines both
 *  changed differently keep mine, listed as clashes. Adjacent edits clash when one is an insertion, as in merge3. */
export function mergeClashes(base: string, mine: string, theirs: string): { text: string; clashes: Clash[] } {
  const B = base.split("\n")
  type Hunk = { i1: number; i2: number; lines: string[]; side: 0 | 1 }
  const hunks = (other: string, side: 0 | 1): Hunk[] => {
    const O = other.split("\n")
    return opcodes(B, O).filter((o) => o[0] !== "equal").map(([, i1, i2, j1, j2]) => ({ i1, i2, lines: O.slice(j1, j2), side }))
  }
  const all = [...hunks(mine, 0), ...hunks(theirs, 1)].sort((x, y) => x.i1 - y.i1 || x.i2 - y.i2)
  const touch = (lo: number, hi: number, h: Hunk) => (lo < h.i2 && h.i1 < hi) || ((lo === hi || h.i1 === h.i2) && h.i1 <= hi && lo <= h.i2)
  const groups: { lo: number; hi: number; hunks: Hunk[] }[] = []
  for (const h of all) {
    const g = groups.at(-1)
    if (g && touch(g.lo, g.hi, h)) { g.hunks.push(h); g.hi = Math.max(g.hi, h.i2); continue }
    groups.push({ lo: h.i1, hi: h.i2, hunks: [h] })
  }
  const sideText = (g: { lo: number; hi: number; hunks: Hunk[] }, side: 0 | 1) => {
    const out: string[] = []
    let pos = g.lo
    for (const h of g.hunks) if (h.side === side) { out.push(...B.slice(pos, h.i1), ...h.lines); pos = h.i2 }
    return [...out, ...B.slice(pos, g.hi)]
  }
  const out: string[] = [], clashes: Clash[] = []
  let pos = 0
  for (const g of groups) {
    out.push(...B.slice(pos, g.lo))
    const sides = new Set(g.hunks.map((h) => h.side))
    const m = sideText(g, 0), t = sideText(g, 1)
    if (sides.size === 2 && m.join("\n") !== t.join("\n")) clashes.push({ at: out.length, mine: m, theirs: t })
    out.push(...(sides.has(0) ? m : t))
    pos = g.hi
  }
  out.push(...B.slice(pos))
  return { text: out.join("\n"), clashes }
}
