// Files that aren't text (a photo from a chat, a PDF) saved into the vault as attachments, and embedded in a note.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { App } from "../app.ts"
import { type Op, type OpCtx, OpError } from "../ops.ts"
import { localStamp, safeName } from "../vault.ts"
import { fetchPublic } from "../web.ts"
import { type Any, enc, serviceOn } from "./common.ts"

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "image/svg+xml": "svg", "application/pdf": "pdf", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4", "text/csv": "csv",
}
/** A type from the file's first bytes, for when nobody said (ChatGPT's files come as application/octet-stream). */
function sniff(b: Buffer): string {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg"
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif"
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp"
  if (b.subarray(4, 12).toString("latin1").startsWith("ftyphei")) return "image/heic"
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf"
  return ""
}

/** ChatGPT's files given more than once in a row (it retries): file_id -> what it was saved as, for 10 minutes. */
const saved = new Map<string, { path: string; until: number }>()

/** The parameters an internet app's upload link carries until the bytes come (plugins/core/mcp/public.ts). */
export type Pending = { name?: string; folder?: string; note?: string }

export function uploadOps(app: App): Op[] {
  return [{
    id: "file.upload",
    cli: "upload",
    mcp: "upload_file",
    summary: "Save a photo or any file into the vault (Attachments/), and embed it in a note or log.",
    help: `Saves a file that isn't text, a photo the user shared in the chat most often, as a vault file beside the others
(the attachments folder), and with note embeds it at the end of that note or log (![[name]]). Log the meal or write the
note first, then upload its photo with note set to that file's path.

The file comes as file (a file the app hands over: ChatGPT fills it in with the user's photo), url (a public address)
or data (base64, small files only), at any size. Over HTTP, a file of any size is best sent as it is: its bytes as the
body of POST /api/ops/file.upload, the parameters in the query (curl --data-binary @photo.jpg -H 'Content-Type:
application/octet-stream' '<server>/api/ops/file.upload?name=Photo.jpg&note=...'). With none of them, over MCP it answers a
one-time upload link instead: PUT the file's bytes to it within 15 minutes (curl -T photo.jpg <link>) from a sandbox
that can reach it; claude.ai's code sandbox sees the chat's files in /mnt/user-data/uploads/.

  vau upload --url https://example.com/chart.png --note "Notes/Garden plan.md"
  vau upload --data "$(base64 -i photo.jpg)" --name "Paprika chicken.jpg" --note "Logs/Nutrition/2026-10-04 Lunch.md"`,
    input: "the file",
    kind: "write",
    params: {
      file: {
        type: "object", format: "file", description: "the file, as the app hands it over (download_url and file_id; ChatGPT fills this in)",
        properties: {
          download_url: { type: "string", description: "where to download it" }, file_id: { type: "string", description: "the app's id for it" },
          mime_type: { type: "string", description: "its type (image/jpeg)" }, file_name: { type: "string", description: "its name" },
        },
      },
      url: { type: "string", description: "a public address to download it from" },
      data: { type: "string", description: "its bytes in base64, for a small file" },
      name: { type: "string", description: "its file name (2026-10-04 Paprika chicken.jpg); the extension is added when missing" },
      folder: { type: "string", description: "the vault folder to save it in; the attachments folder (Attachments) by default" },
      note: { type: "string", format: "path", description: "a note or log to embed it in, at its end (Logs/Nutrition/2026-10-04 Lunch.md)" },
    },
    run: async (p, ctx) => {
      const { file, url, data, note } = p as { file?: Any; url?: string; data?: string; note?: string }
      const given = [file, url, data, ctx.input].filter((x) => x !== undefined && x !== "").length
      if (given > 1) throw new OpError("give one of file, url or data")
      const fileId = typeof file?.file_id === "string" ? file.file_id : ""
      const again = fileId && saved.get(fileId)
      if (again && again.until > Date.now()) return { path: again.path, again: true, embed: embedOf(again.path) }
      if (!given) {
        const link = ctx.who.client === "mcp" ? serviceOn(app, "mcp:upload-link") : null
        const made = link ? await link({ name: p.name, folder: p.folder, note } satisfies Pending, ctx.who) : null
        if (!made) throw new OpError("give the file: file, url, or data (base64)")
        return { link: made.url, expires: made.expires, note: note ?? null }
      }
      // A file that isn't in memory (sent as it is, or downloaded) waits in a folder of its own until it's saved.
      const dir = data === undefined ? fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-upload-")) : null
      try {
        let bytes: Buffer | string, type = "", from = ""
        if (data !== undefined) bytes = Buffer.from(String(data).replace(/^data:[^,]*,/, ""), "base64")
        else if (ctx.input) {
          bytes = path.join(dir!, "file")
          await pipeline(ctx.input, fs.createWriteStream(bytes))
        } else {
          const src = url ?? file?.download_url
          if (typeof src !== "string" || !src) throw new OpError("file has no download_url")
          bytes = path.join(dir!, "file")
          let got
          try { got = await fetchPublic(src, { to: bytes, timeout: 30_000, types: /./ }) } catch (e) { throw new OpError(`couldn't download it: ${(e as Error).message}`) }
          if (got.status < 200 || got.status >= 300) throw new OpError(`couldn't download it: ${got.status}`)
          if (got.cut) throw new OpError("couldn't download it: it stopped coming")
          type = got.type.split(";")[0].trim()
          from = new URL(got.url).pathname
        }
        const head = typeof bytes === "string" ? headOf(bytes) : bytes
        if (!head.length) throw new OpError("the file is empty")
        const named = String(p.name ?? file?.file_name ?? "").trim() || decodeURIComponent(path.posix.basename(from)) || ""
        const mime = sniff(head) || (typeof file?.mime_type === "string" ? file.mime_type : "") || type
        const out = await save(app, ctx, typeof bytes === "string" ? fs.createReadStream(bytes) : bytes, named, mime, p.folder, note)
        if (fileId) {
          for (const [k, v] of saved) if (v.until < Date.now()) saved.delete(k)
          saved.set(fileId, { path: out.path, until: Date.now() + 600_000 })
        }
        return out
      } finally {
        if (dir) fs.rmSync(dir, { recursive: true, force: true })
      }
    },
    text: (r) => r.link
      ? `Upload link (one use, until ${r.expires}): PUT the file's bytes to ${r.link}, e.g. curl -sS -T <file> '${r.link}'. It's saved as an attachment${r.note ? ` and embedded in ${r.note}` : ""} once it arrives; the answer says where.`
      : `Saved ${r.path}${r.bytes ? ` (${Math.max(1, Math.round(r.bytes / 1024))} KB)` : ""}${r.again ? " (already, from before)" : ""}${r.note ? `, embedded at the end of ${r.note}` : `: embed it with ${r.embed}`}.`,
  }]
}

const embedOf = (p: string) => `![[${path.posix.basename(p)}]]`

/** A file's first bytes (enough to tell its type). */
function headOf(p: string) {
  const fd = fs.openSync(p, "r")
  try { const b = Buffer.alloc(64); return b.subarray(0, fs.readSync(fd, b, 0, 64, 0)) } finally { fs.closeSync(fd) }
}

/** Write the bytes (in memory, or a stream of any size) as a new attachment (a taken name gets a number) and embed it at
 *  the end of `note`. */
export async function save(app: App, ctx: OpCtx, bytes: Buffer | Readable, named: string, mime: string, folder?: string, note?: string) {
  const ext = EXT[mime] ?? ""
  // A nameless image (a phone's "image.jpg") is named as Obsidian names a pasted one.
  const pasted = (!named || /^image\.\w+$/i.test(named)) && (/^image\//.test(mime) || /^image\./i.test(named))
  const stem = pasted ? `Pasted image ${localStamp().replace(/\D/g, "")}` : named.replace(/\.[^.]+$/, "") || `Upload ${localStamp()}`
  let name = safeName(stem) + (path.posix.extname(named) || (ext ? `.${ext}` : ""))
  if (!/\.[a-z0-9]+$/i.test(name) && !ext) name = `${name}.bin`
  const dir = folder !== undefined ? String(folder).replace(/^\/+|\/+$/g, "") : String(serviceOn(app, "attachments:folder")?.(note ?? "") ?? "Attachments")
  const f = note ? await ctx.api("GET", `file?path=${enc(note)}`) : null // (before saving: a wrong note saves nothing)
  if (dir) await ctx.api("POST", "folder", { path: dir }).catch(() => {}) // (there already: fine)
  const { path: rel } = await ctx.api("POST", "upload/name", { folder: dir, name })
  await ctx.api("POST", "upload", { path: rel, bytes })
  if (f) {
    const text = String(f.text ?? "")
    await ctx.api("PUT", "file", { path: f.path ?? note, text: `${text.replace(/\s*$/, "")}\n\n${embedOf(rel)}\n`, base: text })
  }
  return { path: rel, bytes: fs.statSync(app.vault.abs(rel)).size, type: mime || null, embed: embedOf(rel), note: note ?? null }
}
