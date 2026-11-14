import { z } from "zod"
import { CslItem } from "../csl.ts"

export type Conn = { base: string; headers: Map<string, string>; web: boolean }
export type Lib = { prefix: string; name: string }

export class ZoteroError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ZoteroError"
    this.status = status
  }
}

export async function call(conn: Conn, path: string, timeout = 8000): Promise<Response> {
  let r: Response
  try {
    r = await fetch(`${conn.base}/${path}`, { headers: Object.fromEntries(conn.headers), signal: AbortSignal.timeout(timeout) })
  } catch {
    throw new ZoteroError(conn.web ? "Zotero's web API isn't answering" : "Zotero isn't running on this computer", 0)
  }
  if (r.ok) return r
  if (r.status === 403 && !conn.web) throw new ZoteroError("Zotero doesn't let other applications in: turn on Allow other applications on this computer to communicate with Zotero, in its Settings, Advanced", 403)
  if (r.status === 403) throw new ZoteroError("Zotero refused the API key: make one with read access at zotero.org/settings/keys", 403)
  if (r.status === 429 || r.status === 503) throw new ZoteroError("Zotero asked to wait a little before more requests", r.status)
  throw new ZoteroError(`Zotero answered ${r.status}`, r.status)
}

const Versions = z.record(z.string(), z.number())
const Data = z.looseObject({
  key: z.string(),
  itemType: z.string(),
  citationKey: z.string().optional(),
  extra: z.string().optional(),
  parentItem: z.string().optional(),
  title: z.string().optional(),
  note: z.string().optional(),
  contentType: z.string().optional(),
  annotationType: z.string().optional(),
  annotationText: z.string().optional(),
  annotationComment: z.string().optional(),
  annotationPageLabel: z.string().optional(),
  annotationSortIndex: z.string().optional(),
  annotationColor: z.string().optional(),
})
export type ZoteroData = z.infer<typeof Data>
const Row = z.looseObject({ key: z.string(), version: z.number(), data: Data, csljson: z.looseObject({}).optional() })
export type ZoteroRow = { key: string; version: number; data: ZoteroData; csl: CslItem | null }

const Group = z.looseObject({ id: z.number(), data: z.looseObject({ name: z.string().optional() }).optional() })
const KeyInfo = z.looseObject({ userID: z.number(), username: z.string().optional() })

export async function versions(conn: Conn, lib: Lib): Promise<{ versions: Map<string, number>; library: number }> {
  const r = await call(conn, `${lib.prefix}/items/top?format=versions`, 20000)
  const parsed = Versions.safeParse(await r.json().catch(() => null))
  if (!parsed.success) throw new ZoteroError("Zotero's answer wasn't understood", 502)
  return { versions: new Map(Object.entries(parsed.data)), library: Number(r.headers.get("Last-Modified-Version") ?? 0) }
}

function rowOf(raw: z.infer<typeof Row>): ZoteroRow {
  const csl = raw.csljson ? CslItem.safeParse({ ...raw.csljson, id: raw.key }) : null
  return { key: raw.key, version: raw.version, data: raw.data, csl: csl?.success ? csl.data : null }
}

export async function items(conn: Conn, lib: Lib, keys: string[]): Promise<ZoteroRow[]> {
  const out: ZoteroRow[] = []
  for (let i = 0; i < keys.length; i += 50) {
    const r = await call(conn, `${lib.prefix}/items?itemKey=${keys.slice(i, i + 50).join(",")}&include=data,csljson&format=json`, 20000)
    const rows = z.array(z.unknown()).safeParse(await r.json().catch(() => null))
    for (const raw of rows.success ? rows.data : []) {
      const row = Row.safeParse(raw)
      if (row.success) out.push(rowOf(row.data))
    }
  }
  return out
}

export async function children(conn: Conn, lib: Lib, key: string): Promise<ZoteroRow[]> {
  const r = await call(conn, `${lib.prefix}/items/${key}/children?format=json&include=data`)
  const rows = z.array(z.unknown()).safeParse(await r.json().catch(() => null))
  return (rows.success ? rows.data : []).flatMap((raw) => { const row = Row.safeParse(raw); return row.success ? [rowOf(row.data)] : [] })
}

export async function groups(conn: Conn, user: string): Promise<Lib[]> {
  const r = await call(conn, `${user}/groups?format=json`)
  const rows = z.array(Group).safeParse(await r.json().catch(() => null))
  return (rows.success ? rows.data : []).map((g) => ({ prefix: `groups/${g.id}`, name: g.data?.name ?? `Group ${g.id}` }))
}

export async function keyOwner(conn: Conn): Promise<{ user: string; name: string }> {
  const r = await call(conn, "keys/current")
  const k = KeyInfo.safeParse(await r.json().catch(() => null))
  if (!k.success) throw new ZoteroError("Zotero's answer about the key wasn't understood", 502)
  return { user: `users/${k.data.userID}`, name: k.data.username ?? "" }
}

export const citekeyIn = (data: ZoteroData) =>
  data.citationKey?.trim() || /^\s*(?:Citation Key|bibtex)\s*:\s*(\S+)\s*$/im.exec(data.extra ?? "")?.[1] || ""

export const SKIP_TYPES = new Set(["note", "attachment", "annotation"])
