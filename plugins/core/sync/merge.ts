// The merges sync makes on every device alike: by line for text, by key for JSON. Both sides' changes are kept, the same
// change once; where both changed the same lines (or key), the later side's stays and the other is handed back as a clash.
import { opcodes } from "../../../core/plugins.ts"

/** Where both sides changed the same lines: the file as merged with those lines as the base had them (`base`) and as the
 *  losing side had them (`other`), so merging `other` into the file from `base` brings back exactly what lost. */
export type Clash = { base: string; other: string; lines: number }
export type Merged = { text: string; clash: Clash | null }

type Hunk = { i1: number; i2: number; lines: string[] }
const hunks = (base: string[], side: string[]): Hunk[] =>
  opcodes(base, side).filter((o) => o[0] !== "equal").map(([, i1, i2, j1, j2]) => ({ i1, i2, lines: side.slice(j1, j2) }))

/** The side's text over base lines [lo, hi), its hunks there applied. */
function over(base: string[], hs: Hunk[], lo: number, hi: number): string[] {
  const out: string[] = []
  let at = lo
  for (const h of hs) { out.push(...base.slice(at, h.i1), ...h.lines); at = h.i2 }
  out.push(...base.slice(at, hi))
  return out
}

const sameLines = (x: string[], y: string[]) => x.length === y.length && x.every((l, i) => l === y[i])
const startsWith = (x: string[], y: string[]) => y.length <= x.length && y.every((l, i) => x[i] === l)

/** 3-way merge by line. `aFirst`: a's change is the earlier one (its lines go first where both added at one place);
 *  `aWins`: a's lines stay where both changed the same ones. */
export function mergeText(base: string, a: string, b: string, aWins: boolean, aFirst = !aWins): Merged {
  if (a === b || b === base) return { text: a, clash: null }
  if (a === base) return { text: b, clash: null }
  const B = base.split("\n"), A = a.split("\n"), C = b.split("\n")
  const all = [...hunks(B, A).map((h) => ({ ...h, side: 0 })), ...hunks(B, C).map((h) => ({ ...h, side: 1 }))]
    .sort((x, y) => x.i1 - y.i1 || x.i2 - y.i2 || x.side - y.side)
  // Groups of hunks that touch the same base lines (or add at the same place): within one, the sides may disagree.
  type Group = { lo: number; hi: number; hs: typeof all }
  const groups: Group[] = []
  for (const h of all) {
    const g = groups[groups.length - 1]
    const joins = g && (Math.max(g.lo, h.i1) < Math.min(g.hi, h.i2) || (g.lo === g.hi && h.i1 === h.i2 && h.i1 === g.lo)
      || (h.i1 === h.i2 && g.lo < h.i1 && h.i1 < g.hi) || (g.lo === g.hi && h.i1 < g.lo && g.lo < h.i2))
    if (joins) { g.lo = Math.min(g.lo, h.i1); g.hi = Math.max(g.hi, h.i2); g.hs.push(h) } else groups.push({ lo: h.i1, hi: h.i2, hs: [h] })
  }
  const out: string[] = [], asBase: string[] = [], asOther: string[] = []
  let at = 0, clashed = 0
  for (const g of groups) {
    const keep = B.slice(at, g.lo)
    out.push(...keep); asBase.push(...keep); asOther.push(...keep)
    const ta = over(B, g.hs.filter((h) => h.side === 0), g.lo, g.hi), tb = over(B, g.hs.filter((h) => h.side === 1), g.lo, g.hi)
    const only = g.hs.every((h) => h.side === g.hs[0].side)
    let lines: string[]
    if (only) lines = g.hs[0].side === 0 ? ta : tb
    else if (sameLines(ta, tb)) lines = ta
    else if (g.lo === g.hi) {
      // Both added lines at one place, changing none: both kept, the earlier first (one that extends the other: the longer).
      lines = startsWith(ta, tb) ? ta : startsWith(tb, ta) ? tb : aFirst ? [...ta, ...tb] : [...tb, ...ta]
    } else {
      lines = aWins ? ta : tb
      clashed++
      out.push(...lines); asBase.push(...B.slice(g.lo, g.hi)); asOther.push(...(aWins ? tb : ta))
      at = g.hi
      continue
    }
    out.push(...lines); asBase.push(...lines); asOther.push(...lines)
    at = g.hi
  }
  const rest = B.slice(at)
  out.push(...rest); asBase.push(...rest); asOther.push(...rest)
  return { text: out.join("\n"), clash: clashed ? { base: asBase.join("\n"), other: asOther.join("\n"), lines: clashed } : null }
}

// ---------- JSON

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
const isObject = (v: unknown): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v)
const equal = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
const MISSING = Symbol("missing")
type Slot = Json | typeof MISSING

function mergeValue(base: Slot, a: Slot, b: Slot, aWins: boolean, at: string, clashes: string[]): Slot {
  if (equal(a, b) || equal(b, base)) return a
  if (equal(a, base)) return b
  if (isObject(a) && isObject(b)) {
    const o = isObject(base) ? base : {}
    const out: Record<string, Json> = {}
    // (a's keys in its order, then b's new ones: the file reads as a's did)
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      const v = mergeValue(k in o ? o[k] : MISSING, k in a ? a[k] : MISSING, k in b ? b[k] : MISSING, aWins, at ? `${at}.${k}` : k, clashes)
      if (v !== MISSING) out[k] = v
    }
    return out
  }
  // (a list of plain values, a plugin's `done` or `enabled`: merged item by item, as lines; any other, whole)
  const plain = (v: Slot) => Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")
  if (plain(a) && plain(b) && (base === MISSING || plain(base))) {
    const lines = (v: Slot) => (v === MISSING ? [] : v as Json[]).map((x) => JSON.stringify(x)).join("\n")
    const m = mergeText(lines(base), lines(a), lines(b), aWins)
    if (!m.clash) return m.text ? m.text.split("\n").map((l) => JSON.parse(l) as Json) : []
  }
  clashes.push(at || "(whole file)")
  return aWins ? a : b
}

/** 3-way merge by key (arrays whole), or null when one side isn't JSON. The clash lists the keys where the other side lost. */
export function mergeJson(base: string, a: string, b: string, aWins: boolean): (Merged & { keys: string[] }) | null {
  let pa: Json, pb: Json, po: Slot
  try { pa = JSON.parse(a); pb = JSON.parse(b); po = base.trim() ? JSON.parse(base) : MISSING } catch { return null }
  const keys: string[] = []
  const v = mergeValue(po, pa, pb, aWins, "", keys)
  const text = equal(v, pa) ? a : equal(v, pb) ? b
    : JSON.stringify(v, null, /^\{\n(\s+)/.exec(a)?.[1] ?? (a.includes("\n") ? 2 : undefined)) + (a.endsWith("\n") ? "\n" : "")
  return { text, keys, clash: keys.length ? { base, other: aWins ? b : a, lines: keys.length } : null }
}
