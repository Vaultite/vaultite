import { z } from "zod"

const OptionalText = z.string().optional().catch(undefined)
const Rows = z.array(z.looseObject({ path: z.unknown() })).optional().catch([]).transform((x) => x ?? [])

export const Live = z.looseObject({ live: z.looseObject({ live: z.unknown().optional() }) })
export const Waited = z.looseObject({ cursor: z.string().optional(), missed: z.boolean().optional(), events: z.array(z.unknown()).optional() })
export const Named = z.object({ path: OptionalText, file: OptionalText, id: OptionalText }).catch({})
export const Tree = z.object({ files: Rows, others: Rows }).catch({ files: [], others: [] })
export const Failure = z.object({ problems: z.array(z.string()).optional().catch(undefined) }).catch({})
export const Both = z.object({ result: z.unknown(), text: z.unknown() }).partial().catch({})
