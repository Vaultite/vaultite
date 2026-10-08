// Moment.js-style dates without moment, shared by the server and the web app (no Node): a formatter and its reader,
// weeks numbered from a chosen first day (w, ww, gggg, e) beside ISO's (W, WW, GGGG, E).

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0")
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th")
const LOCAL: Record<string, string> = { LTS: "h:mm:ss A", LT: "h:mm A", LLLL: "dddd, MMMM D, YYYY h:mm A", LLL: "MMMM D, YYYY h:mm A",
  LL: "MMMM D, YYYY", L: "MM/DD/YYYY", llll: "ddd, MMM D, YYYY h:mm A", lll: "MMM D, YYYY h:mm A", ll: "MMM D, YYYY", l: "M/D/YYYY" }
const local = (fmt: string) => fmt.replace(/\[[^\]]*\]|LTS|LT|LLLL|LLL|LL|L|llll|lll|ll|l/g, (m) => LOCAL[m] ?? m)

/** How weeks count: the day they start on (`start`, 0 Sunday … 6 Saturday) and the day of January week 1 holds (`jan`,
 *  moment's doy: 1 for the week of January 1st); unset, ISO's (1 and 4). `loose`: see parseDate. */
export type DateOptions = { start?: number; jan?: number; loose?: boolean }
type Weeks = { start: number; jan: number }
const ISO: Weeks = { start: 1, jan: 4 }

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5) // (local midnights; DST-safe)
const weekOf = (d: Date, w: Weeks) => addDays(d, -((d.getDay() - w.start + 7) % 7))
/** d's week and week-year: a week is its year's when it holds that year's January `jan`. */
function week(d: Date, w: Weeks) {
  const a = addDays(weekOf(d, w), 7 - w.jan) // (the day of the week that decides its year)
  return { n: Math.floor(daysBetween(new Date(a.getFullYear(), 0, 1), a) / 7) + 1, year: a.getFullYear() }
}
const weekStart = (y: number, n: number, w: Weeks) => addDays(weekOf(new Date(y, 0, w.jan), w), (n - 1) * 7)

const TOKENS = /\[([^\]]*)\]|YYYY|YY|gggg|gg|GGGG|GG|Q|MMMM|MMM|MM|Mo|M|DDDD|DDDo|DDD|Do|DD|D|dddd|ddd|dd|do|d|E|e|ww|wo|w|WW|Wo|W|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|A|a|X|x|ZZ|Z/g

/** `d` in a moment.js format (`YYYY-MM-DD`, `dddd, MMMM Do`, `gggg-[W]ww`, `h:mm A`, `LL`); text in [brackets] as it is. */
export function formatDate(d: Date, fmt = "YYYY-MM-DD", opts: DateOptions = {}): string {
  if (Number.isNaN(d.getTime())) return "Invalid date"
  const w = { start: opts.start ?? 1, jan: opts.jan ?? 4 }, lw = week(d, w), iw = week(d, ISO), h = d.getHours(), ms = d.getMilliseconds()
  const doy = daysBetween(new Date(d.getFullYear(), 0, 1), addDays(d, 0)) + 1, off = -d.getTimezoneOffset()
  const zone = (sep: string) => `${off < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(off) / 60))}${sep}${pad(Math.abs(off) % 60)}`
  const v: Record<string, () => string | number> = {
    YYYY: () => d.getFullYear(), YY: () => pad(d.getFullYear() % 100), gggg: () => lw.year, gg: () => pad(lw.year % 100),
    GGGG: () => iw.year, GG: () => pad(iw.year % 100), Q: () => Math.floor(d.getMonth() / 3) + 1, MMMM: () => MONTHS[d.getMonth()],
    MMM: () => MONTHS[d.getMonth()].slice(0, 3), MM: () => pad(d.getMonth() + 1), Mo: () => ordinal(d.getMonth() + 1), M: () => d.getMonth() + 1,
    DDDD: () => pad(doy, 3), DDDo: () => ordinal(doy), DDD: () => doy, Do: () => ordinal(d.getDate()), DD: () => pad(d.getDate()), D: () => d.getDate(),
    dddd: () => DAYS[d.getDay()], ddd: () => DAYS[d.getDay()].slice(0, 3), dd: () => DAYS[d.getDay()].slice(0, 2), do: () => ordinal(d.getDay()),
    d: () => d.getDay(), E: () => (d.getDay() + 6) % 7 + 1, e: () => (d.getDay() - w.start + 7) % 7,
    ww: () => pad(lw.n), wo: () => ordinal(lw.n), w: () => lw.n, WW: () => pad(iw.n), Wo: () => ordinal(iw.n), W: () => iw.n,
    HH: () => pad(h), H: () => h, hh: () => pad(h % 12 || 12), h: () => h % 12 || 12, kk: () => pad(h || 24), k: () => h || 24,
    mm: () => pad(d.getMinutes()), m: () => d.getMinutes(), ss: () => pad(d.getSeconds()), s: () => d.getSeconds(),
    SSS: () => pad(ms, 3), SS: () => pad(Math.floor(ms / 10)), S: () => Math.floor(ms / 100), A: () => (h < 12 ? "AM" : "PM"), a: () => (h < 12 ? "am" : "pm"),
    X: () => Math.floor(d.getTime() / 1000), x: () => d.getTime(), Z: () => zone(":"), ZZ: () => zone(""),
  }
  return local(fmt).replace(TOKENS, (m, lit?: string) => lit ?? String(v[m]()))
}

// What each token reads, and where it puts it: y year, m month (0-11), d day, q quarter, gy/n a week of `opts`, iy/i an
// ISO one, doy a day of the year, h/min/s/pm the time.
type Parts = Partial<Record<"y" | "m" | "d" | "q" | "gy" | "n" | "iy" | "i" | "doy" | "h" | "min" | "s" | "pm", number>>
type Read = [string, (p: Parts, s: string) => void]
const NUM = (k: keyof Parts, re: string, f = (s: string) => +s): Read => [re, (p, s) => { p[k] = f(s) }]
const NAME = (list: string[], len?: number) => (s: string) => list.findIndex((x) => (len ? x.slice(0, len) : x).toLowerCase() === s.toLowerCase())
const AMPM = NUM("pm", "[AaPp][Mm]", (s) => (/p/i.test(s) ? 12 : 0))
const READ: Record<string, Read> = {
  YYYY: NUM("y", "\\d{4}"), YY: NUM("y", "\\d\\d", (s) => 2000 + +s), gggg: NUM("gy", "\\d{4}"), GGGG: NUM("iy", "\\d{4}"), Q: NUM("q", "[1-4]"),
  MMMM: NUM("m", "[A-Za-z]+", NAME(MONTHS)), MMM: NUM("m", "[A-Za-z]{3}", NAME(MONTHS, 3)), MM: NUM("m", "\\d\\d", (s) => +s - 1), M: NUM("m", "\\d\\d?", (s) => +s - 1),
  DDDD: NUM("doy", "\\d{3}"), DDD: NUM("doy", "\\d{1,3}"), Do: NUM("d", "\\d\\d?(?:st|nd|rd|th)", parseInt), DD: NUM("d", "\\d\\d"), D: NUM("d", "\\d\\d?"),
  ww: NUM("n", "\\d\\d"), w: NUM("n", "\\d\\d?"), WW: NUM("i", "\\d\\d"), W: NUM("i", "\\d\\d?"), HH: NUM("h", "\\d\\d"), H: NUM("h", "\\d\\d?"),
  hh: NUM("h", "\\d\\d", (s) => +s % 12), h: NUM("h", "\\d\\d?", (s) => +s % 12), mm: NUM("min", "\\d\\d"), ss: NUM("s", "\\d\\d"), A: AMPM, a: AMPM,
}

/** The date `text` names in a moment.js format (a week's first day), or null if the format doesn't write it ("2026-13-01"
 *  in YYYY-MM-DD); `loose`: what the text starts with, read as moment does. */
export function parseDate(text: string, fmt: string, opts: DateOptions = {}): Date | null {
  const w = { start: opts.start ?? 1, jan: opts.jan ?? 4 }, sets: Read[1][] = []
  const re = local(fmt).replace(new RegExp(`${TOKENS.source}|[.*+?^\${}()|\\\\]`, "g"), (m, lit?: string) => {
    if (lit !== undefined) return lit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const r = READ[m]
    if (!r) return /^[.*+?^${}()|\\]$/.test(m) ? `\\${m}` : "[A-Za-z0-9]+?" // (a token it writes but needn't read: a weekday)
    sets.push(r[1])
    return `(${r[0]})`
  })
  const hit = new RegExp(`^${re}`).exec(text.trim())
  if (!hit) return null
  const p: Parts = {}
  sets.forEach((set, i) => set(p, hit[i + 1]))
  const y = p.y ?? p.gy ?? p.iy ?? new Date().getFullYear()
  const d = p.n !== undefined ? weekStart(p.gy ?? y, p.n, w) : p.i !== undefined ? weekStart(p.iy ?? y, p.i, ISO)
    : p.doy !== undefined ? new Date(y, 0, p.doy)
    : new Date(y, p.m ?? (p.q ? (p.q - 1) * 3 : 0), p.d ?? 1, (p.h ?? 0) + (p.pm ?? 0), p.min ?? 0, p.s ?? 0)
  return opts.loose || formatDate(d, fmt, w) === text ? d : null
}
