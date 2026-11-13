import { z } from "zod"

const objectOr = <T extends z.ZodType>(s: T) => z.preprocess((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {}), s)
const strings = (max: number) => z.array(z.unknown()).catch([]).transform((a) => a.filter((v) => typeof v === "string").slice(0, max))

export const FOUND = z.object({ classes: strings(5000), ids: strings(5000), hrefs: strings(5000) })
export const SHIELDS = objectOr(z.object({ on: z.unknown().optional(), down: strings(Infinity).transform((a) => a.map((v) => v.trim().toLowerCase())) }))
