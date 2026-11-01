// Proposals: an agent's large change as a shadow copy of a note, cut into changes the user takes or leaves one by one.
// The server's half (the app's needs only text.ts).
import { diffLines } from "../../../core/linediff.ts"
import type { Change } from "./text.ts"

/** Past this many lines replaced, a companion edit is proposed rather than typed in. */
export const BIG_EDIT = 6

/** Lines with their newline kept: joined, they're the text exactly. */
const linesOf = (s: string): string[] => s.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** How `cur` becomes `next`, as changes found by their text. A change that only adds lines takes the line above it
 *  along (the one below, at the top), so it has text to be found by and lands in the right place. */
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

/** How a change reads, for the margin and its agent: "+3 −2". */
export function tally(c: Pick<Change, "find" | "text">) {
  const [a, b] = [c.find, c.text].map((s) => linesOf(s))
  const gone = a.filter((l) => !b.includes(l)).length, come = b.filter((l) => !a.includes(l)).length
  return { come, gone }
}

/** Lines a stretch of text spans. */
export const linesIn = (s: string) => linesOf(s).length
