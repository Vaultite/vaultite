// Where a page opens, worked out from the containers alone (containers.ts passes them in), so tools/test_web.ts checks it.
import { siteOf } from "./address.ts"

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
