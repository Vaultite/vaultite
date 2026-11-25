// All Have I Been Pwned hears is 5 characters of each password's SHA-1 (k-anonymity), in the order of the hashes.
import { app, net } from "electron"

const SITE = (!app.isPackaged && process.env.VAULTITE_TEST_HIBP) || "https://api.pwnedpasswords.com"
const AT_ONCE = 6, RANGE_MAX = 2_000_000

async function range(start: string) {
  const r = await net.fetch(`${SITE}/range/${start}`, { headers: { "Add-Padding": "true" }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000) })
    .catch(() => null)
  if (!r?.ok) throw new Error(r ? `Have I Been Pwned answered ${r.status}` : "Have I Been Pwned couldn't be reached")
  return (await r.text()).slice(0, RANGE_MAX)
}

export async function breaches<T>(starts: () => Promise<string[]>, compare: (start: string, range: string) => Promise<T[]>): Promise<T[]> {
  const left = (await starts()).sort(), found: T[] = []
  const work = async () => { for (let s = left.shift(); s; s = left.shift()) found.push(...await compare(s, await range(s))) }
  try { await Promise.all(Array.from({ length: AT_ONCE }, work)) } finally { left.length = 0 }
  return found
}
