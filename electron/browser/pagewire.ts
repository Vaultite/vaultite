import { z } from "zod"

const objectOr = <T extends z.ZodType>(s: T) => z.preprocess((x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {}), s)
const strings = (max: number) => z.array(z.unknown()).catch([]).transform((a) => a.filter((v) => typeof v === "string").slice(0, max))

export const FOUND = z.object({ classes: strings(5000), ids: strings(5000), hrefs: strings(5000) })
export const SHIELDS = objectOr(z.object({ on: z.unknown().optional(), down: strings(Infinity).transform((a) => a.map((v) => v.trim().toLowerCase())) }))

const HEX = (or: string) => z.string().regex(/^#[0-9a-f]{6}$/i).transform((h) => h.toLowerCase()).catch(or)
const SITES = z.array(z.unknown()).catch([]).transform((a) => a.flatMap((x) => (typeof x === "string" && /^[a-z0-9.-]{1,253}$/.test(x) ? [x] : [])).slice(0, 2000))
export const DARK = objectOr(z.object({ on: z.unknown().optional().transform((v) => v === true), look: z.unknown().optional().transform((v) => (v === "dark" ? "dark" : "theme")),
  bg: HEX("#000000"), fg: HEX("#ffffff"), off: SITES }))

const STYLE = z.object({ site: z.string().regex(/^[a-z0-9.-]+$/), css: z.string().max(1_000_000) })
export const SITE_STYLES = objectOr(z.object({ vars: z.string().max(20_000).catch(""),
  styles: z.array(z.unknown()).catch([]).transform((a) => a.flatMap((x) => { const st = STYLE.safeParse(x); return st.success ? [st.data] : [] }).slice(0, 500)) }))

export const PICKED = z.object({ selector: z.string() })
export const ANSWERS = z.record(z.string(), z.unknown().transform((v) => String(v ?? "")))
export const FORM_SAID = z.object({ form: z.unknown().optional().transform((v) => v === true), password: z.unknown().optional().transform((v) => v === true),
  url: z.string().optional().catch(undefined) })
export const SUBMITTED = z.object({ username: z.string().catch("").transform((u) => u.trim().slice(0, 256)), password: z.string().max(1024).catch("") })
