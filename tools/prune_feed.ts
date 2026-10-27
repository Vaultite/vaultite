// `node tools/prune_feed.ts <"" | nightly/> [--dry-run]`: deletes vaultite-updates' installers its update lists no longer
// name (each release left ~1.2 GB). Blockmaps stay: small, and an app updating reads its own version's there.
const bucket = "vaultite-updates"
const dir = process.argv[2]
const dryRun = process.argv.includes("--dry-run")
if (dir === undefined || (dir !== "" && !dir.endsWith("/"))) throw new Error('usage: node tools/prune_feed.ts <"" | nightly/> [--dry-run]')
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are needed")

const api = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`
const call = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`)
  return res
}

/** The folder's objects, without those in folders under it. */
async function list() {
  const keys: string[] = []
  let cursor = ""
  do {
    const q = new URLSearchParams({ prefix: dir, delimiter: "/", per_page: "1000", ...(cursor && { cursor }) })
    const body = await (await call(`${api}?${q}`)).json() as { result: { key: string }[]; result_info?: { cursor?: string; is_truncated?: boolean } }
    keys.push(...body.result.map((o) => o.key))
    cursor = body.result_info?.is_truncated ? body.result_info.cursor ?? "" : ""
  } while (cursor)
  return keys.filter((k) => !k.slice(dir.length).includes("/"))
}

const keys = await list()
const lists = keys.filter((k) => k.endsWith(".yml"))
if (!lists.length) throw new Error(`no update lists in ${bucket}/${dir}: nothing pruned`)
// (each list's `- url:` entries and its `path:`, as electron-builder writes them)
const named = new Set<string>()
for (const k of lists) {
  const text = await (await call(`${api}/${encodeURIComponent(k)}`)).text()
  for (const [, file] of text.matchAll(/^\s*(?:- url|path): *['"]?([^'"\n]+?)['"]?\s*$/gm)) named.add(dir + file)
}
const installer = /(-mac\.zip|\.AppImage|\.exe)$/
const stale = keys.filter((k) => installer.test(k) && !named.has(k))
if (keys.some((k) => installer.test(k)) && !keys.some((k) => installer.test(k) && named.has(k))) {
  throw new Error(`${bucket}/${dir}: its update lists name none of its installers: nothing pruned`)
}
for (const k of stale) {
  if (!dryRun) await call(`${api}/${encodeURIComponent(k)}`, { method: "DELETE" })
  console.log(`${dryRun ? "would delete" : "deleted"} ${k}`)
}
console.log(`${bucket}/${dir}: ${stale.length} old installers ${dryRun ? "to delete" : "deleted"}, ${named.size} current kept`)
