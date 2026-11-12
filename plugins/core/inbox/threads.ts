// The inbox's lists (decisions, what else needs the user, to review, working, messages; reports, snoozed, done aside),
// shared by the server (vau inbox, the block's text) and the app (panel, page, badge): every surface lists the same.
import { snoozed, snoozeMs } from "./snooze.ts"

/** An event as the lists read it (model.ts' InboxEvent). */
type Ev = { id: string; t: number; kind: string; state: string; read?: boolean; snoozed?: number; link?: string; pinned?: boolean }
/** A result as the lists read it (an Inbox/ file). */
type Result = { id: string; status: string; archived?: unknown; snoozed?: string | null; created?: string | null; updated?: string | null; pinned?: boolean
  question?: string; blocking?: boolean; work?: string; agent?: string; session?: string; terminal?: string }

/** A message: news, dealt with once read (not a session's thread, nor something asking the user). */
export const isMessage = (e: Pick<Ev, "kind">) => e.kind !== "session" && e.kind !== "waiting"
/** What waits on the user: a session or an ask that's open; not a message, nor what an agent is working on. */
export const waitsOnYou = (e: Pick<Ev, "kind" | "state">) => e.state === "open" && !isMessage(e)

/** A result not dealt with yet (to review, or snoozed): new, and not archived (the vault marks an archived file's item). */
export const reviewing = (r: Result) => r.status === "new" && r.archived !== true
/** When a result last had news: its thread's latest report, else when it came, or its snooze's end once that's past. */
export const latestOf = (r: Result, now = Date.now()) => Math.max(snoozeMs(r.updated || r.created || ""), snoozed(r.snoozed, now) ? 0 : snoozeMs(r.snoozed))

/** A decision (decisions.ts): a result asking the user something, with its options. */
export const isDecision = (r: Pick<Result, "question">) => !!r.question
/** An agent's report (inbox.report): it says its work (before that, it named its session). */
export const isReport = (r: Result) => !r.question && !!(r.work || r.agent || r.session || r.terminal)
/** How long a report stays under Reports: the day's (the morning brief has the night's). */
export const REPORTS_MS = 24 * 3600_000

/** The report files threads stand for: a thread that links one is listed in its place (`all`: done ones too). */
export const joined = (events: Ev[], all = false) => new Set(events.filter((e) => (all || e.state !== "done") && e.link).map((e) => e.link!.replace(/^file:/, "")))

export type Lists<E extends Ev, R extends Result> = {
  /** Questions agents ask the user, open: the ones they wait on first, then the newest. */
  decisions: R[]
  /** What the user pinned, kept on top whatever it waits on until it's done or unpinned, newest first. */
  pinned: { events: E[]; results: R[] }
  /** Sessions and asks open for the user, newest first. */
  needs: E[]
  /** Results to review (not a thread's record), the latest first. */
  review: R[]
  /** Threads an agent works on since the user answered. */
  working: E[]
  /** Messages not read yet (and `fresh` ones, read while shown). */
  messages: E[]
  snoozed: { events: E[]; results: R[] }
  /** The last day's reports (archived as they come: results go in the morning brief, not the inbox), newest first. */
  reports: R[]
  /** Dealt with: done events, newest first, and done results. */
  done: { events: E[]; results: R[] }
}

/** The lists. `fresh`: events still drawn where they were (read since they came into view: a message is done by it). */
export function lists<E extends Ev, R extends Result>(events: E[], results: R[], fresh: ReadonlySet<string> = new Set(), now = Date.now()): Lists<E, R> {
  // (a decision is its own row: the event that told it, if any, isn't listed apart)
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

/** The badge's count: the decisions, what else needs the user and the results to review, pinned or not. */
export const countOf = (l: Pick<Lists<Ev, Result>, "decisions" | "needs" | "review" | "pinned">) =>
  l.decisions.length + l.needs.length + l.review.length + l.pinned.events.filter(waitsOnYou).length + l.pinned.results.length
