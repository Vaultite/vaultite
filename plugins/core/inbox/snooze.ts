const HOUR = 3_600_000
const at = (d: Date, days: number, hour: number) => { const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(hour, 0, 0, 0); return x }
const toNext = (d: Date, dow: number) => ((dow - d.getDay() + 7) % 7) || 7

const MORNING = 8, EVENING = 18

export function choices(now = new Date()): { key: string; label: string; at: Date }[] {
  const out = [{ key: "1h", label: "In 1 hour", at: new Date(now.getTime() + HOUR) }, { key: "3h", label: "In 3 hours", at: new Date(now.getTime() + 3 * HOUR) }]
  if (now.getHours() < EVENING - 1) out.push({ key: "evening", label: "This evening", at: at(now, 0, EVENING) })
  out.push({ key: "tomorrow", label: "Tomorrow", at: at(now, 1, MORNING) })
  if (now.getDay() >= 1 && now.getDay() <= 4) out.push({ key: "weekend", label: "This weekend", at: at(now, toNext(now, 6), MORNING) })
  out.push({ key: "week", label: "Next week", at: at(now, toNext(now, 1), MORNING) })
  return out
}

export function whenText(t: Date, now = new Date()) {
  const time = t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const days = Math.round((at(t, 0, 0).getTime() - at(now, 0, 0).getTime()) / (24 * HOUR))
  if (days === 0) return time
  if (days === 1) return `Tomorrow ${time}`
  if (days > 1 && days < 7) return `${t.toLocaleDateString([], { weekday: "short" })} ${time}`
  return `${t.toLocaleDateString([], { month: "short", day: "numeric", ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })}, ${time}`
}

export function parseUntil(s: string, now = new Date()): Date | null {
  const v = s.trim().toLowerCase().replace(/^next[- ]week$/, "week").replace(/^this[- ](evening|weekend)$/, "$1")
  const c = choices(now).find((x) => x.key === v) ?? (v === "evening" ? { at: at(now, 0, EVENING) } : v === "weekend" ? { at: at(now, toNext(now, 6), MORNING) } : null)
  if (c) return c.at
  const m = /^(\d+(?:\.\d+)?)\s*(m|min|h|d)$/.exec(v)
  if (m) return new Date(now.getTime() + Number(m[1]) * (m[2] === "d" ? 24 * HOUR : m[2] === "h" ? HOUR : HOUR / 60))
  const hm = /^(\d\d?):(\d\d)$/.exec(v)
  if (hm) { const t = new Date(now); t.setHours(Number(hm[1]), Number(hm[2]), 0, 0); if (t <= now) t.setDate(t.getDate() + 1); return Number(hm[1]) < 24 && Number(hm[2]) < 60 ? t : null }
  const d = /^(\d{4}-\d\d-\d\d)(?:[ t](\d\d?):(\d\d))?$/.exec(v)
  const t = d ? new Date(`${d[1]}T${(d[2] ?? String(MORNING)).padStart(2, "0")}:${d[3] ?? "00"}`) : null
  return t && !Number.isNaN(t.getTime()) ? t : null
}

export function stampOf(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export const snoozeMs = (v: unknown) => typeof v === "number" ? v : typeof v === "string" && v ? Date.parse(v.replace(" ", "T")) || 0 : 0
export const snoozed = (v: unknown, now = Date.now()) => snoozeMs(v) > now
