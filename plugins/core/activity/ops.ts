import { localDate, localTime } from "../../../core/plugins.ts"
import { ACTION_KINDS, type ActivityList, type FileSession, type Perf } from "./model.ts"
import { profile, type Profiled } from "./profile.ts"
import { fileSessions, query } from "./reading.ts"
import { plugin } from "./store.ts"
import { perf } from "./timings.ts"

plugin.op({
  id: "activity.list",
  cli: "activity",
  summary: "What was done to the vault and the app, and by whom (you, coding agents, the CLI, scripts, changes on disk), newest first.",
  help: `One line each: when, who (an agent with its terminal's session name), what. Runs of the same thing (an editor's
autosaves) are one line with a count. Kept on the server's machine for keep_days (default 14).

  vau activity                       the last 30 things done
  vau activity --actor agent         only coding agents (Claude Code, Codex...)
  vau activity --action changes      only changes (edits, new files, moves, deletes, saves, on disk)
  vau activity --path Notes/Idea.md  everything done to one file
  vau activity --action failed       calls an agent, the CLI or a script got wrong, and why`,
  kind: "read",
  params: {
    limit: { type: "integer", minimum: 1, maximum: 500, default: 30, description: "at most this many events" },
    actor: { type: "string", enum: ["you", "agent", "cli", "script", "disk"], description: "only this kind of actor" },
    action: { type: "string", description: `only these kinds of action, comma-separated: ${ACTION_KINDS.map((k) => k.id).join(", ")}, or an action (edit, open, run...)` },
    name: { type: "string", description: "only this actor (\"Claude Code\", \"You\")" },
    path: { type: "string", format: "path", description: "only what was done to this file" },
  },
  run: (p) => query(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))),
  text: (r: ActivityList) => {
    let last = ""
    const lines: string[] = []
    for (const e of r.events) {
      const d = new Date(e.t).toDateString()
      if (d !== last) { last = d; lines.push(`${lines.length ? "\n" : ""}${d}`) }
      const who = `${e.actor.name}${e.actor.device ? ` (${e.actor.device})` : ""}${e.actor.session ? ` [${e.actor.session}]` : ""}`
      lines.push(`  ${localTime(e.t)}  ${who}: ${e.text}${(e.count ?? 1) > 1 ? ` (x${e.count})` : ""}${e.status && e.status >= 400 ? ` [${e.status}]` : ""}`)
    }
    return lines.length ? lines.join("\n") : "Nothing recorded yet."
  },
})

plugin.op({
  id: "activity.sessions",
  cli: "sessions",
  summary: "The coding agents' sessions that changed a file, newest first: title, agent, when, whether it still runs, and its terminal to open or resume.",
  help: `From the edits Activity kept (keep_days, default 14): one line per session, by its agent's session id. A running
one's terminal opens with vau terminal open <terminal>; an ended one resumes with vau terminal resume <session id>.

  vau sessions Notes/Idea.md`,
  kind: "read",
  args: ["path"],
  params: {
    path: { type: "string", format: "path", required: true, description: "the file" },
    days: { type: "integer", minimum: 1, maximum: 31, default: 30, description: "how far back" },
  },
  run: async ({ path: p, days }) => ({ sessions: await fileSessions(p, days) }),
  text: (r: { sessions: FileSession[] }) => r.sessions.map((s) => `${localDate(s.last)} ${localTime(s.last)}  ${s.agent}${s.title ? ` "${s.title}"` : ""}: ${s.n} change${s.n === 1 ? "" : "s"}, ${s.live ? `running in ${s.terminal}` : "ended"}${s.sessionId ? `, session ${s.sessionId}` : ""}`).join("\n") || "No agent's session changed it lately.",
})

plugin.op({
  id: "activity.perf",
  cli: "perf",
  summary: "How fast the server answers: its routes' and operations' timings, slow requests, memory, event loop delay, the app's load times.",
  help: `Timings since the server started (per route: count, average, p50, p95, max), the slowest recent requests, and
what each app window last reported (load, /api/state, long tasks).

  vau perf
  vau perf --routes 30`,
  kind: "read",
  params: {
    routes: { type: "integer", minimum: 1, default: 15, description: "how many routes to list, the busiest first" },
    minutes: { type: "integer", minimum: 10, maximum: 1440 * 7, default: 60, description: "the window for the per-minute timings" },
  },
  run: ({ routes, minutes }) => { const p = perf(minutes); return { ...p, routes: p.routes.slice(0, routes) } },
  text: (p: Perf) => {
    const pad = (s: string | number, w: number) => String(s).padStart(w)
    const out = [
      `Up ${Math.round(p.uptime / 60)} min, Node ${p.node}, ${p.rss} MB (heap ${p.heap} MB), event loop p99 ${p.lag.p99} ms`,
      `${p.requests} requests${p.errors ? `, ${p.errors} failed` : ""}, ${p.syncs} vault syncs`, "",
      `${"route".padEnd(34)} ${pad("n", 6)} ${pad("avg", 7)} ${pad("p50", 7)} ${pad("p95", 7)} ${pad("max", 7)}`,
      ...p.routes.map((r) => `${r.route.slice(0, 34).padEnd(34)} ${pad(r.n, 6)} ${pad(r.avg, 7)} ${pad(r.p50, 7)} ${pad(r.p95, 7)} ${pad(r.max, 7)}`),
    ]
    if (p.timings.length) {
      out.push("", `${"timings (ms)".padEnd(18)} ${pad("n", 4)} ${pad("p50", 7)} ${pad("p95", 7)} ${pad("last", 7)}  the last one's parts`)
      for (const s of p.timings) {
        const parts = Object.entries(s.last.parts).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ")
        const tags = Object.entries(s.last.tags ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ")
        out.push(`${s.name.padEnd(18)} ${pad(s.n, 4)} ${pad(Math.round(s.p50), 7)} ${pad(Math.round(s.p95), 7)} ${pad(Math.round(s.last.ms), 7)}  ${parts}${tags ? ` (${tags})` : ""}`)
      }
    }
    if (p.slow.length) out.push("", "Slow requests:", ...p.slow.slice(0, 8).map((s) => `  ${localTime(s.t)}  ${s.method} /api/${s.route}  ${s.ms} ms  (${s.who})`))
    if (p.clients.length) out.push("", "The app:", ...p.clients.map((x) => `  ${x.device}: load ${x.load ?? "?"} ms, state ${x.state ?? "?"} ms, ${x.longTasks ?? 0} long tasks, ${x.shifts ?? 0} layout shifts (${x.shift ?? 0})`))
    return out.join("\n")
  },
})

plugin.op({
  id: "activity.profile",
  cli: "profile",
  summary: "Profile the server's CPU for a while as it runs: the functions its time went to, and the profile saved for DevTools.",
  help: `Samples the running server (no restart) for some seconds, then lists the functions that took its main thread's
time: their own ms and with what they called. Do what's slow meanwhile (open the app, run the agent). The profile is
kept on this machine (the last 10); Chrome's DevTools opens it (Performance, Load profile).

  vau profile
  vau profile --seconds 60 --top 40`,
  kind: "read",
  owner: "profiling the server",
  params: {
    seconds: { type: "integer", minimum: 1, maximum: 120, default: 15, description: "how long to sample" },
    top: { type: "integer", minimum: 5, maximum: 200, default: 25, description: "how many functions to list, by their own time" },
  },
  run: ({ seconds, top }) => profile(seconds, top),
  text: (p: Profiled) => {
    const pad = (s: string | number, w: number) => String(s).padStart(w)
    return [`${p.seconds} s sampled: the main thread was busy ${p.busy} ms (${Math.round(p.busy / p.seconds / 10)}%).`, `Saved: ${p.file}`, "",
      `${pad("self ms", 8)} ${pad("total", 8)}  function`,
      ...p.hot.map((h) => `${pad(h.self, 8)} ${pad(h.total, 8)}  ${h.fn}${h.at ? `  ${h.at}` : ""}`)].join("\n")
  },
})
