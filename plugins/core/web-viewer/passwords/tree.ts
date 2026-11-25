import type { Group, Row } from "./types.ts"

export const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
export type Branch = { group: Group; depth: number; count: number; parent: boolean }

export const binsOf = (groups: Group[]) => new Set(groups.flatMap((g) => (g.bin ? [g.id] : [])))

export function treeOf(groups: Group[], entries: Row[]) {
  const kids = new Map<string | null, Group[]>()
  for (const g of groups) if (!g.bin) kids.set(g.parent, [...(kids.get(g.parent) ?? []), g])
  const direct = new Map<string, number>()
  for (const e of entries) direct.set(e.group, (direct.get(e.group) ?? 0) + 1)
  const tree: Branch[] = []
  const walk = (g: Group, depth: number): number => {
    const under = [...(kids.get(g.id) ?? [])].sort((a, b) => collator.compare(a.name, b.name))
    const row: Branch = { group: g, depth, count: 0, parent: under.length > 0 }
    if (depth >= 0) tree.push(row)
    row.count = (direct.get(g.id) ?? 0) + under.reduce((n, k) => n + walk(k, depth + 1), 0)
    return row.count
  }
  const root = groups.find((g) => g.parent === null)
  if (root) walk(root, -1)
  const bins = binsOf(groups)
  return { root, tree, bins, bin: groups.find((g) => g.bin && !(g.parent && bins.has(g.parent))) }
}

export function within(groups: Group[], id: string) {
  const set = new Set([id])
  for (let grew = true; grew;) { grew = false; for (const g of groups) if (g.parent && set.has(g.parent) && !set.has(g.id)) { set.add(g.id); grew = true } }
  return set
}

export function groupPath(groups: Map<string, Group>, id: string) {
  const names: string[] = []
  for (let g = groups.get(id); g && g.parent; g = g.parent ? groups.get(g.parent) : undefined) names.unshift(g.name)
  return names.join(" / ")
}

export function groupChoices(groups: Group[]) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  return groups.flatMap((g) => (g.bin ? [] : [{ id: g.id, top: !g.parent, label: g.parent ? groupPath(byId, g.id) : g.name || "Top level" }]))
    .sort((a, b) => Number(b.top) - Number(a.top) || collator.compare(a.label, b.label))
}

export function sharedGroups(groups: Group[], entries: Row[]) {
  return new Set([...groups.filter((g) => g.share && !g.bin).map((g) => g.id), ...entries.filter((e) => e.shared).map((e) => e.group)])
}

export function matches(e: Row, q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const all = [e.title, e.username, ...e.urls, ...e.tags].map((s) => s.toLowerCase())
  return words.every((w) => all.some((s) => s.includes(w)))
}
