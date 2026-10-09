// What a plugin may write outside .vaultite/ on its own (core/writegate.ts): its manifest's `writes` declares where and
// why, and the user answers once per plugin, kept in .vaultite/grants.json ({"activity": {"Recaps": "allowed"}}).
// "ask": a write wanted it before the user was asked, so the app asks; "not now": asked, and not given.
import type { Plugin } from "./plugins.ts"
import { enabled } from "./plugins.ts"
import type { Item, Vault } from "./vault.ts"

/** One place a plugin writes on its own: a folder (and what's in it) or one file, and why, said to the user. */
export type WriteDecl = { folder?: string; file?: string; why: string }
export type Answer = "allowed" | "not now" | "ask"
/** A declared write as the app lists it, with the user's answer (null: never asked). */
export type Grant = { plugin: string; name: string; on: boolean; place: string; folder: boolean; why: string; answer: Answer | null
  /** Where it writes now: the declared folder, or where the user keeps that kind's files (Inbox/Recaps). */
  at: string }

export const GRANTS = "grants"
const ANSWERS: Answer[] = ["allowed", "not now", "ask"]

const isObj = (x: unknown): x is Item => !!x && typeof x === "object" && !Array.isArray(x)
const cleanPath = (s: string) => s.trim().replace(/^\/+|\/+$/g, "")

/** A plugin's declared writes (the ones that read). */
export function writesOf(p: Plugin): WriteDecl[] {
  return (Array.isArray(p.manifest.writes) ? p.manifest.writes as unknown[] : []).flatMap((w): WriteDecl[] => {
    if (!isObj(w) || typeof w.why !== "string") return []
    if (typeof w.folder === "string" && cleanPath(w.folder)) return [{ folder: cleanPath(w.folder), why: w.why.trim() }]
    if (typeof w.file === "string" && cleanPath(w.file)) return [{ file: cleanPath(w.file), why: w.why.trim() }]
    return []
  })
}

/** The name an answer is kept under: the folder or file as declared. */
const keyOf = (w: WriteDecl) => (w.folder ?? w.file)!

/** The user's answers, by plugin and declared place. */
export function answers(vault: Vault): Record<string, Record<string, Answer>> {
  let raw: Item = {}
  try { raw = vault.config(GRANTS) } catch { /* unreadable for now: nothing granted */ }
  const out: Record<string, Record<string, Answer>> = {}
  for (const [id, v] of Object.entries(raw)) {
    if (!isObj(v)) continue
    const mine = Object.entries(v).filter(([, a]) => ANSWERS.includes(a as Answer))
    if (mine.length) out[id] = Object.fromEntries(mine) as Record<string, Answer>
  }
  return out
}

/** A declared folder and where the user keeps its files now (the folder set for, or most of, the plugin's kinds that
 *  default to it), that first. */
function foldersOf(vault: Vault, p: Plugin, w: WriteDecl) {
  const out: string[] = []
  for (const k of p.kinds) {
    if (k.folder !== w.folder) continue
    try { const h = vault.home(k.collection); if (h) out.push(h) } catch { /* not registered here */ }
  }
  return [...new Set([...out, w.folder!])]
}

/** Whether a declared write covers `rel`: its file, or anything in its folder, wherever the user keeps it. */
function covers(vault: Vault, p: Plugin, w: WriteDecl, rel: string) {
  if (w.file) return rel === w.file
  return foldersOf(vault, p, w).some((f) => rel === f || rel.startsWith(`${f}/`))
}

/** May plugin `id`, acting on its own, write `rel`? Only where it declared and the user allowed. */
export function may(vault: Vault, plugins: Plugin[], id: string, rel: string) {
  const p = plugins.find((x) => x.id === id)
  if (!p) return false
  const mine = answers(vault)[id] ?? {}
  return writesOf(p).some((w) => mine[keyOf(w)] === "allowed" && covers(vault, p, w, rel))
}

/** Each declared write of the plugins given (`on`: of those that are on), with the user's answer. */
export function grantList(vault: Vault, plugins: Plugin[]): Grant[] {
  const on = enabled(vault, plugins), all = answers(vault)
  return plugins.flatMap((p) => writesOf(p).map((w) => ({
    plugin: p.id, name: String(p.manifest.name ?? p.id), on: on.has(p.id), place: keyOf(w), folder: !!w.folder, why: w.why,
    answer: all[p.id]?.[keyOf(w)] ?? null, at: w.file ?? foldersOf(vault, p, w)[0],
  })))
}

/** Record the user's answer for a plugin's declared writes (all of them, or `place`'s). Returns the writes answered. */
export function answer(vault: Vault, p: Plugin, allow: boolean, place?: string) {
  const decls = writesOf(p).filter((w) => !place || keyOf(w) === place)
  if (!decls.length) return []
  const cur = isObj(vault.config(GRANTS)[p.id]) ? vault.config(GRANTS)[p.id] as Item : {}
  const next = { ...cur, ...Object.fromEntries(decls.map((w) => [keyOf(w), allow ? "allowed" : "not now"])) }
  vault.patchConfig(GRANTS, { [p.id]: next })
  return decls.map(keyOf)
}

const told = new Set<string>()

/** A write the gate refused: said in the log (once per plugin and place), and a declared write the user was never
 *  asked about is marked "ask", so the app asks. Returns whether it was marked. */
export function refused(vault: Vault, plugins: Plugin[], id: string, rel: string) {
  const p = plugins.find((x) => x.id === id)
  const w = p ? writesOf(p).find((d) => covers(vault, p, d, rel)) : undefined
  const key = `${vault.path}\0${id}\0${w ? keyOf(w) : rel}`
  if (!told.has(key)) {
    told.add(key)
    console.warn(w ? `write refused: ${id} may not write ${rel} on its own until you allow it (${id}'s settings, Writes on its own)`
      : `write refused: ${id} wrote ${rel} on its own, which its manifest's writes doesn't declare`)
  }
  if (!p || !w || (answers(vault)[id] ?? {})[keyOf(w)]) return false
  try {
    const cur = isObj(vault.config(GRANTS)[id]) ? vault.config(GRANTS)[id] as Item : {}
    vault.patchConfig(GRANTS, { [id]: { ...cur, [keyOf(w)]: "ask" } })
    return true
  } catch (e) {
    console.error("grants:", e)
    return false
  }
}
