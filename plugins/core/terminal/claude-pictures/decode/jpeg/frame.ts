export type Component = {
  id: number
  h: number
  v: number
  tq: number
  /** As it was at the component's first scan: libjpeg latches it there. */
  quant: Int32Array | null
  width: number
  height: number
  blocksW: number
  blocksH: number
  plane: Uint8Array
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
