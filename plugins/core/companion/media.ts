// An image or video card's source (draw's image and video marks), found when drawn so one that can't load says so:
// a vault file as the app loads it, a file of this machine by a token only its card knows, https as it is.
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { contentType, fetchPublic, FileAnswer, HTTPError, OpError, type Plugin, readableImage } from "../../../core/plugins.ts"
import { thumbOf } from "../../../core/thumbs.ts"
import { screenshotDir } from "./reach.ts"
import type { KeptFile } from "./kept.ts"
import { IMAGE_EXT, type Media, VIDEO_EXT } from "../../../core/desktop/screenmarks.ts"

/** Tokens kept (the cards up and a few gone): each a file a card was allowed to show. */
const TOKENS = 64
/** The most of an image kept in a drawing (Keep embeds its bytes). */
const KEEP_BYTES = 8 << 20
/** A kept video's poster frame, its longer side at most this. */
const POSTER_PX = 960

export function screenMedia(plugin: Plugin, o: {
  /** Whether the companion may read this file of this machine (its read-only folders). */
  readable: (abs: string) => boolean
}) {
  const served = new Map<string, { abs: string; type: string }>()
  plugin.route("GET", "companion/media/*/*", (req) => {
    const f = served.get(req.arg(0))
    if (!f) throw new HTTPError(404, "no such picture (its drawing is gone)")
    return new FileAnswer(f.abs, f.type)
  }, { sync: false })
  const serve = (abs: string, type: string) => {
    const token = crypto.randomBytes(12).toString("hex")
    served.set(token, { abs, type })
    if (served.size > TOKENS) served.delete(served.keys().next().value!)
    return `api/companion/media/${token}/${encodeURIComponent(path.basename(abs))}`
  }

  /** A file of this machine a card may show: where the companion may read (its screenshots' folder among them), none
   *  of its folders hidden (keys, settings). */
  async function mayRead(abs: string) {
    let real: string
    try { real = fs.realpathSync(abs) } catch { real = path.resolve(abs) }
    return !real.split(path.sep).some((p) => p.startsWith(".")) && o.readable(real)
  }

  /** `m`'s source found: where the overlay loads it, its name and pixels; an OpError says why it can't show. */
  async function resolve(m: Media): Promise<Media> {
    const kind = m.type, src = m.src.trim(), want = kind === "video" ? VIDEO_EXT : IMAGE_EXT, what = kind === "video" ? "a video" : "an image"
    if (/^https:\/\//i.test(src)) return { ...m, url: src, name: path.basename(new URL(src).pathname) || new URL(src).host, ...(await probeUrl(src, kind)) }
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-z]:[\\/]/i.test(src)) throw new OpError(`src: ${src.split(":")[0]}: isn't a source; a vault path, a file of this Mac, an app (its icon), https or "screenshot"`)
    if (/^(latest[ -])?(screenshot|screen ?shot|recording|screen recording)$/i.test(src)) {
      const abs = await latestCapture(kind)
      if (!abs) throw new OpError(`they have no ${kind === "video" ? "screen recording" : "screenshot"} in ${screenshotDir()}, so nothing was drawn and they saw no card`, 409)
      return local(m, abs)
    }
    const abs = src.startsWith("~/") ? path.join(os.homedir(), src.slice(2)) : src
    // (an app: its icon, as Finder shows it; an icon isn't private, so wherever the app is)
    if (m.type === "image" && /\.app\/?$/i.test(abs) && path.isAbsolute(abs)) return local(m, await appIcon(abs.replace(/\/$/, "")))
    if (path.isAbsolute(abs)) {
      if (!(await mayRead(abs))) throw new OpError(`${src} isn't where you may read (your read-only folders and their screenshots), so nothing was drawn`, 403)
      return local(m, abs)
    }
    // (a vault file: as the app shows it)
    const rel = src.replace(/^\/+/, "")
    if (rel.split("/").some((p) => p.startsWith(".") || p === "..")) throw new OpError(`${src}: not a file of theirs to show`, 403)
    if (!want.test(rel)) throw new OpError(`${src} isn't ${what} (${kind === "video" ? "mp4, mov, webm" : "png, jpg, gif, webp, heic, svg"})`)
    const file = plugin.vault.abs(rel)
    if (!fs.existsSync(file)) throw new OpError(`no ${rel} in the vault, so nothing was drawn and they saw no card`, 404)
    return { ...m, url: `api/raw/${encodeURIComponent(path.basename(rel))}?path=${encodeURIComponent(rel)}${/\.(heic|heif)$/i.test(rel) ? "&as=jpeg" : ""}`, name: path.basename(rel), ...pxOf(file) }
  }

  async function local(m: Media, abs: string): Promise<Media> {
    const want = m.type === "video" ? VIDEO_EXT : IMAGE_EXT
    if (!want.test(abs)) throw new OpError(`${path.basename(abs)} isn't ${m.type === "video" ? "a video" : "an image"}${(m.type === "video" ? IMAGE_EXT : VIDEO_EXT).test(abs) ? `: draw it as ${m.type === "video" ? "an image" : "a video"}` : ""}`)
    let st: fs.Stats
    try { st = fs.statSync(abs) } catch { throw new OpError(`no file ${abs}, so nothing was drawn and they saw no card`, 404) }
    if (!st.isFile()) throw new OpError(`${abs} is a folder`)
    // (a HEIC photo as a JPEG: the overlay's engine can't draw one)
    const file = /\.(heic|heif)$/i.test(abs) ? await readableImage(abs).catch(() => abs) : abs
    return { ...m, url: serve(file, contentType(file)), name: path.basename(abs), ...pxOf(file) }
  }

  /** The file of this machine a card shows (none for https). */
  function fileOf(m: Media) {
    const token = /^api\/companion\/media\/([0-9a-f]+)\//.exec(m.url ?? "")?.[1], vault = /[?&]path=([^&]+)/.exec(m.url ?? "")?.[1]
    return token ? served.get(token)?.abs : vault ? plugin.vault.abs(decodeURIComponent(vault)) : undefined
  }
  /** The bytes Keep embeds of an image card, or of a video's first frame (its poster); null: too big, gone, none. */
  async function bytes(m: Media): Promise<KeptFile | null> {
    if (!m.url) return null
    if (m.type === "video") {
      const abs = fileOf(m)
      try {
        const png = abs && (await thumbOf(abs, fs.statSync(abs), POSTER_PX))
        if (!png) return null
        const buf = fs.readFileSync(png), px = imageSize(buf)
        return { dataURL: `data:image/png;base64,${buf.toString("base64")}`, mime: "image/png", ...(px ? { px } : {}) }
      } catch { return null }
    }
    let buf: Buffer | null = null, mime = ""
    try {
      if (/^https:/i.test(m.url)) {
        const r = await fetchPublic(m.url, { max: KEEP_BYTES, types: /^image\//, timeout: 8000 })
        if (r.status < 400 && !r.cut && r.type.startsWith("image/")) { buf = r.body; mime = r.type.split(";")[0] }
      } else {
        const abs = fileOf(m)
        const file = abs && /\.(heic|heif)$/i.test(abs) ? await readableImage(abs) : abs
        if (file && fs.statSync(file).size <= KEEP_BYTES) { buf = fs.readFileSync(file); mime = contentType(file) }
      }
    } catch { /* kept as a link */ }
    if (!buf || !mime.startsWith("image/")) return null
    const px = imageSize(buf)
    return { dataURL: `data:${mime};base64,${buf.toString("base64")}`, mime, ...(px ? { px } : m.px ? { px: m.px } : {}) }
  }
  return { resolve, bytes }
}

/** A Mac app's icon as a PNG, made once per version of the app. */
async function appIcon(app: string): Promise<string> {
  let st: fs.Stats
  try { st = fs.statSync(app) } catch { throw new OpError(`no app ${app}, so nothing was drawn and they saw no card`, 404) }
  if (process.platform !== "darwin") throw new OpError("an app's icon shows only on a Mac")
  const dir = path.join(os.tmpdir(), "vaultite-app-icons"), out = path.join(dir, `${crypto.createHash("sha1").update(`${app}:${st.mtimeMs}`).digest("hex").slice(0, 16)}.png`)
  if (fs.existsSync(out)) return out
  fs.mkdirSync(dir, { recursive: true })
  const js = `ObjC.import("AppKit"); function run(a) { const i = $.NSWorkspace.sharedWorkspace.iconForFile(a[0]); i.setSize($.NSMakeSize(512, 512)); const b = $.NSBitmapImageRep.imageRepWithData(i.TIFFRepresentation); b.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).writeToFileAtomically(a[1], true) }`
  await new Promise<void>((ok, no) => execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", js, app, out], { timeout: 10_000 }, (e) => (e ? no(e) : ok())))
    .catch((e: Error) => { throw new OpError(`couldn't read ${path.basename(app)}'s icon: ${e.message.slice(0, 120)}`) })
  if (!fs.existsSync(out)) throw new OpError(`couldn't read ${path.basename(app)}'s icon`)
  return out
}

/** An https image or video: there and what it says it is, and an image's pixels; one that can't be reached now is let
 *  through (the card says so if it can't load). */
async function probeUrl(url: string, kind: "image" | "video"): Promise<Partial<Media>> {
  let r
  try { r = await fetchPublic(url, { max: 64 << 10, types: /^(image|video)\//, timeout: 3000 }) } catch (e) {
    if (/public|isn't|can't fetch/i.test((e as Error).message)) throw new OpError(`src: ${(e as Error).message}`)
    return {}
  }
  if (r.status >= 400) throw new OpError(`${url} answers ${r.status}, so nothing was drawn and they saw no card`, 409)
  if (!r.type.startsWith(`${kind}/`)) throw new OpError(`${url} is ${r.type.split(";")[0] || "not a file"}, not ${kind === "video" ? "a video" : "an image"} (a page isn't: give the ${kind}'s own address)`, 409)
  const px = kind === "image" ? imageSize(r.body) : null
  return px ? { px } : {}
}

/** A file's pixels, when its header says (an image's). */
function pxOf(file: string): { px?: [number, number] } {
  try {
    const fd = fs.openSync(file, "r"), buf = Buffer.alloc(64 << 10)
    const n = fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    const px = imageSize(buf.subarray(0, n))
    return px ? { px } : {}
  } catch { return {} }
}

/** An image's width and height from its first bytes: PNG, GIF, JPEG, WebP; null for others. */
export function imageSize(b: Buffer): [number, number] | null {
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)]
  if (b.length >= 10 && b.toString("latin1", 0, 3) === "GIF") return [b.readUInt16LE(6), b.readUInt16LE(8)]
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const f = b.toString("latin1", 12, 16)
    if (f === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    if (f === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1] }
    if (f === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue }
      const mk = b[i + 1], len = b.readUInt16BE(i + 2)
      if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]
      i += 2 + len
    }
  }
  return null
}

/** Their latest screenshot (`image`) or screen recording (`video`), or null. */
export async function latestCapture(kind: "image" | "video") {
  const d = screenshotDir(), want = kind === "video" ? VIDEO_EXT : IMAGE_EXT
  let best: { f: string; t: number } | null = null
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith(".") || !want.test(e.name)) continue
      const f = path.join(d, e.name), t = fs.statSync(f).mtimeMs
      if (!best || t > best.t) best = { f, t }
    }
  } catch { return null }
  return best?.f ?? null
}
