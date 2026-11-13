import { z } from "zod"
import { NearIn } from "./takeover.ts"
import { GOING_TYPES, JOB_EVENTS } from "./joblife.ts"

const s = z.string().optional(), n = z.number().optional(), b = z.boolean().optional()
export const RectRow = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export const HunkRow = z.object({ line: z.number(), added: z.array(z.string()), removed: z.array(z.string()) })
const InkRow = z.object({ shape: z.string(), box: RectRow, points: z.array(z.tuple([z.number(), z.number()])) })
const Spot = { sx: z.number(), sy: z.number() }
export const MomentRow = z.object({
  seq: z.number(), t: z.number(), kind: z.enum(["ask", "point", "edit", "open", "reply", "accept", "reject", "dismiss", "move", "change", "watch"]),
  path: s, line: n, text: s, selection: s, hunks: z.array(HunkRow).optional(), item: s, to: s, find: s, for: s, waited: n, more: n, again: b,
  x: n, y: n, changes: z.array(z.string()).optional(), scene: s, bubble: b, summoned: b, voice: b, live: s, shotWindow: n, pageJob: s, reviewed: s,
  tour: b, front: z.literal("realtime").optional(), talk: z.array(z.string()).optional(), into: z.enum(["note", "bubble"]).optional(),
  app: s, appName: s, window: n, title: s, screen: s, shot: s, floating: z.array(z.object({ app: z.string(), name: z.string(), frame: RectRow })).optional(),
  under: s, sx: n, sy: n, shotAt: RectRow.optional(), near: z.array(NearIn).optional(), ink: z.array(InkRow).optional(),
  origin: z.object({ x: z.number(), y: z.number() }).optional(), region: RectRow.optional(), clicks: z.array(z.object({ ...Spot, under: s })).optional(),
  shotDown: s, shotDownAt: RectRow.optional(), notices: s,
  closeUp: z.object({ shot: z.string(), at: RectRow, scale: z.number(), mark: z.enum(["ring", "pointer"]).optional() }).optional(),
  displays: z.array(RectRow).optional(), pane: s, ui: s, row: n, el: s, chrome: s, what: s, url: s,
})
export const ActRow = z.object({ t: z.number(), as: z.string(), op: z.string(), seqs: z.array(z.number()).optional(), text: s })
export const JobLogRow = z.object({ t: z.number(), job: z.string(), from: z.string(), to: z.string(),
  ev: z.union([z.enum(JOB_EVENTS), z.literal("untold"), z.templateLiteral(["going ", z.enum(GOING_TYPES)])]) })
