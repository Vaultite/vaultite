// How long what the user waits for took, part by part (core/spans.ts, the server's): traced ("span"), and sent with
// the app's perf reports (activity's Report.tsx) so `vau perf` shows them.
import { trace } from "./trace"

export type Span = { name: string; t: number; ms: number; parts: Record<string, number>; tags?: Record<string, string> }
const queue: Span[] = []
const r1 = (n: number) => Math.round(n * 10) / 10

/** A span from `t0` (a performance.now(), default now): `mark` ends a part, `end` sends it all. */
export function span(name: string, tags: Record<string, string> = {}, t0 = performance.now()) {
  const parts: Record<string, number> = {}
  let last = t0, done = false
  return {
    tags,
    mark(part: string) { const now = performance.now(); parts[part] = r1((parts[part] ?? 0) + now - last); last = now },
    end() {
      if (done) return
      done = true
      const ms = r1(performance.now() - t0), s: Span = { name, t: Math.round(performance.timeOrigin + t0), ms, parts, tags }
      trace("span", { name, ms, parts, tags })
      queue.push(s)
      if (queue.length > 100) queue.shift()
    },
  }
}

/** The spans ended since the last call. */
export const takeSpans = () => queue.splice(0)
