// A scan's entropy-coded data into the frame, as libjpeg's jdhuff.c and jdphuff.c read it: sequential blocks
// inverse-transformed as read, progressive coefficients kept till the last scan, restarts recovered from like it.
import { BitReader, type Huffman } from "./huffman.ts"
import { type Component, type Frame, NATURAL } from "./frame.ts"
import { idct } from "./idct.ts"

/** What SOS says of a scan: its components, the tables each codes with (null where the scan needs none), and, in a
 *  progressive frame, its band (`ss..se`) and bit (`ah`: the last scan's, 0 for a first; `al`: this one's). */
export type Scan = {
  components: Component[]
  dc: (Huffman | null)[]
  ac: (Huffman | null)[]
  ss: number
  se: number
  ah: number
  al: number
}

/** Decodes the scan whose data starts at `pos`, every `interval` MCUs a restart (0: none). Where the next marker is
 *  (the bytes' length when none is). */
export function decodeScan(data: Uint8Array, pos: number, frame: Frame, scan: Scan, interval: number): number {
  const r = new BitReader(data, pos)
  const { components: comps, dc, ac, ss, se, ah, al } = scan
  const preds = new Int32Array(comps.length)
  const block = new Int16Array(64), spare = new Int16Array(64)
  let eobrun = 0

  // (one block, `ci` the component's place in the scan, at block row `row` and column `col` of the component: those
  // past its blocks, in an edge MCU, are read and dropped)
  const sequential = (c: Component, ci: number, row: number, col: number) => {
    const s = r.decode(dc[ci]!)
    preds[ci] += s ? r.extend(s) : 0
    block[0] = preds[ci]
    const t = ac[ci]!
    let dcOnly = true
    for (let k = 1; k < 64; k++) {
      const rs = r.decode(t), run = rs >> 4, size = rs & 15
      if (size) { k += run; block[NATURAL[k]] = r.extend(size); dcOnly = false }
      else if (run === 15) k += 15
      else break
    }
    if (row < c.blocksH && col < c.blocksW) idct(block, 0, c.quant!, c.plane, row * 64 * c.blocksW + col * 8, c.blocksW * 8, dcOnly)
    block.fill(0)
  }
  const dcFirst = (c: Component, ci: number, row: number, col: number) => {
    const s = r.decode(dc[ci]!)
    preds[ci] += s ? r.extend(s) : 0
    const inside = row < c.blocksH && col < c.blocksW
    ;(inside ? c.coefs! : spare)[inside ? (row * c.blocksW + col) * 64 : 0] = preds[ci] << al
  }
  const dcRefine = (c: Component, _ci: number, row: number, col: number) => {
    if (r.getBits(1) && row < c.blocksH && col < c.blocksW) c.coefs![(row * c.blocksW + col) * 64] |= 1 << al
  }
  // (AC scans have one component: their blocks are all inside it)
  const acFirst = (c: Component, ci: number, row: number, col: number) => {
    if (eobrun > 0) { eobrun--; return }
    const co = c.coefs!, at = (row * c.blocksW + col) * 64, t = ac[ci]!
    for (let k = ss; k <= se; k++) {
      const rs = r.decode(t), run = rs >> 4, size = rs & 15
      if (size) { k += run; co[at + NATURAL[k]] = r.extend(size) * (1 << al) }
      else if (run === 15) k += 15
      else { eobrun = (1 << run) - 1 + (run ? r.getBits(run) : 0); break }
    }
  }
  const p1 = 1 << al, m1 = -1 << al
  const acRefine = (c: Component, ci: number, row: number, col: number) => {
    const co = c.coefs!, at = (row * c.blocksW + col) * 64, t = ac[ci]!
    let k = ss
    if (eobrun === 0) {
      for (; k <= se; k++) {
        const rs = r.decode(t)
        let run = rs >> 4, s = 0
        // (a new coefficient is ±1 at this bit; libjpeg reads any other size as 1, warning)
        if (rs & 15) s = r.getBits(1) ? p1 : m1
        else if (run !== 15) { eobrun = (1 << run) + (run ? r.getBits(run) : 0); break }
        // (past `run` zero coefficients, each nonzero one met getting its correction bit, to where the new one goes)
        do {
          const z = at + NATURAL[k]
          if (co[z] !== 0) { if (r.getBits(1) && (co[z] & p1) === 0) co[z] += co[z] >= 0 ? p1 : m1 }
          else if (--run < 0) break
          k++
        } while (k <= se)
        if (s) co[at + NATURAL[k]] = s
      }
    }
    if (eobrun > 0) {
      // (the rest of the band is in an end-of-band run: only its nonzero coefficients' correction bits)
      for (; k <= se; k++) {
        const z = at + NATURAL[k]
        if (co[z] !== 0 && r.getBits(1) && (co[z] & p1) === 0) co[z] += co[z] >= 0 ? p1 : m1
      }
      eobrun--
    }
  }
  const decode = !frame.progressive ? sequential : ss === 0 ? (ah === 0 ? dcFirst : dcRefine) : ah === 0 ? acFirst : acRefine

  // (one component: an MCU is one of its blocks, row by row; more: whole MCUs, each its components' blocks in turn)
  const one = comps.length === 1 ? comps[0] : null
  const mcus = one ? one.blocksW * one.blocksH : frame.mcusX * frame.mcusY
  for (let m = 0, rst = 0; m < mcus; m++) {
    if (interval && m > 0 && m % interval === 0) {
      restart(r, rst)
      rst = (rst + 1) & 7
      preds.fill(0)
      eobrun = 0
    }
    if (r.exhausted) continue
    if (one) {
      const row = (m / one.blocksW) | 0
      decode(one, 0, row, m - row * one.blocksW)
      continue
    }
    const my = (m / frame.mcusX) | 0, mx = m - my * frame.mcusX
    for (let ci = 0; ci < comps.length; ci++) {
      const c = comps[ci]
      for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) decode(c, ci, my * c.v + v, mx * c.h + h)
    }
  }
  return r.seekMarker() < 0 ? data.length : r.pos
}

/** Past restart marker `n` (0..7), as libjpeg's read_restart_marker and jpeg_resync_to_restart find it: a missing or
 *  misnumbered one costs only the segments it left out (mid-grey, or what earlier scans gave), not the rest. */
function restart(r: BitReader, n: number) {
  const dry = r.exhausted
  for (let m = r.seekMarker(); ;) {
    if (m === 0xd0 + n) { r.pos += 2; return }
    const rst = m >= 0xd0 && m <= 0xd7 ? m - 0xd0 : -1
    // (not a marker that can follow a scan's data, or a restart we're past: skipped, and the next one considered)
    if (m >= 0 && (m < 0xc0 || rst === ((n - 1) & 7) || rst === ((n - 2) & 7))) { r.pos += 2; m = r.seekMarker(); continue }
    // (the bytes' end, another marker, or one of the next two restarts: this segment is missing, the marker kept. As
    // libjpeg's, its first MCU decodes from zeros unless the last segment had run out already.)
    if (rst < 0 || rst === ((n + 1) & 7) || rst === ((n + 2) & 7)) { r.starve(dry); return }
    // (one too far off to tell: taken for this one)
    r.pos += 2
    return
  }
}
