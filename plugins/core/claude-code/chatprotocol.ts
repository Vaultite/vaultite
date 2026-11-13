import { z } from "zod"
import { Entry, UserEntry } from "./chatlog.ts"

const s = z.string().optional(), b = z.boolean().optional(), strings = z.array(z.string()).optional()

export const Mode = z.enum(["default", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions"])
export type Mode = z.infer<typeof Mode>
export const MODES = Mode.options
export const modeOf = (x: string | undefined) => MODES.find((m) => m === x)
export const Effort = z.enum(["low", "medium", "high", "xhigh", "max"])
export type Effort = z.infer<typeof Effort>
export const EFFORTS = Effort.options
export const effortOf = (x: string | undefined) => EFFORTS.find((e) => e === x)

export const State = z.enum(["starting", "working", "waiting", "idle", "error"])
export type State = z.infer<typeof State>
export const Summary = z.object({
  id: z.string(), state: State, cwd: z.string(), account: z.string(), by: z.string(), model: z.string(), effort: z.string(), mode: Mode,
  started: z.number(), at: z.number(), asks: z.array(z.string()), seq: z.number(), told: z.number(),
  turn: z.object({ prompt: z.string(), text: z.string(), error: s }).nullable(),
  error: s, quiet: b,
  context: z.number().optional(),
  background: z.number(),
})
export type Summary = z.infer<typeof Summary>

/** `streams`: its input told as it's written; `ends`: a turn may end after it with no words; `endsTurn`: it ends one. */
export const ToolDef = z.object({ name: z.string(), description: z.string(), schema: z.looseObject({ properties: z.record(z.string(), z.unknown()).optional(), required: strings }),
  streams: b, ends: b,
  /** Never shown to the model: the host calls it itself (a session's `confirm`). */
  hidden: b })
export type ToolDef = z.infer<typeof ToolDef>

export const ToolResult = z.looseObject({
  content: z.array(z.discriminatedUnion("type", [z.looseObject({ type: z.literal("text"), text: z.string() }), z.looseObject({ type: z.literal("image"), data: z.string(), mimeType: z.string() })])),
  isError: b, endsTurn: b,
})
export type ToolResult = z.infer<typeof ToolResult>

export const Spec = z.object({
  id: z.string(), resume: z.boolean(), cwd: z.string(), env: z.record(z.string(), z.string()), claude: s,
  model: s, effort: Effort.optional(), mode: Mode.optional(), append: s, title: s, tools: z.array(ToolDef).optional(),
  allowed: strings, denied: strings,
  dirs: strings,
  by: s, account: s,
  quiet: b,
  quick: b,
  system: s, builtins: strings,
  texts: b,
  confirm: s,
  never: strings,
  autoMode: z.record(z.string(), z.array(z.string())).optional(),
})
export type Spec = z.infer<typeof Spec>

export const Answer = z.object({ allow: b, always: b, message: s,
  answers: z.array(z.union([z.array(z.number()), z.string(), z.object({ options: z.array(z.number()), text: z.string() })])).optional(), chat: b, mode: Mode.optional() })
export type Answer = z.infer<typeof Answer>

const id = z.string()
export type Uuid = `${string}-${string}-${string}-${string}-${string}`
const Uuid = z.custom<Uuid>((v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), "not a UUID")
const request = <O extends string, F extends Record<string, z.ZodType>>(op: O, fields: F) => z.object({ op: z.literal(op), re: z.number().optional(), ...fields })
export const Request = z.discriminatedUnion("op", [
  request("hello", {}),
  request("follow", {}),
  request("list", {}),
  request("read", { id }),
  request("start", { spec: Spec, prompt: s, images: strings, uuid: Uuid.optional() }),
  request("send", { id, text: z.string(), uuid: Uuid.optional(), images: strings }),
  request("interrupt", { id }),
  request("set", { id, model: s, effort: Effort.optional(), mode: Mode.optional() }),
  request("answer", { id, ask: z.string(), answer: Answer }),
  request("stop", { id }),
  request("forget", { id }),
  request("told", { id, seq: z.number() }),
  request("tool-result", { call: z.string(), result: z.unknown() }),
])
export type Request = z.output<typeof Request>
export type Op = Request["op"]
export type Params<O extends Op> = Omit<Extract<z.input<typeof Request>, { op: O }>, "op" | "re">

const Empty: z.ZodType<{}> = z.object({})
const Sessions = z.object({ sessions: z.array(Summary) })
const Started = z.object({ s: Summary })
const answers = {
  hello: z.object({ v: z.number(), pid: z.number(), file: s, stale: b, code: s }),
  follow: Sessions,
  list: Sessions,
  read: z.object({ s: Summary, entries: z.array(Entry) }),
  start: Started,
  send: z.object({ uuid: z.string(), answered: s }),
  interrupt: z.object({ taken: z.array(UserEntry) }),
  set: Started,
  answer: Started,
  stop: z.object({ stopped: z.boolean() }),
  forget: Empty,
  told: Empty,
  "tool-result": Empty,
} satisfies Record<Op, z.ZodType>
export type Reply<O extends Op> = z.infer<(typeof answers)[O]>
export const Answers: { [O in Op]: z.ZodType<Reply<O>> } = answers

export const Event = z.discriminatedUnion("t", [
  z.object({ t: z.literal("put"), id, e: Entry }),
  z.object({ t: z.literal("drop"), id, e: z.string() }),
  z.object({ t: z.literal("state"), s: Summary }),
  z.object({ t: z.literal("gone"), id }),
  z.object({ t: z.literal("tool"), id, call: z.string(), name: z.string(), args: z.unknown(), use: s }),
  z.object({ t: z.literal("did"), id, tool: z.string(), input: z.unknown() }),
  z.object({ t: z.literal("partial"), id, use: z.string(), name: z.string(), json: z.string(), end: z.enum(["done", "stop", "tool"]).optional() }),
])
export type Event = z.infer<typeof Event>

export const Page = z.object({ entries: z.array(Entry), start: z.number(), total: z.number() })
const reason = z.string()
export const TabMessage = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("hello"), id, s: Summary.nullable(), title: z.string(), cwd: z.string(), account: z.string(), model: z.string(), effort: z.string(),
    history: Page, tui: z.string().nullable(), found: z.boolean(), driven: z.string() }),
  z.object({ t: z.literal("put"), e: Entry }),
  z.object({ t: z.literal("drop"), e: z.string() }),
  z.object({ t: z.literal("state"), s: Summary.nullable() }),
  z.object({ t: z.literal("tui"), tui: z.string().nullable(), title: z.string() }),
  z.object({ t: z.literal("title"), title: z.string() }),
  z.object({ t: z.literal("refused"), reason }),
  z.object({ t: z.literal("unreachable"), reason }),
  z.object({ t: z.literal("error"), reason }),
])
export type TabMessage = z.infer<typeof TabMessage>

export const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "it"} ${i.message}`).join("; ")
