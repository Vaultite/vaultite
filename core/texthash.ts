// A quick fingerprint of a text: what a big file's save sends instead of its base (core/files.ts PUT, web autosave).

/** Saves of a text past this send its base's fingerprint, not the base, and get no copy of what they sent back. */
export const LEAN_PAST = 1 << 20

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
