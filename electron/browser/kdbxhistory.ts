import type { Kdbx, KdbxEntry } from "./kdbx/index.ts"
import { entryById } from "./kdbxedit.ts"
import { FREE_TAG, fieldsOf, urlsOf } from "./keepass.ts"

export type Past = { at: number; until: number; changed: string[] }
export type Version = { at: number; title: string; username: string; password: boolean; urls: string[]; notes: string }

export const modified = (e: KdbxEntry) => Number(e.times.lastModTime ?? 0)
const versions = (e: KdbxEntry) => [...e.history].sort((a, b) => modified(a) - modified(b))
const NAMES = new Map([["Title", "title"], ["UserName", "username"], ["Password", "password"], ["Notes", "notes"], ["otp", "one-time code"]])
const named = (field: string) => (/^(URL|KP2A_URL(_\d+)?)$/.test(field) ? "website" : NAMES.get(field) ?? "other fields")

function changes(was: KdbxEntry, now: KdbxEntry) {
  const a = fieldsOf(was), b = fieldsOf(now)
  const out = new Set<string>()
  for (const k of [...Object.keys(a), ...Object.keys(b)]) if ((a[k] ?? "") !== (b[k] ?? "")) out.add(named(k))
  if ([...was.tags].sort().join() !== [...now.tags].sort().join()) out.add("tags")
  return [...out]
}

export function historyOf(e: KdbxEntry): Past[] {
  const all = [...versions(e), e]
  return all.slice(0, -1).map((v, i) => ({ at: modified(v), until: modified(all[i + 1]), changed: changes(v, all[i + 1]) })).reverse()
}

export function passwordSince(e: KdbxEntry, keptVersions: number): number {
  const now = fieldsOf(e).Password ?? ""
  let since = modified(e)
  for (const v of versions(e).reverse()) {
    if ((fieldsOf(v).Password ?? "") !== now) return since
    since = modified(v)
  }
  return e.history.length >= keptVersions ? since : Math.min(since, Number(e.times.creationTime ?? since))
}

function found(db: Kdbx, id: string, at: number) {
  const e = entryById(db, id), v = e?.history.find((h) => modified(h) === at)
  if (!e || !v) throw new Error("that version is gone from the file")
  return { e, v }
}
export function versionOf(db: Kdbx, id: string, at: number): Version {
  const f = fieldsOf(found(db, id, at).v)
  return { at, title: f.Title ?? "", username: f.UserName ?? "", password: !!f.Password, urls: urlsOf(f), notes: f.Notes ?? "" }
}
export const passwordAt = (db: Kdbx, id: string, at: number) => fieldsOf(found(db, id, at).v).Password ?? ""
export function restoreVersion(db: Kdbx, id: string, at: number): string {
  const { e, v } = found(db, id, at), { times, uuid, tags } = e, isFree = (t: string) => t.trim().toLowerCase() === FREE_TAG
  e.pushHistory()
  e.copyFrom(v)
  // (older versions may carry another id; and what agents may use without asking is the user's choice of now)
  Object.assign(e, { times, uuid, tags: [...v.tags.filter((t) => !isFree(t)), ...tags.filter(isFree)] })
  e.times.update()
  return id
}
