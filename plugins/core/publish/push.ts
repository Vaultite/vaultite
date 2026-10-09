// Sending the published set to Vaultite Cloud: what it lacks of the images, the pages that changed, then the list of
// pages to keep (it removes the rest, and images no page shows).
import fs from "node:fs"
import type { Collected } from "./collect.ts"

/** Vaultite Cloud's API as this machine (the MCP plugin's cloudFetch). */
export type Relay = (route: string, init?: RequestInit) => Promise<Response>
/** What Vaultite Cloud says is published. */
export type Remote = { url: string; entitled: boolean; billing: string; pages: { slug: string; title: string; hash: string; updated: number }[]; assets: string[] }
export type Pushed = { url: string; pages: number; changed: number; images: number; removed: number }

/** An error to show as it is: not signed in, no Publish plan (`billing`: where to get one, in a browser). */
export class PublishError extends Error {
  status: number
  billing?: string
  constructor(message: string, status: number, billing?: string) { super(message); this.status = status; this.billing = billing }
}

async function answer<T>(r: Response, what: string): Promise<T> {
  const d = await r.json().catch(() => ({})) as Record<string, unknown>
  if (r.ok) return d as T
  if (r.status === 401) throw new PublishError("This machine's sign-in to Vaultite Cloud has ended: sign in again under Connections (vau cloud sign-in)", 401)
  if (r.status === 402) throw notEntitled(String(d.billing ?? ""))
  throw new PublishError(`Vaultite Cloud couldn't ${what}: ${String(d.error ?? d.message ?? r.status)}`, r.status >= 500 ? 502 : r.status)
}

export const notEntitled = (billing: string) =>
  new PublishError(`Publishing needs a Publish plan on your Vaultite Cloud account${billing ? `: get one in your browser at ${billing}` : ""}`, 402, billing || undefined)

export async function remote(relay: Relay): Promise<Remote> {
  return answer<Remote>(await relay("/api/publish"), "list what's published")
}

/** Publish `set` as the whole site: pages not in it are removed. */
export async function push(relay: Relay, set: Collected): Promise<Pushed> {
  const now = await remote(relay)
  if (!now.entitled && set.pages.length) throw notEntitled(now.billing)
  const have = new Set(now.assets), hashes = new Map(now.pages.map((p) => [p.slug, p.hash]))
  let images = 0, changed = 0
  for (const a of set.assets) {
    if (have.has(a.hash)) continue
    const body = fs.readFileSync(a.abs)
    await answer(await relay(`/api/publish/assets/${a.hash}`, { method: "PUT", body, headers: { "Content-Type": a.type } }), `take ${a.path}`)
    images++
  }
  for (const p of set.pages) {
    if (hashes.get(p.slug) === p.hash) continue
    await answer(await relay(`/api/publish/pages/${p.slug}`, {
      method: "PUT", body: JSON.stringify({ title: p.title, markdown: p.markdown }), headers: { "Content-Type": "application/json" },
    }), `publish ${p.path}`)
    changed++
  }
  const done = await answer<{ removed?: number }>(await relay("/api/publish/sync", {
    method: "POST", body: JSON.stringify({ keep: set.pages.map((p) => p.slug) }), headers: { "Content-Type": "application/json" },
  }), "tidy up the site")
  return { url: now.url, pages: set.pages.length, changed, images, removed: Number(done.removed ?? 0) }
}
