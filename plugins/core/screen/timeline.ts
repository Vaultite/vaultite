// The screen's timeline's rules (the desktop app's timeline.ts keeps it): the last seconds on one clock, in memory only,
// read by a time range or from when they said something. No Electron: the tests read it.
export type Rect = { x: number; y: number; width: number; height: number }
export type Happened = { t: number } & (
  | { kind: "pointer"; x: number; y: number }
  | { kind: "app"; app: string; name: string; title?: string; private?: boolean }
  | { kind: "click"; x: number; y: number; under?: string }
  | { kind: "said"; text: string }
  | { kind: "box"; rect: Rect | null })
export type Kind = Happened["kind"]
export const KINDS: Kind[] = ["pointer", "app", "click", "said", "box"]
/** How far back it reaches (ms), and the most it keeps: bounded however busy. */
export const KEEP_MS = 30_000, MOST = 6000

/** What's kept at `now`: the last KEEP_MS, at most MOST (the app in front then always: what came before is known). */
export function kept(h: Happened[], now: number): Happened[] {
  const from = now - KEEP_MS, i = h.findIndex((e) => e.t >= from)
  const lastApp = h.slice(0, i < 0 ? h.length : i).findLast((e) => e.kind === "app")
  const recent = i < 0 ? [] : h.slice(i)
  return [...(lastApp ? [{ ...lastApp, t: from }] : []), ...recent].slice(-MOST)
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
/** A stretch of it: `last` seconds, `from`/`to` (ms since 1970), or from when they last said `said` (its key-down) on. */
export type Query = { last?: number; from?: number; to?: number; said?: string; kinds?: Kind[] }
export function rangeOf(h: Happened[], q: Query, now: number): { from: number; to: number } | { why: string } {
  const to = Math.min(now, q.to ?? now), oldest = now - KEEP_MS
  if (q.said?.trim()) {
    const w = words(q.said), hit = h.findLast((e) => e.kind === "said" && e.t <= to && ` ${words(e.text)} `.includes(` ${w} `))
    if (!hit) return { why: `nothing said like "${q.said.trim()}" in the last ${KEEP_MS / 1000} s` }
    return { from: hit.t, to }
  }
  const from = q.from ?? (q.last ? to - q.last * 1000 : oldest)
  if (from >= to) return { why: "from is after to" }
  return { from: Math.max(oldest, from), to }
}

/** What happened in `r` (only `kinds`), the pointer thinned to a point every quarter second. */
export function within(h: Happened[], r: { from: number; to: number }, kinds: Kind[] = KINDS): Happened[] {
  let lastPointer = -Infinity
  return h.filter((e) => {
    if (e.t < r.from || e.t > r.to || !kinds.includes(e.kind)) return false
    if (e.kind !== "pointer") return true
    if (e.t - lastPointer < 250) return false
    lastPointer = e.t
    return true
  })
}

/** One line each, its time from the stretch's start. */
export function timelineLines(h: Happened[], from: number) {
  const at = (t: number) => `[${((t - from) / 1000).toFixed(1)} s]`
  return h.map((e) => {
    if (e.kind === "pointer") return `${at(e.t)} pointer at ${Math.round(e.x)},${Math.round(e.y)}`
    if (e.kind === "app") return `${at(e.t)} ${e.private ? "a private app" : `${e.name}${e.title ? ` "${e.title}"` : ""}`} in front`
    if (e.kind === "click") return `${at(e.t)} clicked at ${Math.round(e.x)},${Math.round(e.y)}${e.under ? `: ${e.under}` : ""}`
    if (e.kind === "said") return `${at(e.t)} said ${JSON.stringify(e.text)}`
    return `${at(e.t)} ${e.rect ? `box at ${e.rect.x},${e.rect.y} ${e.rect.width}×${e.rect.height}` : "box closed"}`
  })
}
