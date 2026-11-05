// Where a page opens, worked out from the containers alone (containers.ts passes them in), so tools/test_web.ts checks it.
import { siteOf } from "./address.ts"
import { signInOf } from "../../../core/signin.ts"

type Named = { id: string; name: string; sites?: string[] }
/** Where an address opens and why (the chip says it while it's typed): `container` null is the workspace's own logins. */
export type Where = { container: string | null; why: string }

const byId = <C extends Named>(list: C[], id: string | null | undefined) => (id ? list.find((c) => c.id === id) ?? null : null)

/** The container a note's `container:` or a link names: its id, else its name in any case ("work", "Work"). */
export function containerNamed<C extends Named>(list: C[], key: string | null | undefined): C | null {
  const k = key?.trim().toLowerCase()
  return k ? byId(list, k) ?? list.find((c) => c.name.toLowerCase() === k) ?? null : null
}
/** A link's `container` (LinkClick's) as `destination`'s `chosen`: null stays none, one no container has is left to
 *  the rules (undefined), as is none given. */
export function linkChoice(list: Named[], container: string | null | undefined): string | null | undefined {
  if (container === null) return null
  return containerNamed(list, container)?.id
}

/** The container a page of `url` opened in none goes to: the one whose sites have its site, if any. */
export function ruleIn(list: Named[], url: string): string | null {
  const site = siteOf(url)
  return (site && list.find((c) => c.sites?.includes(site))?.id) || null
}

/** Where `url` opens from a tab in `from` (`fresh`: new or blank): the container `chosen` (null: none), else the page's
 *  when a page `opened` it (its link is that account's), else its site's, else the tab's, else (fresh) `own`, the workspace's. */
export function whereIn<C extends Named>(list: C[], url: string, { from, fresh, chosen, opened, own }:
  { from: string | null; fresh: boolean; chosen?: string | null; opened?: boolean; own?: string | null }): Where {
  if (chosen !== undefined) return { container: byId(list, chosen)?.id ?? null, why: "" }
  if (opened && byId(list, from)) return { container: from, why: "" }
  const rule = byId(list, url ? ruleIn(list, url) : null)
  if (rule) return { container: rule.id, why: `${siteOf(url)} always opens in ${rule.name}` }
  if (byId(list, from)) return { container: from, why: "" }
  const mine = fresh ? byId(list, own) : null
  return mine ? { container: mine.id, why: "This workspace's container" } : { container: null, why: "" }
}

/** The site whose rule counts for a link from another app: a sign-in link's site signed in to (where it answers), else
 *  its own. Its login's site is its own all the same: a sign-in's is its identity provider's. */
export const ruleSiteOf = (url: string) => siteOf(signInOf(url)?.back ?? "") || siteOf(url)
/** The container a link from another app opens in by a site's rule (ruleSiteOf's, then its own), or null. */
export function linkRuleIn(list: Named[], url: string): string | null {
  const back = signInOf(url)?.back
  return (back ? ruleIn(list, back) : null) ?? ruleIn(list, url)
}

/** Where a page opens by who's signed in to the site it needs, among sets of logins in their order (a container's id,
 *  null the workspace's): one, there (`open`); several, the user picks (`ask`); none, the rules as ever (neither). */
export function byLogins(signed: (string | null)[]): { open?: string | null; ask?: (string | null)[] } {
  const ids = [...new Set(signed)]
  return ids.length === 1 ? { open: ids[0] } : ids.length > 1 ? { ask: ids } : {}
}

/** The address a tab moved to another container opens there: where its page's flow began (`opened`: only redirects and
 *  the page moved it on since), so what its first pages set lands there too; else where it is. */
export const movedFrom = (state: { url: string; opened?: string }, arg: string) => state.opened || state.url || arg
