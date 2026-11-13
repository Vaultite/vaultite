import { snoozed, snoozeMs } from "./snooze.ts"

type Ev = { id: string; t: number; kind: string; state: string; read?: boolean; snoozed?: number; link?: string; pinned?: boolean }
type Result = { id: string; status: string; archived?: unknown; snoozed?: string | null; created?: string | null; updated?: string | null; pinned?: boolean
  question?: string; blocking?: boolean; work?: string; agent?: string; session?: string; terminal?: string }

export const isMessage = (e: Pick<Ev, "kind">) => e.kind !== "session" && e.kind !== "waiting"
export const waitsOnYou = (e: Pick<Ev, "kind" | "state">) => e.state === "open" && !isMessage(e)

export const reviewing = (r: Result) => r.status === "new" && r.archived !== true
export const latestOf = (r: Result, now = Date.now()) => Math.max(snoozeMs(r.updated || r.created || ""), snoozed(r.snoozed, now) ? 0 : snoozeMs(r.snoozed))

export const isDecision = (r: Pick<Result, "question">) => !!r.question
export const isReport = (r: Result) => !r.question && !!(r.work || r.agent || r.session || r.terminal)
export const REPORTS_MS = 24 * 3600_000

export const joined = (events: Ev[], all = false) => new Set(events.filter((e) => (all || e.state !== "done") && e.link).map((e) => e.link!.replace(/^file:/, "")))

export type Lists<E extends Ev, R extends Result> = {
  decisions: R[]
  pinned: { events: E[]; results: R[] }
  needs: E[]
  review: R[]
  working: E[]
  messages: E[]
  snoozed: { events: E[]; results: R[] }
  reports: R[]
  done: { events: E[]; results: R[] }
}

export function lists<E extends Ev, R extends Result>(events: E[], results: R[], fresh: ReadonlySet<string> = new Set(), now = Date.now()): Lists<E, R> {
  const asked = new Set(results.filter(isDecision).map((r) => `${r.id}.md`))
  const all = events.filter((e) => !e.link || !asked.has(e.link.replace(/^file:/, "")))
  const away = (e: E) => e.state !== "done" && snoozed(e.snoozed, now)
  const here = all.filter((e) => !away(e) && (e.state !== "done" || fresh.has(e.id)))
  const links = joined(all), ever = joined(all, true)
  const open = results.filter((r) => reviewing(r) && !links.has(`${r.id}.md`))
  const pin = here.filter((e) => e.pinned && e.state !== "done"), rest = here.filter((e) => !pin.includes(e))
  const byLatest = (a: R, b: R) => latestOf(b, now) - latestOf(a, now)
  const ready = open.filter((r) => !snoozed(r.snoozed, now))
  const review = ready.filter((r) => !isDecision(r)).sort(byLatest)
  const reports = results.filter((r) => !reviewing(r) && isReport(r) && now - latestOf(r, now) < REPORTS_MS).sort(byLatest)
  return {
    decisions: ready.filter(isDecision).sort((a, b) => Number(!!b.blocking) - Number(!!a.blocking) || byLatest(a, b)),
    pinned: { events: pin, results: review.filter((r) => r.pinned) },
    needs: rest.filter(waitsOnYou),
    review: review.filter((r) => !r.pinned),
    working: rest.filter((e) => e.state === "working"),
    messages: rest.filter((e) => isMessage(e) && (e.state === "open" || fresh.has(e.id))),
    snoozed: { events: all.filter(away), results: open.filter((r) => snoozed(r.snoozed, now)) },
    reports,
    done: { events: all.filter((e) => e.state === "done" && !fresh.has(e.id)), results: results.filter((r) => !reviewing(r) && !ever.has(`${r.id}.md`) && !reports.includes(r)) },
  }
}

export const countOf = (l: Pick<Lists<Ev, Result>, "decisions" | "needs" | "review" | "pinned">) =>
  l.decisions.length + l.needs.length + l.review.length + l.pinned.events.filter(waitsOnYou).length + l.pinned.results.length
