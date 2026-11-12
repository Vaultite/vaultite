// What draws a picture Claude got, whatever its format (PNG, JPEG, GIF, WebP): decoded here (decode/), then made as
// small as its cells need and its share of the row's bytes allows, sent as pixels.
import type { ImageSource } from 'claude-code'
import { fit } from '../decode/fit.ts'
import { decodePicture } from '../decode/index.ts'
import type { Rgba } from '../decode/pixels.ts'

/** The cells a picture takes at most; a cell is about twice as tall as it's wide. */
const MAX_COLUMNS = 48, MAX_ROWS = 16
/** A cell's size in pixels on the densest screen it's drawn on (termd's kitty.ts CELL_PX): pixels past it don't show. */
const CELL_PX = { width: 24, height: 48 }
/** Bytes of pictures one row's drawing may carry (Claude Code refuses a tree with more than 2 MiB of Image source; kept
 *  under it as base64, should it count those): what the row's pictures share. */
const ROW_BYTES = ((2 << 20) * 3) / 4 - 4096
/** A side of pixels an Image takes at most. */
const SIDE_MAX = 2048
/** Pixels a decoder here decodes at most: 4096 × 4096, well past what Claude Code sends (it resizes to fit Claude's
 *  limits), and what keeps a few-byte file claiming more from taking the worker's memory. */
const DECODED_MAX = 4096 * 4096

/** A picture decoded, already no bigger than its cells show; what it was last sent as. */
export type Picture = { pixels: Rgba; columns: number; rows: number; sent?: { share: number; source: ImageSource } }
export type Drawn = { source: ImageSource; columns: number; rows: number }

/** `bytes` (a picture Claude got) decoded for its cells, or why it can't be. */
export function decoded(bytes: Uint8Array): Picture | { why: string } {
  const got = decodePicture(bytes, { maxPixels: DECODED_MAX })
  if ('why' in got) return got
  const { columns, rows } = cells(got.pixels.width, got.pixels.height)
  const pixels = fit(got.pixels, Math.min(SIDE_MAX, columns * CELL_PX.width), Math.min(SIDE_MAX, rows * CELL_PX.height), Infinity)
  return { pixels, columns, rows }
}

/** What draws `p` as one of `share` pictures in a row. */
export function drawn(p: Picture, share: number): Drawn {
  if (p.sent?.share !== share) {
    const px = fit(p.pixels, Infinity, Infinity, Math.floor(ROW_BYTES / share / 4))
    p.sent = { share, source: { rgba: px.data.toBase64(), width: px.width, height: px.height } }
  }
  return { source: p.sent.source, columns: p.columns, rows: p.rows }
}

/** Cells for a picture of `width` × `height` px: its shape kept, within MAX_COLUMNS × MAX_ROWS. */
function cells(width: number, height: number) {
  let columns = Math.min(MAX_COLUMNS, Math.max(1, Math.round(width / 8)))
  let rows = Math.max(1, Math.round((columns * height) / width / 2))
  if (rows > MAX_ROWS) { rows = MAX_ROWS; columns = Math.max(1, Math.round((rows * 2 * width) / height)) }
  return { columns, rows }
}
