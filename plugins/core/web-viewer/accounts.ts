// Each set of logins' sites as last listed (Sites asks the desktop app, electron/web.ts), so the container menu can
// name who's signed in to a page's site in each container without waiting.
import { cell, webPages, type WebSite } from "@vaultite"

/** By profile (a workspace's logins, or a container's: "c-work"). */
export const listed = cell(new Map<string, WebSite[]>())
export const keep = (prof: string, sites: WebSite[]) => { listed.update((m) => new Map(m).set(prof, sites)); return sites }

/** List these sets of logins' sites again (as the container menu may open). */
export function askSites(profs: string[]) {
  for (const p of profs) void webPages?.sites?.(p).then((s) => keep(p, s), () => {})
}

/** Who's signed in to `site` in a set of logins, as last listed: the account, and how many more beside it. */
export function accountIn(prof: string, site: string) {
  const s = listed.get().get(prof)?.find((x) => x.site === site || x.with?.includes(site))
  return s?.account ? (s.more?.length ? `${s.account} +${s.more.length}` : s.account) : ""
}
