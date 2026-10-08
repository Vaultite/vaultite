// Page tabs: a page with views is several files; the head lists the others in `tabs:`, each its own `tab:` label.
// Shared by server and app: no Node.

export type TabFile = { path: string; tab?: string; tabs?: string[]; plugin?: string }
export type PageTab = { path: string; label: string }

const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "")
const clean = (t: string) => t.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim().replace(/\.md$/i, "")

/** `tabs:` from frontmatter, as names (a list, or one name). */
export function tabNames(v: unknown): string[] | undefined {
  const all = (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map((x) => clean(String(x))).filter(Boolean)
  return all.length ? all : undefined
}

/** A name in `tabs:` to a file: in the head's folder first (`Claude` beside Agents, not the vault's CLAUDE.md), then
 *  as a path (without .md), else by file name. */
function find(files: TabFile[], name: string, from: string) {
  const low = name.toLowerCase(), dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1).toLowerCase() : ""
  return files.find((f) => f.path.toLowerCase() === `${dir}${low}.md`)
    ?? files.find((f) => f.path.replace(/\.md$/i, "").toLowerCase() === low)
    ?? files.find((f) => stem(f.path).toLowerCase() === low)
}

/** The head of the group `path` belongs to: itself if it lists tabs, else the first file that lists it, else null. */
export function tabHead(files: TabFile[], path: string): TabFile | null {
  const self = files.find((f) => f.path === path)
  if (!self) return null
  if (self.tabs?.length) return self
  return files.find((f) => f.tabs?.some((n) => find(files, n, f.path)?.path === path)) ?? null
}

/** The strip `path` shows: its group's files in order (head first), minus those `hide` leaves out (a plugin that's
 *  off). Fewer than two: no strip, []. */
export function pageTabs(files: TabFile[], path: string, hide: (f: TabFile) => boolean = () => false): PageTab[] {
  const head = tabHead(files, path)
  if (!head) return []
  const seen = new Set<string>()
  const out: PageTab[] = []
  for (const f of [head, ...(head.tabs ?? []).map((n) => find(files, n, head.path))]) {
    if (!f || seen.has(f.path) || hide(f)) continue
    seen.add(f.path)
    out.push({ path: f.path, label: f.tab?.trim() || stem(f.path) })
  }
  return out.length > 1 ? out : []
}
