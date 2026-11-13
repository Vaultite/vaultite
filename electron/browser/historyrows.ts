import { z } from "zod"

export const TABLES = `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS urls (id INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '',
      host TEXT NOT NULL DEFAULT '', visits INTEGER NOT NULL DEFAULT 0, typed INTEGER NOT NULL DEFAULT 0,
      last INTEGER NOT NULL DEFAULT 0, frecency REAL NOT NULL DEFAULT 0, scored INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, url INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
      at INTEGER NOT NULL, profile TEXT NOT NULL DEFAULT '', how TEXT NOT NULL DEFAULT 'link', source TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS visits_once ON visits(url, at);
    CREATE INDEX IF NOT EXISTS visits_at ON visits(at);
    CREATE INDEX IF NOT EXISTS urls_host ON urls(host);
    CREATE INDEX IF NOT EXISTS urls_frecency ON urls(frecency);`

export const HOW = z.enum(["typed", "link", "bookmark", "form", "other"])
export type How = z.infer<typeof HOW>

export const ID_ROW = z.object({ id: z.number() })
export const ID_ROWS = z.array(ID_ROW)
export const URL_ROWS = z.array(z.object({ url: z.number() }))
export const COUNTS = z.object({ n: z.number(), typed: z.number().nullable(), last: z.number().nullable() })
export const RECENT = z.array(z.object({ at: z.number(), how: z.string() }))
export const HOST_LAST = z.array(z.object({ host: z.string(), at: z.number() }))

const SUGGESTION = z.object({ url: z.string(), title: z.string(), host: z.string(), visits: z.number(), typed: z.number(), last: z.number() })
export type Suggestion = z.infer<typeof SUGGESTION>
export const SUGGESTIONS = z.array(SUGGESTION)
export const RANKED = z.array(SUGGESTION.extend({ frecency: z.number() }))
const VISIT = z.object({ id: z.number(), url: z.string(), title: z.string(), host: z.string(), at: z.number(), profile: z.string(), how: HOW.catch("other") })
export type Visit = z.infer<typeof VISIT>
export const VISITS = z.array(VISIT)

const REMOVED = z.object({ url: z.string(), title: z.string(), at: z.number(), profile: z.string(), how: HOW.catch("other"), source: z.string() })
export type Removed = z.infer<typeof REMOVED>
export const GONE = z.array(REMOVED.extend({ id: z.number(), urlId: z.number() }))
const GIVEN = REMOVED.extend({ title: z.string().catch(""), profile: z.string().catch(""), source: z.string().catch("") })
export const RESTORED = z.array(z.unknown()).catch([]).transform((a) => a.flatMap((v) => { const r = GIVEN.safeParse(v); return r.success ? [r.data] : [] }))
export const LIST_ASK = z.object({ before: z.unknown().optional(), text: z.unknown().optional(), limit: z.unknown().optional() }).catch({})
export const REMOVE_ASK = z.object({ visits: z.array(z.unknown()).catch([]).transform((a) => a.map(Number)), urls: z.array(z.unknown()).catch([]).transform((a) => a.map(String)) })
  .catch({ visits: [], urls: [] })

// Chrome's page transitions (ui/base/page_transition_types.h): the core type in the low byte, then qualifiers.
const CORE: Record<number, How | null> = { 0: "link", 1: "typed", 2: "bookmark", 3: null, 4: null, 5: "typed", 6: "other", 7: "form", 8: null, 9: "typed", 10: "typed" }
const CHAIN_START = 0x10000000, CHAIN_END = 0x20000000
/** Chrome's time, in milliseconds since 1601. */
const fromChrome = (ms: number) => Math.round(ms - 11_644_473_600_000)
const NUMBER = z.coerce.number().catch(NaN)
export const CHROME_ROWS = z.array(z.object({ at: NUMBER, t: NUMBER, url: z.string().catch(""), title: z.string().nullable().catch(null) }))
export function chromeVisits(rows: z.infer<typeof CHROME_ROWS>, profile: string, source: string) {
  const visits: Removed[] = []
  for (const r of rows) {
    if (!/^https?:\/\//i.test(r.url)) continue
    const how = CORE[r.t & 0xff]
    if (!how || ((r.t & CHAIN_START) && !(r.t & CHAIN_END))) continue
    visits.push({ url: r.url, title: r.title ?? "", at: fromChrome(r.at), profile, how, source })
  }
  return visits
}
