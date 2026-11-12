// What every format shares: telling them apart by their first bytes, and a picture made smaller for its cells.
import { fit } from "../../../plugins/core/terminal/claude-pictures/decode/fit.ts"
import { decodePicture, formatOf } from "../../../plugins/core/terminal/claude-pictures/decode/index.ts"
import type { Rgba } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { check, section } from "../lib.ts"
import { fixture, LIMITS } from "./compare.ts"

const solid = (width: number, height: number, rgba: number[]): Rgba => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i)
  return { width, height, data }
}

export async function testFit() {
  await section("formats and fitting", () => {
    check("formats are told by their first bytes", formatOf(fixture("gif/odd.gif")) === "gif" && formatOf(fixture("gif/odd.ref.png")) === "png" &&
      formatOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])) === "jpeg" && formatOf(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")) === "webp" &&
      formatOf(new TextEncoder().encode("hello world!")) === null)
    const gif = decodePicture(fixture("gif/odd.gif"), LIMITS)
    check("a GIF decodes through decodePicture", "pixels" in gif && gif.pixels.width === 37)
    const png = decodePicture(fixture("gif/odd.ref.png"), LIMITS)
    check("a PNG decodes through decodePicture", "pixels" in png && png.pixels.width === 37)
    const bad = decodePicture(fixture("gif/photo.gif").subarray(0, 20), LIMITS)
    check("a picture cut before its frame says why, not throws", "why" in bad && /^gif: /.test(bad.why), bad)

    const small = solid(10, 10, [1, 2, 3, 4])
    check("a picture that fits is kept as it is", fit(small, 20, 20, 1000) === small)
    const wide = fit(solid(1000, 100, [200, 100, 50, 255]), 300, 300, 1 << 20)
    check("a wide one is narrowed to fit, its shape kept", wide.width === 300 && wide.height === 30, { w: wide.width, h: wide.height })
    check("… its colour the same", wide.data[0] === 200 && wide.data[1] === 100 && wide.data[2] === 50 && wide.data[3] === 255)
    const many = fit(solid(2000, 2000, [0, 0, 0, 255]), 4000, 4000, 1 << 18)
    check("one of too many pixels is made fewer", many.width * many.height <= 1 << 18 && many.width === many.height, { w: many.width, h: many.height })
    // (half clear, half red: averaged with alpha as the weight, the red stays red rather than darkening)
    const half = solid(4, 1, [255, 0, 0, 255])
    half.data.set([0, 0, 0, 0, 0, 0, 0, 0], 8)
    const one = fit(half, 1, 1, 100)
    check("clear pixels don't darken the colour they're averaged with", one.data[0] === 255 && one.data[3] === 128, [...one.data])
    const third = fit(solid(3, 3, [9, 9, 9, 255]), 2, 2, 100)
    check("a fraction of a pixel counts by how much of it is covered", third.width === 2 && third.data.every((v, i) => v === (i % 4 === 3 ? 255 : 9)), [...third.data])
  })
}
