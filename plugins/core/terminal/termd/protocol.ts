import { z } from "zod"
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

const CaptureFormat = z.enum(["text", "vt", "html"])
export type CaptureFormat = z.infer<typeof CaptureFormat>
export type Capture = { text: string; cols: number; rows: number; cursor: { x: number; y: number }; alternate: boolean
  /** The cursor's line (an agent's input): `suggested` is what's dim or grey (a suggested reply). */
  input?: { line: string; typed: string; suggested: string } }

const Meta = z.record(z.string(), z.string())
const Id = z.string().min(1)

const request = <O extends string, F extends Record<string, z.ZodType>>(op: O, fields: F) => z.object({ op: z.literal(op), re: z.number().optional(), ...fields })

export const Request = z.discriminatedUnion("op", [
  request("hello", {}),
  request("subscribe", {}),
  request("status-drop", { id: Id }),
  request("access", { path: z.string() }),
  request("create", { id: Id, file: z.string(), args: z.union([z.array(z.string()), z.string()]).default([]), cwd: z.string().default(""),
    env: z.record(z.string(), z.string()).default({}), shell: z.string().default(""), cols: z.number().optional(), rows: z.number().optional(),
    scrollback: z.number().optional(), spare: z.boolean().default(false), command: z.string().optional(), meta: Meta.optional() }),
  request("rename", { id: Id, to: z.string(), command: z.string().optional(), meta: Meta.optional() }),
  request("set", { id: Id, meta: z.record(z.string(), z.string().nullable()) }),
  request("kill", { id: Id, signal: z.string().optional() }),
  request("list", { ended: z.boolean().optional() }),
  request("get", { id: Id }),
  request("capture", { id: Id, format: CaptureFormat.default("text"), lines: z.union([z.number(), z.literal("all")]).optional() }),
  request("forget", { id: Id }),
  request("attach", { id: Id }),
  request("snapshot", {}),
  request("input", { id: Id.optional(), b64: z.string(), paste: z.boolean().optional() }),
  request("keys", { id: Id, keys: z.array(z.string()) }),
  request("resize", { cols: z.number(), rows: z.number(), cw: z.number().optional(), ch: z.number().optional() }),
  request("adopt", { socket: z.string(), scrollback: z.number() }),
])
export type Request = z.output<typeof Request>
export type Op = Request["op"]
export type Params<O extends Op> = Omit<Extract<z.input<typeof Request>, { op: O }>, "op" | "re">

type Answers = {
  hello: { v: number; pid: number; file: string; stale: boolean; pictures?: boolean }
  subscribe: {}
  "status-drop": {}
  access: { ok: boolean; code?: string }
  create: { info: Info }
  rename: { info: Info }
  set: { info: Info }
  kill: {}
  list: { sessions: Info[]; ended?: Info[] }
  get: { info: Info }
  capture: Capture & { ended?: boolean }
  forget: {}
  attach: { cols: number; rows: number }
  snapshot: { data: string }
  input: {}
  keys: {}
  resize: never
  adopt: { adopted: string[] }
}
export type Answer<O extends Op> = Answers[O]

/** `retiring`: this server's files are gone and it's ending, so the next one should be asked. */
export type FailureCode = "retiring"
export class Failure extends Error {
  code?: FailureCode
  constructor(message: string, code?: FailureCode) {
    super(message)
    this.code = code
  }
}

export type Reply = { re: number } & (Answers[Op] | { error: string; code?: FailureCode })

export type Unasked =
  | { t: "data"; d: string }
  | { t: "size"; cols: number; rows: number }
  | { t: "exit"; code: number; signal: number; lost?: boolean }
  | ({ t: "event" } & Event)
