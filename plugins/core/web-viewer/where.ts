import { siteOf } from "./address.ts"
import { signInOf } from "../../../core/signin.ts"

type Named = { id: string; name: string; sites?: string[] }
export type Where = { container: string | null; why: string }

const byId = <C extends Named>(list: C[], id: string | null | undefined) => (id ? list.find((c) => c.id === id) ?? null : null)

export function containerNamed<C extends Named>(list: C[], key: string | null | undefined): C | null {
  const k = key?.trim().toLowerCase()
  return k ? byId(list, k) ?? list.find((c) => c.name.toLowerCase() === k) ?? null : null
}
export function linkChoice(list: Named[], container: string | null | undefined): string | null | undefined {
  if (container === null) return null
  return containerNamed(list, container)?.id
}

export function ruleIn(list: Named[], url: string): string | null {
  const site = siteOf(url)
  return (site && list.find((c) => c.sites?.includes(site))?.id) || null
}

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

export const ruleSiteOf = (url: string) => siteOf(signInOf(url)?.back ?? "") || siteOf(url)
export function linkRuleIn(list: Named[], url: string): string | null {
  const back = signInOf(url)?.back
  return (back ? ruleIn(list, back) : null) ?? ruleIn(list, url)
}

export function byLogins(signed: (string | null)[]): { open?: string | null; ask?: (string | null)[] } {
  const ids = [...new Set(signed)]
  return ids.length === 1 ? { open: ids[0] } : ids.length > 1 ? { ask: ids } : {}
}

export const movedFrom = (state: { url: string; opened?: string }, arg: string) => state.opened || state.url || arg
