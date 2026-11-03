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

/** Where `a` and `b` differ: the common head's length and the common tail's, never cutting a character in two (Yjs
 *  would make each half a U+FFFD). */
export function span(a: string, b: string): [number, number] {
  const low = (s: string, i: number) => { const c = s.charCodeAt(i); return c >= 0xdc00 && c <= 0xdfff }
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  if (head > 0 && (low(a, head) || low(b, head))) head--
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  if (tail > 0 && (low(a, a.length - tail) || low(b, b.length - tail))) tail--
  return [head, tail]
}

/** One change of a proposal: `find` (whole lines of the note as it was) becomes `text`. While its agent writes, a
 *  placeholder by `find` saying what will come (`intent`). stale: its text has since changed, so it can only be left. */
export type Change = { id: string; find: string; text: string; line: number; intent?: string; stale?: boolean }

/** Where a change is in `text`: its start, -1 when its lines aren't there any more. */
export const changeAt = (text: string, c: Pick<Change, "find" | "line">) => (c.find ? nearest(text, c.find, c.line) : text ? -1 : 0)

/** Whether a note is kept from the agents: under one of `folders` (vault paths), or its frontmatter (at the start of
 *  `text`) says `companion: private`. */
export function isPrivate(path: string, text: string, folders: string[]) {
  if (folders.some((f) => { const d = f.trim().replace(/^\/+|\/+$/g, ""); return !!d && (path === d || path.startsWith(`${d}/`)) })) return true
  const fm = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(text)?.[1]
  return !!fm && /^companion:\s*["']?private["']?\s*$/m.test(fm)
}
