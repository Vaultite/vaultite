// The picture decoders the claude-pictures mod draws what Claude got with (PNG, JPEG, GIF, WebP): each against a
// reference decoder's pixels, and none throwing anything but Unreadable or running away on bytes it can't read. `node tools/test_pictures.ts` (npm test)
import { summary } from "./test/lib.ts"
import { testFit } from "./test/pictures/fit.ts"
import { testGif } from "./test/pictures/gif.ts"
import { testJpeg } from "./test/pictures/jpeg.ts"
import { testPng } from "./test/pictures/png.ts"
import { testVp8l } from "./test/pictures/vp8l.ts"
import { testWebp } from "./test/pictures/webp.ts"

const t0 = Date.now()
await testFit()
await testPng()
await testJpeg()
await testGif()
await testVp8l()
await testWebp()
summary("test_pictures", t0)
