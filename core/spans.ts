// How long what the user waits for took (the app starting, a terminal opening, an agent getting ready), part by part:
// `vau perf` shows them. In memory, the last few of each.
export type Span = { name: string; t: number; ms: number; parts: Record<string, number>; tags?: Record<string, string> }

const KEEP = 50
// When the user asked for this server: the desktop app's launch, or its window opening when the app was already up.
const launched = Number(process.env.VAULTITE_LAUNCHED_AT) || 0, forked = Number(process.env.VAULTITE_FORKED_AT) || 0
export const askedAt = forked && forked - launched < 30_000 ? launched : forked || performance.timeOrigin
delete process.env.VAULTITE_LAUNCHED_AT; delete process.env.VAULTITE_FORKED_AT // (not for the shells it starts)
let opened = false
const kept = new Map<string, Span[]>()
const r1 = (n: number) => Math.round(n * 10) / 10

/** Keep a finished span (the app's arrive through POST activity/perf). The app's first load after this server started
 *  makes "app.open": from the launch to its first draw. */
export function record(s: Span) {
  if (s.name === "app.load" && !opened && s.t >= askedAt && s.t - askedAt < 120_000) {
    opened = true
    record({ name: "app.open", t: askedAt, ms: r1(s.t + s.ms - askedAt), parts: { "until the page": r1(s.t - askedAt), ...s.parts } })
  }
  const list = kept.get(s.name) ?? []
  list.push(s)
  if (list.length > KEEP) list.shift()
  kept.set(s.name, list)
}

/** A span starting now (or at `t0`, a performance.now()): `mark` ends a part, `end` records it all. */
export function span(name: string, tags: Record<string, string> = {}, t0 = performance.now()) {
  const parts: Record<string, number> = {}
  let last = t0
  return {
    tags,
    mark(part: string) { const now = performance.now(); parts[part] = r1((parts[part] ?? 0) + now - last); last = now },
    end() { const ms = r1(performance.now() - t0); record({ name, t: Date.now() - ms, ms, parts, tags }); return ms },
  }
}

export const spans = () => [...kept.values()].flat().sort((a, b) => a.t - b.t)
