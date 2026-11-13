
export type FramedSite = { url: string; title: string; icon: string }

const sites = new Map<string, FramedSite>()
const hostIn = (url: string) => { try { return new URL(url).host.replace(/^www\./, "") } catch { return "" } }

export function frameSites(list: FramedSite[]) {
  for (const s of list) sites.set(hostIn(s.url), s)
}
export const framing = () => sites.size > 0
export const framedSite = (url: string) => (/^https:\/\//i.test(url) ? sites.get(hostIn(url)) ?? null : null)
export const framedIcon = (host: string) => sites.get(host)?.icon ?? ""
