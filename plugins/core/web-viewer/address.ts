
export const SEARCH = "https://duckduckgo.com/?q=%s"

/** Local hosts rarely have https. */
const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|(\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(?=:\d)|[a-z0-9.-]+\.(local|lan|internal|test|localhost|home\.arpa))(:\d+)?$/i

export function addressOf(typed: string, search = SEARCH): string | null {
  const t = typed.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) {
    try { return new URL(t).href } catch { return null }
  }
  const host = t.split(/[/?#]/)[0]
  if (!/\s/.test(t) && (LOCAL.test(host) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?$/i.test(host))) {
    try { return new URL(`${LOCAL.test(host) ? "http" : "https"}://${t}`).href } catch { return null }
  }
  if (/^[a-z][a-z0-9+.-]*:\S/i.test(t) && !/\s/.test(t)) return null
  return searchUrl(t, search)
}

export const guessedHttps = (typed: string) => {
  const t = typed.trim(), to = addressOf(t)
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !!to?.startsWith("https:") && to !== searchUrl(t)
}
export const httpFallback = (url: string, error: string) =>
  /^https:\/\//i.test(url) && /ERR_(CONNECTION_|SSL_|CERT_|EMPTY_RESPONSE|TIMED_OUT|ADDRESS_UNREACHABLE|TUNNEL_)/.test(error) ? `http://${url.slice(8)}` : null

export const searchUrl = (words: string, search = SEARCH) => (search.includes("%s") ? search : SEARCH).replace("%s", encodeURIComponent(words.trim()))

export function hostOf(url: string) {
  try { return new URL(url).host.replace(/^www\./, "") || url } catch { return url }
}

export function siteOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname.toLowerCase() } catch { return "" }
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return host
  const parts = host.split(".")
  return parts.slice(/\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(host) ? -3 : -2).join(".")
}
export function siteName(url: string) {
  const site = siteOf(url)
  return site.includes(".") && !/^[\d.]+$/.test(site) ? site.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : null
}
