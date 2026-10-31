// Each set of logins' sites as last listed (Sites asks the desktop app, electron/web.ts), so the container menu can
// name who's signed in to a page's site in each container without waiting; other machines' asked through the server.
import { cell, get, webPages, type WebSite } from "@vaultite"

/** By profile (a workspace's logins, or a container's: "c-work"). */
export const listed = cell(new Map<string, WebSite[]>())
export const keep = (prof: string, sites: WebSite[]) => { listed.update((m) => new Map(m).set(prof, sites)); return sites }

/** List these sets of logins' sites again (as the container menu may open): done when they've all answered. */
export function askSites(profs: string[]) {
  return Promise.all(profs.map((p) => webPages?.sites?.(p).then((s) => { keep(p, s) }, () => {}))).then(() => {})
}

/** Addresses that are only another site's door, signed in with its login (gmail.com opens mail.google.com). */
const DOOR: Record<string, string> = { "gmail.com": "google.com", "youtu.be": "youtube.com", "twitter.com": "x.com" }

/** Who's signed in to `site` in a set of logins, as last listed: the account, and how many more beside it ("Signed in"
 *  when the site doesn't say who). */
export function accountIn(prof: string, typed: string) {
  const site = DOOR[typed] ?? typed
  const s = listed.get().get(prof)?.find((x) => x.site === site || x.with?.includes(site))
  return s?.account ? (s.more?.length ? `${s.account} +${s.more.length}` : s.account) : s?.signed ? "Signed in" : ""
}

/** Another machine's browser's sets of logins with sites (machinelogins.ts), by profile. */
export type MachineSets = { machine: string; label: string; sets: Record<string, WebSite[]> }
/** The other machines' as last listed (null: not yet). */
export const elsewhere = cell<MachineSets[] | null>(null)

/** List the other machines' sets of logins among `profs` again. */
export function askElsewhere(profs: string[]) {
  return get<{ machines: MachineSets[] }>(`web-viewer/logins?profiles=${encodeURIComponent(profs.join(","))}`)
    .then((r) => elsewhere.set(r.machines), () => {})
}
