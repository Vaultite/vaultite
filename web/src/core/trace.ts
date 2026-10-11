// What the app did, for debugging: `window.__vauTrace`, recent events per topic in memory ("editor": changes, cursor
// jumps, mounts, never the text). Always on, it's cheap: `vau dev eval __vauTrace.editor`, or `onTrace` (Bug recorder).
const MAX: Record<string, number> = { editor: 2000 }
export type TraceEvent = { t: number; at: string; [k: string]: unknown }
const topics: Record<string, TraceEvent[]> = {}
;(globalThis as { __vauTrace?: typeof topics }).__vauTrace = topics
const subs = new Set<(topic: string, e: TraceEvent) => void>()

/** Something the app did, under `topic`: plain values only, never a file's text. */
export function trace(topic: string, event: Record<string, unknown>) {
  const list = (topics[topic] ??= [])
  // (performance.now for order, the clock for matching the server's log and the activity)
  const e = { t: Math.round(performance.now()), at: new Date().toISOString(), ...event }
  list.push(e)
  const max = MAX[topic] ?? 300
  if (list.length > max) list.splice(0, list.length - max)
  for (const f of subs) try { f(topic, e) } catch { /* a listener's problem */ }
}

/** Hear every traced event from now on; returns how to stop. */
export const onTrace = (fn: (topic: string, e: TraceEvent) => void) => { subs.add(fn); return () => { subs.delete(fn) } }
