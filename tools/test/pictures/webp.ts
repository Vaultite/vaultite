// WebP's container and lossy pictures against libwebp's (exact); damaged and oversized input. How the fixtures were
// made: tools/fixtures/pictures/webp/CLAUDE.md.
import fs from "node:fs"
import path from "node:path"
import { Unreadable } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { decodeWebp } from "../../../plugins/core/terminal/claude-pictures/decode/webp/index.ts"
import { check, section } from "../lib.ts"
import { checkPicture, FIXTURES, fixture, LIMITS, reference } from "./compare.ts"

const DIR = "webp"

/** How a damaged copy went: decoded, thrown Unreadable, or thrown something else (a bug); and how long it took. */
function attempt(data: Uint8Array) {
  const t0 = performance.now()
  let how = "decoded"
  try { decodeWebp(data, LIMITS) } catch (e) { how = e instanceof Unreadable ? "unreadable" : `threw ${String(e)}` }
  return { how, ms: performance.now() - t0 }
}

/** A RIFF WebP of `chunks` (fourcc and payload each, an odd one padded). */
function riff(...chunks: [string, Uint8Array][]) {
  const parts: number[] = []
  for (const [tag, payload] of chunks) {
    const n = payload.length
    parts.push(...[...tag].map((c) => c.charCodeAt(0)), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...payload)
    if (n & 1) parts.push(0)
  }
  const n = parts.length + 4
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, 0x57, 0x45, 0x42, 0x50, ...parts])
}

const le24 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255]

export async function testWebp(): Promise<void> {
  await section("webp", () => {
    const files = fs.readdirSync(path.join(FIXTURES, DIR)).filter((f) => f.endsWith(".webp")).sort()
    for (const f of files) {
      const rel = `${DIR}/${f}`
      let got = null
      try { got = decodeWebp(fixture(rel), LIMITS) } catch (e) { check(`decodes ${f}`, false, String(e)); continue }
      checkPicture(`decodes ${f} as ${f.startsWith("anim") ? "PIL's first frame" : "dwebp does"}`, got, reference(rel))
    }

    // (the largest fixture's decode, warm: logged, not held to a time)
    const big = fixture(`${DIR}/q95.webp`)
    decodeWebp(big, LIMITS)
    const t0 = performance.now()
    for (let i = 0; i < 10; i++) decodeWebp(big, LIMITS)
    console.log(`     q95.webp (160x128, ${big.length} bytes) decodes in ${((performance.now() - t0) / 10).toFixed(2)} ms`)

    // Damage: every cut, and bytes flipped at random (a fixed seed), of a lossy, multi-partition, alpha and animated file
    for (const f of ["q50", "vpx8", "alpha-fast", "alpha-raw-f3", "anim-offset", "metadata"]) {
      const b = fixture(`${DIR}/${f}.webp`)
      const hows = new Map<string, number>()
      let slowest = 0
      const tally = (r: { how: string; ms: number }) => { hows.set(r.how, (hows.get(r.how) ?? 0) + 1); slowest = Math.max(slowest, r.ms) }
      for (let n = 0; n < b.length; n += Math.max(1, b.length >> 7)) tally(attempt(b.subarray(0, n)))
      for (let seed = 1; seed <= 150; seed++) {
        const d = b.slice()
        for (let k = 0, s = seed; k < 6; k++) { s = (s * 1103515245 + 12345) >>> 0; d[s % d.length] ^= 1 << ((s >> 8) & 7) }
        tally(attempt(d))
      }
      // (and a simple file's VP8 frame cut anywhere in a container sized to it: the frame's own checks, not the RIFF's)
      if (f === "q50" || f === "vpx8") {
        const frame = b.subarray(20, 20 + (b[16] | (b[17] << 8) | (b[18] << 16)))
        for (let n = 0; n < frame.length; n += Math.max(1, frame.length >> 8)) tally(attempt(riff(["VP8 ", frame.subarray(0, n)])))
      }
      const bugs = [...hows.keys()].filter((h) => h.startsWith("threw"))
      check(`${f}.webp cut short or flipped decodes or throws Unreadable, each under a second`, !bugs.length && slowest < 1000, { hows: Object.fromEntries(hows), slowest })
    }

    // Too big: refused from the header, before anything is allocated
    const small = { maxPixels: 1 << 20 }
    const vp8 = fixture(`${DIR}/one.webp`).subarray(20)
    const huge = riff(["VP8X", new Uint8Array([0, 0, 0, 0, ...le24(16383), ...le24(16383)])], ["VP8 ", vp8])
    let why = ""
    try { decodeWebp(huge, small) } catch (e) { why = e instanceof Unreadable ? e.message : `threw ${e}` }
    check("a VP8X canvas of 16384x16384 is refused under a smaller limit", /too many pixels/.test(why), why)
    const frame = vp8.slice()
    frame[6] = frame[8] = 0xff
    frame[7] = frame[9] = 0x3f
    why = ""
    try { decodeWebp(riff(["VP8 ", frame]), small) } catch (e) { why = e instanceof Unreadable ? e.message : `threw ${e}` }
    check("a VP8 frame of 16383x16383 is refused under a smaller limit", /too many pixels/.test(why), why)
    why = ""
    try { decodeWebp(riff(["VP8X", new Uint8Array([0, 0, 0, 0, ...le24(36), ...le24(22)])], ["VP8 ", vp8]), LIMITS) } catch (e) { why = e instanceof Unreadable ? e.message : `threw ${e}` }
    check("a picture of another size than its canvas is refused", /sizes differ/.test(why), why)
  })
}
