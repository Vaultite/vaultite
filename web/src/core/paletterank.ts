// The command palette's order for what's typed (CommandPalette): no React, so the tests rank real lists.
import { fuzzy, startsWords } from "./fuzzy.ts"

type Ranked = { id: string; name: string; words?: string; on?: () => boolean; nameWhenOn?: string; value?: () => string }

/** A setting (a switch or a value): what one changes, after what one goes to or does when they match as well. */
const setting = (c: Ranked) => (!!c.on && !c.nameWhenOn) || !!c.value

/** By name: the better match first (fuzzy's tier), among equal ones commands before settings ("terminal": Open
 *  terminal, then Terminal cursor), then the score; then those found only by their other words. */
export function rankCommands<T extends Ranked>(cs: T[], q: string): (T & { marks: number[] })[] {
  const typed = q.trim()
  const out = cs.flatMap((c) => {
    const m = fuzzy(typed, c.name)
    if (m) return [{ c, marks: m.marks, tier: m.tier, kind: setting(c) ? 1 : 0, score: m.score }]
    return c.words && startsWords(typed, `${c.name} ${c.words}`) ? [{ c, marks: [], tier: -1, kind: setting(c) ? 1 : 0, score: 0 }] : []
  })
  return out.sort((a, b) => b.tier - a.tier || a.kind - b.kind || b.score - a.score).map(({ c, marks }) => ({ ...c, marks }))
}
