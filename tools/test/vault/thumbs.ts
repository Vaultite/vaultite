import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import type { VaultTest } from "./harness.ts"
import { skip } from "../lib.ts"

/** A solid w×h RGB PNG. */
function png(w: number, h: number) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x60)])
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))])
}

/** A one-page PDF (landscape, 600×300 pt) with its xref right. */
function pdf() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Contents 4 0 R >>", "<< /Length 23 >>\nstream\n0 0 1 rg 0 0 300 300 re f\nendstream"]
  let out = "%PDF-1.4\n"
  const at: number[] = []
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`
  return out + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}

/** A PNG's width and height, from its header. */
const dims = (file: string) => { const b = fs.readFileSync(file); return b.subarray(1, 4).toString() === "PNG" ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0] }

export default async ($: VaultTest) => {
  const { VAULT, check } = $
  // ---------- files' thumbnails for the folder views (core/thumbs.ts, GET /api/raw?thumb=) ----------
  const { bucket, thumbOf } = await import("../../../core/thumbs.ts")
  const { imageMagick, onPath } = await import("../../../core/heic.ts")
  check("thumbs: a size asked for is made at its bucket", [1, 256, 257, 512, 600, 1024, 5000].map(bucket).join() === "256,256,512,512,1024,1024,1024")
  const dir = path.join(VAULT, "Thumbs")
  fs.mkdirSync(dir, { recursive: true })
  const at = (name: string, data: string | Buffer) => { const p = path.join(dir, name); fs.writeFileSync(p, data); return p }
  const photo = at("wide.png", png(600, 300)), doc = at("page.pdf", pdf()), odd = at("notes.qqq", "plain text"), zip = at("a.zip", "PK\x03\x04")
  const mac = process.platform === "darwin" && fs.existsSync("/usr/bin/qlmanage")
  // Images need a converter on PATH that reads a PNG: a broken one (Windows on Arm's runner has an ImageMagick that can't
  // find its coders) gives none, checked below.
  const magick = imageMagick(), vips = onPath("vips")
  const probe = magick ? spawnSync(magick, [photo, "info:"], { encoding: "utf8" }) : vips ? spawnSync(vips, ["header", photo], { encoding: "utf8" }) : null
  const imageTool = probe?.status === 0, brokenTool = probe && !imageTool ? `${magick ?? vips} can't read a PNG: ${(probe.stderr || String(probe.error)).trim().split("\n")[0]}` : null

  for (const quicklook of mac ? [true, false] : [false]) {
    const how = quicklook ? "QuickLook" : "tools on PATH"
    let t = Date.now()
    const none = await Promise.all([odd, zip].map((f) => thumbOf(f, fs.statSync(f), 256, quicklook)))
    check(`thumbs (${how}): a kind with no thumbnail is none, at once`, none.every((x) => x === null) && Date.now() - t < 500, [none, Date.now() - t])
    if (quicklook || imageTool) {
      const [a, b] = await Promise.all([thumbOf(photo, fs.statSync(photo), 200, quicklook), thumbOf(photo, fs.statSync(photo), 256, quicklook)])
      check(`thumbs (${how}): an image's is a PNG at most the size asked, made once for two asking`, a && a === b && dims(a).join() === "256,128" && a.endsWith("-256.png"), [a, a && dims(a)])
      t = Date.now()
      check(`thumbs (${how}): asked again, it's the one made`, !!a && (await thumbOf(photo, fs.statSync(photo), 256, quicklook)) === a && Date.now() - t < 50)
      const big = await thumbOf(photo, fs.statSync(photo), 700, quicklook)
      check(`thumbs (${how}): a bigger bucket is its own, never past the image`, big !== a && !!big && Math.max(...dims(big)) <= 1024, big && dims(big))
    } else if (brokenTool) {
      const other = at("other.png", png(60, 30)), none = await thumbOf(other, fs.statSync(other), 256, quicklook)
      check(`thumbs (${how}): a converter that fails gives no thumbnail (${brokenTool})`, none === null, none)
    } else skip(`thumbs (${how}): images`, "no magick, convert or vips")
    if (quicklook || onPath("pdftoppm")) {
      const d = await thumbOf(doc, fs.statSync(doc), 512, quicklook)
      const [w, h] = d ? dims(d) : [0, 0]
      check(`thumbs (${how}): a PDF's first page`, w === 512 && h > 200 && h < 300, [d, w, h])
    } else skip(`thumbs (${how}): PDFs`, "no pdftoppm")
    const ffmpeg = onPath("ffmpeg")
    if (ffmpeg) {
      const clip = path.join(dir, `clip-${quicklook}.mp4`), short = path.join(dir, `short-${quicklook}.mp4`)
      for (const [f, s] of [[clip, "2"], [short, "0.3"]]) execFileSync(ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=d=${s}:s=640x360`, "-pix_fmt", "yuv420p", f])
      const [v, sv] = await Promise.all([clip, short].map((f) => thumbOf(f, fs.statSync(f), 256, quicklook)))
      check(`thumbs (${how}): a video's frame, a clip under a second's too`, !!v && dims(v).join() === "256,144" && !!sv && dims(sv)[0] === 256, [v && dims(v), sv && dims(sv)])
    } else skip(`thumbs (${how}): videos`, "no ffmpeg (to make one)")
  }
  if (onPath("pdftoppm")) {
    // A file that can't be drawn is tried once, not on every request.
    const bad = at("broken.pdf", "not a pdf")
    const first = await thumbOf(bad, fs.statSync(bad), 256, false)
    const t = Date.now(), again = await thumbOf(bad, fs.statSync(bad), 512, false)
    check("thumbs: a file that can't be drawn is none, and isn't tried again", first === null && again === null && Date.now() - t < 20, Date.now() - t)
  }
  fs.rmSync(dir, { recursive: true })
}
