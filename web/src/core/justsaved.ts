const copies = new Map<string, string>()

const KEEP = 5 * 60_000

export function keepLocal(path: string, blob: Blob) {
  if (/\.(heic|heif)$/i.test(path) || !/^(image|video|audio)\//.test(blob.type)) return
  const url = URL.createObjectURL(blob)
  copies.set(path, url)
  setTimeout(() => { if (copies.get(path) === url) copies.delete(path); URL.revokeObjectURL(url) }, KEEP)
}

export const localCopy = (path: string) => copies.get(path) ?? null
