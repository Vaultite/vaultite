import { z } from "zod"

export const objectOr = <T extends z.ZodType>(s: T) => z.preprocess((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {}), s)
export const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined)
export const yes = z.unknown().optional().transform((v) => v === true)
