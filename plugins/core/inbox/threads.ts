// The inbox's lists: what needs the user, what's to review, what agents work on, messages; snoozed and done aside.
// Shared by the server (vau inbox, the block's text) and the app (panel, page, badge): every surface lists the same.
import { snoozed, snoozeMs } from "./snooze.ts"

/** An event as the lists read it (plugin.ts' InboxEvent). */
type Ev = { id: string; t: number; kind: string; state: string; read?: boolean; snoozed?: number; link?: string }
/** A result as the lists read it (an Inbox/ file). */
type Result = { id: string; status: string; archived?: unknown; snoozed?: string | null; created?: string | null; updated?: string | null }

/** A message: news, dealt with once read (not a session's thread, nor something asking the user). */
export const isMessage = (e: Pick<Ev, "kind">) => e.kind !== "session" && e.kind !== "waiting"
/** What waits on the user: a session or an ask that's open; not a message, nor what an agent is working on. */
export const waitsOnYou = (e: Pick<Ev, "kind" | "state">) => e.state === "open" && !isMessage(e)

/** A result not dealt with yet (to review, or snoozed): new, and not archived (the vault marks an archived file's item). */
export const reviewing = (r: Result) => r.status === "new" && r.archived !== true
/** When a result last had news: its thread's latest report, else when it came, or its snooze's end once that's past. */
export const latestOf = (r: Result, now = Date.now()) => Math.max(snoozeMs(r.updated || r.created || ""), snoozed(r.snoozed, now) ? 0 : snoozeMs(r.snoozed))

/** The report files threads stand for: a thread that links one is listed in its place (`all`: done ones too). */
export const joined = (events: Ev[], all = false) => new Set(events.filter((e) => (all || e.state !== "done") && e.link).map((e) => e.link!.replace(/^file:/, "")))

export type Lists<E extends Ev, R extends Result> = {
  /** Sessions and asks open for the user, newest first. */
  needs: E[]
  /** Results to review (not a thread's record), the latest first. */
  review: R[]
  /** Threads an agent works on since the user answered. */
  working: E[]
  /** Messages not read yet (and `fresh` ones, read while shown). */
  messages: E[]
  snoozed: { events: E[]; results: R[] }
  /** Dealt with: done events, newest first, and done results. */
  done: { events: E[]; results: R[] }
}

/** The lists. `fresh`: events still drawn where they were (read since they came into view: a message is done by it). */
export function lists<E extends Ev, R extends Result>(events: E[], results: R[], fresh: ReadonlySet<string> = new Set(), now = Date.now()): Lists<E, R> {
  const away = (e: E) => e.state !== "done" && snoozed(e.snoozed, now)
  const here = events.filter((e) => !away(e) && (e.state !== "done" || fresh.has(e.id)))
  const links = joined(events), ever = joined(events, true)
  const open = results.filter((r) => reviewing(r) && !links.has(`${r.id}.md`))
  return {
    needs: here.filter(waitsOnYou),
    review: open.filter((r) => !snoozed(r.snoozed, now)).sort((a, b) => latestOf(b, now) - latestOf(a, now)),
    working: here.filter((e) => e.state === "working"),
    messages: here.filter((e) => isMessage(e) && (e.state === "open" || fresh.has(e.id))),
    snoozed: { events: events.filter(away), results: open.filter((r) => snoozed(r.snoozed, now)) },
    done: { events: events.filter((e) => e.state === "done" && !fresh.has(e.id)), results: results.filter((r) => !reviewing(r) && !ever.has(`${r.id}.md`)) },
  }
}

/** The badge's count: what needs the user and the results to review. */
export const countOf = (l: Pick<Lists<Ev, Result>, "needs" | "review">) => l.needs.length + l.review.length
