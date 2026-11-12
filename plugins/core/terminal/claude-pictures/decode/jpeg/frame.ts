// A JPEG frame as its scans fill it in: the components' sample planes, and, progressive, their coefficients till the
// last scan.

/** One component of the frame (Y, Cb, Cr, K...). */
export type Component = {
  id: number
  /** Sampling factors, 1..4. */
  h: number
  v: number
  /** Which quantization table it names, and that table as it was at its first scan (libjpeg latches it there). */
  tq: number
  quant: Int32Array | null
  /** Its size in samples (the picture's, scaled by its sampling against the largest), and in the blocks covering
   *  that: what a scan of it alone walks. An interleaved scan's MCUs at the edges have more, which show nowhere. */
  width: number
  height: number
  blocksW: number
  blocksH: number
  /** Its samples, `blocksW * 8` a row; a block no scan reached stays mid-grey (as a block of zeros decodes). */
  plane: Uint8Array
  /** Progressive only: 64 coefficients a block, in natural order, the blocks as in the plane. */
  coefs: Int16Array | null
}

export type Frame = {
  width: number
  height: number
  progressive: boolean
  components: Component[]
  hmax: number
  vmax: number
  mcusX: number
  mcusY: number
}

/** libjpeg's zigzag-to-natural order, padded with 63s: a corrupt run that overshoots lands on the last coefficient,
 *  as libjpeg's does, rather than past the block. */
export const NATURAL = Int32Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
  63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63, 63,
])
