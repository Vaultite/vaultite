import type { AgentRun } from "@vaultite"

export type Shelf = "pinned" | "needs" | "working" | "snoozed" | "settled"
export type Mark = { pinned?: boolean; snoozed?: number; settled?: number }
export type Marks = Record<string, Mark>
type Run = Pick<AgentRun, "id" | "state" | "at" | "since" | "project">

export const SHELVES: { id: Shelf; label: string }[] = [
  { id: "pinned", label: "Pinned" }, { id: "needs", label: "Needs you" }, { id: "working", label: "Working" },
  { id: "snoozed", label: "Snoozed" }, { id: "settled", label: "Settled" },
]
export const FOLDED: Shelf[] = ["snoozed", "settled"]

const latest = (r: Run) => Math.max(r.at, r.since ?? 0)
export const isSettled = (r: Run, m: Mark | undefined) => !!m?.settled && r.state === "done" && latest(r) <= m.settled
export const isSnoozed = (m: Mark | undefined, now: number) => !!m?.snoozed && m.snoozed > now
export const canSettle = (r: Pick<AgentRun, "state">) => r.state === "done"

export function shelfOf(r: Run, m: Mark | undefined, now: number, folds: boolean): Shelf {
  if (isSettled(r, m)) return "settled"
  if (m?.pinned) return "pinned"
  if (isSnoozed(m, now) && r.state !== "needs") return "snoozed"
  if (r.state === "working" || r.state === "waiting") return "working"
  return folds ? "settled" : "needs"
}

export function shelve<R extends Run>(list: R[], marks: Marks, now: number, folds: (r: R) => boolean): Map<Shelf, R[]> {
  const out = new Map<Shelf, R[]>(SHELVES.map((s) => [s.id, []]))
  for (const r of list) out.get(shelfOf(r, marks[r.id], now, folds(r)))!.push(r)
  return out
}

export function nextNeeding<R extends Run>(needs: R[], from: string): R | undefined {
  const i = needs.findIndex((r) => r.id === from)
  return needs.slice(i + 1).find((r) => r.id !== from) ?? needs.find((r) => r.id !== from)
}

export function projectsOf(list: Run[], marks: Marks, now: number): string[] {
  const names = list.filter((r) => !isSettled(r, marks[r.id]) && !isSnoozed(marks[r.id], now)).flatMap((r) => (r.project ? [r.project] : []))
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

export function keptMarks(marks: Marks, ids: ReadonlySet<string>, now: number): Marks {
  return Object.fromEntries(Object.entries(marks).filter(([id, m]) => ids.has(id) || isSnoozed(m, now)))
}

type Change = { pinned?: boolean | null; snoozed?: number | null; settled?: number | null }
export function withMark(marks: Marks, id: string, change: Change): Marks {
  const was = marks[id] ?? {}, pick = <K extends keyof Change>(k: K) => (change[k] === undefined ? was[k] : change[k] ?? undefined)
  const pinned = pick("pinned"), snoozed = pick("snoozed"), settled = pick("settled")
  const m: Mark = {}
  if (pinned) m.pinned = true
  if (snoozed) m.snoozed = snoozed
  if (settled) m.settled = settled
  const rest = { ...marks }
  delete rest[id]
  return Object.keys(m).length ? { ...rest, [id]: m } : rest
}
