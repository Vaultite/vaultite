// HEIC photos as JPEG for browsers that can't draw them (Chrome, so the desktop app), made once per version with
// `sips` (or heif-convert/magick) into VAULTITE_LOCAL/cache/heic/. Without a converter: null, and the app shows a card.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { LOCAL } from "./plugins.ts"

const DIR = path.join(LOCAL, "cache", "heic")
/** Copies older than this are cleared on the next conversion. */
const KEEP_MS = 30 * 86400_000

export const isHeic = (p: string) => /\.(heic|heif)$/i.test(p)

const onPath = (name: string) =>
  (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) ?? null

/** The command that writes `out` (a JPEG) from `src`, or null when this machine has none. */
function converter(src: string, out: string): [string, string[]] | null {
  if (process.platform === "darwin" && fs.existsSync("/usr/bin/sips")) return ["/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "85", src, "--out", out]]
  const heif = onPath("heif-convert")
  if (heif) return [heif, ["-q", "85", src, out]]
  const magick = onPath("magick")
  if (magick) return [magick, [src, "-quality", "85", out]]
  // Ubuntu's ImageMagick 6 is `convert` (it reads HEIC with libheif), and libvips' `vips` does too.
  const convert = onPath("convert")
  if (convert && process.platform !== "win32") return [convert, [src, "-quality", "85", out]]
  const vips = onPath("vips")
  if (vips) return [vips, ["copy", src, `${out}[Q=85]`]]
  return null
}

const running = new Map<string, Promise<string | null>>()

/** The JPEG copy of the photo at `abs` (its stat says which version), made if it isn't there yet; null when it can't be
 *  made. Two requests for the same photo share one conversion. */
export function jpegOf(abs: string, st: fs.Stats): Promise<string | null> {
  const key = crypto.createHash("sha1").update(`${abs}\0${st.size}\0${st.mtimeMs}`).digest("hex")
  const out = path.join(DIR, `${key}.jpg`)
  if (fs.existsSync(out)) return Promise.resolve(out)
  let job = running.get(key)
  if (job) return job
  const cmd = converter(abs, `${out}.tmp.jpg`)
  if (!cmd) return Promise.resolve(null)
  fs.mkdirSync(DIR, { recursive: true })
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

/** Copies not made or used for a while go (a photo's old versions, photos deleted). */
function tidy() {
  try {
    const now = Date.now()
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f)
      if (now - fs.statSync(p).atimeMs > KEEP_MS && now - fs.statSync(p).mtimeMs > KEEP_MS) fs.rmSync(p, { force: true })
    }
  } catch { /* the folder went: nothing to tidy */ }
}
