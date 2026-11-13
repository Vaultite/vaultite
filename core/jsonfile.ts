import fs from "node:fs"
import { z } from "zod"

export type Read<T> = { ok: true; value: T } | { ok: false; why: string }

export function readJson<T extends z.ZodType>(file: string, schema: T, read: (file: string) => string = (f) => fs.readFileSync(f, "utf8")): Read<z.output<T>> {
  let raw: unknown
  try { raw = JSON.parse(read(file)) } catch (e) { return { ok: false, why: e instanceof Error ? e.message : String(e) } }
  const r = schema.safeParse(raw)
  return r.success ? { ok: true, value: r.data } : { ok: false, why: z.prettifyError(r.error) }
}

/** A record of `entry`s, those that don't parse left out; anything else, none. */
export const recordOf = <T extends z.ZodType>(entry: T) => z.record(z.string(), z.unknown()).catch({}).transform((r) => {
  const out: Record<string, z.output<T>> = {}
  for (const [k, v] of Object.entries(r)) { const e = entry.safeParse(v); if (e.success) out[k] = e.data }
  return out
})

/** A list of `item`s, those that don't parse left out; anything else, none. */
export const listOf = <T extends z.ZodType>(item: T) => z.array(z.unknown()).catch([]).transform((a) => a.flatMap((v) => {
  const e = item.safeParse(v)
  return e.success ? [e.data] : []
}))
