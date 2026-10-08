// What's typed in the web viewer's address bar (or in "Open web page…") as an address. Shared with tools/test_web.ts.

/** The search used for words that aren't an address: `%s` is what was typed. */
export const SEARCH = "https://duckduckgo.com/?q=%s"

const LOCAL = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i

/** An http(s) address as it is; a host ("example.com/a", "localhost:3000") with https:// (http:// for this machine
 *  and IP addresses); anything else a search (`search`, with %s). null for nothing, or another scheme (file:, mailto:). */
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

/** Words searched for with `search` (its %s), else the default search. */
export const searchUrl = (words: string, search = SEARCH) => (search.includes("%s") ? search : SEARCH).replace("%s", encodeURIComponent(words.trim()))

/** A page's site, for its tab before it has a title: "example.com". */
export function hostOf(url: string) {
  try { return new URL(url).host.replace(/^www\./, "") || url } catch { return url }
}
