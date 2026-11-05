// Looking for words in what a tab answers (read --find, snapshot --find), so an agent gets the lines it needs, not the page.
import { OpError } from "../../../core/plugins.ts"

/** The lines of a tree (two spaces a level) that have `find` (any case; /a regex/ too), each with the lines it's inside. */
export function within(tree: string, find: string, max = 80) {
  const re = pattern(find)
  const lines = tree.split("\n"), keep = new Set<number>()
  const depth = (l: string) => l.length - l.trimStart().length
  let hits = 0
  lines.forEach((l, i) => {
    if (hits >= max || !re.test(l)) return
    hits++
    keep.add(i)
    for (let j = i - 1, d = depth(l); j >= 0 && d > 0; j--) if (depth(lines[j]) < d) { keep.add(j); d = depth(lines[j]) }
  })
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n")
}
const pattern = (find: string) => {
  const m = /^\/(.+)\/([a-z]*)$/.exec(find)
  try { return m ? new RegExp(m[1], m[2].includes("i") ? m[2] : `${m[2]}i`) : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }
  catch { throw new OpError(`not a regex: ${find}`) }
}

/** The lines of `text` that have `find` (any case; /a regex/ too), a line around each, numbered. */
export function grep(text: string, find: string, max = 50) {
  const re = pattern(find)
  const lines = text.split("\n"), keep = new Set<number>(), hits: number[] = []
  lines.forEach((l, i) => { if (hits.length < max && re.test(l)) { hits.push(i); for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < lines.length) keep.add(j) } })
  const out: string[] = []
  let last = -2
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (i > last + 1 && out.length) out.push("--")
    out.push(`${i + 1}${hits.includes(i) ? ":" : "-"} ${lines[i].slice(0, 500)}`)
    last = i
  }
  return { hits: hits.length, text: out.join("\n") }
}
