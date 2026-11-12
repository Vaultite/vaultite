// The formats Claude takes (PNG, JPEG, GIF, WebP), told by their first bytes and decoded to pixels: kitty graphics
// take PNG or pixels, and Claude Code allows a row few bytes of them, so the mod sends pixels sized to their cells.
import { decodeGif, isGif } from "./gif.ts"
import { decodeJpeg } from "./jpeg.ts"
import type { Limits, Rgba } from "./pixels.ts"
import { decodePng, isPng } from "./png.ts"
import { decodeWebp } from "./webp/index.ts"

export type Format = "png" | "jpeg" | "gif" | "webp"

/** A picture's format by its first bytes (whatever its name or media type say), or null for none Claude takes. */
export function formatOf(b: Uint8Array): Format | null {
  if (isPng(b)) return "png"
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg"
  if (isGif(b)) return "gif"
  if (b.length >= 12 && ascii(b, 0) === "RIFF" && ascii(b, 8) === "WEBP") return "webp"
  return null
}
const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

const DECODERS: Record<Format, (b: Uint8Array, limits: Limits) => Rgba> = { png: decodePng, jpeg: decodeJpeg, gif: decodeGif, webp: decodeWebp }

/** A picture's pixels (a GIF's or an animated WebP's first frame), or why not: one cut short, of a feature no decoder
 *  here has, or of more than `limits.maxPixels`. */
export function decodePicture(b: Uint8Array, limits: Limits): { pixels: Rgba } | { why: string } {
  const format = formatOf(b)
  if (!format) return { why: "not a picture" }
  const decode = DECODERS[format]
  try { return { pixels: decode(b, limits) } } catch (e) { return { why: `${format}: ${(e as Error)?.message ?? e}` } }
}
