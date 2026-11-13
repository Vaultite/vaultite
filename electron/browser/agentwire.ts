import { z } from "zod"

export type By = { name?: string; session?: string; task?: string; summary?: string; remote?: boolean }
const said = (n: number) => z.unknown().optional().transform((v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n) || undefined)
const objectOr = <T extends z.ZodType>(s: T) => z.preprocess((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {}), s)
export const BY: z.ZodType<By> = objectOr(z.object({ name: said(80), session: said(80), task: said(80), summary: said(300), remote: z.unknown().optional().transform((r) => r === true || undefined) }))

export type Field = { ref: string; value: string; name?: string }
const LIST = "fields: a list of { ref, value }", EACH = "fields: each needs a ref (e12) or its control's name, and its value"
const FIELD = z.object({ ref: z.unknown().optional(), name: z.unknown().optional(), value: z.unknown().optional() }, { error: EACH })
  .transform((f): Field => ({ ref: String(f.ref ?? "").trim(), name: String(f.name ?? "").trim() || undefined,
    value: typeof f.value === "string" ? f.value : f.value == null ? "" : String(f.value) }))
  .refine((f) => f.ref || f.name, EACH)
const FIELDS = z.array(z.unknown(), { error: LIST }).min(1, LIST).transform((a) => a.slice(0, 200)).pipe(z.array(FIELD))

const UPLOAD = z.object({ name: z.unknown().optional(), data: z.unknown().optional() }).catch({})
  .transform((f) => ({ name: String(f.name ?? ""), data: String(f.data ?? "") }))
export type Upload = z.infer<typeof UPLOAD>

export const AT = z.object({ x: z.number(), y: z.number() })
const TEXT = z.union([z.string(), z.number(), z.boolean()]).transform(String)
const SOME = TEXT.optional().catch(undefined)
export const ACT = objectOr(z.object({
  action: TEXT.catch(""), ref: SOME, name: SOME, role: SOME, at: AT.optional().catch(undefined), value: SOME, html: SOME, key: SOME, direction: SOME,
  files: z.array(UPLOAD).optional().catch(undefined), fields: z.preprocess((x) => x || undefined, FIELDS.optional()), diff: z.unknown().optional(),
}))
export type Act = z.infer<typeof ACT>

export const WAIT = z.object({ text: z.unknown().optional(), url: z.unknown().optional(), download: z.unknown().optional(), helped: z.unknown().optional() }).catch({})
  .transform((w) => ({ text: w.text ? String(w.text) : undefined, url: w.url ? String(w.url) : undefined, download: !!w.download, helped: !!w.helped }))
export type Wait = z.infer<typeof WAIT>

export const PAGE_TEXT = z.object({ url: z.string(), title: z.string(), text: z.string(), as: z.string().optional().catch(undefined) })
