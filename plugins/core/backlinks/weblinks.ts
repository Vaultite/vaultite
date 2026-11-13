const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src|si)$/i
const URL_RE = /https?:\/\/[^\s<>"'`\]]+/gi

export function siteOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "") } catch { return "" }
}

export function pageKey(url: string): string {
  let u: URL
  try { u = new URL(url) } catch { return "" }
  if (!/^https?:$/.test(u.protocol)) return ""
  const q = [...u.searchParams].filter(([k]) => !TRACKING.test(k)).map(([k, v]) => `${k}=${v}`).sort().join("&")
  return `${siteOf(url)}${u.pathname.replace(/\/+$/, "")}${q ? `?${q}` : ""}`
}

function trimmed(raw: string): string {
  let u = raw.replace(/[.,;:!?*_~]+$/, "")
  // Wikipedia's addresses hold parentheses: "Foo_(bar)".
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) u = u.slice(0, -1).replace(/[.,;:!?]+$/, "")
  return u
}

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

export function sourcesOf(fm: Record<string, unknown>): string[] {
  return ["source", "url"].flatMap((k) => (Array.isArray(fm[k]) ? fm[k] as unknown[] : [fm[k]])).filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v))
}
