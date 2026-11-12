// GIF: the first frame, against a reference decoder's; damaged and oversized input. How the fixtures were made:
// tools/fixtures/pictures/gif/CLAUDE.md.
import { decodeGif } from "../../../plugins/core/terminal/claude-pictures/decode/gif.ts"
import { check, section } from "../lib.ts"
import { checkPicture, fixture, LIMITS, reference } from "./compare.ts"

export async function testGif() {
  await section("gif", () => {
    for (const name of ["photo", "odd", "dot", "transparent", "interlaced", "local", "anim"]) {
      checkPicture(`${name}.gif is the reference's first frame`, decodeGif(fixture(`gif/${name}.gif`), LIMITS), reference(`gif/${name}.gif`))
    }
    const photo = fixture("gif/photo.gif")
    // (cut short: the frame's rows that came, the rest clear, as browsers draw a GIF still loading)
    const cut = decodeGif(photo.subarray(0, photo.length >> 1), LIMITS)
    check("a GIF cut short draws what came", cut.width === 120 && cut.data[3] === 255 && cut.data[cut.data.length - 1] === 0)
    let threw = 0, slow = 0
    for (let seed = 1; seed <= 200; seed++) {
      const b = photo.slice(), t = performance.now()
      for (let k = 0, s = seed; k < 8; k++) { s = (s * 1103515245 + 12345) >>> 0; b[s % b.length] ^= 1 << (s >> 8 & 7) }
      // (a flipped size within the limit is a real allocation: a limit like the mod's, not the tests' 64M pixels)
      try { decodeGif(b, { maxPixels: 1 << 22 }) } catch { threw++ }
      if (performance.now() - t > 500) slow++
    }
    check("bytes flipped at random decode or throw, quickly", slow === 0, { threw, slow })
    const huge = fixture("gif/dot.gif").slice()
    huge[6] = huge[7] = huge[8] = huge[9] = 0xff
    let refused = false
    try { decodeGif(huge, { maxPixels: 1 << 20 }) } catch { refused = true }
    check("a screen of more pixels than the limit is refused", refused)
  })
}
