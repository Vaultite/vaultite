// Calendar: events from private iCal links, fetched live and cached 10 minutes; nothing is written to the vault. The
// links are secrets (anyone with one can read the calendar), so they live in data/config.json only.
import ICAL from "ical.js"
import { addDays, bullets, OpError, Plugin, section, today as todayIso } from "../../../core/plugins.ts"
import { type Item, sortBy } from "../../../core/vault.ts"

export const plugin = new Plugin(import.meta.url)
const TTL = 600

async function fetchCalendar(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new HTTPStatusError(`${r.status}`)
  const cal = new ICAL.Component(ICAL.parse(await r.text()))
  for (const tz of cal.getAllSubcomponents("vtimezone")) ICAL.TimezoneService.register(tz)
  return cal
}

class HTTPStatusError extends Error {
  name = "HTTPError"
}

const pad = (n: number) => String(n).padStart(2, "0")

/** An event time as the app shows it: a date "YYYY-MM-DD", a time in this machine's zone with its offset, or a
 *  floating time as written. */
function iso(t: ICAL.Time) {
  if (t.isDate) return `${t.year}-${pad(t.month)}-${pad(t.day)}`
  if (t.zone === ICAL.Timezone.localTimezone) return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`
  const d = t.toJSDate()
  const off = -d.getTimezoneOffset()
  const sign = off < 0 ? "-" : "+"
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

/** When a time is, for comparing with the range (dates and floating times are this machine's local time). */
function ms(t: ICAL.Time) {
  if (t.isDate || t.zone === ICAL.Timezone.localTimezone) return +new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  return +t.toJSDate()
}

/** Every occurrence of the calendar's events that overlaps [start, end) (local days). */
function occurrences(cal: ICAL.Component, start: string, end: string) {
  const from = +new Date(`${start}T00:00:00`), to = +new Date(`${end}T00:00:00`)
  const events = cal.getAllSubcomponents("vevent")
  const overrides = new Map<string, ICAL.Component[]>()
  for (const v of events) {
    if (!v.hasProperty("recurrence-id")) continue
    const uid = String(v.getFirstPropertyValue("uid"))
    overrides.set(uid, [...(overrides.get(uid) ?? []), v])
  }
  const out: { item: ICAL.Event; start: ICAL.Time; end: ICAL.Time }[] = []
  const overlaps = (s: ICAL.Time, e: ICAL.Time) => {
    const a = ms(s), b = ms(e)
    return a < to && (b > from || (a >= from && b === a))
  }
  for (const v of events) {
    if (v.hasProperty("recurrence-id")) continue
    const ev = new ICAL.Event(v, { strictExceptions: true, exceptions: overrides.get(String(v.getFirstPropertyValue("uid"))) ?? [] })
    if (!ev.startDate) continue
    if (!ev.isRecurring()) {
      if (overlaps(ev.startDate, ev.endDate)) out.push({ item: ev, start: ev.startDate, end: ev.endDate })
      continue
    }
    const it = ev.iterator()
    for (let next = it.next(), n = 0; next && n < 100000; next = it.next(), n++) {
      const d = ev.getOccurrenceDetails(next)
      if (ms(next) >= to && ms(d.startDate) >= to) break
      if (overlaps(d.startDate, d.endDate)) out.push({ item: d.item, start: d.startDate, end: d.endDate })
    }
  }
  return out
}

async function events(start: string, end: string) {
  const calendars: Item[] = plugin.secrets().calendars ?? []
  const out: Item[] = [], errors: string[] = []
  for (const c of calendars) {
    let cal: ICAL.Component
    try {
      cal = await plugin.memo(TTL, fetchCalendar, c.ics)
    } catch (e) {
      errors.push(`${c.name ?? "None"}: ${(e as Error).name}`) // never echo the URL
      continue
    }
    for (const o of occurrences(cal, start, addDays(end, 1))) {
      out.push({ calendar: c.name ?? "", title: o.item.summary ?? "", location: o.item.location ?? "",
        start: iso(o.start), end: iso(o.end), all_day: o.start.isDate })
    }
  }
  return { events: sortBy(out, (x) => x.start), errors, configured: calendars.length > 0 }
}

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the next 7 days) */
plugin.route("GET", "calendar", async (req) => {
  const start = req.query.from || todayIso()
  const end = req.query.to || addDays(todayIso(), 7)
  try {
    return await events(start, end)
  } catch (e) { // feed down: the page just shows no events
    return { events: [], errors: [String((e as Error).message ?? e)], configured: true }
  }
})

/** Forget the cached feeds (after editing the calendar), so the next load fetches them again. */
plugin.route("POST", "calendar/refresh", () => {
  plugin.forget()
  return { ok: true }
})

plugin.op({
  id: "calendar.events",
  cli: "calendar",
  mcp: "calendar",
  summary: "The user's calendar events for a day or a range (today by default), from their calendars, read live (never stored).",
  help: `Events of every connected calendar (private iCal links on this machine), recurring ones expanded, times in this machine's
zone. What matters from one goes where it belongs (a person's timeline, a log), never the events themselves.

  vau calendar
  vau calendar 2026-10-05
  vau calendar --from 2026-10-05 --to 2026-10-11`,
  kind: "read",
  params: {
    from: { type: "string", format: "date", description: "the first day, YYYY-MM-DD (default today)" },
    to: { type: "string", format: "date", description: "the last day (default the first: one day)" },
  },
  args: ["from"],
  run: async ({ from, to }) => {
    const start = from ?? todayIso(), end = to ?? start
    if (end < start) throw new OpError("to is before from")
    if (addDays(start, 92) < end) throw new OpError("at most three months at a time")
    return { from: start, to: end, ...(await events(start, end)) }
  },
  text: (r) => {
    if (!r.configured) return "No calendars connected yet (their private iCal links go in data/config.json on this machine)."
    const byDay = new Map<string, Item[]>()
    for (const e of r.events as Item[]) byDay.set(e.start.slice(0, 10), [...(byDay.get(e.start.slice(0, 10)) ?? []), e])
    const hm = (t: string) => t.slice(11, 16)
    const days = [...byDay].map(([d, es]) => [`### ${d}`, ...es.map((e) => `- ${e.all_day ? "All day" : `${hm(e.start)}-${hm(e.end)}`} ${e.title}${e.location ? ` (${e.location})` : ""}${e.calendar ? ` · ${e.calendar}` : ""}`)].join("\n"))
    return [days.length ? days.join("\n\n") : `No events ${r.from === r.to ? `on ${r.from}` : `from ${r.from} to ${r.to}`}.`,
      ...(r.errors.length ? [`_Couldn't read: ${r.errors.join(", ")}_`] : [])].join("\n\n")
  },
})

/** Today's and tomorrow's events. */
plugin.block("agenda", async (ctx) => {
  const today = ctx.today, tomorrow = addDays(today, 1)
  let res: Item
  try {
    res = await events(today, tomorrow)
  } catch (e) {
    return section("Agenda", `_Couldn't read the calendars: ${(e as Error).name}_`)
  }
  if (!res.configured) return section("Agenda", "_No calendars connected yet._")
  const rows = (res.events as Item[]).map((e) => {
    const day = e.start.slice(0, 10) === today ? "Today" : e.start.slice(0, 10) === tomorrow ? "Tomorrow" : e.start.slice(0, 10)
    const when = e.all_day ? "all day" : e.start.slice(11, 16) + (e.end ? ` to ${e.end.slice(11, 16)}` : "")
    return `${day}, ${when}: ${e.title}` + (e.location ? ` (${e.location})` : "")
  })
  return section("Agenda", bullets(rows, "Nothing today or tomorrow."))
})
