
export type Birthday = { month: number; day: number; year: number | null }
export type NextBirthday = { date: string; days: number; turns: number | null }

const pad = (n: number) => String(n).padStart(2, "0")
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A `birthday` value as written: a YAML reader that makes dates Dates gives one back as YYYY-MM-DD. */
export function birthdayText(v: unknown) {
  if (v instanceof Date) return isNaN(+v) ? "" : v.toISOString().slice(0, 10)
  return typeof v === "string" ? v.trim() : ""
}

export function parseBirthday(v: unknown): Birthday | null {
  const m = /^(?:(\d{4})-)?(\d\d)-(\d\d)$/.exec(birthdayText(v))
  if (!m) return null
  const year = m[1] ? Number(m[1]) : null, month = Number(m[2]), day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > daysIn(year ?? 2000, month)) return null
  return { month, day, year }
}

export const bornOn = (b: Birthday) => `${b.year ?? 2000}-${pad(b.month)}-${pad(b.day)}`

const inYear = (b: Birthday, year: number) => `${year}-${pad(b.month)}-${pad(Math.min(b.day, daysIn(year, b.month)))}`

export function nextBirthday(b: Birthday, today: string): NextBirthday {
  let year = Number(today.slice(0, 4))
  let date = inYear(b, year)
  if (date < today) date = inYear(b, ++year)
  const turns = b.year !== null && year > b.year ? year - b.year : null
  return { date, days: Math.round((Date.parse(date) - Date.parse(today)) / 864e5), turns }
}

export function ageOn(b: Birthday, today: string) {
  const n = nextBirthday(b, today)
  return n.turns === null ? null : n.days === 0 ? n.turns : n.turns - 1
}

export function upcoming<T extends { name?: unknown; birthday?: unknown }>(people: T[], today: string, count: number) {
  const out: (NextBirthday & { person: T })[] = []
  for (const person of people) {
    const b = parseBirthday(person.birthday)
    if (b) out.push({ person, ...nextBirthday(b, today) })
  }
  return out.sort((x, y) => x.days - y.days || String(x.person.name).localeCompare(String(y.person.name))).slice(0, Math.max(0, count))
}

export const until = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`)

export const nearness = (days: number) => (days < 7 ? "soon" : days < 30 ? "near" : null)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const monthDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`
