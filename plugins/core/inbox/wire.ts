import { z } from "zod"
import type { Question } from "../../../core/agents.ts"
import type { InboxEvent } from "./model.ts"

const s = z.string().optional(), b = z.boolean().optional(), n = z.number().optional()

export const Saved = z.looseObject({ id: z.string() })
export type Saved = z.infer<typeof Saved>

const Asked = z.looseObject({ question: z.string(), header: s, multi: b, closed: b,
  options: z.array(z.looseObject({ label: z.string(), description: s })) }) satisfies z.ZodType<Question>
const By = z.looseObject({ title: z.string(), agent: z.string(), terminal: s, session: s })
export const Fix = z.looseObject({ label: z.string(), op: z.string(), args: z.record(z.string(), z.string()), why: z.string() })
export const Event = z.looseObject({
  id: z.string(), t: z.number(), source: z.string(), kind: z.string(), state: z.enum(["open", "working", "done"]), title: z.string(),
  body: s, link: s, key: s, terminal: s, session: s, host: b, ask: s, questions: z.array(Asked).optional(), preview: s, turn: s, nt: n,
  gate: b, answer: z.enum(["approve", "deny"]).optional(), read: b, kept: b, machine: s, machineLabel: s, snoozed: n, pinned: b, stays: b, fix: Fix.optional(),
  parent: By.optional(), from: By.optional(), progress: s,
}) satisfies z.ZodType<InboxEvent>
export const Fixed = z.looseObject({ id: z.string(), text: z.string() })
export const Events = z.looseObject({ events: z.array(z.looseObject({ id: z.string() })) })
export const Unread = z.looseObject({ unread: z.number() })

const Live = z.looseObject({ id: z.string(), agent: z.string().nullish(), busy: b, state: s })
export type Live = z.infer<typeof Live>
export const Sessions = z.looseObject({ sessions: z.array(Live) })
export const Captured = z.looseObject({ text: z.string() })
export const Uploaded = z.looseObject({ path: z.string() })
export const Passed = z.looseObject({})
