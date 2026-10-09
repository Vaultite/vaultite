// Edits the server hasn't confirmed yet, kept on this device (per vault and file) until it has: a window closed or
// killed mid-save offers them back the next time the file opens (FileView).
import { getStore } from "@/core/data"

export type Draft = { text: string; base: string; t: number }

const PREFIX = "vaultite.draft:"
const key = (path: string) => `${PREFIX}${getStore()?.vault.path ?? ""}:${path}`

/** What fits in this device's storage (a few MB per site). */
const MAX = 2_000_000

/** Keep `text` (typed over `base`, what the server had, to merge with) until `dropDraft`; the base only while both
 *  fit. A text too big for it isn't kept. */
export function keepDraft(path: string, text: string, base: string) {
  if (text.length > MAX) return dropDraft(path)
  const kept: Draft = { text, base: text.length + base.length <= MAX ? base : "", t: Date.now() }
  try { localStorage.setItem(key(path), JSON.stringify(kept)) } catch { /* private mode, or full */ }
}

export function dropDraft(path: string) {
  try { localStorage.removeItem(key(path)) } catch { /* private mode */ }
}

/** The edits kept for a file, unless they're what it has now (they did get saved). */
export function draftOf(path: string, now: string): Draft | null {
  let kept: Draft | null = null
  try { kept = JSON.parse(localStorage.getItem(key(path)) ?? "null") } catch { /* private mode, or not JSON */ }
  if (!kept || typeof kept.text !== "string") return null
  if (kept.text === now) { dropDraft(path); return null }
  return kept
}
