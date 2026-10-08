// A web page card's preview: what a page's HTML says about itself. Pure, no Node: plugin.ts fetches through
// fetchPublic, and tests run it on made-up HTML.

/** What GET /api/canvas/link answers: the address asked about, and what its page says (each left out when it doesn't). */
export type LinkPreview = { url: string; title?: string; site?: string; description?: string; image?: string; icon?: string }

// ---------- What a page's HTML says about itself ----------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘",
  rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•", copy: "©", reg: "®", trade: "™",
  deg: "°", times: "×", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶", shy: "", zwj: "\u200d", zwnj: "\u200c",
}

/** Text with its HTML character references decoded (&amp; &#39; &#x2014; and common named ones; unknown ones stay). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});?/gi, (all, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10)
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all
    }
    const named = NAMED[ref.toLowerCase()]
    return named ?? all
  })
}

/** A tag's attributes, names lowercased, values decoded. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  const body = tag.replace(/^<\s*[a-z]+/i, "").replace(/\/?>$/, "")
  for (let m; (m = re.exec(body));) {
    const k = m[1].toLowerCase()
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")
  }
  return out
}

const clean = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  return !t ? undefined : t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** `href` against `base` as an absolute http(s) address (or a small data: image, for icons), else undefined. */
function absolute(href: string | undefined, base: string, data = false): string | undefined {
  const h = (href ?? "").trim()
  if (!h) return undefined
  if (/^data:image\//i.test(h)) return data && h.length <= 16_384 ? h : undefined
  try {
    const u = new URL(h, base)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined
  } catch { return undefined }
}

/** What a page's HTML says about itself (og:, twitter:, <title>, the best icon), addresses made absolute against
 *  `pageUrl` or its <base href>. Never throws. */
export function parsePreview(html: string, pageUrl: string): Omit<LinkPreview, "url"> {
  // Comments, scripts, styles and inline SVG (whose <title>s aren't the page's) say nothing about the page.
  const text = html.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|svg|template|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const meta: Record<string, string> = {}
  const icons: { rel: string; href: string; size: number }[] = []
  let base = pageUrl
  for (const m of text.matchAll(/<(meta|link|base)\b[^>]*>/gi)) {
    const a = attributes(m[0])
    const tag = m[1].toLowerCase()
    if (tag === "meta") {
      const key = (a.property || a.name || a.itemprop || "").toLowerCase().trim()
      if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
    } else if (tag === "base") {
      if (a.href && base === pageUrl) base = absolute(a.href, pageUrl) ?? pageUrl
    } else if (a.href) {
      const rel = (a.rel ?? "").toLowerCase().split(/\s+/)
      if (!rel.some((r) => r === "icon" || r === "apple-touch-icon" || r === "apple-touch-icon-precomposed")) continue
      const sizes = /(\d+)x\d+/i.exec(a.sizes ?? "")
      icons.push({ rel: rel.includes("icon") ? "icon" : "apple", href: a.href, size: sizes ? Number(sizes[1]) : 0 })
    }
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1]
  const pick = (...keys: string[]) => keys.map((k) => meta[k]).find((v) => v && v.trim())

  // An icon: a plain one over an apple-touch-icon; among them the smallest at least 32 px, else the biggest, else
  // the first (sizes unknown). /favicon.ico when the page names none.
  const rank = (i: (typeof icons)[number]) => (i.size >= 32 ? 10_000 - i.size : i.size)
  const best = (list: typeof icons) => list.length ? list.reduce((a, b) => (rank(b) > rank(a) ? b : a)) : undefined
  const chosen = best(icons.filter((i) => i.rel === "icon")) ?? best(icons.filter((i) => i.rel === "apple"))
  let icon = chosen ? absolute(chosen.href, base, true) : undefined
  if (!icon) try { icon = new URL("/favicon.ico", pageUrl).href } catch { /* no address: no icon */ }

  const out: Omit<LinkPreview, "url"> = {
    title: clean(pick("og:title", "twitter:title") ?? decodeEntities(title ?? ""), 300),
    site: clean(pick("og:site_name", "application-name", "apple-mobile-web-app-title"), 100),
    description: clean(pick("og:description", "twitter:description", "description"), 500),
    image: absolute(pick("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"), base),
    icon,
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) if (out[k] === undefined) delete out[k]
  return out
}
