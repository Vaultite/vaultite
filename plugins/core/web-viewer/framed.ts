// Sites a tab shows live where the desktop app's pages aren't: in a sandboxed frame (FramedPage.tsx). None in the app;
// the web demo names its few (web/demo/boot.ts, before the app's modules run: so this imports nothing).

export type FramedSite = { url: string; title: string; icon: string }

const sites = new Map<string, FramedSite>()
const hostIn = (url: string) => { try { return new URL(url).host.replace(/^www\./, "") } catch { return "" } }

export function frameSites(list: FramedSite[]) {
  for (const s of list) sites.set(hostIn(s.url), s)
}
/** Whether tabs show some sites live (the web demo). */
export const framing = () => sites.size > 0
/** The site `url` is on, if it's one a tab shows live. */
export const framedSite = (url: string) => (/^https:\/\//i.test(url) ? sites.get(hostIn(url)) ?? null : null)
/** A framed site's icon by host (a data URL), "" for none. */
export const framedIcon = (host: string) => sites.get(host)?.icon ?? ""
