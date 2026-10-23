// Web addresses in notes, for a web page's links: which notes are about it (`source:`), link to it, or to its site.
// Pure, no Node: the server reads notes with it and tools/test/vault/backlinks.ts checks it.

/** Query keys that only track where a visit came from: the same page without them. */
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|si)$/i
const URL_RE = /https?:\/\/[^\s<>"'`\]]+/gi

/** A page's site, as a person says it: "www.youtube.com" → "youtube.com" ("" for what isn't a web address). */
export function siteOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" }
}

/** The page an address shows, whatever way it's written: no scheme, www, #part, trailing slash or tracking keys. */
export function pageKey(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { return "" }
  if (!/^https?:$/.test(u.protocol)) return ""
  const q = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).map(([k, v]) => `${k}=${v}`).sort().join("&")
  return `${siteOf(url)}${u.pathname.replace(/\/+$/, "")}${q ? `?${q}` : ""}`
}

/** An address as written in Markdown, without what ends the sentence or the link around it. */
function trimmed(raw: string): string {
  let u = raw.replace(/[.,;:!?*_~]+$/, "")
  // A ")" closes the link it's in unless the address opened one itself (Wikipedia's "Foo_(bar)").
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?]+$/, "")
  return u
}

/** Each web address in a note's body with its line, outside code (fences and inline). */
export function urlsIn(body: string): { url: string; line: string }[] {
  const out: { url: string; line: string }[] = []
  let fence: string | null = null
  for (const line of body.split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f && (fence === null || (f[1][0] === fence[0] && f[1].length >= fence.length))) { fence = fence ? null : f[1]; continue }
    if (fence || !/https?:\/\//i.test(line)) continue
    for (const m of line.replace(/(`+)(?:(?!\1).)+?\1/g, "").matchAll(URL_RE)) out.push({ url: trimmed(m[0]), line })
  }
  return out
}

/** The addresses a note says it's about: its `source` (a clipping's, a page's note) and `url`. */
export function sourcesOf(fm: Record<string, unknown>): string[] {
  return ["source", "url"].flatMap((k) => (Array.isArray(fm[k]) ? fm[k] as unknown[] : [fm[k]])).filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v))
}
