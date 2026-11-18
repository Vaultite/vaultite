export type Moves = { seq: number; log: { seq: number; from: number; to: number }[] }
export const NO_MOVES: Moves = { seq: 0, log: [] }
export const DELETED = 0

function afterMove({ from, to }: { from: number; to: number }, n: number): number | null {
  if (to === DELETED) return n === from ? null : n > from ? n - 1 : n
  if (n === from) return to
  if (from < to && n > from && n <= to) return n - 1
  if (from > to && n >= to && n < from) return n + 1
  return n
}

export function numberNow(moves: Moves, n: number, seen: number): number | null {
  if (seen >= moves.seq) return n
  const since = moves.log.filter((m) => m.seq > seen)
  if (since.length !== moves.seq - seen) return null
  let at: number | null = n
  for (const m of since) { if (at === null) return null; at = afterMove(m, at) }
  return at
}

export function moved<T>(list: T[], from: number, to: number): T[] {
  const out = [...list], [d] = out.splice(from - 1, 1)
  out.splice(to - 1, 0, d)
  return out
}

export function deleted<T>(list: T[], n: number, empty: T): T[] {
  const out = [...list]
  out.splice(n - 1, 1)
  out.push(empty)
  return out
}
