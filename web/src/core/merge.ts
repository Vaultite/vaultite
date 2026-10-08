// Line diffs and three-way merges for the editor, so a change on disk while you type keeps both. The server's code
// (core/textedit.ts) in strict mode: a line both sides changed is a conflict.
import { opcodes } from "../../../core/textedit.ts"

export { merge3, opcodes } from "../../../core/textedit.ts"

/** The changes that turn a into b, one per changed run, trimmed to the differing characters: one stretch over two
 *  distant changes would swallow the cursor, and the next letter typed would land wrong. */
export function textChanges(a: string, b: string): { from: number; to: number; insert: string }[] {
  if (a === b) return []
  const A = a.split("\n"), B = b.split("\n")
  // (the lines alike at both ends first: the line diff then only looks at what changed)
  let p = 0
  while (p < A.length && p < B.length && A[p] === B[p]) p++
  let q = 0
  while (q < A.length - p && q < B.length - p && A[A.length - 1 - q] === B[B.length - 1 - q]) q++
  const starts = (ls: string[]) => { const o = [0]; for (const l of ls) o.push(o[o.length - 1] + l.length + 1); return o }
  const sa = starts(A), sb = starts(B)
  const out: { from: number; to: number; insert: string }[] = []
  for (const [tag, x1, x2, y1, y2] of opcodes(A.slice(p, A.length - q), B.slice(p, B.length - q))) {
    if (tag === "equal") continue
    const i1 = x1 + p, i2 = x2 + p, j1 = y1 + p, j2 = y2 + p
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
