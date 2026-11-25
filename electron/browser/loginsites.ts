import { getDomain } from "tldts-experimental"
import type { Entry } from "./keepass.ts"

type Rule = { scheme: string; host: string; port: string; wild: boolean }
const bare = (host: string) => host.toLowerCase().replace(/\.$/, "")
const isIp = (host: string) => /^[\d.]+$/.test(host) || host.startsWith("[")

/** An entry's address as a rule: no scheme is https; `*.` before a domain (one owned by someone, never a public suffix
 *  like co.uk or github.io) names it and every subdomain; else that host only, and www. under a domain itself. */
function ruleOf(given: string): Rule | null {
  let s = given.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
  const wild = /^[a-z]+:\/\/\*\./i.test(s)
  let u: URL
  try { u = new URL(wild ? s.replace("*.", "") : s) } catch { return null }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null
  const host = bare(u.hostname)
  if (!host) return null
  if (wild) {
    const owned = isIp(host) ? null : getDomain(host, { allowPrivateDomains: true })
    if (!owned || (host !== owned && !host.endsWith(`.${owned}`))) return null
  }
  return { scheme: u.protocol.slice(0, -1), host, port: u.port, wild }
}

/** Whether a page at `page` is the site the entry's address `entryUrl` names. An https page takes an http entry of the
 *  same host (an upgrade), an http page only an http entry; the port must be the entry's (none: the default). */
export function matchesSite(entryUrl: string, page: string): boolean {
  const r = ruleOf(entryUrl)
  let u: URL
  try { u = new URL(page) } catch { return false }
  if (!r || (u.protocol !== "https:" && u.protocol !== "http:")) return false
  if (u.protocol === "http:" && r.scheme !== "http") return false
  if (u.port !== r.port) return false
  const host = bare(u.hostname)
  if (r.wild) return host === r.host || host.endsWith(`.${r.host}`)
  if (host === r.host) return true
  return !isIp(r.host) && getDomain(r.host, { allowPrivateDomains: true }) === r.host && host === `www.${r.host}`
}

/** The entries for a page: those one of whose addresses names its site. */
export const entriesFor = (entries: Entry[], page: string) => entries.filter((e) => e.urls.some((u) => matchesSite(u, page)))

/** Entries for another host of the page's domain (retellai.com, for a sign-in at auth.retellai.com), which don't fill
 *  there: each with that address of its. */
export function nearlyFor(entries: Entry[], page: string): { entry: Entry; url: string; domain: string }[] {
  let host: string
  try { host = bare(new URL(page).hostname) } catch { return [] }
  const domain = isIp(host) ? null : getDomain(host, { allowPrivateDomains: true })
  if (!domain) return []
  return entries.flatMap((entry) => {
    const url = entry.urls.find((u) => { const r = ruleOf(u); return !!r && getDomain(r.host, { allowPrivateDomains: true }) === domain })
    return url ? [{ entry, url, domain }] : []
  })
}
