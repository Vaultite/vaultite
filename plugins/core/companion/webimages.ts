import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { parseJson } from "../../../core/agents.ts"
import { BROWSER_UA, fetchPublic, OpError } from "../../../core/plugins.ts"
import { messageOf } from "./errors.ts"

const MAX_BYTES = 8 << 20
const THUMB_PX = 960
const CACHE_FILES = 200
// Wikimedia's policy asks API clients to name themselves; any other site gets a browser's.
const WIKI_UA = "Vaultite/1.0 (https://github.com/Vaultite/vaultite)"
const WIKIMEDIA = /(^|\.)(wikimedia|wikipedia)\.org$/i
const EXT = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/gif", "gif"], ["image/webp", "webp"], ["image/avif", "avif"], ["image/svg+xml", "svg"], ["image/bmp", "bmp"], ["image/tiff", "tiff"]])
const dir = () => path.join(os.tmpdir(), "vaultite-web-images")
export const SEARCH = /^(search|find):\s*/i

const uaFor = (url: string) => (WIKIMEDIA.test(new URL(url).hostname) ? WIKI_UA : BROWSER_UA)

export async function webImage(url: string): Promise<{ file: string; url: string }> {
  const key = crypto.createHash("sha1").update(url).digest("hex").slice(0, 20)
  const had = cached(key)
  if (had) return { file: had, url }
  const got = await get(url)
  if (got.status < 400) return { file: keep(key, got.type, got.body), url }
  const thumb = got.status < 500 ? await wikimediaThumb(url) : null
  if (thumb) {
    const again = await get(thumb)
    if (again.status < 400) return { file: keep(key, again.type, again.body), url: thumb }
  }
  throw new OpError(`the image ${url} answers ${got.status}${thumb ? " (Wikimedia has no such file)" : ""}: never a guessed address; give src "search: <what it shows>" for a real picture, or the address of one you saw`, 409)
}

async function get(url: string) {
  let r
  try {
    r = await fetchPublic(url, { max: MAX_BYTES, types: /^image\//, timeout: 10_000, headers: { "User-Agent": uaFor(url), "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5" } })
  } catch (e) { throw new OpError(`the image ${url} can't be fetched: ${messageOf(e)}`, 409) }
  if (r.status >= 400) return r
  const type = r.type.split(";")[0].trim()
  if (!type.startsWith("image/")) throw new OpError(`${url} is ${type || "not a file"}, not an image (a page isn't: give the image's own address, or src "search: <what it shows>")`, 409)
  if (r.cut) throw new OpError(`the image ${url} is over ${MAX_BYTES >> 20} MB`, 409)
  return { ...r, type }
}

function cached(key: string) {
  try { const f = fs.readdirSync(dir()).find((n) => n.startsWith(`${key}.`)); return f ? path.join(dir(), f) : null } catch { return null }
}
function keep(key: string, type: string, body: Buffer) {
  fs.mkdirSync(dir(), { recursive: true })
  const file = path.join(dir(), `${key}.${EXT.get(type) ?? "img"}`)
  fs.writeFileSync(file, body)
  try {
    const all = fs.readdirSync(dir()).map((n) => ({ f: path.join(dir(), n), t: fs.statSync(path.join(dir(), n)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const old of all.slice(CACHE_FILES)) fs.rmSync(old.f, { force: true })
  } catch {}
  return file
}

const Info = z.object({ thumburl: z.string().optional(), url: z.string().optional(), mime: z.string().optional() })
const Pages = z.object({ query: z.object({ pages: z.array(z.object({ title: z.string(), index: z.number().optional(),
  thumbnail: z.object({ source: z.string() }).optional(), imageinfo: z.array(Info).optional() })) }).optional() })

async function api(host: string, params: Record<string, string>) {
  const u = new URL(`https://${host}/w/api.php`)
  for (const [k, v] of Object.entries({ action: "query", format: "json", formatversion: "2", ...params })) u.searchParams.set(k, v)
  const r = await fetchPublic(u, { types: /json/, timeout: 6000, headers: { "User-Agent": WIKI_UA, "Accept": "application/json" } })
  if (r.status >= 400) throw new OpError(`${host} answers ${r.status}`, 502)
  const pages = parseJson(r.body.toString("utf8"), Pages)
  if (!pages) throw new OpError(`${host} answers something other than its pages`, 502)
  return pages.query?.pages ?? []
}

async function wikimediaThumb(url: string): Promise<string | null> {
  const u = new URL(url), m = /^\/wikipedia\/([\w-]+)\/thumb\/\w\/\w\w\/([^/]+)\//.exec(u.pathname)
  if (!WIKIMEDIA.test(u.hostname) || !m) return null
  const host = m[1] === "commons" ? "commons.wikimedia.org" : `${m[1]}.wikipedia.org`
  const pages = await api(host, { titles: `File:${decodeURIComponent(m[2])}`, prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(THUMB_PX) }).catch(() => [])
  const info = pages[0]?.imageinfo?.[0]
  return info?.thumburl ?? info?.url ?? null
}

type Found = { url: string; name: string }
const byRank = <T extends { index?: number }>(a: T, b: T) => (a.index ?? 99) - (b.index ?? 99)
async function leadImage(q: string): Promise<(Found & { rank: number }) | null> {
  const pages = await api("en.wikipedia.org", { generator: "search", gsrsearch: q, gsrlimit: "5", prop: "pageimages", piprop: "thumbnail", pithumbsize: String(THUMB_PX) }).catch(() => [])
  const lead = pages.filter((p) => p.thumbnail).sort(byRank)[0]
  return lead?.thumbnail ? { url: lead.thumbnail.source, name: `${lead.title} (Wikipedia)`, rank: lead.index ?? 99 } : null
}
async function commonsFile(q: string): Promise<Found | null> {
  const files = await api("commons.wikimedia.org", { generator: "search", gsrsearch: `${q} filetype:bitmap|drawing`, gsrnamespace: "6", gsrlimit: "5", prop: "imageinfo", iiprop: "url|mime", iiurlwidth: String(THUMB_PX) }).catch(() => [])
  const file = files.sort(byRank).find((p) => p.imageinfo?.[0]?.mime?.startsWith("image/")), info = file?.imageinfo?.[0]
  const src = info?.thumburl ?? info?.url
  return file && src ? { url: src, name: `${file.title.replace(/^File:/, "").replace(/\.\w+$/, "")} (Wikimedia Commons)` } : null
}

export async function findImage(words: string): Promise<Found> {
  const q = words.trim()
  if (!q) throw new OpError(`src "search: <words>": say what the picture shows`)
  const lead = await leadImage(q)
  const found = (lead && lead.rank <= 2 ? lead : null) ?? (await commonsFile(q)) ?? lead
  if (!found) throw new OpError(`no picture of "${q}" on Wikipedia or Wikimedia Commons: try other words, or the address of an image you saw`, 404)
  return { url: found.url, name: found.name }
}
