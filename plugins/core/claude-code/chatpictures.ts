// The pictures sent with a message: checked and kept for the keeper to read, and read back for the chat tab.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { OpError, type Param } from "../../../core/plugins.ts"
import { IMAGE_MAX, IMAGE_TYPES, IMAGES_MAX, type ImageType, imageType } from "./chatlog.ts"
import { NAME } from "./chatwire.ts"

export const IMAGES_PARAM = { type: "array", description: `pictures sent with it (at most ${IMAGES_MAX}, ${IMAGE_MAX >> 20} MB each): {data: base64, type: ${IMAGE_TYPES.join(" | ")}}`,
  items: { type: "object", properties: { data: { type: "string" }, type: { type: "string", enum: IMAGE_TYPES } }, required: ["data", "type"] } } satisfies Param
const EXT: Record<ImageType, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }
/** Where the pictures given to the ops wait for the keeper to read them (this machine's, out of the vault), by the
 *  message they go with, a day at most: a transcript has them after. */
export const IMAGES = path.join(os.tmpdir(), `vaultite-chat-images-${NAME}`)
const IMAGE_DAYS = 1
export const KEEP_IMAGE = { "Cache-Control": "private, max-age=31536000, immutable" }

/** The pictures an op was given, checked (each one's bytes say what it is), written for message `uuid`: their files. */
export function picturesFor(uuid: string, given: unknown): string[] {
  if (given === undefined || given === null) return []
  if (!Array.isArray(given)) throw new OpError("`images`: a list of {data, type}")
  if (given.length > IMAGES_MAX) throw new OpError(`\`images\`: at most ${IMAGES_MAX} a message (${given.length} given)`)
  const pics = given.map((g: { data?: unknown; type?: unknown } | null, i) => {
    const data = typeof g?.data === "string" ? g.data.replace(/\s+/g, "") : "", type = g?.type as ImageType
    if (!IMAGE_TYPES.includes(type)) throw new OpError(`\`images\`: picture ${i + 1}'s type is ${IMAGE_TYPES.join(", ")}`)
    if (data.startsWith("data:")) throw new OpError(`\`images\`: picture ${i + 1}'s data is base64 alone, without its data: prefix`)
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new OpError(`\`images\`: picture ${i + 1}'s data isn't base64`)
    if (Math.floor(data.length * 3 / 4) - (data.match(/=+$/)?.[0].length ?? 0) > IMAGE_MAX) throw new OpError(`\`images\`: picture ${i + 1} is over ${IMAGE_MAX >> 20} MB`)
    const bytes = Buffer.from(data, "base64"), is = imageType(bytes)
    if (!is) throw new OpError(`\`images\`: picture ${i + 1} isn't a PNG, JPEG, GIF or WebP picture`)
    if (is !== type) throw new OpError(`\`images\`: picture ${i + 1} is ${is}, not ${type}`)
    return { bytes, type }
  })
  if (!pics.length) return []
  fs.mkdirSync(IMAGES, { recursive: true, mode: 0o700 })
  sweep()
  return pics.map((p, n) => {
    const f = path.join(IMAGES, `${uuid}-${n}.${EXT[p.type]}`)
    fs.writeFileSync(f, p.bytes, { mode: 0o600 })
    return f
  })
}
/** Picture `n` of message `entry` as the server wrote it, while it's kept. */
export function pictureFile(entry: string, n: number) {
  for (const ext of Object.values(EXT)) { try { return fs.readFileSync(path.join(IMAGES, `${entry}-${n}.${ext}`)) } catch { /* not this one */ } }
  return null
}
/** Picture `n` of message `entry` as its transcript keeps it (a user line, or one sent mid-turn: its queued_command). */
export async function pictureIn(file: string | undefined, entry: string, n: number) {
  if (!file) return null
  const lines = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.includes(entry) || !line.includes('"image"')) continue
      let d: { uuid?: unknown; message?: { content?: unknown }; attachment?: { source_uuid?: unknown; prompt?: unknown } }
      try { d = JSON.parse(line) } catch { continue }
      const content = d.uuid === entry ? d.message?.content : d.attachment?.source_uuid === entry ? d.attachment.prompt : null
      if (!Array.isArray(content)) continue
      const img = content.filter((c) => c?.type === "image")[n] as { source?: { type?: string; data?: unknown } } | undefined
      return img?.source?.type === "base64" && typeof img.source.data === "string" ? Buffer.from(img.source.data, "base64") : null
    }
  } catch { /* gone */ } finally { lines.close() }
  return null
}
let swept = 0
/** The pictures kept past IMAGE_DAYS removed (at most hourly). */
export function sweep() {
  if (Date.now() - swept < 3600_000) return
  swept = Date.now()
  let names: string[] = []
  try { names = fs.readdirSync(IMAGES) } catch { return }
  for (const name of names) {
    const f = path.join(IMAGES, name)
    try { if (Date.now() - fs.statSync(f).mtimeMs > IMAGE_DAYS * 86400_000) fs.rmSync(f, { force: true }) } catch { /* gone */ }
  }
}
