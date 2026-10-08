// What the core reads from any file's frontmatter, alike on server and app (no Node): a file's type (its kind's, else
// its `type` or a plugin's mark, never its folder's alone) and `archived: true` (core/docs/vault.md).

export const ARCHIVED = "archived"
/** The hidden folder archived files move into, inside their own folder (the Archive plugin). The vault indexes it like
 *  any folder, so links and history keep working, while tools that skip dot folders don't see it. */
export const ARCHIVE_DIR = ".archive"

/** Whether a path is inside an archive folder (People/.archive/Kai.md): such a file is archived, key or not. */
export const inArchive = (rel: string) => rel.split("/").slice(0, -1).includes(ARCHIVE_DIR)
/** The path as if it weren't archived (People/.archive/Kai.md -> People/Kai.md): what kinds and homes go by. */
export const unarchived = (rel: string) => (inArchive(rel) ? rel.split("/").filter((p, i, a) => p !== ARCHIVE_DIR || i === a.length - 1).join("/") : rel)
/** The same path archived or not: People/Kai.md <-> People/.archive/Kai.md. */
export const archiveTwin = (rel: string) => {
  if (inArchive(rel)) return unarchived(rel)
  const i = rel.lastIndexOf("/")
  return `${rel.slice(0, i + 1)}${ARCHIVE_DIR}/${rel.slice(i + 1)}`
}
/** Where the plugins' pages go in a folder of the user's own (pages.json `install: false`), never among their notes. The
 *  vault indexes it like any folder (a page there is drawn, pinned and linked as usual); the file tree leaves it out. */
export const PAGES_DIR = ".vaultite/pages"
export const inPagesDir = (rel: string) => rel === PAGES_DIR || rel.startsWith(`${PAGES_DIR}/`)
/** A dot folder or file somewhere in the path, other than an archive folder or the pages folder: hidden unless hidden
 *  files are shown. */
export const isHiddenPath = (rel: string) => !inPagesDir(rel) && rel.split("/").some((p) => p.startsWith(".") && p !== ARCHIVE_DIR)

/** Whether a value of `archived` means archived: anything set, but false, no, off, 0 and blanks (so `archived: yes` or a
 *  date archive it, like the Python-like truthiness the app reads other flags with). */
export function archivedValue(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false
  if (typeof v === "string") return v.trim() !== "" && !/^(false|no|off|0)$/i.test(v.trim())
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === "object") return Object.keys(v).length > 0
  return true
}

/** Whether a file (its frontmatter) or an item (a person, a routine: the vault puts `archived: true` on the items of
 *  archived files) is archived. */
export const isArchived = (x: object | null | undefined) => !!x && archivedValue((x as Record<string, unknown>)[ARCHIVED])

/** Frontmatter keys that type a file without `type:`, from plugins' manifests' `marks` (`{"kanban-plugin": "kanban"}`:
 *  files another app's plugin made, drawn by the plugin that reads them). */
let marks: [string, string][] = []
export function setMarks(manifests: Record<string, unknown>[]) {
  marks = manifests.flatMap((m) => Object.entries((m.marks ?? {}) as Record<string, unknown>)).filter((e): e is [string, string] => typeof e[1] === "string")
}

/** A file's type: its kind's (`kindType`, when a kind owns the file), else its frontmatter `type` when that's text, else
 *  a plugin's mark on it. */
export function effectiveType(kindType: string | null | undefined, fm: Record<string, unknown> | null | undefined): string | null {
  if (kindType) return kindType
  const t = fm?.type
  if (typeof t === "string" && t.trim()) return t
  const hit = fm && marks.find(([k]) => typeof fm[k] === "string" && (fm[k] as string).trim())
  return hit ? hit[1] : null
}

/** Where new files of a kind go: the folder most of them are in, preferring ones named like the kind's default, so a
 *  few clipped notes elsewhere don't draw new notes away. Ties go to the first by name; null when there are none. */
export function homeFolder(paths: Iterable<string>, name?: string | null, nested = false): string | null {
  const count = new Map<string, number>()
  for (const p of paths) {
    if (inArchive(p)) continue // (new files never go into an archive)
    const d = p.slice(0, Math.max(0, p.lastIndexOf("/")))
    count.set(d, (count.get(d) ?? 0) + 1)
  }
  const named = (d: string) => { const parts = d.split("/"); return nested ? parts.includes(name!) : parts[parts.length - 1] === name }
  const pick = (ok: (d: string) => boolean) => {
    let best: string | null = null, n = 0
    for (const [d, c] of [...count].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (ok(d) && c > n) { best = d; n = c }
    return best
  }
  return (name ? pick(named) : null) ?? pick(() => true)
}
