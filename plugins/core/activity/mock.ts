// Made-up answers for Activity's routes, for its preview (Plugins > Activity): nobody real, times relative to now.
import type { ActivityEvent, ActivityList, ActivitySummary, Minute, Perf } from "./model"
import { parseRecap } from "./recap"

const MIN = 60_000, HOUR = 3_600_000

export function mockLive(): Record<string, unknown> {
  const now = Date.now()
  const you = { kind: "you" as const, name: "You", device: "desktop" }
  const claude = { kind: "agent" as const, name: "Claude Code", session: "Plan the Lighthouse launch" }
  const ev = (id: string, ago: number, e: Omit<ActivityEvent, "id" | "t">): ActivityEvent => ({ id, t: now - ago, ...e })
  const events: ActivityEvent[] = [
    ev("m1", 2 * MIN, { actor: claude, action: "edit", text: "Edited Projects/Lighthouse.md", paths: ["Projects/Lighthouse.md"], count: 4, last: now - MIN, method: "PUT", route: "file", status: 200, ms: 18 }),
    ev("m2", 6 * MIN, { actor: you, action: "open", text: "Opened Notes/Idea.md", paths: ["Notes/Idea.md"] }),
    ev("m3", 9 * MIN, { actor: you, action: "edit", text: "Edited Notes/Idea.md", paths: ["Notes/Idea.md"], count: 12 }),
    ev("m4", 25 * MIN, { actor: { kind: "cli", name: "vau CLI" }, action: "read", text: "Read Dashboards/Today.md", paths: ["Dashboards/Today.md"] }),
    ev("m5", 48 * MIN, { actor: claude, action: "save", text: "Logged a call with Alice Park", paths: ["People/Alice Park.md"], method: "POST", route: "interactions", status: 200, ms: 412 }),
    ev("m6", 2 * HOUR, { actor: { kind: "disk", name: "On disk" }, action: "change", text: "Changed People/Bob Lee.md", paths: ["People/Bob Lee.md"] }),
    ev("m7", 3 * HOUR, { actor: you, action: "command", text: "Ran Toggle reading view" }),
    ev("m8", 26 * HOUR, { actor: { kind: "script", name: "curl" }, action: "save", text: "Logged Morning run", paths: ["Logs/Running/Morning run.md"] }),
  ]
  const list: ActivityList = { events, total: events.length }

  const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR
  const wave = (i: number, k: number) => Math.max(0, Math.round((Math.sin((i + k) / 3) + 0.6) * (4 + (i % 5))))
  const buckets = Array.from({ length: 24 }, (_, i) => ({ t: start + i * HOUR, you: i < 8 ? 0 : wave(i, 0), agents: i < 8 ? 0 : wave(i, 2), other: i % 6 === 0 ? 2 : 0 }))
  const summary: ActivitySummary = {
    since: start, total: buckets.reduce((n, b) => n + b.you + b.agents + b.other, 0), bucket: "hour", buckets,
    actors: [
      { kind: "you", name: "You", n: 118, last: now - 6 * MIN },
      { kind: "agent", name: "Claude Code", n: 81, last: now - MIN, session: "Plan the Lighthouse launch" },
      { kind: "cli", name: "vau CLI", n: 9, last: now - 25 * MIN },
      { kind: "disk", name: "On disk", n: 6, last: now - 2 * HOUR },
    ],
    files: [
      { path: "Notes/Idea.md", n: 34, last: now - 6 * MIN, actors: ["You"] },
      { path: "Projects/Lighthouse.md", n: 22, last: now - MIN, actors: ["Claude Code", "You"] },
      { path: "People/Alice Park.md", n: 5, last: now - 48 * MIN, actors: ["Claude Code"] },
      { path: "People/Bob Lee.md", n: 2, last: now - 2 * HOUR, actors: ["On disk"] },
    ],
  }

  const minutes: Minute[] = Array.from({ length: 1440 }, (_, i) => {
    const n = Math.max(0, Math.round(8 + 6 * Math.sin(i / 90) + ((i * 7) % 5)))
    return { t: now - (1440 - i) * MIN, n, errors: i % 211 === 0 ? 1 : 0, p50: 6, p95: 20 + ((i * 13) % 40) + (i % 300 === 0 ? 180 : 0), max: 90, lag: 12, lagMax: 30, rss: 180, heap: 70 }
  })
  const perf: Perf = {
    now, uptime: 3 * 86400 + 5 * 3600, node: "v24.1.0", pid: 4242, rss: 184, heap: 72,
    lag: { p50: 10.2, p99: 14.8, max: 41 }, requests: 18_422, errors: 7, syncs: 9_310,
    routes: [
      { route: "state", n: 412, errors: 0, avg: 38, p50: 31, p95: 84, max: 240 },
      { route: "file", n: 1280, errors: 2, avg: 9, p50: 6, p95: 22, max: 130 },
      { route: "render", n: 96, errors: 0, avg: 54, p50: 40, p95: 160, max: 410 },
      { route: "claude-code", n: 180, errors: 0, avg: 120, p50: 95, p95: 300, max: 820 },
      { route: "people/*", n: 22, errors: 0, avg: 12, p50: 10, p95: 25, max: 31 },
    ],
    slow: [
      { t: now - 48 * MIN, method: "POST", route: "interactions", ms: 412, status: 200, who: "Claude Code" },
      { t: now - 3 * HOUR, method: "GET", route: "claude-code", ms: 820, status: 200, who: "You" },
    ],
    minutes,
    clients: [
      { device: "desktop", t: now - 40_000, ttfb: 12, ready: 180, load: 260, state: 42, longTasks: 2, longMs: 140, heap: 96,
        api: [{ route: "state", n: 3, p50: 45, max: 61 }, { route: "file", n: 14, p50: 8, max: 30 }] },
      { device: "phone", t: now - 20 * MIN, ttfb: 90, ready: 640, load: 910, state: 180, longTasks: 0, longMs: 0,
        api: [{ route: "state", n: 1, p50: 180, max: 180 }] },
    ],
  }
  // A day as its recap file would say it.
  const day = (n: number) => { const d = new Date(now - n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
  const { entries } = parseRecap([
    "- 08:40 Completed \"Book the venue\" · [[Projects/Open|Open]] → [[Projects/Closed|Closed]]",
    "- 09:12 Captured [[Bookmarks/Designing calm software|Designing calm software]] · Raindrop",
    "  > Calm software asks for attention only when it matters.",
    "- 11:02 Edited [[Notes/Lighthouse launch|Lighthouse launch]] · 3 changes",
    "  > The launch moves to the week after the review, so Alice Park can join.",
    "- 14:20 Captured [[Transcripts/Call with Alice|Call with Alice]] · Transcripts",
    "  > We agreed to keep the first version small.",
    "- 15:05 Claude Code changed 4 files · Plan the Lighthouse launch",
    "  - [[Projects/Lighthouse|Lighthouse]]",
    "  - [[Notes/Launch checklist|Launch checklist]]",
    "- 17:05 Cancelled \"Print the flyers\" · [[Projects/Open|Open]]",
    "  > Reason: the venue has screens",
    "- 18:30 Logged [[Logs/Running/Evening run|Evening run]]",
  ].join("\n"))
  const recap = { days: [{ date: day(0), entries, live: true }] }
  const counts = { from: day(69), to: day(0), days: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [day(i), i % 7 === 5 ? {} : { notes: 2 + (i * 7) % 9, tasks: (i * 3) % 4, captures: i % 3, logs: i % 2 }])) }
  return { activity: list, "activity/summary": summary, "activity/perf": perf, "activity/recap": recap, "activity/recap/counts": counts }
}
