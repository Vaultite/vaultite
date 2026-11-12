// What every decoder here answers: a picture's pixels, as the kitty graphics protocol takes them raw (RGBA). The
// decoders are plain TypeScript on bytes (no Node, no DOM): they run in Claude Code's mod worker, and in tests.

/** A picture's pixels: `width * height` of them, rows top to bottom, 4 bytes each (R, G, B, A), not premultiplied. */
export type Rgba = { width: number; height: number; data: Uint8Array }

/** What a decoder may decode to at most: a picture of more pixels is refused before anything is allocated for it. */
export type Limits = { maxPixels: number }

/** Bytes a decoder can't read (cut short, a field out of range, a feature it doesn't have): thrown inside a decoder,
 *  caught by decodePicture (index.ts), which answers null for it. */
export class Unreadable extends Error {}

/** Throws Unreadable with `why` unless `ok`. */
export function need(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Unreadable(why)
}

/** A picture's size checked against `limits` (and against nonsense) before its pixels are allocated. */
export function sized(width: number, height: number, limits: Limits): void {
  need(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0, `bad size ${width}x${height}`)
  need(width * height <= limits.maxPixels, `too many pixels: ${width}x${height}`)
}
