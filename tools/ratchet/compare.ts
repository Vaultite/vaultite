import { type Finding, SIZE } from "./lint.ts"

export type Growth = { rule: string; before: number; after: number; message: string; added: Finding[] }

const total = (fs: Finding[], rule: string) => fs.filter((f) => f.rule === rule).reduce((n, f) => n + f.weight, 0)
const count = (fs: Finding[], rule: string) => fs.filter((f) => f.rule === rule).length
const keyOf = (f: Finding) => `${f.rule}\u0000${f.text}`

/** A size rule grows only with more files or functions over its limit and more lines past it: one already over may
 *  grow, and a split may leave several pieces over as long as less is past the limit in all. */
const grew = (was: Finding[], now: Finding[], rule: string) =>
  total(now, rule) > total(was, rule) && (!SIZE.test(rule) || count(now, rule) > count(was, rule))

/** The findings `now` has that `was` didn't, matched by rule and line text so code that only moved isn't new. */
function added(was: Finding[], now: Finding[]) {
  const left = new Map<string, number>()
  for (const f of was) left.set(keyOf(f), (left.get(keyOf(f)) ?? 0) + f.weight)
  return now.filter((f) => {
    const had = left.get(keyOf(f)) ?? 0
    left.set(keyOf(f), Math.max(0, had - f.weight))
    return had < f.weight
  })
}

/** Each rule whose count grew from the change's files before (`was`) to after (`now`). */
export function compare(was: Finding[], now: Finding[]): Growth[] {
  const rules = [...new Set(now.map((f) => f.rule))].sort()
  const fresh = added(was, now)
  return rules.filter((r) => grew(was, now, r)).map((rule) => ({
    rule, before: total(was, rule), after: total(now, rule),
    message: now.find((f) => f.rule === rule)?.message ?? "", added: fresh.filter((f) => f.rule === rule),
  }))
}
