// HEIC photos as JPEG for browsers that can't draw them (Chrome, so the desktop app), made once per version with
// `sips` (or heif-convert/magick) into VAULTITE_LOCAL/cache/heic/. Without a converter: null, and the app shows a card.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL } from "./plugins.ts"

const cacheDir = () => path.join(LOCAL, "cache", "heic")
const KEEP_MS = 30 * 86400_000

export const isHeic = (p: string) => /\.(heic|heif)$/i.test(p)

export const onPath = (name: string) =>
  (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, process.platform === "win32" ? `${name}.exe` : name)).find((f) => fs.existsSync(f)) ?? null

/** ImageMagick: `magick` (7), or `convert` (Ubuntu's 6) off Windows, whose convert.exe converts disks. */
export const imageMagick = () => onPath("magick") ?? (process.platform !== "win32" ? onPath("convert") : null)

function converter(src: string, out: string): [string, string[]] | null {
  if (process.platform === "darwin" && fs.existsSync("/usr/bin/sips")) return ["/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", src, "--out", out]]
  const heif = onPath("heif-convert")
  if (heif) return [heif, ["-q", "85", src, out]]
  // (Ubuntu's ImageMagick 6 reads HEIC with libheif, and libvips' `vips` does too)
  const magick = imageMagick()
  if (magick) return [magick, [src, "-quality", "85", out]]
  const vips = onPath("vips")
  if (vips) return [vips, ["copy", src, `${out}[Q=85]`]]
  return null
}

const running = new Map<string, Promise<string | null>>()

export function jpegOf(abs: string, st: fs.Stats): Promise<string | null> {
  const key = crypto.createHash("sha1").update(`${abs}\0${st.size}\0${st.mtimeMs}`).digest("hex")
  const out = path.join(cacheDir(), `${key}.jpg`)
  if (fs.existsSync(out)) return Promise.resolve(out)
  let job = running.get(key)
  if (job) return job
  const cmd = converter(abs, `${out}.tmp.jpg`)
  if (!cmd) return Promise.resolve(null)
  fs.mkdirSync(cacheDir(), { recursive: true })
  job = new Promise<string | null>((done) => {
    execFile(cmd[0], cmd[1], { timeout: 60_000 }, (err) => {
      try {
        if (err) throw err
        fs.renameSync(`${out}.tmp.jpg`, out)
        done(out)
      } catch {
        fs.rmSync(`${out}.tmp.jpg`, { force: true })
        done(null)
      }
      running.delete(key)
      tidy()
    })
  })
  running.set(key, job)
  return job
}

/** HEIC or HEIF by its first bytes (an `ftyp` box of one of their brands), whatever the file is named. */
export function heicBytes(file: string): boolean {
  const b = Buffer.alloc(12)
  try { const fd = fs.openSync(file, "r"); try { fs.readSync(fd, b, 0, 12, 0) } finally { fs.closeSync(fd) } } catch { return false }
  return b.subarray(4, 8).toString("latin1") === "ftyp" && /^(hei[cxms]|hev[cx]|mif1|msf1)$/.test(b.subarray(8, 12).toString("latin1"))
}

/** A file an agent can read: a HEIC photo (a phone's screenshot pasted into a terminal) as a JPEG beside it, the same
 *  size, the original kept; any other file, or one that can't be converted here, as it is. */
export function readableImage(file: string): Promise<string> {
  if (!isHeic(file) && !heicBytes(file)) return Promise.resolve(file)
  const out = `${file.replace(/\.(heic|heif)$/i, "")}.jpg`
  const cmd = converter(file, out)
  if (!cmd) return Promise.resolve(file)
  return new Promise((done) => execFile(cmd[0], cmd[1], { timeout: 60_000 }, (err) => {
    if (!err && fs.existsSync(out) && fs.statSync(out).size) return done(out)
    fs.rmSync(out, { force: true })
    done(file)
  }))
}

function tidy() {
  try {
    const now = Date.now()
    for (const f of fs.readdirSync(cacheDir())) {
      const p = path.join(cacheDir(), f)
      if (now - fs.statSync(p).atimeMs > KEEP_MS && now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true })
    }
  } catch { /* the folder went: nothing to tidy */ }
}
