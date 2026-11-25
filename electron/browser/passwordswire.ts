import { z } from "zod"

/** `key`: the password, encrypted by the system's keyring. `sealed`: by a Mac's Secure Enclave, then the keyring. */
const CONFIG = z.object({ file: z.string(), key: z.string().nullable().catch(null), sealed: z.string().optional().catch(undefined) })
export type Config = z.infer<typeof CONFIG>
export function configOf(text: string): Config | null {
  try { return CONFIG.parse(JSON.parse(text)) } catch { return null }
}

const TEXT = z.string().catch(""), TEXTS = z.array(TEXT).catch([])
export const CHANGE = z.preprocess((x) => (Array.isArray(x) ? {} : x), z.object({
  id: z.string().optional(), group: z.string().optional(), title: TEXT, username: TEXT, password: TEXT, urls: TEXTS, tags: TEXTS, notes: TEXT,
  otp: z.string().optional().catch(undefined),
  expires: z.number().nullable().optional().catch(undefined),
}))
export type Change = z.infer<typeof CHANGE>

export const MOVES = z.array(z.object({ id: z.string(), group: z.string() })).min(1).max(5000)
export type Moves = z.infer<typeof MOVES>
export const GROUP_CHANGE = z.object({ id: z.string().optional(), parent: z.string().optional(), name: z.string().trim().min(1).max(200) })
export type GroupChange = z.infer<typeof GROUP_CHANGE>
export const REMOVAL = z.object({ ids: z.array(z.string()).min(1), forever: z.boolean() })
export type Removal = z.infer<typeof REMOVAL>
