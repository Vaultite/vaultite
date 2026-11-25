// The user's own KeePass file, for the Passwords page (kdbxfile.ts): its groups and entries, edits, and the groups
// KeePassXC's KeeShare exports (agents.kdbx), written again as KeePassXC would. Node only, so its tests run without the app.
import path from "node:path"
import { Credentials, Kdbx, KdbxUuid, ProtectedValue, type KdbxEntry, type KdbxGroup } from "./kdbx/index.ts"
import { FREE_TAG, fieldsOf, urlsOf } from "./keepass.ts"
import { otpOf } from "./otp.ts"
import { historyOf, type Past } from "./kdbxhistory.ts"
import type { Change, GroupChange, Moves } from "./passwordswire.ts"

export type Group = { id: string; name: string; parent: string | null; share: string | null; bin: boolean; expanded: boolean }
export type Row = { id: string; group: string; title: string; username: string; urls: string[]; tags: string[]; free: boolean
  shared: boolean; expired: boolean; otp: boolean; modified: number }
export type Listed = Row & { expires: number | null; from: string | null }
export type Full = Listed & { password: boolean; notes: string; history: Past[] }
/** A group KeePassXC exports with KeeShare: where to, with which password, and whether its subgroups go too. */
export type Share = { group: string; path: string; password: string; keepGroups: boolean }

const REFERENCE = "KeeShare/Reference"
const isFree = (tags: string[]) => tags.some((t) => t.trim().toLowerCase() === FREE_TAG)

/** The groups KeePassXC exports (an Export reference), their paths made absolute against the file's own folder. */
export function sharesOf(db: Kdbx, file: string): Share[] {
  const out: Share[] = []
  const walk = (g: KdbxGroup) => {
    const raw = g.customData?.get(REFERENCE)?.value
    if (raw) {
      const xml = Buffer.from(raw, "base64").toString("utf8")
      const tag = (name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? ""
      const b64 = (v: string) => Buffer.from(v, "base64").toString("utf8")
      const type = xml.match(/<Type>([\s\S]*?)<\/Type>/)?.[1] ?? ""
      const p = b64(tag("Path"))
      if (/<Export\s*\/?>/.test(type) && p) {
        out.push({ group: g.uuid.id, path: path.isAbsolute(p) ? p : path.resolve(path.dirname(file), p), password: b64(tag("Password")), keepGroups: tag("KeepGroups") === "True" })
      }
    }
    for (const sub of g.groups) walk(sub)
  }
  walk(db.getDefaultGroup())
  return out
}

/** Groups, and entries without their secrets: those in an exported group are `shared` (agents' file has them). */
export function listOf(db: Kdbx, file: string): { groups: Group[]; entries: Listed[]; recycles: boolean } {
  const shares = sharesOf(db, file)
  const bin = db.meta.recycleBinUuid?.id
  const groups: Group[] = [], entries: Listed[] = []
  const now = Date.now()
  const walk = (g: KdbxGroup, parent: string | null, share: Share | null, inBin: boolean) => {
    const own = shares.find((s) => s.group === g.uuid.id)
    const here = own ?? (share?.keepGroups ? share : null)
    const binned = inBin || (!!bin && g.uuid.id === bin)
    groups.push({ id: g.uuid.id, name: g.name ?? "", parent, share: own ? own.path : null, bin: binned, expanded: g.expanded !== false })
    for (const e of g.entries) entries.push({ ...rowOf(e, g.uuid.id, !!here && !binned, now), from: binned ? cameFrom(db, e)?.uuid.id ?? null : null })
    for (const sub of g.groups) walk(sub, g.uuid.id, here, binned)
  }
  walk(db.getDefaultGroup(), null, null, false)
  return { groups, entries, recycles: recycles(db) }
}

function rowOf(e: KdbxEntry, group: string, shared: boolean, now = Date.now()): Omit<Listed, "from"> {
  const f = fieldsOf(e), expires = e.times.expires && e.times.expiryTime ? e.times.expiryTime.getTime() : null
  return { id: e.uuid.id, group, title: f.Title ?? "", username: f.UserName ?? "", urls: urlsOf(f), tags: [...e.tags], free: isFree(e.tags), shared,
    expired: expires !== null && expires < now, expires, otp: otpOf(f) !== null, modified: Number(e.times.lastModTime ?? 0) }
}

const entries = (g: KdbxGroup): KdbxEntry[] => [...g.entries, ...g.groups.flatMap(entries)]
export function entryById(db: Kdbx, id: string) {
  return entries(db.getDefaultGroup()).find((e) => e.uuid.id === id) ?? null
}

export function fullOf(db: Kdbx, file: string, id: string): Full | null {
  const row = listOf(db, file).entries.find((e) => e.id === id)
  const e = entryById(db, id)
  if (!row || !e) return null
  const f = fieldsOf(e)
  return { ...row, password: !!f.Password, notes: f.Notes ?? "", history: historyOf(e) }
}

const clean = (s: string, n = 4000) => s.slice(0, n)

function setExpiry(e: KdbxEntry, at: Change["expires"]) {
  if (at === undefined) return
  e.times.expires = at !== null
  if (at !== null) e.times.expiryTime = new Date(at)
}

/** Apply an edit (a new entry without `id`): the old values go to the entry's history, as KeePassXC keeps them. */
export function applyChange(db: Kdbx, c: Change): string {
  const group = c.group ? db.getGroup(c.group) : undefined
  if (c.group && !group) throw new Error("that group is gone from the file")
  let e: KdbxEntry
  if (c.id) {
    const found = entryById(db, c.id)
    if (!found) throw new Error("that entry is gone from the file (changed elsewhere?)")
    e = found
    e.pushHistory()
  } else e = db.createEntry(group ?? db.getDefaultGroup())
  e.fields.set("Title", clean(c.title, 500))
  e.fields.set("UserName", clean(c.username, 500))
  e.fields.set("Password", ProtectedValue.fromString(clean(c.password, 4000)))
  e.fields.set("Notes", clean(c.notes, 100_000))
  const urls = c.urls.map((u) => clean(u, 2000).trim()).filter(Boolean)
  for (const k of [...e.fields.keys()]) if (/^KP2A_URL(_\d+)?$/.test(k)) e.fields.delete(k)
  e.fields.set("URL", urls[0] ?? "")
  urls.slice(1).forEach((u, i) => e.fields.set(i ? `KP2A_URL_${i}` : "KP2A_URL", u))
  if (c.otp !== undefined) {
    if (c.otp.trim()) e.fields.set("otp", ProtectedValue.fromString(c.otp.trim()))
    else e.fields.delete("otp")
  }
  e.tags = [...new Set(c.tags.map((t) => clean(t, 100).trim()).filter(Boolean))]
  setExpiry(e, c.expires)
  e.times.update()
  if (c.id && group && e.parentGroup !== group) db.move(e, group)
  return e.uuid.id
}

const isBin = (db: Kdbx, g: KdbxGroup) => g.uuid.id === db.meta.recycleBinUuid?.id
function inBin(db: Kdbx, g: KdbxGroup | undefined) {
  for (let at = g; at; at = at.parentGroup) if (isBin(db, at)) return true
  return false
}

export const recycles = (db: Kdbx) => db.meta.recycleBinEnabled !== false

/** To the recycle bin, or `forever`: from the bin, or in a file that keeps none. Never the one when asked the other. */
export function removeEntry(db: Kdbx, id: string, forever = false) {
  const e = entryById(db, id)
  if (!e) return
  const gone = inBin(db, e.parentGroup) || !recycles(db)
  if (gone !== forever) throw new Error(gone ? "it's in the recycle bin already (moved elsewhere?)" : "it isn't in the recycle bin any more")
  if (forever) return db.move(e, null)
  db.createRecycleBin()
  db.remove(e)
}

const cameFrom = (db: Kdbx, e: KdbxEntry) => {
  const g = e.previousParentGroup && db.getGroup(e.previousParentGroup)
  return g && g !== e.parentGroup && !inBin(db, g) ? g : null
}

export function moveEntries(db: Kdbx, moves: Moves): string {
  for (const m of moves) {
    const e = entryById(db, m.id)
    if (!e) throw new Error("that entry is gone from the file")
    const to = db.getGroup(m.group)
    if (!to) throw new Error("that group is gone from the file")
    if (e.parentGroup !== to) db.move(e, to)
  }
  return moves[0].id
}

export function saveGroup(db: Kdbx, c: GroupChange): string {
  const parent = c.parent ? db.getGroup(c.parent) : db.getDefaultGroup(), g = c.id ? db.getGroup(c.id) : parent && db.createGroup(parent, c.name)
  if (!g) throw new Error("that group is gone from the file")
  g.name = c.name
  g.times.update()
  return g.uuid.id
}
export function removeGroup(db: Kdbx, id: string): string {
  const g = db.getGroup(id)
  if (!g) return id
  if (!g.parentGroup || isBin(db, g) || g.entries.length || g.groups.length) throw new Error("only an empty group can be deleted")
  db.move(g, null)
  return id
}

/** The file KeePassXC writes for an exported group: that group as its root, its entries (and with keepGroups, its
 *  subgroups) with their own ids and history, keyed with the share's password. */
export async function exportOf(db: Kdbx, share: Share): Promise<ArrayBuffer> {
  const src = db.getGroup(share.group)
  if (!src) throw new Error("the exported group is gone")
  const out = Kdbx.create(new Credentials(ProtectedValue.fromString(share.password)), src.name ?? "Shared")
  out.meta.recycleBinEnabled = false
  const root = out.getDefaultGroup()
  root.uuid = new KdbxUuid(src.uuid.id)
  root.name = src.name
  const copy = (from: KdbxGroup, to: KdbxGroup) => {
    for (const e of from.entries) {
      const made = out.importEntry(e, to, db)
      made.uuid = new KdbxUuid(e.uuid.id)
      for (const h of made.history) h.uuid = made.uuid
    }
    if (!share.keepGroups) return
    for (const g of from.groups) {
      const sub = out.createGroup(to, g.name ?? "")
      sub.uuid = new KdbxUuid(g.uuid.id)
      copy(g, sub)
    }
  }
  copy(src, root)
  for (const d of db.deletedObjects) if (d.uuid) out.addDeletedObject(d.uuid, d.deletionTime ?? new Date())
  return out.save()
}
