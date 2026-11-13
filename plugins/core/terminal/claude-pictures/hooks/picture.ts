import type { ImageSource } from 'claude-code'
import { CELL_PX } from '../decode/cells.ts'
import { fit } from '../decode/fit.ts'
import { decodePicture } from '../decode/index.ts'
import type { Rgba } from '../decode/pixels.ts'

const MAX_COLUMNS = 48, MAX_ROWS = 16
const CELL_ASPECT = CELL_PX.height / CELL_PX.width
/** Claude Code refuses a tree with more than 2 MiB of Image source: kept under it as base64, should it count those. */
const ROW_BYTES = ((2 << 20) * 3) / 4 - 4096
const SIDE_MAX = 2048
const DECODED_MAX = 4096 * 4096

export type Picture = { pixels: Rgba; columns: number; rows: number; sent?: { share: number; source: ImageSource } }
export type Drawn = { source: ImageSource; columns: number; rows: number }

export function decoded(bytes: Uint8Array): Picture | { why: string } {
  const got = decodePicture(bytes, { maxPixels: DECODED_MAX })
  if ('why' in got) return got
  const { columns, rows } = cells(got.pixels.width, got.pixels.height)
  const pixels = fit(got.pixels, Math.min(SIDE_MAX, columns * CELL_PX.width), Math.min(SIDE_MAX, rows * CELL_PX.height), Infinity)
  return { pixels, columns, rows }
}

export function drawn(p: Picture, share: number): Drawn {
  if (p.sent?.share !== share) {
    const px = fit(p.pixels, Infinity, Infinity, Math.floor(ROW_BYTES / share / 4))
    p.sent = { share, source: { rgba: px.data.toBase64(), width: px.width, height: px.height } }
  }
  return { source: p.sent.source, columns: p.columns, rows: p.rows }
}

function cells(width: number, height: number) {
  let columns = Math.min(MAX_COLUMNS, Math.max(1, Math.round(width / 8)))
  let rows = Math.max(1, Math.round((columns * height) / width / CELL_ASPECT))
  if (rows > MAX_ROWS) { rows = MAX_ROWS; columns = Math.max(1, Math.round((rows * CELL_ASPECT * width) / height)) }
  return { columns, rows }
}
