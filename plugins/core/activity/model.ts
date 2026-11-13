
export type ActorKind = "you" | "agent" | "cli" | "script" | "disk"
export type Actor = {
  kind: ActorKind
  name: string
  device?: string
  terminal?: string
  session?: string
  sessionId?: string
}

export type Action = "edit" | "create" | "delete" | "move" | "save" | "settings" | "pin" | "ui" | "read" | "search" | "run"
  | "open" | "command" | "drop" | "change" | "request" | "failed"

export const ACTION_KINDS = [
  { id: "changes", label: "Changes", actions: ["edit", "create", "delete", "move", "save", "change"] },
  { id: "opens", label: "Opens and reads", actions: ["open", "read", "search"] },
  { id: "commands", label: "Commands", actions: ["command", "run", "ui", "drop"] },
  { id: "settings", label: "Settings", actions: ["settings", "pin"] },
  { id: "other", label: "Other requests", actions: ["request"] },
  { id: "failed", label: "Failed", actions: ["failed"] },
] as const satisfies readonly { id: string; label: string; actions: readonly Action[] }[]
export type ActionKind = typeof ACTION_KINDS[number]["id"]

export function actionsOf(q: string | undefined): Set<string> | null {
  const names = (q ?? "").split(",").map((x) => x.trim()).filter(Boolean)
  if (!names.length) return null
  return new Set(names.flatMap((n) => ACTION_KINDS.find((k) => k.id === n)?.actions ?? [n]))
}

export type ActivityEvent = {
  id: string
  t: number
  last?: number
  count?: number
  actor: Actor
  action: Action
  text: string
  paths?: string[]
  wrote?: string[]
  method?: string
  route?: string
  status?: number
  ms?: number
}

export type ActivityList = { events: ActivityEvent[]; total: number }

export type ActorCount = { kind: ActorKind; name: string; n: number; last: number; terminal?: string; session?: string }
export type ActivitySummary = {
  since: number
  total: number
  actors: ActorCount[]
  buckets: { t: number; you: number; agents: number; other: number }[]
  bucket: "hour" | "day"
  files: { path: string; n: number; last: number; actors: string[] }[]
}

export type FileSession = {
  agent: string; runs?: string
  title?: string; terminal?: string; sessionId?: string
  first: number; last: number; n: number; live: boolean
}

export type RouteStat = { route: string; n: number; errors: number; avg: number; p50: number; p95: number; max: number }
export type Minute = { t: number; n: number; errors: number; p50: number; p95: number; max: number
  lag: number; lagMax: number; rss: number; heap: number }
export type SlowRequest = { t: number; method: string; route: string; ms: number; status: number; who: string }
export type ClientPerf = {
  device: string; t: number
  ttfb?: number; ready?: number; load?: number; state?: number
  longTasks?: number; longMs?: number
  shift?: number; shifts?: number
  api?: { route: string; n: number; p50: number; max: number }[]
  /** JS heap in use (MB; Chromium only). */
  heap?: number
}
export type Timing = { name: string; n: number; p50: number; p95: number; last: { t: number; ms: number; parts: Record<string, number>; tags?: Record<string, string> } }

export type Perf = {
  now: number; uptime: number; node: string; pid: number
  rss: number; heap: number
  lag: { p50: number; p99: number; max: number }
  requests: number; errors: number
  syncs: number
  routes: RouteStat[]
  slow: SlowRequest[]
  timings: Timing[]
  minutes: Minute[]
  clients: ClientPerf[]
}
