// Claude Code on the web's sessions, read by the desktop app with the Browser's logins (electron/web.ts): one list
// for the whole app, asked once, then told as it changes. Elsewhere (a browser, a phone) there's none.
import { webPages, type CloudSession } from "@vaultite"

let now: CloudSession[] = []
let asked = false
const listeners = new Set<() => void>()
const put = (list: CloudSession[]) => { now = list; listeners.forEach((f) => f()) }

export function subscribeCloud(fn: () => void) {
  listeners.add(fn)
  if (!asked && webPages?.cloud) {
    asked = true
    webPages.on((m) => { if (m.type === "cloud") put(m.sessions) })
    void webPages.cloud().then(put, () => {})
  }
  return () => { listeners.delete(fn) }
}
export const getCloud = () => now

/** The ones the panel lists: waiting on you, working, then idle ones touched in the last two days, at most ten; `older`:
 *  the rest, behind Show older. */
export const cloudListed = (list: CloudSession[]) => {
  const rank = { waiting: 0, running: 1, idle: 2 }
  const recent = (c: CloudSession) => c.state !== "idle" || Date.now() - c.updated < 2 * 86_400_000
  const sorted = [...list].sort((a, b) => Number(!recent(a)) - Number(!recent(b)) || rank[a.state] - rank[b.state] || b.updated - a.updated)
  const n = Math.min(10, sorted.filter(recent).length)
  return { listed: sorted.slice(0, n), older: sorted.slice(n) }
}

