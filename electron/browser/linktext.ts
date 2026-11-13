// Agents' reads send these functions' source into the page (linkTextCode), so each one holds everything it uses.
type Shown = { innerText?: string; textContent: string | null; parentElement: Shown | null; closest(s: string): Shown | null
  querySelectorAll(s: string): Iterable<Shown>; getAttribute(n: string): string | null }

export function shortUrl(href: string, base: string): string | null {
  const parse = (s: string, b?: string) => URL.canParse(s, b) ? new URL(s, b) : null
  const decoded = (s: string) => { try { return decodeURI(s) } catch { return s } }
  const here = parse(base), u = href.startsWith("#") ? null : parse(href, here?.href)
  if (!u || /^(javascript|data|blob|about):$/.test(u.protocol)) return null
  if (!/^https?:$/.test(u.protocol)) return /^(mailto|tel):$/.test(u.protocol) ? u.protocol + u.pathname : `${u.protocol}//${u.host}${u.pathname}`
  const same = !!here && here.origin === u.origin
  if (same && here.pathname === u.pathname && here.search === u.search) return null
  const tracking = /^(utm_\w*|mc_\w*|_hs\w*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|igshid|mkt_tok|ref|ref_src|ref_url|si|spm|share_id)$/i
  const kept = new URLSearchParams(Array.from(u.searchParams).filter(([k]) => !tracking.test(k))).toString()
  const path = decoded(u.pathname.replace(/\/+$/, "") + (kept ? `?${kept}` : ""))
  return same ? path || "/" : u.host.replace(/^www\./, "") + path
}

export function textWithLinks(el: Shown, short: (href: string, base: string) => string | null): string {
  const LINK = "a[href], [data-wiki], [data-url]", shown = (e: Shown) => e.innerText ?? e.textContent ?? ""
  const plain = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/^\[\[|\]\]$/g, "").replace(/\/$/, "")
  const whereTo = (a: Shown) => {
    const wiki = a.getAttribute("data-wiki")
    return wiki ? `[[${wiki}]]` : short(a.getAttribute("href") || a.getAttribute("data-url") || "", globalThis.location?.href ?? "")
  }
  const saysItself = (words: string, to: string) => { const said = plain(words), bare = plain(to); return said === bare || (said.includes("/") && bare.endsWith(said)) }
  const linkOf = (a: Shown) => { const words = shown(a).trim(), to = words ? whereTo(a) : null; return to && !saysItself(words, to) ? { words, to } : null }
  const inside = el.closest(LINK), text = shown(el)
  if (inside) { const l = linkOf(inside); return l ? `${text.trim()} (→ ${l.to})` : text }
  let out = "", from = 0
  for (const a of el.querySelectorAll(LINK)) {
    const l = a.parentElement?.closest(LINK) ? null : linkOf(a), at = l ? text.indexOf(l.words, from) : -1
    if (!l || at < 0) continue
    out += `${text.slice(from, at + l.words.length)} (→ ${l.to})`
    from = at + l.words.length
  }
  return out + text.slice(from)
}

export const linkTextCode = (root: string) => `(${textWithLinks})(${root}, ${shortUrl})`
