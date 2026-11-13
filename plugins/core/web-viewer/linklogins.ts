import { Box } from "lucide-react"
import { choose, dotIcon, notify, webPages } from "@vaultite"
import { siteOf } from "./address"
import { colorOf, containerById, containers, keepOutside, profileIn, setSiteRule } from "./containers"
import { byLogins, linkRuleIn, ruleSiteOf } from "./where.ts"

type Signed = { id: string | null; account: string }

async function signedIn(site: string): Promise<Signed[]> {
  const ids = [null, ...containers().map((c) => c.id)]
  const who = await webPages?.who?.(site, ids.map(profileIn)).catch(() => null)
  return who ? ids.flatMap((id) => {
    const w = who[profileIn(id)]
    return w ? [{ id, account: w.account ? (w.more?.length ? `${w.account} +${w.more.length}` : w.account) : "Signed in" }] : []
  }) : []
}

function pick(among: Signed[], site: string, ruleSite: string, current: string | null | undefined, done: (id: string | null | undefined) => void) {
  choose({
    title: "Open in", heading: ruleSite === site ? `Which ${site} account?` : `Which ${site} account for ${ruleSite}?`, placeholder: "Open in…",
    items: among.map((s) => {
      const c = containerById(s.id)
      return { id: s.id ?? "", label: `${c?.name ?? "No container"} · ${s.account}`, icon: c ? dotIcon(colorOf(c)) : Box }
    }),
    current: current === undefined ? undefined : current ?? "",
    modHint: `to always open ${ruleSite} there`,
    onPick: (it, how) => {
      const id = it.id || null, c = containerById(id)
      if (how.mod && c) void setSiteRule(ruleSite, c.id).then(() => notify(`${ruleSite} opens in ${c.name} from now on`))
      done(id)
    },
    onDismiss: () => done(undefined),
  })
}

const unchosen = new Map<string, number>()
const watched = new Set<string>()
const FRESH_MS = 30_000
export function watchTab(url: string, tab: string) {
  const at = unchosen.get(url)
  if (at === undefined) return
  unchosen.delete(url)
  if (tab && Date.now() - at < FRESH_MS) watched.add(tab)
}

export async function openFromApp(url: string, open: (url: string, container: string | null) => void) {
  const rule = linkRuleIn(containers(), url)
  if (rule) return open(url, rule)
  const site = siteOf(url), among = site ? await signedIn(site) : []
  const d = byLogins(among.map((s) => s.id))
  const go = (id: string | null | undefined) => {
    if (id === null) keepOutside(url)
    open(url, id ?? null)
  }
  if (d.ask) return pick(among, site, ruleSiteOf(url), undefined, go)
  if (d.open !== undefined) return go(d.open)
  unchosen.set(url, Date.now())
  open(url, null)
}

export async function signInReached(tab: string, container: string | null, site: string, opened: string, restart: (url: string, container: string | null) => void) {
  if (!watched.delete(tab)) return
  const among = await signedIn(site), d = byLogins(among.map((s) => s.id))
  const go = (id: string | null | undefined) => {
    if (id === undefined || id === container) return
    if (id === null) keepOutside(opened)
    restart(opened, id)
  }
  if (d.ask) pick(among, site, siteOf(opened), container, go)
  else go(d.open)
}
