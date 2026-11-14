import { z } from "zod"
import { CslItem } from "../csl.ts"
import { makeKey } from "../parse/keys.ts"
import { type Conn, citekeyIn, items, type Lib, SKIP_TYPES, versions, type ZoteroRow } from "./api.ts"

export const Kept = z.object({
  key: z.string(),
  version: z.number(),
  citekey: z.string(),
  item: CslItem.nullable(),
})
export type Kept = z.infer<typeof Kept>
export const KeptLibrary = z.object({ prefix: z.string(), name: z.string(), version: z.number(), items: z.array(Kept) })
export type KeptLibrary = z.infer<typeof KeptLibrary>

export type Citekeys = (keys: string[]) => Promise<Map<string, string>>

function keptItem(r: ZoteroRow, bbt: Map<string, string>, taken: Set<string>): Kept {
  if (SKIP_TYPES.has(r.data.itemType) || !r.csl) return { key: r.key, version: r.version, citekey: "", item: null }
  let citekey = citekeyIn(r.data) || bbt.get(r.key) || ""
  if (!citekey || taken.has(citekey)) citekey = makeKey(r.csl, taken)
  taken.add(citekey)
  return { key: r.key, version: r.version, citekey, item: { ...r.csl, id: citekey } }
}

async function bbtKeys(citekeys: Citekeys | null, fresh: ZoteroRow[]): Promise<Map<string, string>> {
  const asked = fresh.flatMap((r) => (citekeyIn(r.data) ? [] : [r.key]))
  if (!citekeys || !asked.length) return new Map()
  return citekeys(asked).catch(() => new Map<string, string>())
}

export async function sync(conn: Conn, lib: Lib, was: KeptLibrary | null, citekeys: Citekeys | null): Promise<KeptLibrary> {
  const now = await versions(conn, lib)
  const had = new Map((was?.items ?? []).map((k) => [k.key, k]))
  if (was && was.version === now.library && had.size === now.versions.size) return was
  const changed = [...now.versions].flatMap(([k, v]) => (had.get(k)?.version === v ? [] : [k]))
  const fresh = await items(conn, lib, changed)
  const bbt = await bbtKeys(citekeys, fresh)
  const kept = new Map<string, Kept>()
  for (const [k, v] of now.versions) { const old = had.get(k); if (old && old.version === v) kept.set(k, old) }
  const taken = new Set([...kept.values()].map((k) => k.citekey))
  for (const r of fresh) kept.set(r.key, keptItem(r, bbt, taken))
  return { prefix: lib.prefix, name: lib.name, version: now.library, items: [...kept.values()] }
}
