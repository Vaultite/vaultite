import { z } from "zod"

const Sha = z.string()

export const CiState = z.enum(["passed", "failed", "running", "none", "cancelled"])
export type CiState = z.infer<typeof CiState>

export const Judged = z.object({ commit: Sha, ok: z.boolean().nullable(), state: CiState.optional() })
export type Judged = z.infer<typeof Judged>

export const Blocked = z.object({ by: z.enum(["uncommitted", "unpushed", "diverged", "branch"]), files: z.array(z.string()).optional(), commits: z.array(Sha).optional() })
export type Blocked = z.infer<typeof Blocked>

export const UpdateStatus = z.object({
  branch: z.string().nullable(),
  state: z.enum(["off", "current", "waiting", "updating", "failed"]),
  why: z.string(),
  checked: z.number().nullable(),
  looking: z.boolean().optional(),
  running: Sha.optional(),
  origin: Sha.optional(),
  next: Sha.optional(),
  blocked: Blocked.optional(),
  ci: z.array(Judged).optional(),
  last: z.object({ from: Sha, to: Sha, at: z.number(), restarted: z.boolean(), elsewhere: z.array(z.string()).optional() }).optional(),
  error: z.object({ at: z.number(), commit: Sha, message: z.string() }).optional(),
})
export type UpdateStatus = z.infer<typeof UpdateStatus>
export type UpdateState = UpdateStatus["state"]

const Root = z.object({ from: z.string(), commit: Sha.nullable(), fellBack: z.object({ commit: Sha.nullable(), why: z.string() }).optional() })

export const AppUpdates = z.object({
  mode: z.enum(["automatic", "notify", "off"]),
  available: z.boolean(),
  from: z.string(),
  ready: Sha.nullable(),
  doing: z.string().nullable(),
  commit: Sha.nullable().optional(),
  worktree: z.object({ worktree: z.string(), branch: z.string(), commit: Sha, dirty: z.boolean() }).optional(),
  helper: z.boolean().optional(),
  helperCommit: Sha.nullable().optional(),
  store: z.object({ state: z.string(), why: z.string(), running: Sha.optional(), last: z.object({ from: Sha, to: Sha, at: z.number() }).optional() }).optional(),
  how: z.enum(["install", "relaunch"]).optional(),
  behind: z.string().optional(),
  root: Root.optional(),
})
export type AppUpdates = z.infer<typeof AppUpdates>

export const Process = z.object({ id: z.string(), label: z.string(), commit: Sha.nullable(), stale: z.boolean().nullable(), first: z.string().optional(),
  chain: z.array(z.string()).optional(), why: z.string().optional() })
export type Process = z.infer<typeof Process>

export const Verdict = z.object({
  commit: Sha,
  live: z.boolean(),
  final: z.boolean(),
  why: z.string(),
  outcome: z.enum(["live", "never", "pending", "timeout", "unreachable"]),
  waited: z.number().optional(),
  red: Sha.optional(),
  behind: z.object({ part: z.enum(["server", "web", "desktop", "helper"]), by: z.enum(["itself", "restart", "never"]) }).optional(),
})
export type Verdict = z.infer<typeof Verdict>

export const VersionHere = z.looseObject({
  version: z.string(),
  api: z.number(),
  commit: Sha.nullable(),
  subject: z.string().optional(),
  at: z.number().optional(),
  branch: z.string().nullable(),
  web: z.object({ entry: z.string().nullable(), commit: Sha.nullable() }).optional(),
  pid: z.number(),
  started: z.number(),
  updates: UpdateStatus,
  app: z.union([AppUpdates, z.literal("unknown"), z.null()]),
  processes: z.array(Process).optional(),
  live: Verdict.optional(),
  machine: z.string().optional(),
})
export type VersionHere = z.infer<typeof VersionHere>

export const Relayed = z.looseObject({ machine: z.string(), live: Verdict.optional() })

export const Version = z.union([VersionHere, Relayed])
export type Version = z.infer<typeof Version>
export const isHere = (v: Version): v is VersionHere => VersionHere.safeParse(v).success
