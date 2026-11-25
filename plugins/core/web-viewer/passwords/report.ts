import { isWeak, levelOf, LEVELS } from "./levels.ts"
import type { Health, Row } from "./types.ts"

export type Issue = "leaked" | "expired" | "weak" | "reused" | "old"
export type Finding = { row: Row; why: string }
export type Report = { issues: Record<Issue, Finding[]>; left: Row[]; total: number }

const DAY = 86_400_000
const SOON_DAYS = 30, OLD_YEARS = 3
const yearsOf = (ms: number) => Math.floor(ms / (365.25 * DAY))

function expiry(row: Row, now: number) {
  if (row.expires === null) return ""
  const days = Math.ceil((row.expires - now) / DAY)
  if (days <= 0) return days > -1 ? "Expired today" : `Expired ${-days === 1 ? "a day" : `${-days} days`} ago`
  return days <= SOON_DAYS ? `Expires ${days === 1 ? "tomorrow" : `in ${days} days`}` : ""
}

type Facts = { health: ReadonlyMap<string, Health>; leaks: ReadonlyMap<string, number> | null; sharing: Map<string, Row[]>; now: number }

function whys(row: Row, h: Health, f: Facts): Record<Issue, string> {
  const times = f.leaks?.get(row.id) ?? 0, years = yearsOf(f.now - h.since), due = expiry(row, f.now)
  const others = h.same ? (f.sharing.get(h.same) ?? []).filter((r) => r !== row) : []
  return {
    leaked: times ? `Seen ${times === 1 ? "once" : `${times.toLocaleString()} times`} in known breaches` : "",
    expired: due,
    weak: h.bits !== null && isWeak(h.bits) ? `${LEVELS[levelOf(h.bits)].label}, ${Math.round(h.bits)} bits` : "",
    reused: others.length ? `Same as ${others.map((r) => r.title || "Untitled").join(", ")}` : "",
    old: h.bits !== null && years >= OLD_YEARS ? `Not changed in ${years} years` : "",
  }
}

export const ISSUES = ["leaked", "expired", "weak", "reused", "old"] as const
export function reportOf(rows: Row[], health: Facts["health"], leaks: Facts["leaks"], now: number): Report {
  const issues: Report["issues"] = { leaked: [], expired: [], weak: [], reused: [], old: [] }, left: Row[] = [], bad = new Set<string>()
  const sharing = new Map<string, Row[]>()
  for (const r of rows) { const same = health.get(r.id)?.same; if (same) sharing.set(same, [...sharing.get(same) ?? [], r]) }
  for (const row of rows) {
    const h = health.get(row.id)
    if (h?.excluded) left.push(row)
    if (!h || h.excluded) continue
    const why = whys(row, h, { health, leaks, sharing, now })
    for (const k of ISSUES) { const w = why[k]; if (w) { issues[k].push({ row, why: w }); bad.add(row.id) } }
  }
  const of = (f: Finding) => health.get(f.row.id)
  issues.leaked.sort((a, b) => (leaks?.get(b.row.id) ?? 0) - (leaks?.get(a.row.id) ?? 0))
  issues.expired.sort((a, b) => (a.row.expires ?? 0) - (b.row.expires ?? 0))
  issues.weak.sort((a, b) => (of(a)?.bits ?? 0) - (of(b)?.bits ?? 0))
  issues.reused.sort((a, b) => (of(a)?.same ?? "").localeCompare(of(b)?.same ?? ""))
  issues.old.sort((a, b) => (of(a)?.since ?? 0) - (of(b)?.since ?? 0))
  return { issues, left, total: bad.size }
}
