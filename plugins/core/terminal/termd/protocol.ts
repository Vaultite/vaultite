import type { Said } from "../osc7501.ts"

/** 1 ptyd.ts, the keeper before; 2 termd with xterm.js; 3 before pictures; 4 screens on its loop (one stuck froze all). */
export const PROTOCOL = 5

/** `lost`: the server holding it went away first, so how it ended is unknown. */
export type Exit = { code: number; signal: number; at: number; lost?: boolean }

export type Info = {
  id: string; pid: number; shell: string; process: string; cwd: string; command: string; created: number; activity: number; title: string
  cols: number; rows: number; clients: number; spare: boolean; meta: Record<string, string>; said: Said; exit?: Exit
  /** The pid of an older server it's held through. */
  via?: number
}

export type Event =
  | { type: "started"; id: string; info: Info }
  | { type: "renamed"; id: string; to: string }
  | { type: "exited"; id: string; exit: Exit }
  | { type: "status"; id: string; said: Said }
  | { type: "title"; id: string; title: string }
  | { type: "meta"; id: string; meta: Record<string, string> }
  | { type: "size"; id: string; cols: number; rows: number }
  | { type: "clients"; id: string; clients: number }
  /** `id` "": the server's own. */
  | { type: "trouble"; id: string; text: string }

export type CaptureFormat = "text" | "vt" | "html"
export type Capture = { text: string; cols: number; rows: number; cursor: { x: number; y: number }; alternate: boolean
  /** The cursor's line (an agent's input): `suggested` is what's dim or grey (a suggested reply). */
  input?: { line: string; typed: string; suggested: string } }

export type Create = { id: string; file: string; args: string[] | string; cwd: string; env: Record<string, string>; shell: string; cols: number; rows: number
  scrollback: number; spare: boolean; command?: string; meta?: Record<string, string> }

/** Each request's fields and its answer: {re, ...answer}, or {re, error}. */
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

export type Unasked =
  | { t: "data"; d: string }
  | { t: "size"; cols: number; rows: number }
  | { t: "exit"; code: number; signal: number; lost?: boolean }
  | ({ t: "event" } & Event)
