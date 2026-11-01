// A quick fingerprint of a text and one edit between two texts: what an editor's save sends instead of its text and
// base, and gets back instead of the file (core/files.ts PUT, web autosave).

/** An open text past this is read again after a change only when its file's time or size moved (often its own save). */
export const LEAN_PAST = 8 << 10

/** Two FNV-1a hashes over its UTF-16 units (64 bits), and its length. */
export function textHash(t: string): string {
  let a = 0x811c9dc5, b = 0x050c5d1f
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x2c1b3c6d)
  }
  return `${t.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`
}

/** One edit that turns `a` into `b`: `cut` characters at `at` replaced with `add` (the parts both share kept). */
export type TextEdit = { at: number; cut: number; add: string }
export function editOf(a: string, b: string): TextEdit {
  const most = Math.min(a.length, b.length)
  let at = 0
  while (at < most && a.charCodeAt(at) === b.charCodeAt(at)) at++
  let end = 0
  while (end < most - at && a.charCodeAt(a.length - 1 - end) === b.charCodeAt(b.length - 1 - end)) end++
  return { at, cut: a.length - at - end, add: b.slice(at, b.length - end) }
}
/** `a` with the edit made, or null when it isn't one of `a`'s. */
export function applyEdit(a: string, e: unknown): string | null {
  const { at, cut, add } = (e ?? {}) as Partial<TextEdit>
  if (!Number.isInteger(at) || !Number.isInteger(cut) || typeof add !== "string" || at! < 0 || cut! < 0 || at! + cut! > a.length) return null
  return a.slice(0, at) + add + a.slice(at! + cut!)
}
