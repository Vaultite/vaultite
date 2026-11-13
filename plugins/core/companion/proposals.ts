import { diffLines } from "../../../core/linediff.ts"
import type { Change } from "./text.ts"

export const BIG_EDIT = 6

const linesOf = (s: string): string[] => s.match(/[^\n]*\n|[^\n]+$/g) ?? []

export function changesOf(cur: string, next: string, newId: () => string): Change[] {
  const a = linesOf(cur), b = linesOf(next), out: Change[] = []
  for (const [tag, i1, i2, j1, j2] of diffLines(a, b)) {
    if (tag === "equal") continue
    let find = a.slice(i1, i2).join(""), text = b.slice(j1, j2).join(""), line = i1 + 1
    if (!find && i1 > 0) {
      find = a[i1 - 1]!; line = i1
      text = find.endsWith("\n") ? find + text : `${find}\n${text.replace(/\n$/, "")}`
    } else if (!find && a.length) { find = a[0]!; text += find }
    out.push({ id: newId(), find, text, line })
  }
  return out
}

export function tally(c: Pick<Change, "find" | "text">) {
  const [a, b] = [c.find, c.text].map((s) => linesOf(s))
  const gone = a.filter((l) => !b.includes(l)).length, come = b.filter((l) => !a.includes(l)).length
  return { come, gone }
}

export const linesIn = (s: string) => linesOf(s).length
