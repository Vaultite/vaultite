// Line diffs fast at any size (a file's history, a day's recap): common ends trimmed, lines found once on each side as
// anchors (patience diff), Myers' diff between them. A stretch too tangled to compare cheaply is told as replaced: never
// a wrong diff, at worst a longer one. No Node: both sides use it.
import type { Opcode } from "./textedit.ts"

/** Past this many steps of Myers' diff in one stretch, it's told as replaced. */
const BUDGET = 4_000_000
/** Stretches this short (lines on both sides) are compared by Myers' alone. */
const SHORT = 2000

/** How to turn a into b, as textedit's opcodes (equal runs and changed runs), for any number of lines. */
export function diffLines(a: string[], b: string[]): Opcode[] {
  // Lines as numbers: compared by identity from here on.
  const ids = new Map<string, number>()
  const id = (s: string) => { let n = ids.get(s); if (n === undefined) ids.set(s, n = ids.size); return n }
  const A = Int32Array.from(a, id), B = Int32Array.from(b, id)
  const blocks: [number, number, number][] = [] // [i, j, size]: A[i..i+size) equals B[j..j+size)
  const todo: [number, number, number, number][] = [[0, A.length, 0, B.length]]
  while (todo.length) {
    let [alo, ahi, blo, bhi] = todo.pop()!
    let k = 0
    while (alo + k < ahi && blo + k < bhi && A[alo + k] === B[blo + k]) k++
    if (k) { blocks.push([alo, blo, k]); alo += k; blo += k }
    k = 0
    while (ahi - k > alo && bhi - k > blo && A[ahi - k - 1] === B[bhi - k - 1]) k++
    if (k) { blocks.push([ahi - k, bhi - k, k]); ahi -= k; bhi -= k }
    if (alo === ahi || blo === bhi) continue
    // (a short stretch gets the shortest diff; anchors are for long ones)
    const anchors = ahi - alo + bhi - blo > SHORT ? unique(A, B, alo, ahi, blo, bhi) : []
    if (anchors.length) {
      let pi = alo, pj = blo
      for (const [i, j] of anchors) {
        blocks.push([i, j, 1])
        if (pi < i || pj < j) todo.push([pi, i, pj, j])
        pi = i + 1; pj = j + 1
      }
      if (pi < ahi || pj < bhi) todo.push([pi, ahi, pj, bhi])
    } else blocks.push(...myers(A, B, alo, ahi, blo, bhi))
  }
  blocks.sort((x, y) => x[0] - y[0])
  const out: Opcode[] = []
  let i = 0, j = 0
  const flush = (ai: number, bj: number) => {
    const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null
    if (tag) out.push([tag, i, ai, j, bj])
  }
  for (const [bi, bj, size] of blocks) {
    if (!size) continue
    flush(bi, bj)
    const last = out[out.length - 1]
    if (last?.[0] === "equal" && last[2] === bi && last[4] === bj) { last[2] += size; last[4] += size }
    else out.push(["equal", bi, bi + size, bj, bj + size])
    i = bi + size; j = bj + size
  }
  flush(A.length, B.length)
  return out
}

/** Lines found exactly once in each stretch, paired, the longest run of them in the same order on both sides. */
function unique(A: Int32Array, B: Int32Array, alo: number, ahi: number, blo: number, bhi: number): [number, number][] {
  const inA = new Map<number, number>(), inB = new Map<number, number>()
  for (let i = alo; i < ahi; i++) inA.set(A[i], inA.has(A[i]) ? -1 : i)
  for (let j = blo; j < bhi; j++) if (inA.get(B[j]) !== undefined && inA.get(B[j])! >= 0) inB.set(B[j], inB.has(B[j]) ? -1 : j)
  const pairs: [number, number][] = []
  for (let i = alo; i < ahi; i++) { const j = inA.get(A[i]) === i ? inB.get(A[i]) : undefined; if (j !== undefined && j >= 0) pairs.push([i, j]) }
  if (!pairs.length) return []
  // Patience sorting: the longest increasing run of j (pairs are in order of i).
  const tails: number[] = [], prev = new Int32Array(pairs.length).fill(-1)
  for (let p = 0; p < pairs.length; p++) {
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < pairs[p][1]) lo = mid + 1; else hi = mid }
    if (lo) prev[p] = tails[lo - 1]
    tails[lo] = p
  }
  const out: [number, number][] = []
  for (let p = tails[tails.length - 1]; p >= 0; p = prev[p]) out.push(pairs[p])
  return out.reverse()
}

/** Myers' O(ND) diff of one stretch, as its equal runs; none (all replaced) when it would take over BUDGET steps. */
function myers(A: Int32Array, B: Int32Array, alo: number, ahi: number, blo: number, bhi: number): [number, number, number][] {
  const n = ahi - alo, m = bhi - blo, max = n + m, off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let steps = 0
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && A[alo + x] === B[blo + y]) { x++; y++; steps++ }
      v[off + k] = x
      if (x >= n && y >= m) return path(trace, d, n, m, alo, blo)
    }
    if ((steps += d) > BUDGET || (d + 1) * (d + 1) > BUDGET) return []
  }
  return []
}

/** The equal runs along Myers' path, walked back from (n, m). `trace[d]` is v before step d, around k = 0. */
function path(trace: Int32Array[], dEnd: number, n: number, m: number, alo: number, blo: number): [number, number, number][] {
  const out: [number, number, number][] = []
  let x = n, y = m
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d], at = (k: number) => v[k + d + 1]
    const k = x - y
    const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const px = at(pk), py = px - pk
    const sx = pk === k + 1 ? px : px + 1 // where this step's snake starts
    if (x > sx) out.push([alo + sx, blo + sx - k, x - sx])
    x = px; y = py
  }
  if (x > 0) out.push([alo, blo, x])
  return out.reverse()
}
