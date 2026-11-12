import { trace } from "@/core/trace"

export type ActivityNote = { action: string; text: string; paths?: string[]; t: number }

const subs = new Set<(n: ActivityNote) => void>()

export function noteActivity(action: string, text: string, paths?: string[]) {
  trace("activity", { action, text: text.slice(0, 200), ...(paths?.length ? { paths: paths.slice(0, 5) } : {}) })
  if (!subs.size) return
  const n = { action, text, paths, t: Date.now() }
  for (const f of subs) try { f(n) } catch { /* a listener's problem, never the caller's */ }
}

/** Hear what the user does (see noteActivity); returns how to stop. */
export const onActivity = (fn: (n: ActivityNote) => void) => { subs.add(fn); return () => { subs.delete(fn) } }
