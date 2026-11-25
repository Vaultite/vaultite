// What locked calls go by when only Touch ID opens the file: no secret, and 16 bits of each password's HMAC (too few to guess it).
import crypto from "node:crypto"
import { z } from "zod"
import { INDEX_ROW } from "./kdbxwire.ts"
import { matchesSite } from "./loginsites.ts"

const INDEX = z.object({ file: z.string(), salt: z.string(), rows: z.array(INDEX_ROW) })
export type Index = z.infer<typeof INDEX>
export function indexOf(text: string): Index | null {
  try { return INDEX.parse(JSON.parse(text)) } catch { return null }
}

export const fingerprint = (salt: string, id: string, password: string) =>
  crypto.createHmac("sha256", Buffer.from(salt, "base64")).update(`${id}\0${password}`).digest("hex").slice(0, 4)
export const newSalt = () => crypto.randomBytes(32).toString("base64")

export const indexedFor = (x: Index, url: string) => x.rows.filter((r) => r.urls.some((u) => matchesSite(u, url))).map(({ fp: _, ...row }) => row)
export const indexedSame = (x: Index, ids: string[], password: string) =>
  x.rows.filter((r) => ids.includes(r.id) && r.fp === fingerprint(x.salt, r.id, password)).map((r) => r.id)
