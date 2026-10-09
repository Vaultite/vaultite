// Free-text place -> [lat, lon] for the People map, from Nominatim, remembered in the plugin's cache (never in the
// person's file). No guesses: offline or not found is null, and no pin beats a wrong one.
export type LatLon = [number, number]
/** By place (trimmed, lower-cased): its pin, or null when Nominatim found nothing. */
export type Places = Record<string, LatLon | null>

export const placeKey = (location: string) => (location ?? "").trim().toLowerCase().replace(/\s+/g, " ")

const round4 = (x: number) => Math.round(x * 1e4) / 1e4

async function nominatim(location: string, timeout = 5000): Promise<LatLon | null> {
  const q = new URLSearchParams({ q: location, format: "jsonv2", limit: "1" })
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, {
    headers: { "User-Agent": "vaultite/1.0 (personal app, a few requests a month)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(timeout),
  })
  if (!r.ok) throw new Error(`nominatim: ${r.status}`)
  const hits = await r.json()
  return hits.length ? [round4(Number(hits[0].lat)), round4(Number(hits[0].lon))] : null
}

/** Lookups through a cache that `load` reads and `save` writes, one request a second at most (Nominatim's policy). */
export function geocoder(load: () => Places, save: (places: Places) => void, lookup = nominatim, gap = 1100) {
  let queue: Promise<unknown> = Promise.resolve()
  let last = 0
  const pending = new Map<string, Promise<LatLon | null>>()
  /** The cached pin: [lat, lon], null (not found), or undefined (never looked up). */
  const known = (location: string): LatLon | null | undefined => {
    const k = placeKey(location)
    return k ? load()[k] : null
  }
  /** [lat, lon] or null. Never throws; a network failure isn't remembered, so it's tried again later. */
  const locate = (location: string): Promise<LatLon | null> => {
    const k = placeKey(location)
    if (!k) return Promise.resolve(null)
    const hit = load()[k]
    if (hit !== undefined) return Promise.resolve(hit)
    const was = pending.get(k)
    if (was) return was
    const run = queue.then(async () => {
      const wait = last + gap - Date.now()
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait))
      last = Date.now()
      try {
        const ll = await lookup(location)
        save({ ...load(), [k]: ll })
        return ll
      } catch {
        return null
      }
    }).finally(() => pending.delete(k))
    queue = run
    pending.set(k, run)
    return run
  }
  return { known, locate }
}
