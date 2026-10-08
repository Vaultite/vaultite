// The Errors plugin's shapes, shared by its server side (plugin.ts) and the app's (index.tsx).

export type Source = "app" | "server"

/** One time an error happened (a line in errors-<date>.jsonl). `n`: how many times it happened since the line before
 *  for the same error (a burst is written once every few seconds, with its count). */
export type ErrorEvent = {
  /** The error's kind (its group): a hash of where it came from, its message and its first stack frame. */
  id: string
  t: number
  source: Source
  /** The app: uncaught, rejection, boundary, stopped, boot, stale (web/src/core/errors.ts). The server: error (logged),
   *  fatal (it ended the server). */
  kind: string
  message: string
  stack?: string
  /** React's component stack (the app). */
  component?: string
  fatal?: boolean
  /** The server: the request it happened in ("POST /api/file"). The app: its address, its build, which device. */
  where?: string
  url?: string
  build?: string
  device?: string
  /** What the user did just before (the app's commands, drops). */
  trail?: string[]
  n?: number
}

/** A kind of error: every time it happened, summed. */
export type ErrorGroup = {
  id: string
  source: Source
  kind: string
  message: string
  first: number
  last: number
  count: number
  /** How many of them stopped the app or the server. */
  fatal: number
  devices: string[]
  /** The latest time it happened, all of it. */
  latest: ErrorEvent
}

export type ErrorList = { groups: ErrorGroup[]; total: number; events: number; since: number }
export type ErrorDetail = { group: ErrorGroup; events: ErrorEvent[] }
