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
