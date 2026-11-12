// What app.version and app.update answer, and what the desktop app says of its own updates (app:updates). The server,
// the web app, the desktop app and vau may each run another build, so the side that receives one parses it here.
import { z } from "zod"

const Sha = z.string()

export const CiState = z.enum(["passed", "failed", "running", "none", "cancelled"])
export type CiState = z.infer<typeof CiState>

/** What CI said of a commit asked about; ok null is not yet. */
export const Judged = z.object({ commit: Sha, ok: z.boolean().nullable(), state: CiState.optional() })
export type Judged = z.infer<typeof Judged>

export const Blocked = z.object({ by: z.enum(["uncommitted", "unpushed", "diverged", "branch"]), files: z.array(z.string()).optional(), commits: z.array(Sha).optional() })
export type Blocked = z.infer<typeof Blocked>

export const UpdateStatus = z.object({
  branch: z.string().nullable(),
  state: z.enum(["off", "current", "waiting", "updating", "failed"]),
  why: z.string(),
  checked: z.number().nullable(),
  /** A look is under way (`vau update` joins it). */
  looking: z.boolean().optional(),
  /** What it runs: the commit it started on, moved on by an update needing no restart. */
  running: Sha.optional(),
  /** origin's commit of the branch at the last look. */
  origin: Sha.optional(),
  /** The branch's newer commit, while waiting for it. */
  next: Sha.optional(),
  blocked: Blocked.optional(),
  /** While it waits on CI, the tip first (git.ts' redRoute reads it). */
  ci: z.array(Judged).optional(),
  /** `elsewhere`: the CI jobs that had failed on it besides this OS's (which passed) when it was taken. */
  last: z.object({ from: Sha, to: Sha, at: z.number(), restarted: z.boolean(), elsewhere: z.array(z.string()).optional() }).optional(),
  /** It isn't tried again until the branch moves on. */
  error: z.object({ at: z.number(), commit: Sha, message: z.string() }).optional(),
})
export type UpdateStatus = z.infer<typeof UpdateStatus>
export type UpdateState = UpdateStatus["state"]

const Root = z.object({ from: z.string(), commit: Sha.nullable(), fellBack: z.object({ commit: Sha.nullable(), why: z.string() }).optional() })

/** The desktop app's updates (electron/updates.ts appUpdates), asked by the server it runs or is attached to. */
export const AppUpdates = z.object({
  mode: z.enum(["automatic", "notify", "off"]),
  available: z.boolean(),
  from: z.string(),
  ready: Sha.nullable(),
  doing: z.string().nullable(),
  commit: Sha.nullable().optional(),
  worktree: z.object({ worktree: z.string(), branch: z.string(), commit: Sha, dirty: z.boolean() }).optional(),
  helper: z.boolean().optional(),
  /** Main's updates through the root store (electron/storehost.ts). */
  store: z.object({ state: z.string(), why: z.string(), running: Sha.optional(), last: z.object({ from: Sha, to: Sha, at: z.number() }).optional() }).optional(),
  how: z.enum(["install", "relaunch"]).optional(),
  /** Why the main process runs older code, while its relaunch waits. */
  behind: z.string().optional(),
  /** The code root this launch runs, and after a fallback the one it didn't and why. */
  root: Root.optional(),
})
export type AppUpdates = z.infer<typeof AppUpdates>

/** A process and whether it runs older code: what it reaches (core/update/closure.ts, `id` its entry) changed since the
 *  commit it started on (`first`: the changed file nearest it, `chain` how it reaches it). Null: can't say (`why`). */
export const Process = z.object({ id: z.string(), label: z.string(), commit: Sha.nullable(), stale: z.boolean().nullable(), first: z.string().optional(),
  chain: z.array(z.string()).optional(), why: z.string().optional() })
export type Process = z.infer<typeof Process>

/** Whether a commit is live, and when not, whether that can still change by itself (`final`: it can't). */
export const Verdict = z.object({
  commit: Sha,
  live: z.boolean(),
  final: z.boolean(),
  /** One sentence: the output's last line. */
  why: z.string(),
  /** never: not by itself; pending: asked without waiting; timeout: waited all it may; unreachable: its server didn't answer. */
  outcome: z.enum(["live", "never", "pending", "timeout", "unreachable"]),
  /** With wait: the seconds it waited, across the server's restarts. */
  waited: z.number().optional(),
  /** CI failed on this commit (it, or the newest commit with it): it goes live only with a fix. */
  red: Sha.optional(),
})
export type Verdict = z.infer<typeof Verdict>

/** What a server runs and its updates: app.version's answer (with `live` when asked about a commit, `machine` when
 *  another's). Loose: a newer server's fields pass through. */
export const VersionHere = z.looseObject({
  version: z.string(),
  api: z.number(),
  /** null: unknown, neither a checkout nor a packaged app. */
  commit: Sha.nullable(),
  subject: z.string().optional(),
  at: z.number().optional(),
  branch: z.string().nullable(),
  /** The web app's build served: its entry script and commit (null: not stamped, or none built). Older servers: none. */
  web: z.object({ entry: z.string().nullable(), commit: Sha.nullable() }).optional(),
  pid: z.number(),
  started: z.number(),
  updates: UpdateStatus,
  /** null: not in a desktop app; unknown: an older app that didn't say. */
  app: z.union([AppUpdates, z.literal("unknown"), z.null()]),
  /** Older servers: none. */
  processes: z.array(Process).optional(),
  live: Verdict.optional(),
  machine: z.string().optional(),
})
export type VersionHere = z.infer<typeof VersionHere>

/** Another machine's answer passed on: only its verdict is read (it may run an older build, or have stayed down). */
export const Relayed = z.looseObject({ machine: z.string(), live: Verdict.optional() })

export const Version = z.union([VersionHere, Relayed])
export type Version = z.infer<typeof Version>
export const isHere = (v: Version): v is VersionHere => VersionHere.safeParse(v).success
