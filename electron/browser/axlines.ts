// An agent's page as lines of its accessibility tree (agent.ts `tree`, two spaces a level): what changed between two, and
// a new page's content. Plain functions, no Electron: tools/test/vault/browser-files.ts tests them.

/** What changed between two trees, by what lines say, not their depth (a wrapper added moves nothing): a control whose
 *  line changed (its value, checked...) once as ~, then lines new (+), then gone (-), so a cut keeps what's new. */
export function changes(before: string[], after: string[]) {
  const plain = (l: string) => l.trim().replace(/^- /, "")
  const left = new Map<string, number>()
  for (const l of before) left.set(plain(l), (left.get(plain(l)) ?? 0) + 1)
  const added: string[] = []
  for (const l of after.map(plain)) {
    const n = left.get(l) ?? 0
    if (n) left.set(l, n - 1); else added.push(l)
  }
  const gone = before.map(plain).filter((l) => { const n = left.get(l) ?? 0; if (n) left.set(l, n - 1); return n > 0 })
  const refOf = (l: string) => /\[ref=(e\d+)\]/.exec(l)?.[1]
  const was = new Set(gone.map(refOf).filter(Boolean))
  const now = new Set(added.map(refOf).filter(Boolean))
  const both = (l: string) => { const r = refOf(l); return !!r && was.has(r) && now.has(r) }
  return [...added.filter(both).map((l) => `~ ${l}`), ...added.filter((l) => !both(l)).map((l) => `+ ${l}`), ...gone.filter((l) => !both(l)).map((l) => `- ${l}`)]
}

/** The roles of a page's parts around its content: a new page's first lines skip them. */
const AROUND = /^\s*- (navigation|banner|contentinfo|complementary)\b/
/** A page's content, for its first lines: its main part, else the page without its navigation, header and footer. */
export function mainLines(lines: string[]) {
  const depth = (l: string) => l.length - l.trimStart().length
  const at = lines.findIndex((l) => /^\s*- main\b/.test(l))
  if (at >= 0) {
    const d = depth(lines[at]), end = lines.findIndex((l, i) => i > at && depth(l) <= d)
    return lines.slice(at + 1, end < 0 ? undefined : end).map((l) => l.slice(d + 2))
  }
  const out: string[] = []
  const root = /^- RootWebArea\b/.test(lines[0] ?? "")
  let skip = -1
  for (const l of root ? lines.slice(1) : lines) {
    if (skip >= 0 && depth(l) > skip) continue
    skip = AROUND.test(l) ? depth(l) : -1
    if (skip < 0) out.push(root ? l.slice(2) : l)
  }
  return out
}
