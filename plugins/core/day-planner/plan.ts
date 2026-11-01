// A day's plan read from a note, for both sides: list items starting with a time ("- [ ] 09:00 - 10:30 Standup",
// "- 14:00 Lunch"), each lasting to its end time, else to the next one's start, else DEFAULT minutes.

export type Entry = { start: number; end: number; text: string; done: boolean | null; line: number }

export const DEFAULT = 30
const ITEM = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(\d{1,2})[:.](\d\d)(?:\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d\d))?\s+(.+?)\s*$/

const minutes = (h: string, m: string) => {
  const n = Number(h) * 60 + Number(m)
  return Number(h) < 24 && Number(m) < 60 ? n : null
}

/** The timed items of a note's text (code skipped), in order of their start. */
export function planOf(text: string): Entry[] {
  const out: Entry[] = []
  let fence: string | null = null
  text.split("\n").forEach((l, line) => {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(l)
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; return }
    if (fence) return
    const m = ITEM.exec(l)
    if (!m) return
    const start = minutes(m[2], m[3])
    if (start === null) return
    const end = m[4] ? minutes(m[4], m[5]) : null
    out.push({ start, end: end !== null && end > start ? end : -1, text: m[6], done: m[1] === undefined ? null : m[1] !== " ", line })
  })
  out.sort((a, b) => a.start - b.start || a.line - b.line)
  out.forEach((e, i) => {
    if (e.end > 0) return
    const next = out.slice(i + 1).find((x) => x.start > e.start)
    e.end = Math.min(next ? next.start : e.start + DEFAULT, e.start + DEFAULT * 4, 24 * 60)
  })
  return out
}

export const hhmm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`

/** The plan as text: a line per item, `now` (minutes into the day, when it's that day) marking the one going on. */
export function planText(plan: Entry[], now: number | null): string {
  if (!plan.length) return "_Nothing planned: list items starting with a time (`- 09:00 - 10:00 Standup`) show here._"
  return plan.map((e) => {
    const on = now !== null && now >= e.start && now < e.end
    return `- ${hhmm(e.start)}–${hhmm(e.end)} ${e.text}${e.done ? " (done)" : ""}${on ? " **(now)**" : ""}`
  }).join("\n")
}

/** The day a note is, from its name (a daily note's date), or null. */
export const dayOf = (path: string) => /(\d{4}-\d\d-\d\d)/.exec(path.split("/").pop() ?? "")?.[1] ?? null
