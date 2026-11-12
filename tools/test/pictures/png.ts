// PNG in the mod (decode/png.ts, on its own inflate.ts) against PIL's and termd's decoders; zlib's every block kind;
// damaged input. How the fixtures were made: tools/fixtures/pictures/png/CLAUDE.md.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { inflateZlib } from "../../../plugins/core/terminal/claude-pictures/decode/inflate.ts"
import { Unreadable } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { decodePng } from "../../../plugins/core/terminal/claude-pictures/decode/png.ts"
import { decodePng as termdPng } from "../../../plugins/core/terminal/termd/png.ts"
import { check, section } from "../lib.ts"
import { checkPicture, distance, FIXTURES, fixture, LIMITS, reference } from "./compare.ts"

export async function testPng() {
  await section("png", () => {
    const names = fs.readdirSync(path.join(FIXTURES, "png")).filter((f) => f.endsWith(".png") && !f.endsWith(".ref.png")).sort()
    for (const f of names) {
      const got = decodePng(fixture(`png/${f}`), LIMITS)
      // (gray16's reference rounds 16 bits to 8, where we take the high byte as termd does)
      checkPicture(`${f} is PIL's`, got, reference(`png/${f}`), f === "gray16.png" ? { max: 1, mean: 0.5 } : undefined)
      const t = termdPng(Buffer.from(fixture(`png/${f}`)), LIMITS.maxPixels * 4)!, theirs = new Uint8Array(t.width * t.height * 4)
      for (let i = 0, j = 0; i < theirs.length; i += 4, j += t.channels) { theirs.set(t.data.subarray(j, j + 3), i); theirs[i + 3] = t.channels === 4 ? t.data[j + 3] : 255 }
      check(`… and termd's`, distance(got, { width: t.width, height: t.height, data: theirs }).max === 0)
    }

    // (zlib's blocks: stored, fixed codes, dynamic codes, and long runs copied from far back)
    const text = new TextEncoder().encode("a picture is worth a thousand words; ".repeat(400))
    const noise = new Uint8Array(70000).map((_, i) => (i * 2654435761) >>> 24)
    for (const [name, data, o] of [["stored", noise, { level: 0 }], ["fixed codes", text, { strategy: zlib.constants.Z_FIXED }], ["dynamic codes", text, {}], ["noise", noise, { level: 9 }]] as const) {
      const z = zlib.deflateSync(data, o), got = inflateZlib(new Uint8Array(z), data.length)
      check(`inflate: ${name}`, got.length === data.length && got.every((v, i) => v === data[i]))
    }
    let tooMany = false
    try { inflateZlib(new Uint8Array(zlib.deflateSync(text)), 100) } catch (e) { tooMany = e instanceof Unreadable }
    check("inflate: a stream of more bytes than asked is refused", tooMany)

    const big = fixture("png/rgba16.png")
    let other = 0, slow = 0, threw = 0
    for (let cut = 8; cut < big.length; cut += 37) other += attempt(big.subarray(0, cut))
    for (let seed = 1; seed <= 300; seed++) {
      const b = big.slice()
      for (let k = 0, s = seed; k < 6; k++) { s = (s * 1103515245 + 12345) >>> 0; b[8 + (s % (b.length - 8))] ^= 1 << ((s >> 8) & 7) }
      other += attempt(b)
    }
    check("damaged PNGs decode or throw Unreadable, quickly", !other && !slow, { other, slow, threw })
    let refused = false
    const huge = fixture("png/dot.png").slice()
    huge.set([0, 1, 0, 0, 0, 1, 0, 0], 16)
    try { decodePng(huge, { maxPixels: 1 << 20 }) } catch (e) { refused = e instanceof Unreadable }
    check("a size of more pixels than the limit is refused", refused)

    /** 1 when it threw anything but Unreadable. */
    function attempt(b: Uint8Array) {
      const t = performance.now()
      try { decodePng(b, LIMITS) } catch (e) { if (!(e instanceof Unreadable)) return 1; threw++ }
      if (performance.now() - t > 500) slow++
      return 0
    }
  })
}
