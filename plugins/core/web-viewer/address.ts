// What's typed in the Browser's address bar (or in "Open web page…") as an address, and a page's site. Shared with
// tools/test_web.ts.

/** The search used for words that aren't an address: `%s` is what was typed. */
export const SEARCH = "https://duckduckgo.com/?q=%s"

/** Hosts on this machine or the local network, which rarely have https: this machine, IP addresses, a name with a
 *  port ("nas:5000") and the local network's names (printer.local, router.lan, app.test). */
const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|(\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(?=:\d)|[a-z0-9.-]+\.(local|lan|internal|test|localhost|home\.arpa))(:\d+)?$/i

/** An http(s) address as it is; a host ("example.com/a", "localhost:3000") with https:// (http:// for local ones);
 *  anything else a search (`search`, with %s). null for nothing, or another scheme (file:, mailto:). */
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
  if (/^[a-z][a-z0-9+.-]*:\S/i.test(t) && !/\s/.test(t)) return null // mailto:, file:, javascript:...
  return searchUrl(t, search)
}

/** What's typed went to https only because it named no scheme: http is tried when that can't connect, as browsers do. */
export const guessedHttps = (typed: string) => {
  const t = typed.trim(), to = addressOf(t)
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(t) && !!to?.startsWith("https:") && to !== searchUrl(t)
}
/** The http address to try after `url`, guessed https, failed with `error` (a connection's or a certificate's). */
export const httpFallback = (url: string, error: string) =>
  /^https:\/\//i.test(url) && /ERR_(CONNECTION_|SSL_|CERT_|EMPTY_RESPONSE|TIMED_OUT|ADDRESS_UNREACHABLE|TUNNEL_)/.test(error) ? `http://${url.slice(8)}` : null

/** Words searched for with `search` (its %s), else the default search. */
export const searchUrl = (words: string, search = SEARCH) => (search.includes("%s") ? search : SEARCH).replace("%s", encodeURIComponent(words.trim()))

/** A page's site, for its tab before it has a title: "example.com". */
export function hostOf(url: string) {
  try { return new URL(url).host.replace(/^www\./, "") || url } catch { return url }
}

/** "www.youtube.com" → "youtube.com": what a container's sites name. */
export function siteOf(url: string) {
  let host = ""
  try { host = new URL(url).hostname.toLowerCase() } catch { return "" }
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return host
  const parts = host.split(".")
  return parts.slice(/\.(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(host) ? -3 : -2).join(".")
}
/** A page's site as a name for a group of its tabs ("www.github.com" -> "Github"); null for this machine or an IP. */
export function siteName(url: string) {
  const site = siteOf(url)
  return site.includes(".") && !/^[\d.]+$/.test(site) ? site.split(".")[0].replace(/^./, (c) => c.toUpperCase()) : null
}
