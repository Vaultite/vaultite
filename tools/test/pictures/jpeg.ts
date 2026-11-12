// JPEG (decode/jpeg.ts) against libjpeg-turbo's pixels, exactly, and bytes it can't read failing cleanly and fast.
// How each fixture and its reference were made: tools/fixtures/pictures/jpeg/CLAUDE.md.
import { decodeJpeg } from "../../../plugins/core/terminal/claude-pictures/decode/jpeg.ts"
import { type Limits, type Rgba, Unreadable } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { check, cpuMs, section } from "../lib.ts"
import { checkPicture, distance, fixture, LIMITS, reference } from "./compare.ts"

const PICTURES = [
  "444", "422", "420", "411", "440", "odd-sampling", "odd", "odd-422", "tiny-420", "gray", "gray-2x2", "multiscan", "sof1",
  "progressive", "progressive-444", "restart", "progressive-restart", "rgb", "rgb-ids", "cmyk", "ycck",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `orient-${n}`), "restart-ahead", "restart-missing", "cut",
]

export async function testJpeg(): Promise<void> {
  await section("jpeg", () => {
    // (exact: the same integer IDCT, upsampling filters, colour tables and recovery from damage as libjpeg-turbo's)
    for (const name of PICTURES) checkPicture(`jpeg ${name}`, decodeJpeg(fixture(`jpeg/${name}.jpg`), LIMITS), reference(`jpeg/${name}.jpg`))
    const big = fixture("jpeg/timing.jpg")
    decodeJpeg(big, LIMITS)
    const { value, ms } = cpuMs(() => decodeJpeg(big, LIMITS))
    check("jpeg decodes an 800x600 4:2:0 picture", value.width === 800 && value.height === 600, value)
    console.log(`     (800x600 in ${ms.toFixed(1)} ms of CPU)`)

    // (cut short, a progressive picture shows what its early scans gave: not exactly libjpeg's, which smooths the
    // blocks of a picture whose coefficients are missing bits; mean 3 off it, here)
    const prog = fixture("jpeg/progressive.jpg"), early = decodeJpeg(prog.subarray(0, Math.floor(prog.length * 0.6)), LIMITS)
    const d = distance(early, reference("jpeg/progressive.jpg"))
    check("jpeg progressive cut short shows its first scans", d.mean > 0 && d.mean < 6, d)
    // (a restart marker numbered too far off to tell is taken for the one due, as libjpeg's is)
    const rst = fixture("jpeg/restart.jpg"), far = rst.slice()
    far[markers(rst, 0xd1)[0] + 1] = 0xd5
    checkPicture("jpeg a restart marker numbered far off", decodeJpeg(far, LIMITS), reference("jpeg/restart.jpg"))
  })

  await section("jpeg: bytes it can't read", () => {
    const limits: Limits = { maxPixels: 1 << 20 }
    const tally = { runs: 0, decoded: 0, refused: 0, slowestMs: 0, wrong: [] as string[] }
    const attempt = (what: string, bytes: Uint8Array) => {
      tally.runs++
      const { value, ms } = cpuMs(() => { try { return decodeJpeg(bytes, limits) } catch (e) { return e } })
      tally.slowestMs = Math.max(tally.slowestMs, ms)
      if (value instanceof Unreadable) tally.refused++
      else if (isPicture(value, limits)) tally.decoded++
      else tally.wrong.push(`${what}: ${String(value)}`)
    }
    const ok = () => tally.wrong.length === 0 && tally.slowestMs < 1000
    const names = [...PICTURES, "timing"]
    for (const name of names) {
      const b = fixture(`jpeg/${name}.jpg`)
      for (let i = 0; i < 24; i++) attempt(`${name} cut at ${i}/24`, b.subarray(0, Math.floor((b.length * i) / 24)))
    }
    check("jpeg cut short: decodes as far as it goes, or refuses", ok(), tally)
    Object.assign(tally, { runs: 0, decoded: 0, refused: 0, slowestMs: 0 })
    let seed = 1
    const random = (n: number) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return Math.floor((seed / 2 ** 32) * n) }
    for (const name of names) {
      const b = fixture(`jpeg/${name}.jpg`)
      for (let i = 0; i < 40; i++) {
        const c = b.slice()
        for (let n = 1 + random(8); n > 0; n--) c[random(c.length)] ^= 1 << random(8)
        attempt(`${name} flipped #${i}`, c)
      }
    }
    check("jpeg with bits flipped: decodes or refuses, never hangs or overruns", ok(), tally)

    const base = fixture("jpeg/420.jpg"), sof = markers(base, 0xc0)[0]
    const patched = (f: (b: Uint8Array) => void) => { const b = base.slice(); f(b); return b }
    const huge = patched((b) => b.set([0xea, 0x60, 0xea, 0x60], sof + 5))
    const refused = (name: string, bytes: Uint8Array, why: RegExp, l = LIMITS) => {
      const { value, ms } = cpuMs(() => { try { return decodeJpeg(bytes, l) } catch (e) { return e } })
      check(name, value instanceof Unreadable && why.test(value.message) && ms < 100, { got: String(value), ms })
    }
    refused("jpeg claiming 60000x60000 is refused before allocating", huge, /too many pixels/)
    refused("jpeg past the limit is refused", base, /too many pixels/, { maxPixels: 64 * 48 - 1 })
    check("jpeg at the limit decodes", isPicture(decodeJpeg(base, { maxPixels: 64 * 48 }), { maxPixels: 64 * 48 }))
    refused("jpeg arithmetic-coded is refused", patched((b) => { b[sof + 1] = 0xc9 }), /arithmetic/)
    refused("jpeg lossless is refused", patched((b) => { b[sof + 1] = 0xc3 }), /lossless/)
    refused("jpeg hierarchical is refused", patched((b) => { b[sof + 1] = 0xc5 }), /hierarchical/)
    refused("jpeg 12-bit is refused", patched((b) => { b[sof + 4] = 12 }), /12-bit/)
    refused("jpeg of 2 components is refused", patched((b) => { b[sof + 9] = 2 }), /2 components/)
    refused("not a JPEG is refused", new TextEncoder().encode("GIF89a, not a JPEG at all"), /not a JPEG/)
  })
}

/** Where each marker `m` is (its 0xFF), headers and scan data alike. */
function markers(b: Uint8Array, m: number): number[] {
  const at: number[] = []
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === m) at.push(i)
  if (!at.length) throw new Error(`no marker 0x${m.toString(16)}`)
  return at
}

const isPicture = (p: unknown, limits: Limits): p is Rgba => {
  const r = p as Rgba
  return !!r && r.width > 0 && r.height > 0 && r.width * r.height <= limits.maxPixels && r.data?.length === r.width * r.height * 4
}
