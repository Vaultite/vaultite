import { cell, get, webPages, type WebSite } from "@vaultite"

export const listed = cell(new Map<string, WebSite[]>())
export const keep = (prof: string, sites: WebSite[]) => { listed.update((m) => new Map(m).set(prof, sites)); return sites }

export function askSites(profs: string[]) {
  return Promise.all(profs.map((p) => webPages?.sites?.(p).then((s) => { keep(p, s) }, () => {}))).then(() => {})
}

const DOOR: Record<string, string> = { "gmail.com": "google.com", "youtu.be": "youtube.com", "twitter.com": "x.com" }

export function accountIn(prof: string, typed: string) {
  const site = DOOR[typed] ?? typed
  const s = listed.get().get(prof)?.find((x) => x.site === site || x.with?.includes(site))
  return s?.account ? (s.more?.length ? `${s.account} +${s.more.length}` : s.account) : s?.signed ? "Signed in" : ""
}

export type MachineSets = { machine: string; label: string; sets: Record<string, WebSite[]> }
export const elsewhere = cell<MachineSets[] | null>(null)

export function askElsewhere(profs: string[]) {
  return get<{ machines: MachineSets[] }>(`web-viewer/logins?profiles=${encodeURIComponent(profs.join(","))}`)
    .then((r) => elsewhere.set(r.machines), () => {})
}
