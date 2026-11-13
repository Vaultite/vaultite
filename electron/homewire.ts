import { z } from "zod"
import { DRAWING } from "../core/desktop/drawingwire.ts"
import { KNOCK, PRESENCE } from "../core/desktop/knockwire.ts"
import type { Agent, Note } from "./helperbase.ts"
import type { HelperJob } from "./helperlogic.ts"
import { TAKEOVER_MESSAGES } from "./takeoverlogic.ts"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const WORDS = opt(z.string()), N = opt(z.number()), FLAG = opt(z.boolean())
const listOf = <T extends z.ZodType>(item: T) => z.array(z.unknown()).transform((xs) => xs.flatMap((x): z.output<T>[] => { const r = item.safeParse(x); return r.success ? [r.data] : [] }))
const RECT = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export const AGENT = z.looseObject({
  name: z.string(), tint: z.string(), state: z.string(), t: N, seen: FLAG, why: WORDS, app: WORDS, window: N, find: WORDS, sx: N, sy: N, display: N, path: WORDS,
  line: N, pane: WORDS, row: N, ui: WORDS, frame: opt(RECT), runs: WORDS, model: WORDS, effort: WORDS,
}) satisfies z.ZodType<Agent>
export const NOTE = z.looseObject({
  id: z.string(), kind: z.string(), agent: z.string(), t: z.number(), text: WORDS, question: FLAG, dismissed: N, seen: FLAG,
  answers: opt(z.looseObject({ t: z.number(), voice: FLAG, lang: WORDS, realtime: FLAG })),
}) satisfies z.ZodType<Note>
const HELPER_JOB = z.looseObject({
  id: z.string(), title: z.string(), state: z.string(), link: z.string().nullable(), unseen: z.boolean(), at: z.number(), where: WORDS, now: WORDS, took: WORDS, result: WORDS,
  waits: opt(z.object({ question: z.string(), choices: z.array(z.string()) })),
}) satisfies z.ZodType<HelperJob>

const message = <const T extends string, F extends Record<string, z.ZodType>>(t: T, fields: F) => z.object({ t: z.literal(t), ...fields })
const ID = z.string().optional()
const LIVE_MESSAGE = z.discriminatedUnion("t", [
  message("voice", {}),
  message("drawing", { agent: z.string(), drawing: DRAWING.nullish().transform((d) => d ?? null) }),
  message("state", { mode: z.string().catch(""), name: z.string().catch(""), agents: listOf(AGENT), notes: listOf(NOTE), said: listOf(NOTE).optional() }),
  message("said", { said: listOf(NOTE).optional() }),
  message("agent", { agent: AGENT }),
  message("note", { note: NOTE }),
  message("drop", { id: z.coerce.string() }),
  message("hush", {}),
  ...TAKEOVER_MESSAGES,
  message("open", { id: ID, url: z.string().catch(""), app: z.string().catch(""), path: z.string().catch("") }),
  message("find", { id: ID, text: z.unknown().optional().transform((v) => String(v ?? "")) }),
  message("things", { id: ID }),
  message("inputs", { on: z.unknown().optional().transform((v) => v === true) }),
  message("knocks", { knocks: listOf(KNOCK).catch([]), presences: listOf(PRESENCE).catch([]) }),
  message("record", { job: z.string() }),
  message("jobs", { jobs: listOf(HELPER_JOB) }),
])
export type LiveMessage = z.infer<typeof LIVE_MESSAGE>
const VOICE = z.object({ voice: opt(z.enum(["auto", "always", "off"])) })
export type Heard = { voice?: z.infer<typeof VOICE>["voice"]; message: LiveMessage | null }
/** A message off the companion's socket, with the voice setting any may carry; null `message`: one not read here. */
export function heardFrom(text: string): Heard | null {
  let json: unknown
  try { json = JSON.parse(text) } catch { return null }
  const voice = VOICE.safeParse(json)
  if (!voice.success) return null
  return { voice: voice.data.voice, message: LIVE_MESSAGE.safeParse(json).data ?? null }
}

export const SAID = z.object({ said: z.unknown().optional() }).catch({})
export const ADDED = z.object({ added: z.object({ word: z.string(), said: z.string().optional() }).nullish().catch(null) }).catch({ added: null })
const DECISION = z.object({ question: z.string(), from: z.string().nullable(), created: z.string().nullable(), blocking: FLAG })
export const DECISIONS = z.object({ decisions: listOf(DECISION).catch([]) }).catch({ decisions: [] })
export const HOLD = z.object({ hold: z.object({ until: z.string() }).nullish().catch(null) }).catch({ hold: null })
export const REALTIME_KEY = z.object({ url: WORDS, key: WORDS }).catch({})
