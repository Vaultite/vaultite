// Text helpers both halves use (no Node, no DOM).

/** Lines changed together: from `line` (1-based, in the file's text, frontmatter too), `removed` replaced by `added`. */
export type Hunk = { line: number; added: string[]; removed: string[] }

/** Where `find` is in `text`: the occurrence nearest line `line` (1-based), -1 when it isn't. */
export function nearest(text: string, find: string, line?: number) {
  if (!find) return -1
  let best = -1, bestD = Infinity
  for (let i = text.indexOf(find); i >= 0; i = text.indexOf(find, i + 1)) {
    const d = line ? Math.abs(text.slice(0, i).split("\n").length - line) : 0
    if (d < bestD) { best = i; bestD = d }
    if (!line) break
  }
  return best
}
