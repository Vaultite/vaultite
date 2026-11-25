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
}))
export type Change = z.infer<typeof CHANGE>
