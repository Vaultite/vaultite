// A day's plan read from a note, for both sides: list items starting with a time ("- [ ] 09:00 - 10:30 Standup",
// "- 14:00 Lunch"), each lasting to its end time, else to the next one's start, else DEFAULT minutes.

export type Entry = { start: number; end: number; text: string; done: boolean | null; line: number; raw: string
  /** How many lines before it read the same (ticking finds this one, not an earlier twin). */
  nth?: number
  /** A calendar's event (its calendar's name), drawn beside the note's items; never written anywhere. */
  calendar?: string }
/** An event as the calendar op answers it (times local, "YYYY-MM-DDTHH:MM..."). */
export type CalEvent = { title: string; start: string; end: string | null; all_day: boolean; calendar: string }

export const DEFAULT = 30
const ITEM = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(\d{1,2})[:.](\d\d)(?:\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d\d))?\s+(.+?)\s*$/

/** HH:MM as minutes into the day, or null; `end`: 24:00 too (midnight, the day's end). */
const minutes = (h: string, m: string, end = false) => {
  const n = Number(h) * 60 + Number(m)
  return (Number(h) < 24 || (end && n === 24 * 60)) && Number(m) < 60 ? n : null
}

/** The timed items of a note's text (code skipped), in order of their start. */
export function planOf(text: string): Entry[] {
  const out: Entry[] = []
  let fence: string | null = null
  const lines = text.split("\n")
  lines.forEach((l, line) => {
    // (a fence closes on its own mark, at least as long, alone: a ```js line inside a ```` block is code)
    const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(l)
    if (f && !fence) { fence = f[1]; return }
    if (f && f[1][0] === fence![0] && f[1].length >= fence!.length && !f[2].trim()) { fence = null; return }
    if (fence) return
    const m = ITEM.exec(l)
    if (!m) return
    const start = minutes(m[2], m[3])
    if (start === null) return
    const end = m[4] ? minutes(m[4], m[5], true) : null
    out.push({ start, end: end !== null && end > start ? end : -1, text: m[6], done: m[1] === undefined ? null : m[1] !== " ", line, raw: l, nth: lines.slice(0, line).filter((x) => x === l).length })
  })
  out.sort((a, b) => a.start - b.start || a.line - b.line)
  out.forEach((e, i) => {
    if (e.end > 0) return
    const next = out.slice(i + 1).find((x) => x.start > e.start)
    e.end = Math.min(next ? next.start : e.start + DEFAULT, e.start + DEFAULT * 4, 24 * 60)
  })
  return out
}

/** A note's text with the item `raw` (its line as it was read) ticked `on` or not, or null when no line is that. */
export function ticked(text: string, raw: string, on: boolean, nth = 0): string | null {
  const lines = text.split("\n")
  let i = -1
  for (let k = 0; k <= nth; k++) { i = lines.indexOf(raw, i + 1); if (i < 0) break }
  if (i < 0 || !/\[[ xX]\]/.test(raw)) return null
  lines[i] = raw.replace(/\[[ xX]\]/, on ? "[x]" : "[ ]")
  return lines.join("\n")
}

/** When a new time block starts: after the note's last item that ends later than `now`, else at the next half hour. */
export function nextStart(text: string, now: number): number {
  const later = planOf(text).map((e) => e.end).filter((e) => e > now)
  return Math.min(23 * 60 + 30, Math.max(Math.ceil(now / 30) * 30, ...later))
}

export const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`

/** A day's calendar events as entries (those that start or end that day, cut to it), and its all-day ones' titles. */
export function eventsOf(events: CalEvent[], day: string): { timed: Entry[]; allDay: string[] } {
  const timed: Entry[] = [], allDay: string[] = []
  const at = (t: string) => (t.slice(0, 10) < day ? 0 : t.slice(0, 10) > day ? 24 * 60 : Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)))
  for (const e of events) {
    if (!e.start || e.start.slice(0, 10) > day || (e.end ?? e.start).slice(0, 10) < day) continue
    // (an all-day event's end is the day after its last)
    if (e.all_day) { if (!e.end || e.end.slice(0, 10) > day || e.start.slice(0, 10) === day) allDay.push(e.title); continue }
    const start = at(e.start), end = e.end ? at(e.end) : start + DEFAULT
    if (end <= start && e.start.slice(0, 10) !== day) continue
    timed.push({ start, end: Math.max(end, start + 15), text: e.title, done: null, line: -1, raw: "", calendar: e.calendar })
  }
  return { timed: timed.sort((a, b) => a.start - b.start), allDay }
}

/** The note's items and the day's events, in order of their start. */
export const merged = (plan: Entry[], events: Entry[]) => [...plan, ...events].sort((a, b) => a.start - b.start || a.line - b.line)

/** The plan as text: a line per item, `now` (minutes into the day, when it's that day) marking the one going on. */
export function planText(plan: Entry[], now: number | null, allDay: string[] = []): string {
  const head = allDay.length ? `All day: ${allDay.join(", ")}\n\n` : ""
  if (!plan.length) return `${head}_Nothing planned: list items starting with a time (\`- 09:00 - 10:00 Standup\`) show here._`
  return head + plan.map((e) => {
    const on = now !== null && now >= e.start && now < e.end
    return `- ${hhmm(e.start)}–${hhmm(e.end)} ${e.text}${e.calendar !== undefined ? ` (calendar${e.calendar ? `: ${e.calendar}` : ""})` : ""}${e.done ? " (done)" : ""}${on ? " **(now)**" : ""}`
  }).join("\n")
}

/** The day a note is, from its name (a daily note's date), or null. */
export const dayOf = (path: string) => /(\d{4}-\d\d-\d\d)/.exec(path.split("/").pop() ?? "")?.[1] ?? null
