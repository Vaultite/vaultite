import { fuzzy, startsWords } from "./fuzzy.ts"

type Ranked = { id: string; name: string; words?: string; on?: () => boolean; nameWhenOn?: string; value?: () => string }

const setting = (c: Ranked) => (!!c.on && !c.nameWhenOn) || !!c.value

export function rankCommands<T extends Ranked>(cs: T[], q: string): (T & { marks: number[] })[] {
  const typed = q.trim()
  const out = cs.flatMap((c) => {
    const m = fuzzy(typed, c.name)
    if (m) return [{ c, marks: m.marks, tier: m.tier, kind: setting(c) ? 1 : 0, score: m.score }]
    return c.words && startsWords(typed, `${c.name} ${c.words}`) ? [{ c, marks: [], tier: -1, kind: setting(c) ? 1 : 0, score: 0 }] : []
  })
  return out.sort((a, b) => b.tier - a.tier || a.kind - b.kind || b.score - a.score).map(({ c, marks }) => ({ ...c, marks }))
}
