// What an op's params and result are typed as (core/ops.ts defineOp): tsc checks this file, nothing runs it.
import { defineOp, type Param, type ParamsOf } from "../../core/ops.ts"

const KIND = { type: "string", required: true, description: "the kind" } satisfies Param
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const yes = <T extends true>() => undefined as unknown as T

type Got = ParamsOf<{
  kind: typeof KIND
  limit: { type: "integer"; description: "n" }
  n: { type: "number"; default: 3; description: "n" }
  pick: { type: "string"; enum: ["a", "b"]; description: "p" }
  tags: { type: "array"; items: { type: "string" }; description: "t" }
  at: { type: "object"; properties: { x: { type: "string" } }; required: ["x"]; description: "o" }
  data: { type: "object"; description: "d" }
  raw: { format: "json"; description: "r" }
}>
yes<Same<Got, { kind: string; n: number; limit?: number; pick?: "a" | "b"; tags?: string[]; at?: { x: string }; data?: Record<string, unknown>; raw?: unknown }>>()

defineOp({ id: "t.typed", summary: "s", kind: "read", params: { kind: KIND }, run: ({ kind }) => ({ len: kind.length }), text: (r) => String(r.len) })
// @ts-expect-error a required string param isn't a number
defineOp({ id: "t.wrong", summary: "s", kind: "read", params: { kind: KIND }, run: ({ kind }) => { const n: number = kind; return n } })
// @ts-expect-error text reads only what run returns
defineOp({ id: "t.result", summary: "s", kind: "read", run: () => ({ a: 1 }), text: (r) => r.b })

