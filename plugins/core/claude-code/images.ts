// Claude takes pictures of at most 2000 px on the long edge and 5 MB.

export type Picture = { id: string; data: string; type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; url: string; name: string
  size: number }
export const MAX_PICTURES = 10
const EDGE = 2000
// (5 MB as base64, the API's limit per image: 3/4 of it in bytes)
const BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4)
const TAKEN = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])

const drafts = new Map<string, Picture[]>()
export const draftPictures = (key: string) => drafts.get(key) ?? []
export function keepPictures(key: string, ps: Picture[]) {
  for (const p of draftPictures(key)) if (!ps.includes(p)) URL.revokeObjectURL(p.url)
  if (ps.length) drafts.set(key, ps); else drafts.delete(key)
}

export const picturesIn = (files: Iterable<File> | ArrayLike<File>) => Array.from(files).filter((f) => f.type.startsWith("image/"))

export async function readPicture(file: File, pasted = false): Promise<Picture> {
  const id = crypto.randomUUID(), name = (!pasted && file.name) || "Pasted image"
  let blob: Blob = file
  if (!TAKEN.has(file.type) || file.size > BYTES || (file.type !== "image/gif" && (await longEdge(file)) > EDGE)) blob = await shrink(file)
  const type = blob.type as Picture["type"]
  return { id, data: await base64(blob), type, url: URL.createObjectURL(blob), name, size: blob.size }
}

async function longEdge(file: Blob) {
  const b = await createImageBitmap(file)
  const n = Math.max(b.width, b.height)
  b.close()
  return n
}

async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    for (let edge = EDGE; edge >= 500; edge = Math.round(edge * 0.75)) {
      const k = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * k)); canvas.height = Math.max(1, Math.round(bitmap.height * k))
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      if (file.type === "image/png") { const png = await encode(canvas, "image/png"); if (png.size <= BYTES) return png }
      for (const q of [0.88, 0.75, 0.6]) { const jpg = await encode(canvas, "image/jpeg", q); if (jpg.size <= BYTES) return jpg }
    }
  } finally { bitmap.close() }
  throw new Error("The picture is too big to send")
}

const encode = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Couldn't encode the picture"))), type, q))

const base64 = (b: Blob) => new Promise<string>((ok, no) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""))
  r.onerror = () => no(r.error)
  r.readAsDataURL(b)
})
