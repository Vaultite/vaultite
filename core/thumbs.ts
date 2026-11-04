// Files' thumbnails for the folder views, as Finder draws them: QuickLook on macOS, else what's on PATH (ImageMagick or
// libvips for images, pdftoppm for PDFs, ffmpeg for videos). Made once per version and size into VAULTITE_LOCAL/cache/thumbs/.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { kindOf } from "./filetypes.ts"
import { imageMagick, onPath } from "./heic.ts"
import { LOCAL } from "./plugins.ts"
import { iCloud } from "./vault.ts"

const DIR = path.join(LOCAL, "cache", "thumbs")
const KEEP_MS = 30 * 86400_000
export const SIZES = [256, 512, 1024]
const MAX_JOBS = 2, TIMEOUT_MS = 20_000
const QUICKLOOK = "/usr/bin/qlmanage"

/** The size made for a request of `px`: the smallest bucket at least that big, the largest at most. */
export const bucket = (px: number) => SIZES.find((s) => s >= px) ?? SIZES[SIZES.length - 1]

// QuickLook never exits on a file it has no thumbnail for (an archive, a program): only kinds Finder draws a picture of.
const QUICKLOOK_EXTS = new Set(("html htm svg xlsx xls xlsm numbers pages key docx doc pptx ppt odt ods odp rtf psd ai sketch tif tiff " +
  "raw cr2 nef dng epub ttf otf usdz").split(" "))
const quicklooks = (abs: string) => {
  const kind = kindOf(abs)
  return kind === "image" || kind === "pdf" || kind === "video" || kind === "audio" || QUICKLOOK_EXTS.has(path.extname(abs).slice(1).toLowerCase())
}

/** The commands to try, in turn, for a thumbnail of `abs` in the empty folder `tmp`, each with the file it writes. */
function commands(abs: string, tmp: string, px: number, quicklook: boolean): [string, string[], string][] {
  if (quicklook) return quicklooks(abs) ? [[QUICKLOOK, ["-t", "-s", String(px), "-o", tmp, abs], path.join(tmp, `${path.basename(abs)}.png`)]] : []
  const out = path.join(tmp, "thumb.png"), kind = kindOf(abs), box = `${px}x${px}>`
  if (kind === "image") {
    const magick = imageMagick()
    if (magick) return [[magick, [`${abs}[0]`, "-auto-orient", "-thumbnail", box, out], out]]
    const vips = onPath("vips")
    return vips ? [[vips, ["thumbnail", abs, out, String(px), "--height", String(px), "--size", "down"], out]] : []
  }
  if (kind === "pdf") {
    const pdftoppm = onPath("pdftoppm")
    return pdftoppm ? [[pdftoppm, ["-png", "-singlefile", "-f", "1", "-l", "1", "-scale-to", String(px), abs, path.join(tmp, "thumb")], out]] : []
  }
  if (kind === "video") {
    const ffmpeg = onPath("ffmpeg")
    const at = (s: string): [string, string[], string] =>
      [ffmpeg!, ["-loglevel", "error", "-y", "-ss", s, "-i", abs, "-frames:v", "1", "-vf", `scale='min(${px},iw)':'min(${px},ih)':force_original_aspect_ratio=decrease`, out], out]
    return ffmpeg ? [at("1"), at("0")] : [] // (a clip under a second has no frame at 1 s)
  }
  return []
}

let active = 0
const waiting: (() => void)[] = []
const slot = () => (active < MAX_JOBS ? (active++, Promise.resolve()) : new Promise<void>((r) => waiting.push(r)))
const free = () => { const next = waiting.shift(); if (next) next(); else active-- }

const run = (cmd: string, args: string[]) => new Promise<void>((done) => execFile(cmd, args, { timeout: TIMEOUT_MS }, () => done()))

const running = new Map<string, Promise<string | null>>()
/** Files no thumbnail could be made of, by version: not tried again till the server restarts. */
const failed = new Set<string>()

/** A thumbnail (PNG) of the file at `abs` (its stat says which version) whose longer side is at most `px` (to its
 *  bucket), made if it isn't there yet; null when it can't be. An iCloud placeholder isn't brought down for it. */
export function thumbOf(abs: string, st: fs.Stats, px: number, quicklook = process.platform === "darwin" && fs.existsSync(QUICKLOOK)): Promise<string | null> {
  const size = bucket(px)
  const key = crypto.createHash("sha1").update(`${abs}\0${st.size}\0${st.mtimeMs}`).digest("hex")
  const out = path.join(DIR, `${key}-${size}.png`)
  if (fs.existsSync(out)) return Promise.resolve(out)
  // (a placeholder QuickLook couldn't draw may yet be drawn once it's down)
  const evicted = iCloud.on && iCloud.evicted(abs, st)
  if (!quicklook && evicted) return Promise.resolve(null)
  const failure = evicted ? `${key}:evicted` : key
  if (failed.has(failure) || !commands(abs, DIR, size, quicklook).length) return Promise.resolve(null)
  let job = running.get(out)
  if (job) return job
  job = (async () => {
    await slot()
    let tmp = ""
    try {
      fs.mkdirSync(DIR, { recursive: true })
      tmp = fs.mkdtempSync(path.join(DIR, ".job-"))
      for (const [cmd, args, made] of commands(abs, tmp, size, quicklook)) {
        await run(cmd, args)
        // (QuickLook exits 0 having made nothing; a converter may leave nothing on a failure)
        if (fs.existsSync(made) && fs.statSync(made).size > 0) {
          fs.renameSync(made, out)
          return out
        }
      }
      if (failed.size >= 10_000) failed.delete(failed.values().next().value!)
      failed.add(failure)
      return null
    } finally {
      free()
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
      running.delete(out)
      tidy()
    }
  })().catch(() => null) // (the disk full: no thumbnail, tried again next time)
  running.set(out, job)
  return job
}

/** Thumbnails not made or used for a while go (files' old versions, files deleted), at most once an hour. */
let tidied = 0
function tidy() {
  const now = Date.now()
  if (now - tidied < 3600_000) return
  tidied = now
  try {
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f), s = fs.statSync(p)
      if (now - s.atimeMs > KEEP_MS && now - s.mtimeMs > KEEP_MS) fs.rmSync(p, { recursive: true, force: true })
    }
  } catch { /* the folder went: nothing to tidy */ }
}
