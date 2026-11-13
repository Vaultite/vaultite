import { z } from "zod"
import type { Said as Told } from "../osc7501.ts"

/** 1 ptyd.ts, the keeper before; 2 termd with xterm.js; 3 before pictures; 4 screens on its loop (one stuck froze all). */
export const PROTOCOL = 5

const Meta = z.record(z.string(), z.string())
const Id = z.string().min(1)

const Exit = z.object({ code: z.number(), signal: z.number(), at: z.number(),
  /** The server holding it went away first, so how it ended is unknown. */
  lost: z.boolean().optional() })
export type Exit = z.infer<typeof Exit>

const Status = z.object({ state: z.enum(["idle", "working", "blocked", "done", "error"]), kind: z.enum(["permission", "question", "auth"]).optional(),
  msg: z.string().optional(), app: z.string().optional() })
const Said: z.ZodType<Told> = z.object({ seen: z.boolean(), status: Status.nullable() })

const Info = z.object({
  id: z.string(), pid: z.number(), shell: z.string(), process: z.string(), cwd: z.string(), command: z.string(), created: z.number(), activity: z.number(), title: z.string(),
  cols: z.number(), rows: z.number(), clients: z.number(), spare: z.boolean(), meta: Meta, said: Said, exit: Exit.optional(),
  /** The pid of an older server it's held through. */
  via: z.number().optional(),
})
export type Info = z.infer<typeof Info>

const event = <T extends string, F extends Record<string, z.ZodType>>(type: T, fields: F) => z.object({ t: z.literal("event"), type: z.literal(type), id: z.string(), ...fields })
const EventMessage = z.discriminatedUnion("type", [
  event("started", { info: Info }),
  event("renamed", { to: z.string() }),
  event("exited", { exit: Exit }),
  event("status", { said: Said }),
  event("title", { title: z.string() }),
  event("meta", { meta: Meta }),
  event("size", { cols: z.number(), rows: z.number() }),
  event("clients", { clients: z.number() }),
  /** `id` "": the server's own. */
  event("trouble", { text: z.string() }),
])
type WithoutT<M> = M extends unknown ? Omit<M, "t"> : never
export type Event = WithoutT<z.infer<typeof EventMessage>>

const CaptureFormat = z.enum(["text", "vt", "html"])
export type CaptureFormat = z.infer<typeof CaptureFormat>
const Capture = z.object({ text: z.string(), cols: z.number(), rows: z.number(), cursor: z.object({ x: z.number(), y: z.number() }), alternate: z.boolean(),
  /** The cursor's line (an agent's input): `suggested` is what's dim or grey (a suggested reply). */
  input: z.object({ line: z.string(), typed: z.string(), suggested: z.string() }).optional() })
export type Capture = z.infer<typeof Capture>

export const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "it"} ${i.message}`).join("; ")

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

const Empty: z.ZodType<{}> = z.object({})
const InfoAnswer = z.object({ info: Info })
const answers = {
  hello: z.object({ v: z.number(), pid: z.number(), file: z.string(), stale: z.boolean(), pictures: z.boolean().optional() }),
  subscribe: Empty,
  "status-drop": Empty,
  access: z.object({ ok: z.boolean(), code: z.string().optional() }),
  create: InfoAnswer,
  rename: InfoAnswer,
  set: InfoAnswer,
  kill: Empty,
  list: z.object({ sessions: z.array(Info), ended: z.array(Info).optional() }),
  get: InfoAnswer,
  capture: Capture.extend({ ended: z.boolean().optional() }),
  forget: Empty,
  attach: z.object({ cols: z.number(), rows: z.number() }),
  snapshot: z.object({ data: z.string() }),
  input: Empty,
  keys: Empty,
  resize: z.never(),
  adopt: z.object({ adopted: z.array(z.string()) }),
} satisfies Record<Op, z.ZodType>
export type Answer<O extends Op> = z.infer<(typeof answers)[O]>
type AnswerSchemas = { [O in Op]: z.ZodType<Answer<O>> }
export const Answers: AnswerSchemas = answers

/** `retiring`: this server's files are gone and it's ending, so the next one should be asked. */
export type FailureCode = "retiring"
export class Failure extends Error {
  code?: FailureCode
  constructor(message: string, code?: FailureCode) {
    super(message)
    this.code = code
  }
}

export type Reply = { re: number } & (Answer<Op> | { error: string; code?: FailureCode })

export const Unasked = z.discriminatedUnion("t", [
  z.object({ t: z.literal("data"), d: z.string() }),
  z.object({ t: z.literal("size"), cols: z.number(), rows: z.number() }),
  z.object({ t: z.literal("exit"), code: z.number(), signal: z.number(), lost: z.boolean().optional() }),
  EventMessage,
])
export type Unasked = z.infer<typeof Unasked>
