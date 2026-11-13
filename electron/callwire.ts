import { z } from "zod"
import { listOf } from "../core/jsonfile.ts"
import { strings } from "../core/values.ts"

const SAID = z.unknown().optional()
export const UNREACHED = z.looseObject({ name: SAID, message: SAID, cause: z.looseObject({ code: SAID }).optional().catch(undefined) })
  .transform(({ name, message, cause }) => name === "TimeoutError" ? "It didn't answer" : cause?.code === "ENOTFOUND" ? "No machine has that name"
    : cause?.code === "ECONNREFUSED" ? "Nothing is listening there" : String(message))
  .catch(({ input }) => String(input))

export const BOX = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export const APP_RECT = BOX.refine((b) => b.width >= 2 && b.height >= 2)
export const WID = z.number().int().positive().catch(0)
export const HOLDS = z.object({ boxes: z.array(z.unknown()).pipe(listOf(BOX)).transform((b) => b.slice(0, 200)) })

export const PEN = z.looseObject({ strokes: z.array(z.looseObject({ pts: z.array(z.tuple([z.number(), z.number()])) })) }).nullable()
export const penShifted = (s: z.infer<typeof PEN>, dx: number, dy: number) =>
  s && { ...s, strokes: s.strokes.map((k) => ({ ...k, pts: k.pts.map(([x, y]) => [x + dx, y + dy]) })) }

const FILE = z.object({ path: z.string(), title: z.string() })
const COMMAND = z.object({ id: z.string(), name: z.string(), keys: z.array(z.unknown()).transform(strings),
  custom: z.unknown().optional().transform(Boolean), on: z.unknown().optional().transform(Boolean) })
export const MENU = z.object({ commands: z.array(z.unknown()).pipe(listOf(COMMAND)), pinned: listOf(FILE).transform((f) => f.slice(0, 40)), recent: listOf(FILE).transform((f) => f.slice(0, 15)) })
