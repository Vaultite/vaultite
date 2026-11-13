import { z } from "zod"

export const VERSION = 1

const FLAG = z.unknown().optional().transform((v) => !!v)
const KEPT = z.object({
  name: z.string(), value: z.string(), domain: z.string().regex(/^\.?[\w.:[\]-]+$/), hostOnly: FLAG, path: z.string().startsWith("/"), secure: FLAG,
  httpOnly: FLAG, sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]),
})
/** What a session cookie is set again from. */
export type Kept = z.infer<typeof KEPT>
const FILE = z.object({ v: z.literal(VERSION), cookies: z.array(z.unknown()) })
  .transform((f) => f.cookies.flatMap((c) => { const k = KEPT.safeParse(c); return k.success ? [k.data] : [] })).catch([])

/** The kept cookies a file's text holds (anything malformed left out). */
export const parseKept = (text: string): Kept[] => FILE.parse(JSON.parse(text))
