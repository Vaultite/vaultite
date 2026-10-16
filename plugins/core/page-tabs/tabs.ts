// Page tabs: a page with views is several files; the head lists the others in `tabs:`, each its own `tab:` label.
// Shared by the plugin's server and app sides: no Node.

export type TabFile = { path: string; tab?: string; tabs?: string[]; plugin?: string }
/** One tab of a strip: its file, label, and the plugin that brought it (it hides while that plugin is off). */
export type PageTab = { path: string; label: string; plugin?: string }

const stem = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "")
const clean = (t: string) => t.trim().replace(/^\[\[|\]\]$/g, "").split("|")[0].trim().replace(/\.md$/i, "")

/** `tabs:` from frontmatter, as names (a list, or one name). */
export function tabNames(v: unknown): string[] | undefined {
  const all = (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []).map((x) => clean(String(x))).filter(Boolean)
  return all.length ? all : undefined
}

/** A file's tab fields from its frontmatter. */
export const tabFile = (path: string, fm: Record<string, unknown>): TabFile => ({
  path, tab: typeof fm.tab === "string" ? fm.tab : undefined, tabs: tabNames(fm.tabs), plugin: typeof fm.plugin === "string" ? fm.plugin : undefined,
})

/** A name in `tabs:` to a file: in the head's folder first (`Claude` beside Agents, not the vault's CLAUDE.md), then
 *  as a path (without .md), else by file name. */
function find(files: TabFile[], name: string, from: string) {
  const low = name.toLowerCase(), dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1).toLowerCase() : ""
  return files.find((f) => f.path.toLowerCase() === `${dir}${low}.md`)
    ?? files.find((f) => f.path.replace(/\.md$/i, "").toLowerCase() === low)
    ?? files.find((f) => stem(f.path).toLowerCase() === low)
}

/** Every page with tabs: its files in order, head first (a file listed twice, or missing, left out). */
export function tabGroups(files: TabFile[]): PageTab[][] {
  return files.filter((f) => f.tabs?.length).map((head) => {
    const seen = new Set<string>()
    const out: PageTab[] = []
    for (const f of [head, ...head.tabs!.map((n) => find(files, n, head.path))]) {
      if (!f || seen.has(f.path)) continue
      seen.add(f.path)
      out.push({ path: f.path, label: f.tab?.trim() || stem(f.path), ...(f.plugin ? { plugin: f.plugin } : {}) })
    }
    return out
  })
}

/** The strip `path` shows: the first group it's in, minus the tabs `hide` leaves out (a plugin that's off). Fewer than
 *  two: no strip, []. */
export function stripOf(groups: PageTab[][], path: string, hide: (t: PageTab) => boolean = () => false): PageTab[] {
  const group = groups.find((g) => g[0].path === path) ?? groups.find((g) => g.some((t) => t.path === path))
  const out = (group ?? []).filter((t) => !hide(t))
  return out.length > 1 ? out : []
}
