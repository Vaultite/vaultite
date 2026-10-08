// Activity's data as its routes answer it (plugin.ts writes it, index.tsx and cli.ts read it). Types, and the kinds of
// action to filter by, with no imports, so both sides can import this file.

/** Who did something: `you` (the app), `agent` (a coding agent), `cli` (vau with no agent above it), `script` (anything
 *  else calling the API), `disk` (a change no request made: iCloud, another app, an agent's own file tools). */
export type ActorKind = "you" | "agent" | "cli" | "script" | "disk"
export type Actor = {
  kind: ActorKind
  /** "You", "Claude Code", "vau CLI", "curl", "On disk". */
  name: string
  /** For `you`: desktop, web or phone. */
  device?: string
  /** The terminal it runs in, when it's one of the app's (`view:terminal/<terminal>` opens it), and that terminal's
   *  title (a Claude Code session's name). */
  terminal?: string
  session?: string
}

/** What was done; `ui` is an agent driving the app, `run` a shell command an agent ran, `request` anything else. */
export type Action = "edit" | "create" | "delete" | "move" | "save" | "settings" | "pin" | "ui" | "read" | "search" | "run"
  | "open" | "command" | "drop" | "change" | "request"

/** What was done, in a few kinds to filter by (the panel's and the feed's What, `?action=` and `vau activity --action`):
 *  each a list of actions. */
export const ACTION_KINDS = [
  { id: "changes", label: "Changes", actions: ["edit", "create", "delete", "move", "save", "change"] },
  { id: "opens", label: "Opens and reads", actions: ["open", "read", "search"] },
  { id: "commands", label: "Commands", actions: ["command", "run", "ui", "drop"] },
  { id: "settings", label: "Settings", actions: ["settings", "pin"] },
  { id: "other", label: "Other requests", actions: ["request"] },
] as const satisfies readonly { id: string; label: string; actions: readonly Action[] }[]
export type ActionKind = typeof ACTION_KINDS[number]["id"]

/** The actions `q` names (comma-separated kinds from ACTION_KINDS or actions), or null for every one. */
export function actionsOf(q: string | undefined): Set<string> | null {
  const names = (q ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  if (!names.length) return null
  return new Set(names.flatMap((n) => ACTION_KINDS.find((k) => k.id === n)?.actions ?? [n]))
}

export type ActivityEvent = {
  id: string
  /** When it started, and when the last of a run of the same thing happened (ms). */
  t: number
  last?: number
  /** How many times in a row (an editor's autosaves, 12 edits to one file in a minute): 1 when absent. */
  count?: number
  actor: Actor
  action: Action
  /** One line, as the app words things: "Edited Notes/Idea.md", "Logged Morning run". */
  text: string
  /** Vault paths it touched (from the request, or the files that changed on disk while it ran). */
  paths?: string[]
  /** For API requests: method, route (under /api/), status, duration (ms). */
  method?: string
  route?: string
  status?: number
  ms?: number
}

export type ActivityList = { events: ActivityEvent[]; total: number }

export type ActorCount = { kind: ActorKind; name: string; n: number; last: number; terminal?: string; session?: string }
export type ActivitySummary = {
  /** From when (ms), and how many events since. */
  since: number
  total: number
  /** Who, most active first. */
  actors: ActorCount[]
  /** One bucket per hour (days = 1) or per day, oldest first: events by you, by agents, by everything else. */
  buckets: { t: number; you: number; agents: number; other: number }[]
  bucket: "hour" | "day"
  /** The files touched most, with who touched them. */
  files: { path: string; n: number; last: number; actors: string[] }[]
}

export type RouteStat = { route: string; n: number; errors: number; avg: number; p50: number; p95: number; max: number }
export type Minute = { t: number; n: number; errors: number; p50: number; p95: number; max: number
  /** Event loop delay this minute (ms): p99 and max; memory (MB). */
  lag: number; lagMax: number; rss: number; heap: number }
export type SlowRequest = { t: number; method: string; route: string; ms: number; status: number; who: string }
/** What an app window reports about itself (POST /api/activity/perf), the latest per device. */
export type ClientPerf = {
  device: string; t: number
  /** Its last load: time to first byte, DOM ready, load, and /api/state (ms). */
  ttfb?: number; ready?: number; load?: number; state?: number
  /** Long tasks (the main thread busy over 50 ms) since the last report, and their total time. */
  longTasks?: number; longMs?: number
  /** Layout shifts since the report before (what moved without the user moving it): summed like CLS, and how many. */
  shift?: number; shifts?: number
  /** Its API calls since the last report, by route: count, median and slowest (ms, as the app saw them: the network
   *  included). */
  api?: { route: string; n: number; p50: number; max: number }[]
  /** JS heap in use (MB; Chromium only). */
  heap?: number
}
export type Perf = {
  now: number; uptime: number; node: string; pid: number
  rss: number; heap: number
  /** Event loop delay over the last minute (ms). */
  lag: { p50: number; p99: number; max: number }
  /** Requests since the server started. */
  requests: number; errors: number
  /** Syncs of the vault since the server started (each request, each change on disk). */
  syncs: number
  routes: RouteStat[]
  slow: SlowRequest[]
  /** One per minute, oldest first (the last `minutes`, default 24 h). */
  minutes: Minute[]
  clients: ClientPerf[]
}
