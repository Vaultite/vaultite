// Claude Code on the web's sessions, read by the desktop app with the Web viewer's logins (electron/web.ts): one list
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

/** The ones the panel lists: waiting on you, working, then idle ones touched in the last two days; at most ten. */
export const cloudListed = (list: CloudSession[]) => {
  const rank = { waiting: 0, running: 1, idle: 2 }
  return list.filter((c) => c.state !== "idle" || Date.now() - c.updated < 2 * 86_400_000)
    .sort((a, b) => rank[a.state] - rank[b.state] || b.updated - a.updated).slice(0, 10)
}

/** "now", "5 min", "3 h", "2 d". */
export function ago(t: number) {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  return mins < 1 ? "now" : mins < 60 ? `${mins} min` : mins < 60 * 24 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
}
