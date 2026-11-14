import { z } from "zod"
import { CslDate, CslItem, CslName } from "../csl.ts"
import { anyDate } from "./dates.ts"
import { plainName, toList } from "./names.ts"
import { itemTypeOf } from "./types.ts"
import { DATE_KEYS, KEY_CASE, NAME_KEYS, TEXT_KEYS } from "./variables.ts"

export const CslJson = z.json()
export type CslJson = z.infer<typeof CslJson>
export const CslFields = z.record(z.string(), CslJson)
export type CslFields = z.infer<typeof CslFields>
export type CslFrom = { id?: string; type?: string; typeKey?: string; cslOnly?: boolean }

type Value = string | CslName[] | CslDate | CslJson

const Scalar = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v).trim())
const Text = z.union([Scalar, z.array(Scalar).transform((list) => list.filter(Boolean).join(", "))])

const splitNames = (s: string) => s.split(/\s*;\s*|\s+and\s+/).flatMap((n) => toList(plainName(n)))
const Names = z.union([
  z.string().transform(splitNames),
  z.array(z.union([z.string().transform((s) => plainName(s)), CslName])).transform((list) => list.flatMap(toList)),
  CslName.transform((n) => [n]),
])

const Part = z.union([z.number(), z.string().trim().regex(/^-?\d+$/).transform(Number), z.string()])
const OldPandoc = z.array(z.looseObject({ year: Part, month: Part.optional(), day: Part.optional() }))
const Dated = z.union([
  z.number().transform((y): CslDate => ({ "date-parts": [[y]] })),
  z.string().transform(anyDate),
  OldPandoc.transform((list): CslDate => ({ "date-parts": list.map((p) => [p.year, p.month ?? 0, p.day ?? 0]
    .filter((n) => n !== 0 && n !== "")) })),
  CslDate.extend({ "date-parts": z.array(z.array(Part)).optional() }),
])

function parsed<T>(schema: z.ZodType<T>, v: CslJson | undefined): T | null {
  const r = schema.safeParse(v)
  return r.success ? r.data : null
}

function known(key: string): boolean {
  return TEXT_KEYS.has(key) || NAME_KEYS.has(key) || DATE_KEYS.has(key)
}

function valueOf(key: string, v: CslJson, cslOnly: boolean): Value | null {
  if (NAME_KEYS.has(key)) return parsed(Names, v)
  if (DATE_KEYS.has(key)) return parsed(Dated, v)
  const text = parsed(Text, v)
  if (text !== null) return text
  return cslOnly || v === null ? null : v
}

function empty(v: Value | null): boolean {
  return v === null || v === "" || (Array.isArray(v) && v.length === 0)
}

function copyFields(out: Map<string, Value>, fields: CslFields, skip: string, cslOnly: boolean) {
  for (const [raw, v] of Object.entries(fields)) {
    const key = KEY_CASE.get(raw.toLowerCase()) ?? raw
    if (key === "id" || key === "type" || key === skip || out.has(key) || (cslOnly && !known(key))) continue
    const value = valueOf(key, v, cslOnly)
    if (!empty(value) && value !== null) out.set(key, value)
  }
}

export type CslRead = { item: CslItem | null; problem: string }

export function readCslItem(fields: CslFields, options: CslFrom = {}): CslRead {
  const id = options.id ?? parsed(Scalar, fields.id) ?? ""
  if (!id) {
    const title = parsed(Scalar, fields.title)?.slice(0, 60)
    return { item: null, problem: `An item has no id${title ? ` ("${title}")` : ""}: skipped` }
  }
  const typeKey = options.typeKey ?? "type"
  const type = options.type ?? parsed(Scalar, fields[typeKey]) ?? ""
  const out = new Map<string, Value>([["id", id], ["type", type ? itemTypeOf(type) : "document"]])
  copyFields(out, fields, typeKey, options.cslOnly ?? false)
  const r = CslItem.safeParse(Object.fromEntries(out))
  if (r.success) return { item: r.data, problem: "" }
  const issue = r.error.issues[0]
  return { item: null, problem: `"${id}" isn't valid CSL (${issue?.path.join(".")}: ${issue?.message}): skipped` }
}

export function cslItemFrom(fields: CslFields, options: CslFrom = {}): CslItem | null {
  return readCslItem(fields, options).item
}
