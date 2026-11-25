import { z } from "zod"
import { type Knock, type Presence, URGENCIES } from "./knocks.ts"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
export const KNOCK = z.looseObject({
  id: z.string(), from: z.string(), who: z.string(), line: z.string(), urgency: z.enum(URGENCIES), at: z.number(), until: z.number(),
  state: z.enum(["waiting", "showing", "later", "told", "ignored", "opened", "expired", "moot"]), shown: opt(z.number()), later: opt(z.number()), open: opt(z.string()), hold: opt(z.number()),
  why: opt(z.string()), job: opt(z.string()),
}) satisfies z.ZodType<Knock>
export const PRESENCE = z.looseObject({
  id: z.string(), who: z.string(), tint: z.string(), state: z.enum(["needs you", "ready", "working", "done"]), since: z.number(), step: opt(z.string()), line: opt(z.string()),
  knock: opt(z.string()), urgency: opt(z.enum(URGENCIES)), terminal: opt(z.string()), open: opt(z.string()), job: opt(z.string()),
  chat: opt(z.string()), link: opt(z.string()), agent: opt(z.string()), where: opt(z.string()), ask: opt(z.object({ what: z.string(), id: opt(z.string()) })),
}) satisfies z.ZodType<Presence>
