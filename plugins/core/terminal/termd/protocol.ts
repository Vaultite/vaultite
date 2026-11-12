// What the terminal server (termd.ts) and its clients (backend.ts) say: newline JSON over a Unix socket or named pipe. A
// request is {op, re, ...}, its answer {re, ...} or {re, error}; a message unasked {t}. Types only (termd loads it too).
import type { Said } from "../osc7501.ts"

/** The protocol, in its socket's name: a server speaking another takes over the older one's terminals (adopt.ts).
 *  1 ptyd.ts, the keeper before; 2 termd with xterm.js; 3 before pictures; 4 screens on its loop (one stuck froze all). */
export const PROTOCOL = 5

/** How a terminal's program ended: its exit code, or the signal that ended it (0: none). `lost`: the server holding it
 *  went away first, so how it ended is unknown. */
export type Exit = { code: number; signal: number; at: number; lost?: boolean }

/** A terminal as the server holds it. `meta`: what the app keeps with it (`name`, `note`); `command`: what it was started
 *  to run; `process`: what runs in front; `clients`: connections attached; `said`: OSC 7501; `exit`: once it ended. */
export type Info = {
  id: string; pid: number; shell: string; process: string; cwd: string; command: string; created: number; activity: number; title: string
  cols: number; rows: number; clients: number; spare: boolean; meta: Record<string, string>; said: Said; exit?: Exit
  /** Held through an older server it took over (adopt.ts): that server's pid. */
  via?: number
}

/** What changed, to the connections that subscribed (`subscribe`), as {t: "event", ...Event}. */
export type Event =
  | { type: "started"; id: string; info: Info }
  | { type: "renamed"; id: string; to: string }
  | { type: "exited"; id: string; exit: Exit }
  | { type: "status"; id: string; said: Said }
  | { type: "title"; id: string; title: string }
  | { type: "meta"; id: string; meta: Record<string, string> }
  | { type: "size"; id: string; cols: number; rows: number }
  | { type: "clients"; id: string; clients: number }
  /** Something went wrong the app should hear of (its errors): one terminal's (a screen stuck), or ("") the server's. */
  | { type: "trouble"; id: string; text: string }

/** A capture's form: plain text (wrapped lines joined), the terminal's own sequences (colors, the cursor: replayed, it
 *  draws the screen again), or HTML. */
export type CaptureFormat = "text" | "vt" | "html"
export type Capture = { text: string; cols: number; rows: number; cursor: { x: number; y: number }; alternate: boolean
  /** The cursor's line (an agent's input): all of it, what's drawn plainly, and what's dim or grey (a suggested reply). */
  input?: { line: string; typed: string; suggested: string } }

/** What `create` starts: the program and its pty, and what the app keeps with it. */
export type Create = { id: string; file: string; args: string[] | string; cwd: string; env: Record<string, string>; shell: string; cols: number; rows: number
  scrollback: number; spare: boolean; command?: string; meta?: Record<string, string> }

/** Each request's fields and its answer ({re, ...answer}; a failure answers {re, error} instead). */
export type Requests = {
  hello: [{}, { v: number; pid: number; file: string; stale: boolean; pictures?: boolean }]
  subscribe: [{}, {}]
  "status-drop": [{ id: string }, {}]
  access: [{ path: string }, { ok: boolean; code?: string }]
  create: [Create, { info: Info }]
  rename: [{ id: string; to: string; command?: string; meta?: Record<string, string> }, { info: Info }]
  set: [{ id: string; meta: Record<string, string | null> }, { info: Info }]
  kill: [{ id: string; signal?: string }, {}]
  list: [{ ended?: boolean }, { sessions: Info[]; ended?: Info[] }]
  get: [{ id: string }, { info: Info }]
  capture: [{ id: string; format: CaptureFormat; lines?: number | "all" }, Capture & { ended?: boolean }]
  forget: [{ id: string }, {}]
  attach: [{ id: string }, { cols: number; rows: number }]
  snapshot: [{}, { data: string }]
  input: [{ id?: string; b64: string; paste?: boolean }, {}]
  keys: [{ id: string; keys: string[] }, {}]
  resize: [{ cols: number; rows: number; cw?: number; ch?: number }, never]
  adopt: [{ socket: string; scrollback: number }, { adopted: string[] }]
}
export type Op = keyof Requests
export type Params<O extends Op> = Requests[O][0]
export type Answer<O extends Op> = Requests[O][1]

/** What the server sends a connection unasked: its attached terminal's output, size and end; events once subscribed. */
export type Unasked =
  | { t: "data"; d: string }
  | { t: "size"; cols: number; rows: number }
  | { t: "exit"; code: number; signal: number; lost?: boolean }
  | ({ t: "event" } & Event)
