import { useDeferredValue, useEffect, useMemo } from "react"
import { get } from "@/core/http"
import type { SearchDoc } from "@/core/plugins"
import { searchNames } from "@/core/namesearch"
import type { Found, Result } from "@/pages/SearchHits"
import { plural } from "@/lib/utils"

export const FIRST = 10, PAGE = 40, LINES = 20, MOST_LINES = 100_000
const MOST = 500

export type Shown = { results: Result[]; files?: number; lines?: number; fresh?: boolean }
const SCREEN_ROWS = 60
function firstScreen(rs: Result[], shut: boolean) {
  let rows = 0, n = 0
  for (; n < rs.length && rows < SCREEN_ROWS; n++) rows += 1 + (shut ? 0 : rs[n].matches?.length ?? 0)
  return n === rs.length ? rs : rs.slice(0, n)
}
export function useFirstScreen(found: Shown | null, setFound: (f: (cur: Shown | null) => Shown | null) => void, shut: boolean) {
  const fresh = !!found?.fresh
  useEffect(() => {
    if (!fresh) return
    const t = requestAnimationFrame(() => setFound((cur) => cur && { ...cur, fresh: false }))
    return () => cancelAnimationFrame(t)
  }, [fresh, setFound])
  return found && fresh ? firstScreen(found.results, shut) : found?.results ?? null
}

export async function firstOf(params: string, n: number, signal: AbortSignal): Promise<Result[]> {
  let out: Result[] | null = null
  for (let at = 0; !out || (at < n && out.length === at); at += MOST) {
    const rs: Result[] = await get<Result[]>(`search?${params}&lines=${LINES}&offset=${at}&limit=${Math.min(MOST, n - at)}`, signal)
    out = out ? [...out, ...rs] : rs
  }
  return out
}
export const totalOf = (params: string, signal: AbortSignal) => get<Found>(`search?${params}&lines=${LINES}&total=1&limit=1`, signal)
  .then((t) => ({ files: t.files, lines: t.lines ?? 0 }), () => ({ files: 0, lines: 0 }))

export function statusOf(f: Shown | null, busy: boolean) {
  if (!f || (busy && !f.results.length)) return null
  if (!f.results.length) return "Nothing found"
  if (f.files === undefined || f.lines === undefined) return null
  return f.lines ? `${plural(f.lines, "line")} in ${plural(f.files, "file")}` : plural(f.files, "file")
}
export function useNames(docs: SearchDoc[], q: string, on: boolean) {
  const typed = useDeferredValue(on ? q : "")
  return useMemo(() => searchNames(docs, typed), [docs, typed])
}

