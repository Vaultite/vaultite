// Made-up answers for the Errors plugin's routes, for its preview (Plugins > Errors): times relative to now.
import type { ErrorEvent, ErrorGroup, ErrorList } from "./model"

const MIN = 60_000, HOUR = 3_600_000

export function mockLive(): Record<string, unknown> {
  const now = Date.now()
  const ev = (id: string, ago: number, e: Omit<ErrorEvent, "id" | "t">): ErrorEvent => ({ id, t: now - ago, ...e })
  const group = (e: ErrorEvent, count: number, first: number, extra: Partial<ErrorGroup> = {}): ErrorGroup =>
    ({ id: e.id, source: e.source, kind: e.kind, message: e.message, first: now - first, last: e.t, count, fatal: e.fatal ? 1 : 0, devices: e.device ? [e.device] : [], latest: e, ...extra })
  const groups = [
    group(ev("a1b2c3d4e5", 4 * MIN, { source: "app", kind: "stopped", fatal: true, device: "phone", message: "TypeError: Cannot read properties of undefined (reading 'title')",
      stack: "TypeError: Cannot read properties of undefined (reading 'title')\n    at ProjectCard (assets/index.js:120:14)\n    at renderWithHooks (assets/index.js:4410:22)",
      url: "/#/Projects/Lighthouse.md", build: "index-3hY8kq.js", trail: ["Ran Open quick switcher", "Opened Projects/Lighthouse.md"] }), 1, 4 * MIN),
    group(ev("f6e5d4c3b2", 35 * MIN, { source: "server", kind: "error", message: "calendar: couldn't read the feed: Error: getaddrinfo ENOTFOUND",
      stack: "Error: getaddrinfo ENOTFOUND\n    at GetAddrInfoReqWrap.onlookup (node:dns:120:26)", where: "GET /api/calendar" }), 6, 5 * HOUR),
    group(ev("0a9b8c7d6e", 26 * HOUR, { source: "app", kind: "boundary", device: "desktop", message: "Error: block-people-map: map style didn't load",
      url: "/#/Dashboards/People.md" }), 2, 30 * HOUR, { devices: ["desktop", "web"] }),
  ]
  const list: ErrorList = { groups, total: groups.length, events: groups.reduce((n, g) => n + g.count, 0), since: now - 30 * HOUR }
  return Object.fromEntries([["errors", list], ...groups.map((g) => [`errors/${g.id}`, { group: g, events: [g.latest] }])])
}
