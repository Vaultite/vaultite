import { z } from "zod"

const opt = { s: z.string().optional(), n: z.number().optional() }
export const ActorRow = z.object({ kind: z.enum(["you", "agent", "cli", "script", "disk"]), name: z.string(), device: opt.s, terminal: opt.s, session: opt.s, sessionId: opt.s })
const ACTIONS = ["edit", "create", "delete", "move", "save", "settings", "pin", "ui", "read", "search", "run", "open", "command", "drop", "change", "request", "failed"] as const
export const ActivityRow = z.object({ id: z.string(), t: z.number(), last: opt.n, count: opt.n, actor: ActorRow, action: z.enum(ACTIONS), text: z.string(),
  paths: z.array(z.string()).optional(), wrote: z.array(z.string()).optional(), method: opt.s, route: opt.s, status: opt.n, ms: opt.n })
const n = z.number()
export const MinuteRow = z.object({ t: n, n, errors: n, p50: n, p95: n, max: n, lag: n, lagMax: n, rss: n, heap: n })
