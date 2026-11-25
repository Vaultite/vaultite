import crypto from "node:crypto"
import type { Kdbx, KdbxEntry, KdbxGroup } from "./kdbx/index.ts"
import { entryById } from "./kdbxedit.ts"
import { passwordSince } from "./kdbxhistory.ts"
import { fieldsOf } from "./keepass.ts"

export type Health = { id: string; bits: number | null; same: string | null; since: number; excluded: boolean }
export type Hashes = Map<string, { rest: string; id: string }[]>

const REFERENCE = /^\{REF:/i
function kept(db: Kdbx): { e: KdbxEntry; password: string }[] {
  const bin = db.meta.recycleBinUuid?.id, out: { e: KdbxEntry; password: string }[] = []
  const walk = (g: KdbxGroup) => {
    if (bin && g.uuid.id === bin) return
    for (const e of g.entries) out.push({ e, password: fieldsOf(e).Password ?? "" })
    g.groups.forEach(walk)
  }
  walk(db.getDefaultGroup())
  return out
}
const own = (password: string) => !!password && !REFERENCE.test(password)

const keepsVersions = (db: Kdbx) => { const n = db.meta.historyMaxItems; return n === undefined || n < 0 ? Infinity : n }

export function healthOf(db: Kdbx, bits: (password: string) => number): Health[] {
  const limit = keepsVersions(db), all = kept(db), users = new Map<string, string[]>()
  for (const { e, password } of all) if (own(password)) users.set(password, [...users.get(password) ?? [], e.uuid.id])
  return all.map(({ e, password }) => {
    const ids = users.get(password) ?? []
    return { id: e.uuid.id, bits: own(password) ? bits(password) : null, same: ids.length > 1 ? ids[0] : null, since: passwordSince(e, limit), excluded: e.qualityCheck === false }
  })
}

export function setExcluded(db: Kdbx, id: string, on: boolean): string {
  const e = entryById(db, id)
  if (!e) throw new Error("that entry is gone from the file")
  if (db.header.versionMajor < 4) throw new Error("an older KeePass file (KDBX 3) can't keep that")
  if (db.header.versionMinor < 1) db.header.versionMinor = 1
  e.qualityCheck = on ? false : undefined
  e.times.update()
  return id
}

export function hashesOf(db: Kdbx): Hashes {
  const out: Hashes = new Map()
  for (const { e, password } of kept(db)) if (own(password)) {
    const h = crypto.createHash("sha1").update(password).digest("hex").toUpperCase(), start = h.slice(0, 5)
    out.set(start, [...out.get(start) ?? [], { rest: h.slice(5), id: e.uuid.id }])
  }
  return out
}
export function leaked(hashes: Hashes, start: string, range: string) {
  const mine = hashes.get(start)
  if (!mine) throw new Error("locked")
  const counts = new Map(Array.from(range.matchAll(/^([0-9A-F]{35}):(\d+)\s*$/gim), (m) => [m[1].toUpperCase(), Number(m[2])]))
  return mine.flatMap(({ rest, id }) => { const times = counts.get(rest) ?? 0; return times > 0 ? [{ id, times }] : [] })
}
