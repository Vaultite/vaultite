// What the app did, for debugging: `window.__vauTrace`, the latest events per topic in memory (heights and scroll
// restores; "editor": each editor's changes, cursor jumps, views and mounts, never the text). Cheap enough to be always
// on; read with `vau dev eval __vauTrace.editor`.
const MAX: Record<string, number> = { editor: 2000 }
type Event = { t: number; at: string; [k: string]: unknown }
const topics: Record<string, Event[]> = {}
;(globalThis as { __vauTrace?: typeof topics }).__vauTrace = topics

export function trace(topic: string, event: Record<string, unknown>) {
  const list = (topics[topic] ??= [])
  // (performance.now for order, the clock for matching the server's log and the activity)
  list.push({ t: Math.round(performance.now()), at: new Date().toISOString(), ...event })
  const max = MAX[topic] ?? 300
  if (list.length > max) list.splice(0, list.length - max)
}
