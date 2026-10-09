// The quick switcher (⌘O): fuzzy matches, then "In files" (the server's search). A query with
// operators is the server's alone. ⇧Enter makes a note with the name typed. Each row with its kind's icon, muted as ⌘P's (with File icons on).
import { useEffect, useMemo, useState } from "react"
import { TextSearch } from "lucide-react"
import { getStore, type Store } from "@/core/data"
import { get } from "@/core/http"
import { cleanName, createNamed, folderOf, openFile, openNew, openView, stem } from "@/core/files"
import { currentFile } from "@/core/workspace"
import { newNoteFolder } from "@/core/conventions"
import { snippet } from "@/core/links"
import { openDetail } from "@/core/nav"
import { search, suggestions, useSearchIndex, type Hit } from "@/core/search"
import { useRecentFiles } from "@/core/scope"
import { usePrefs } from "@/core/prefs"
import { Marked, Palette } from "@/components/Palette"
import { excerpt, explain, highlighter, isPlain, marksOf, parse, type Node } from "../../../core/searchquery.ts"

type Found = { path: string; title: string; context: string; mtime: number; archived?: boolean }

/** A query as the search syntax reads it, or why it can't be read. */
function readQuery(q: string): { node: Node | null; error?: string } {
  if (!q.trim()) return { node: null }
  try { return { node: parse(q.trim()) } } catch (e) { return { node: null, error: (e as Error).message } }
}

/** A file the server found, as a row: its name and the part of the line that matched, both marked. */
function foundHit(r: Found, node: Node): Hit {
  const title = stem(r.path)
  const line = snippet(r.context)
  const ex = line ? excerpt(line, highlighter(node)(line), 140) : null
  const where = folderOf(r.path).split("/").join(" / ")
  return {
    id: `text-${r.path}`, title, meta: ex ? ex.text : where, metaMarks: ex ? marksOf(ex.ranges) : [], kind: "Text", icon: TextSearch,
    tint: "var(--muted-foreground)", file: r.path, text: "", recent: r.mtime, marks: marksOf(highlighter(node, "name")(title)), score: 0, archived: r.archived,
  }
}

export function SearchPalette({ store, onClose }: { store: Store; onClose: () => void }) {
  const docs = useSearchIndex(store)
  const [q, setQ] = useState("")
  const { node, error } = useMemo(() => readQuery(q), [q])
  const plain = !node || isPlain(node)
  const opened = useRecentFiles()
  const { fileIcons } = usePrefs()
  const local = useMemo(() => (!q.trim() ? suggestions(docs, opened) : plain && !error ? search(docs, q) : []), [docs, q, plain, error, opened])
  // Words inside files: the server searches every file's text (with operators, it's all there is).
  const [text, setText] = useState<Hit[]>([])
  useEffect(() => {
    const query = q.trim()
    if (!node || (plain && query.length < 3)) { setText([]); return }
    let on = true
    const t = setTimeout(() => {
      get<Found[]>(`search?q=${encodeURIComponent(query)}`).then((rs) => on && setText(rs.map((r) => foundHit(r, node)))).catch(() => on && setText([]))
    }, 150)
    return () => { on = false; clearTimeout(t) }
  }, [q, node, plain])
  // Archived files after everything else (core/search.ts), words inside files included.
  const hits = useMemo(() => {
    const have = new Set(local.map((h) => h.file).filter(Boolean))
    const inFiles = text.filter((h) => !have.has(h.file))
    return [...local.filter((h) => !h.archived), ...inFiles.filter((h) => !h.archived), ...local.filter((h) => h.archived), ...inFiles.filter((h) => h.archived)]
  }, [local, text])

  const go = (h: Hit, newTab = false) => {
    onClose()
    if (h.run) setTimeout(() => h.run!(newTab), 0)
    else if (h.to) setTimeout(() => openView(h.to!, { newTab: true }), 0)
    else if (h.file) setTimeout(() => openFile(h.file!, { newTab }), 0)
    else if (h.detail) setTimeout(() => openDetail(h.detail!), 0)
  }
  // ⇧Enter: a note named what was typed, where every new note goes (newNoteFolder).
  const create = async (newTab: boolean) => {
    if (!cleanName(q)) return
    onClose()
    const f = await createNamed(newNoteFolder(getStore(), currentFile()), q)
    if (f) openNew(f.path, { newTab })
  }

  return (
    <Palette label="Search" placeholder="Find or create a note…" query={q} setQuery={setQ} items={hits} onClose={onClose}
      onPick={(h, { mod, shift }) => (shift || !h ? create(mod) : go(h, mod))}
      heading={!q.trim() ? "Recent files and pages" : node && !plain ? explain(node) : undefined}
      section={(h) => (plain && h.id.startsWith("text-") ? "In files" : undefined)}
      empty={error ? <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">{error}</p>
        : q.trim() && <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Nothing matches "{q.trim()}". Enter makes a note with that name.</p>}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to open"], ["Mod+Enter", "to open in new tab"], ["Shift+Enter", "to create"], ["Escape", "to dismiss"]]}
      row={(h) => (<>
        {fileIcons && <h.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="min-w-0 shrink truncate text-[15px] leading-[21px] text-foreground/90"><Marked text={h.title} marks={h.marks} /></span>
          {h.meta && <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground"><Marked text={h.meta} marks={h.metaMarks ?? []} /></span>}
        </span>
      </>)} />
  )
}
