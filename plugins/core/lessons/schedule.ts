// When each card comes back: FSRS-6 (Anki's scheduler) with its default weights, and the queue of what's due.
import { type Card, shuffled } from "./format.ts"

/** A card's memory (reviews.json): stability `s` (days until recall falls to 90%), difficulty `d` (1-10). */
export type Memory = { due: string; s: number; d: number; reps: number; lapses: number; last: string; since: string }
/** Reviews by source (a cards file or a finished lesson, its id) and card key. */
export type Reviews = Record<string, Record<string, Memory>>
export type Rating = 1 | 2 | 3 | 4
export const RATINGS = ["again", "hard", "good", "easy"] as const

const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614,
  0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]
const DECAY = -W[20]
const FACTOR = 0.9 ** (1 / DECAY) - 1
const DAY = 86_400_000
/** Again brings a card back within the session. */
const AGAIN_MS = 10 * 60_000

const clampD = (d: number) => Math.min(10, Math.max(1, d))
const d0 = (g: number) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1)

/** Days until recall falls to `retention`. */
export const interval = (s: number, retention: number) =>
  Math.min(36500, Math.max(1, Math.round((s / FACTOR) * (retention ** (1 / DECAY) - 1))))

export function next(m: Memory | undefined, g: Rating, now: Date, retention = 0.9): Memory {
  let s: number, d: number
  if (!m) { s = W[g - 1]; d = d0(g) } else {
    const t = Math.max(0, (now.getTime() - Date.parse(m.last)) / DAY)
    d = clampD(W[7] * d0(4) + (1 - W[7]) * (m.d - W[6] * (g - 3) * (10 - m.d) / 9))
    if (t < 1) s = m.s * Math.exp(W[17] * (g - 3 + W[18])) * m.s ** -W[19]
    else {
      const r = (1 + FACTOR * t / m.s) ** DECAY
      s = g === 1
        ? Math.min(W[11] * m.d ** -W[12] * ((m.s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)), m.s / Math.exp(W[17] * W[18]))
        : m.s * (1 + Math.exp(W[8]) * (11 - m.d) * m.s ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1))
    }
  }
  s = Math.max(0.01, s)
  const due = new Date(g === 1 ? now.getTime() + AGAIN_MS : now.getTime() + interval(s, retention) * DAY)
  return {
    due: due.toISOString(), s: +s.toFixed(3), d: +d.toFixed(3), reps: (m?.reps ?? 0) + 1,
    lapses: (m?.lapses ?? 0) + (g === 1 && m ? 1 : 0), last: now.toISOString(), since: m?.since ?? localDay(now),
  }
}

/** "10m", "3d", "2mo", "1y": how long until a card comes back. */
export function span(from: Date, to: string) {
  const ms = Date.parse(to) - from.getTime()
  if (ms < DAY) return `${Math.max(1, Math.round(ms / 60_000))}m`
  const days = Math.round(ms / DAY)
  return days < 30 ? `${days}d` : days < 365 ? `${Math.round(days / 30)}mo` : `${+(days / 365).toFixed(1)}y`
}

export const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

export type Source = { id: string; title: string; cards: Card[] }
export type Due = Card & { source: string; title: string; fresh: boolean }

/** What to review now: cards due, then up to `newPerDay` new ones (fewer the more were started today), mixed across
 *  sources (interleaving helps tell similar things apart). */
export function queue(sources: Source[], reviews: Reviews, now: Date, newPerDay = 20): Due[] {
  const today = localDay(now)
  let started = 0
  const due: Due[] = [], fresh: Due[] = []
  for (const src of sources) {
    for (const c of src.cards) {
      const m = reviews[src.id]?.[c.key]
      if (m?.since === today) started++
      if (!m) fresh.push({ ...c, source: src.id, title: src.title, fresh: true })
      else if (Date.parse(m.due) <= now.getTime()) due.push({ ...c, source: src.id, title: src.title, fresh: false })
    }
  }
  const mix = (xs: Due[]) => shuffled(xs, today)
  return [...mix(due), ...mix(fresh).slice(0, Math.max(0, newPerDay - started))]
}

/** When the next card comes back, after what's due now. */
export function nextDue(sources: Source[], reviews: Reviews, now: Date): string | null {
  let best: string | null = null
  for (const src of sources) for (const c of src.cards) {
    const m = reviews[src.id]?.[c.key]
    if (m && Date.parse(m.due) > now.getTime() && (!best || m.due < best)) best = m.due
  }
  return best
}
