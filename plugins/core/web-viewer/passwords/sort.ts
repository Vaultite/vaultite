import { collator } from "./tree.ts"
import type { Health, Row } from "./types.ts"

export const SORTS = { title: "Name", username: "Username", site: "Website", modified: "Last changed", strength: "Weakest first" } as const
export type Sort = keyof typeof SORTS
export const isSort = (s: string): s is Sort => Object.hasOwn(SORTS, s)

const site = (e: Row) => (e.urls[0] ?? "").replace(/^[a-z][a-z\d+.-]*:\/\/(www\.)?/i, "")
const emptyLast = (a: string, b: string) => Number(!a) - Number(!b) || collator.compare(a, b)
export function sorted(rows: Row[], by: Sort, health: ReadonlyMap<string, Health>): Row[] {
  const bits = (e: Row) => health.get(e.id)?.bits ?? Infinity
  const first: Record<Sort, (a: Row, b: Row) => number> = {
    title: () => 0, username: (a, b) => emptyLast(a.username, b.username), site: (a, b) => emptyLast(site(a), site(b)),
    modified: (a, b) => b.modified - a.modified, strength: (a, b) => (bits(a) === bits(b) ? 0 : bits(a) - bits(b)),
  }
  return [...rows].sort((a, b) => first[by](a, b) || emptyLast(a.title, b.title) || emptyLast(a.username, b.username))
}
