// Pictures decoded here held against a reference decoder's pixels (libjpeg's, libwebp's...), kept beside each fixture
// as `<name>.ref.png` (RGBA): decoded with termd's own PNG decoder, so the reference needs nothing installed.
import fs from "node:fs"
import path from "node:path"
import type { Limits, Rgba } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { decodePng } from "../../../plugins/core/terminal/termd/png.ts"
import { check } from "../lib.ts"

export const FIXTURES = path.join(import.meta.dirname, "../../fixtures/pictures")
export const LIMITS: Limits = { maxPixels: 64 << 20 }

/** A fixture's bytes. */
export const fixture = (rel: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)))

/** `<name>.ref.png` beside a fixture, as RGBA (an opaque reference gets alpha 255). */
export function reference(rel: string): Rgba {
  const file = path.join(FIXTURES, rel.replace(/\.[^./]+$/, ".ref.png"))
  const px = decodePng(fs.readFileSync(file), LIMITS.maxPixels * 4)
  if (!px) throw new Error(`no reference: ${file}`)
  if (px.channels === 4) return { width: px.width, height: px.height, data: new Uint8Array(px.data) }
  const data = new Uint8Array(px.width * px.height * 4)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { data[i] = px.data[j]; data[i + 1] = px.data[j + 1]; data[i + 2] = px.data[j + 2]; data[i + 3] = 255 }
  return { width: px.width, height: px.height, data }
}

/** How far two pictures' pixels are: the largest difference of one channel, and the mean over all of them. */
export function distance(a: Rgba, b: Rgba) {
  if (a.width !== b.width || a.height !== b.height) return { max: Infinity, mean: Infinity }
  let max = 0, sum = 0
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i] - b.data[i]); sum += d; if (d > max) max = d }
  return { max, mean: sum / a.data.length }
}

/** A check that `got` is the reference's picture: exactly (`max` 0), or within `max` a channel and `mean` overall
 *  (a lossy format's decoders may round its transform differently). */
export function checkPicture(name: string, got: Rgba | null, ref: Rgba, tolerance: { max: number; mean: number } = { max: 0, mean: 0 }) {
  if (!got) return check(name, false, "not decoded")
  const d = distance(got, ref)
  return check(name, d.max <= tolerance.max && d.mean <= tolerance.mean, { size: `${got.width}x${got.height}`, want: `${ref.width}x${ref.height}`, ...d })
}
