import { z } from "zod"

const TWO_PART = /\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/
export function siteOf(host: string) {
  const h = host.toLowerCase().replace(/^\./, "").replace(/\.$/, "")
  if (!h || /^[\d.]+$/.test(h) || !h.includes(".")) return h
  const parts = h.split(".")
  return parts.slice(TWO_PART.test(h) ? -3 : -2).join(".")
}
export const hostOfUrl = (u: string) => { try { return new URL(u).hostname } catch { return "" } }

export const RECT = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), radius: z.number().catch(0).optional() })
  .transform(({ x, y, width, height, radius }) => ({ x, y, width, height, radius: Math.max(0, Math.min(40, radius ?? 0)) }))
export type WebRect = z.infer<typeof RECT>

export const MENUS = z.object({ containers: z.array(z.unknown()).catch([]), glance: z.unknown().optional() }).catch({ containers: [] })
export const CONTAINER = z.object({ id: z.string(), name: z.string() })
export const FIND = z.object({ forward: z.unknown().optional(), next: z.unknown().optional(), matchCase: z.unknown().optional() }).catch({})
export const FETCHED = z.object({ url: z.string(), body: z.unknown().optional() }).nullable()
export const PAGE_HTML = z.object({ url: z.string(), title: z.string(), html: z.string() })

export const WHO = z.object({ account: z.string(), more: z.array(z.string()).optional().catch(undefined), avatar: z.string().optional().catch(undefined) })
export const ZOOM_FILE = z.record(z.string(), z.number().catch(1)).catch({})
export const KNOWN = z.record(z.string(), z.record(z.string(), z.object({ login: z.string(), who: WHO, at: z.number().optional() }))).catch({})
export type Known = z.infer<typeof KNOWN>
export const SEAL_KEYS = z.object({ pub: z.string(), priv: z.string() })
export const ICONS = z.object({ v: z.number().optional(), icons: z.record(z.string(), z.unknown()).optional() }).catch({})

export const SITES = z.array(z.unknown()).catch([]).transform((a) => a.filter((x) => typeof x === "string").map((x) => x.toLowerCase()).slice(0, 20))

const COOKIE = z.object({
  name: z.string(), value: z.string(), domain: z.string().regex(/^\.?[\w.-]+$/), path: z.string().startsWith("/"),
  sameSite: z.enum(["unspecified", "no_restriction", "lax", "strict"]), expirationDate: z.number().optional(),
  hostOnly: z.unknown().optional(), secure: z.unknown().optional(), httpOnly: z.unknown().optional(), session: z.unknown().optional(),
})
const KNOWN_LOGIN = z.object({ login: z.string(), who: WHO })
export const SEALED_LOGIN = z.object({
  at: z.number().optional().catch(undefined), names: SITES.optional(), cookies: z.array(z.unknown()).catch([]).optional(),
  account: z.unknown().optional(), known: z.record(z.string(), z.unknown()).catch({}).optional(), visited: SITES.optional(),
}).catch({})

export function cookiesFrom(list: unknown[], names: string[]) {
  return list.flatMap((x) => {
    const c = COOKIE.safeParse(x)
    return c.success && names.includes(siteOf(c.data.domain)) ? [c.data] : []
  }).slice(0, 500).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, hostOnly: c.hostOnly === true,
    secure: c.secure === true, httpOnly: c.httpOnly === true, session: c.session === true, sameSite: c.sameSite,
    ...(c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}) }))
}

export function knownFrom(known: NonNullable<z.infer<typeof SEALED_LOGIN>["known"]>, names: string[]) {
  return Object.fromEntries(Object.entries(known).flatMap(([n, k]) => {
    const l = KNOWN_LOGIN.safeParse(k)
    return names.includes(n) && l.success ? [[n, l.data]] : []
  }))
}
