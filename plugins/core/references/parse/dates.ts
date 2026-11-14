import type { CslDate } from "../csl.ts"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const SEASONS = new Map([["spring", 13], ["summer", 14], ["autumn", 15], ["fall", 15], ["winter", 16]])
const ISO_PART = /^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:T[\d:.]+(?:Z|[+-][\d:]+)?)?([~?%]?)$/

type Parts = { parts: number[]; circa: boolean }

function isoPart(text: string): Parts | null {
  const m = ISO_PART.exec(text.trim())
  if (!m) return null
  const parts = [Number(m[1])]
  if (m[2]) parts.push(Number(m[2]))
  if (m[3]) parts.push(Number(m[3]))
  return { parts, circa: m[4] !== "" }
}

function fromParts(list: Parts[]): CslDate {
  const date: CslDate = { "date-parts": list.map((p) => p.parts) }
  if (list.some((p) => p.circa)) date.circa = true
  return date
}

export function isoDate(text: string): CslDate | null {
  const t = text.trim()
  if (!t) return null
  const ends = t.split("/")
  if (ends.length > 2) return null
  const parts: Parts[] = []
  for (const end of ends) {
    if (end === "" || end === "..") continue
    const p = isoPart(end)
    if (!p) return null
    parts.push(p)
  }
  return parts.length ? fromParts(parts) : null
}

export function monthOf(text: string): number {
  const t = text.trim().toLowerCase()
  if (/^\d{1,2}$/.test(t)) return Number(t)
  const i = MONTHS.indexOf(t.slice(0, 3))
  return i >= 0 ? i + 1 : SEASONS.get(t) ?? 0
}

type MonthDay = { month: number; day: number }

export function monthDay(text: string): MonthDay {
  let named = 0
  const numbers: number[] = []
  for (const word of text.split(/[^\p{L}\d]+/u)) {
    if (/^\d{1,2}$/.test(word)) numbers.push(Number(word))
    else if (word) named = monthOf(word) || named
  }
  const [month, day] = named ? [named, numbers[0] ?? 0] : [numbers[0] ?? 0, numbers[1] ?? 0]
  return { month: month <= 16 ? month : 0, day: day <= 31 ? day : 0 }
}

function yearRange(text: string): number[][] | null {
  const m = /^(\d{1,4})\s*(?:[-–—/]+\s*(\d{1,4}))?$/.exec(text.trim())
  if (!m) return null
  return m[2] ? [[Number(m[1])], [Number(m[2])]] : [[Number(m[1])]]
}

export function yearDate(year: string, month = "", day = ""): CslDate | null {
  const y = year.trim()
  if (!y) return null
  const years = yearRange(y)
  if (!years) return /\d/.test(y) ? { raw: y } : { literal: y }
  if (years.length > 1) return { "date-parts": years }
  const md = monthDay(`${month} ${day}`)
  const parts = [years[0][0]]
  if (md.month) parts.push(md.month)
  if (md.month && md.day) parts.push(md.day)
  return { "date-parts": [parts] }
}

const WORDY = /^(?:(\d{1,2})\.?\s+)?([\p{L}]+)\.?\s+(?:(\d{1,2}),?\s+)?(\d{4})$/u

export function anyDate(text: string): CslDate | null {
  const t = text.trim()
  if (!t) return null
  const iso = isoDate(t)
  if (iso) return iso
  const range = yearRange(t)
  if (range) return { "date-parts": range }
  const m = WORDY.exec(t)
  const month = m ? monthOf(m[2]) : 0
  if (m && month) {
    const day = Number(m[1] ?? m[3] ?? 0)
    return { "date-parts": [day ? [Number(m[4]), month, day] : [Number(m[4]), month]] }
  }
  return /\d/.test(t) ? { raw: t } : { literal: t }
}
