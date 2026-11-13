import { z } from "zod"
import { AREAS, type Drawing, LIVES, type Mark, type PaperItem, type Spot } from "./screenmarks.ts"

const WORDS = z.string().optional()
const N = z.number()
const RECT = z.looseObject({ x: N, y: N, w: N, h: N, label: WORDS })
const SPOT: z.ZodType<Spot> = z.union([RECT, z.looseObject({ el: z.string() }), z.looseObject({ pane: z.string() }), z.looseObject({ ui: z.string() }),
  z.looseObject({ find: z.string() }), z.looseObject({ area: z.enum(AREAS) })])
const ACTION = z.union([z.looseObject({ copy: z.string() }), z.looseObject({ open: z.string() }), z.looseObject({ ask: z.string() })])
const SIZE = z.enum(["s", "m", "l"]).optional()
const END = z.union([z.tuple([N, N]), z.string()])
const BOX = { x: N, y: N, w: N, h: N }
const INK = { id: WORDS, color: WORDS, fill: WORDS, gone: N.optional() }
const SVG_PATH = z.looseObject({ d: z.string(), color: WORDS, fill: WORDS, width: N.optional() })
const item = <const T extends readonly [string, ...string[]], F extends Record<string, z.ZodType>>(types: T, fields: F) => z.looseObject({ ...INK, type: z.enum(types), ...fields })
const PAPER_ITEM = z.discriminatedUnion("type", [
  item(["line", "arrow"], { from: END, to: END, label: WORDS }),
  item(["rect", "ellipse", "diamond"], { ...BOX, label: WORDS }),
  item(["path"], { points: z.array(z.tuple([N, N])) }),
  item(["text"], { x: N, y: N, text: z.string(), size: SIZE }),
  item(["chart"], { ...BOX, kind: z.enum(["bar", "line"]), values: z.array(N), labels: z.array(z.string()).optional() }),
  item(["svg"], { ...BOX, paths: z.array(SVG_PATH), viewBox: z.tuple([N, N, N, N]).optional(), style: z.enum(["clean", "sketch"]).optional() }),
]) satisfies z.ZodType<PaperItem>
const BASE = { beat: N.optional(), id: WORDS, life: z.enum(LIVES).optional(), gone: N.optional() }
const mark = <const T extends readonly [string, ...string[]], F extends Record<string, z.ZodType>>(types: T, fields: F) => z.looseObject({ ...BASE, type: z.enum(types), ...fields })
const CARD = SPOT.optional()
const MARK = z.discriminatedUnion("type", [
  mark(["point", "ring", "frame"], { at: SPOT, label: WORDS }),
  mark(["underline", "strike", "check", "cross", "spotlight"], { at: SPOT }),
  mark(["scroll"], { at: SPOT, dir: z.enum(["up", "down", "left", "right"]), label: WORDS }),
  mark(["num"], { at: SPOT, n: N }),
  mark(["connect"], { from: SPOT, to: SPOT, label: WORDS }),
  mark(["write"], { at: CARD, text: z.string(), size: SIZE }),
  mark(["paper"], { at: CARD, w: N, h: N, title: WORDS, grid: z.boolean().optional(), items: z.array(PAPER_ITEM) }),
  mark(["sticky"], { at: CARD, text: z.string(), title: WORDS }),
  mark(["list"], { at: CARD, title: WORDS, items: z.array(z.string()), numbered: z.boolean().optional() }),
  mark(["button"], { at: CARD, label: z.string(), do: ACTION }),
  mark(["copy"], { at: CARD, text: z.string(), label: WORDS }),
  mark(["open"], { at: CARD, url: z.string(), label: WORDS }),
  mark(["image", "video"], { at: CARD, src: z.string(), caption: WORDS, size: SIZE, url: WORDS, name: WORDS, px: z.tuple([N, N]).optional(),
    over: z.boolean().optional(), sound: z.boolean().optional(), paused: z.boolean().optional() }),
]) satisfies z.ZodType<Mark>
/** A drawing as the server sends the overlay one (plugins/core/companion/drawings.ts). */
export const DRAWING = z.looseObject({
  id: z.string(), agent: z.string(), tint: z.string(), t: N, marks: z.array(MARK), caption: WORDS, places: z.record(z.string(), RECT).optional(), kept: WORDS,
  spoken: z.array(z.looseObject({ at: N, dur: N }).nullable()).optional(), waits: z.boolean().optional(), past: z.boolean().optional(), hidden: z.boolean().optional(),
  question: WORDS, hint: WORDS,
}) satisfies z.ZodType<Drawing>
