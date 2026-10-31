// Files this app has just saved (a pasted picture): drawn from the copy in hand, not fetched back from the server.
const copies = new Map<string, string>()

/** How long a copy stands in (ms): long enough to draw it; past that the server's file is the one to show. */
const KEEP = 5 * 60_000

/** Keep `blob` as `path`'s picture for a while (a format the browser can't draw is fetched as usual). */
export function keepLocal(path: string, blob: Blob) {
  if (/\.(heic|heif)$/i.test(path) || !/^(image|video|audio)\//.test(blob.type)) return
  const url = URL.createObjectURL(blob)
  copies.set(path, url)
  setTimeout(() => { if (copies.get(path) === url) copies.delete(path); URL.revokeObjectURL(url) }, KEEP)
}

/** The copy in hand of `path`, if this app just saved it. */
export const localCopy = (path: string) => copies.get(path) ?? null
