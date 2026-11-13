import { z } from "zod"
import type { FnEvent } from "../core/fnkey.ts"

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
const WORDS = opt(z.string()), N = opt(z.number()), FLAG = opt(z.boolean())
const said = z.unknown().optional().transform((v) => v === true)
export const RECT = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
const listOf = <T extends z.ZodType>(item: T) => z.array(z.unknown()).catch([]).transform((xs) => xs.flatMap((x): z.output<T>[] => { const r = item.safeParse(x); return r.success ? [r.data] : [] }))

/** An app's window as screen.swift tells it (`at`, `window`, a `front` event): `{ window: 0 }`, none there. */
export const WINDOW = z.looseObject({ bundle: z.string().catch(""), name: z.string().catch(""), pid: z.number().catch(0), window: z.number().catch(0), title: z.string().catch(""),
  frame: RECT.nullish().catch(undefined), vaultite: FLAG })
export const FOCUS = WINDOW.extend({ field: z.boolean().catch(false), editable: FLAG, secure: FLAG, role: WORDS, before: WORDS })
export const OK = z.looseObject({ ok: FLAG, why: WORDS })
export const UNDER = OK.extend({ vaultite: FLAG, bundle: WORDS, name: WORDS, role: WORDS, label: WORDS, in: WORDS })
export const TEXT = OK.extend({ text: WORDS })
export const SCREEN_WINDOW = z.looseObject({ window: z.number(), bundle: z.string(), name: z.string(), layer: N, frame: RECT.nullish().catch(undefined), seen: FLAG, vaultite: FLAG })
export const WINDOWS = OK.extend({ windows: listOf(SCREEN_WINDOW).optional() })
export const ELEMENTS = OK.extend({ elements: z.array(z.unknown()).optional().catch(undefined) })
export const COVERED = OK.extend({ covered: FLAG })
export const FOUND = OK.extend({ found: RECT.nullish().catch(undefined), window: N, frame: RECT.nullish().catch(undefined) })
export const NOTCHES = OK.extend({ screens: listOf(z.object({ frame: RECT, notch: opt(RECT) })).optional() })
export const FOLLOWED = OK.extend({ value: WORDS, caret: N, bundle: WORDS, name: WORDS })
export const KEPT = OK.extend({ before: WORDS, name: WORDS })
export const INSERTED = OK.extend({ how: WORDS })
export const SHOT = OK.extend({ file: WORDS, frame: opt(RECT) })
const MIC_USER = z.object({ pid: z.number(), bundle: z.string(), app: z.string(), appBundle: z.string(), chain: z.array(z.number()), input: z.boolean(), output: z.boolean() })
export const MICS = OK.extend({ users: listOf(MIC_USER).optional() })
export const SAMPLES = OK.extend({ samples: z.array(z.unknown()).optional().catch(undefined) })

const event = <const T extends string, F extends Record<string, z.ZodType>>(name: T, fields: F) => z.looseObject({ event: z.literal(name), ...fields })
export const SCREEN_EVENT = z.discriminatedUnion("event", [
  event("fn", { double: said, other: said, shortcut: FLAG, down: said, t: N, held: FLAG }),
  event("mod", { code: N, on: FLAG, alone: FLAG, at: N, other: FLAG }),
  event("chord", { name: z.string().catch(""), on: said, other: said, t: N }),
  event("moved", { window: z.number(), frame: RECT.nullable().catch(null), gone: FLAG }),
  event("ink", { phase: z.enum(["down", "move", "up"]), x: z.number(), y: z.number() }),
  event("click", { x: z.number(), y: z.number(), held: FLAG, exchange: FLAG }),
  event("esc", {}),
  event("input", { kind: z.string(), x: N, y: N }),
  event("key", { key: z.string() }),
  event("typed", {}),
  event("follow", { value: WORDS, over: WORDS }),
  WINDOW.extend({ event: z.literal("front") }),
  event("tap", { ok: FLAG, ink: FLAG }),
  event("exit", {}),
])
export type ScreenEvent = z.infer<typeof SCREEN_EVENT>
type Fn = Extract<ScreenEvent, { event: "fn" }>
export const fnEvent = (m: Fn): FnEvent => (m.double ? { double: true } : m.other ? { other: true, shortcut: m.shortcut } : { down: m.down, t: m.t, held: m.held })
