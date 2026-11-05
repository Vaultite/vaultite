// Links from other apps open where their site's account is signed in (a picker when several are); one nobody's chose
// is watched, and the sign-in its page reaches on another site (an app's auth start's Google) chooses then.
import { Box } from "lucide-react"
import { choose, dotIcon, notify, webPages } from "@vaultite"
import { siteOf } from "./address"
import { colorOf, containerById, containers, keepOutside, profileIn, setSiteRule } from "./containers"
import { byLogins, linkRuleIn, ruleSiteOf } from "./where.ts"

type Signed = { id: string | null; account: string }

/** Who's signed in to `site` in each set of logins, in the menus' order (none, the workspace's, first). */
async function signedIn(site: string): Promise<Signed[]> {
  const ids = [null, ...containers().map((c) => c.id)]
  const who = await webPages?.who?.(site, ids.map(profileIn)).catch(() => null)
  return who ? ids.flatMap((id) => {
    const w = who[profileIn(id)]
    return w ? [{ id, account: w.account ? (w.more?.length ? `${w.account} +${w.more.length}` : w.account) : "Signed in" }] : []
  }) : []
}

/** Ask which of `among` a page needing `site`'s login opens in (`current`: the one it's in); ⌘Enter also always opens
 *  `ruleSite` there. `done` gets the id picked, undefined when dismissed. */
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
      // (none is where a site with no rule opens: nothing to remember)
      if (how.mod && c) void setSiteRule(ruleSite, c.id).then(() => notify(`${ruleSite} opens in ${c.name} from now on`))
      done(id)
    },
    onDismiss: () => done(undefined),
  })
}

/** Links nobody's logins chose, by address, as they were opened: their tab is watched once its page opens (`watchTab`). */
const unchosen = new Map<string, number>()
const watched = new Set<string>()
const FRESH_MS = 30_000
/** Tab `tab` is showing `url`: one just opened unchosen from another app is watched for a sign-in (`signInReached`). */
export function watchTab(url: string, tab: string) {
  const at = unchosen.get(url)
  if (at === undefined) return
  unchosen.delete(url)
  if (tab && Date.now() - at < FRESH_MS) watched.add(tab)
}

/** Open `url`, another app's link, with `open`: in its rule's container, else where its site's account is (asking when
 *  it's in several; dismissed, as ever), else as ever and watched. */
export async function openFromApp(url: string, open: (url: string, container: string | null) => void) {
  const rule = linkRuleIn(containers(), url)
  if (rule) return open(url, rule)
  const site = siteOf(url), among = site ? await signedIn(site) : []
  const d = byLogins(among.map((s) => s.id))
  const go = (id: string | null | undefined) => {
    // (none chosen stays in none, whatever the workspace's own container)
    if (id === null) keepOutside(url)
    open(url, id ?? null)
  }
  if (d.ask) return pick(among, site, ruleSiteOf(url), undefined, go)
  if (d.open !== undefined) return go(d.open)
  unchosen.set(url, Date.now())
  open(url, null)
}

/** Tab `tab`'s page, in `container`, reached `site`'s sign-in before the user moved it on: if it's watched, it starts
 *  again from `opened` (`restart`) where that site's account is, asking when it's in several. Once per tab. */
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
