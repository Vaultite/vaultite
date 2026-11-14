import { useEffect, useMemo, useState } from "react"
import { Search, TextSearch } from "lucide-react"
import { getStore, type Store } from "@/core/data"
import { get } from "@/core/http"
import { trackSoon } from "@/core/unsaved"
import { cleanName, createNamed, folderOf, openFile, openNew, openView, stem } from "@/core/files"
import { currentFile, newTabsAt } from "@/core/workspace"
import { launcherAt, launcherClosed } from "@/core/launcher"
import { newNoteFolder } from "@/core/conventions"
import { snippet } from "@/core/plaintext"
import { openDetail } from "@/core/nav"
import { completeTyped, launcherText, search, suggestions, typedHits, typedOwned, typedTurns, useQueried, useSearchIndex, type Hit } from "@/core/search"
import { useRecentFiles } from "@/core/scope"
import { usePrefs } from "@/core/prefs"
import { useStateFor } from "@/core/statefor"
import { marked, NoMatches, Palette, useFinderQuery } from "@/components/Palette"
import { FilePreview } from "@/components/FilePreview"
import { excerpt, explain, highlighter, isPlain, marksOf, parse, type Node } from "../../../core/searchquery.ts"

type Found = { path: string; title: string; context: string; mtime: number; archived?: boolean }

function readQuery(q: string): { node: Node | null; error?: string } {
  if (!q.trim()) return { node: null }
  try { return { node: parse(q.trim()) } } catch (e) { return { node: null, error: e instanceof Error ? e.message : undefined } }
}

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

const PAGE = 40

export function SearchPalette({ store, onClose, launcher = false }: { store: Store; onClose: () => void
  launcher?: boolean }) {
  const docs = useSearchIndex(store)
  const { query: q, setQuery: setQ, select, picked } = useFinderQuery()
  const [at] = useState(() => (launcher ? launcherAt() : undefined))
  useEffect(() => (launcher ? launcherClosed : undefined), [launcher])
  const { node, error } = useMemo(() => readQuery(q), [q])
  const near = useMemo(() => (node ? highlighter(node) : null), [node])
  const plain = !node || isPlain(node)
  const opened = useRecentFiles()
  const { fileIcons, disabled } = usePrefs()
  const [limit, setLimit] = useStateFor([q], () => PAGE)
  const named = useMemo(() => (!q.trim() ? suggestions(docs, opened) : plain && !error ? search(docs, q, Infinity) : []), [docs, q, plain, error, opened])
  const local = q.trim() ? named.slice(0, limit) : named
  const short = !node || (plain && q.trim().length < 2)
  const [text, setText] = useStateFor<{ hits: Hit[]; files: number }>([short], () => ({ hits: [], files: 0 }))
  useEffect(() => {
    const query = q.trim()
    if (!node || short) return
    let on = true
    const off = trackSoon("the switcher's search", () => true)
    const t = setTimeout(() => {
      off()
      get<{ results: Found[]; files: number }>(`search?q=${encodeURIComponent(query)}&limit=${limit}&total=1`)
        .then((f) => on && setText({ hits: f.results.map((r) => foundHit(r, node)), files: f.files }))
        .catch(() => on && setText({ hits: [], files: 0 }))
    }, limit > PAGE ? 0 : 150)
    return () => { on = false; off(); clearTimeout(t) }
  }, [q, node, plain, limit, short, setText])
  const queried = useQueried(plain && !error ? q : "")
  const lead = launcher ? launcherText(disabled) : null
  const [auto, setAuto] = useState(true)
  const [done, setDone] = useState<{ for: string; text: string } | null>(null)
  useEffect(() => {
    if (!lead || !plain || error || !q.trim() || !auto) return
    let on = true
    void completeTyped(q.trim(), disabled).then((text) => { if (on) setDone(text ? { for: q, text } : null) })
    return () => { on = false }
  }, [lead, plain, error, q, auto, disabled])
  const complete = lead && auto && q.trim() && done && done.text.toLowerCase().startsWith(q.toLowerCase()) && q.toLowerCase().startsWith(done.for.toLowerCase().slice(0, q.length)) ? done.text : null
  const [turn, setTurn] = useState(0)
  const typed = useMemo(() => (plain && !error ? typedHits(q, disabled, { complete: complete && complete.length > q.length ? complete : null, turn }) : []), [q, plain, error, disabled, complete, turn])
  const turns = typed.some((h) => h.tag) ? typedTurns(disabled) : null
  const everything = useMemo<Hit>(() => {
    const query = q.trim()
    return { id: "search-tab", title: `Search for "${query}" in every file`, meta: "", kind: "Search", icon: Search, tint: "var(--muted-foreground)",
      text: "", recent: 0, marks: [], score: 0, run: () => openView(`search/${query}`, { newTab: true }) }
  }, [q])
  const { hits, sections } = useMemo(() => {
    const have = new Set(local.map((h) => h.file).filter(Boolean))
    const inFiles = text.hits.filter((h) => !have.has(h.file))
    const found = queried.flatMap((g) => g.hits)
    const all = [...local.filter((h) => !h.archived), ...found, ...inFiles.filter((h) => !h.archived), ...local.filter((h) => h.archived), ...inFiles.filter((h) => h.archived)]
    const sections = new Map<string, string>([...queried.flatMap((g) => g.hits.map((h) => [h.id, g.section] as const)), ...typed.map((h) => [h.id, lead ? "" : "More"] as const)])
    const query = q.trim()
    const rows = !query ? all : lead ? [...typed, ...all, ...(all.length ? [everything] : [])] : [...all, ...typed, ...(all.length ? [everything] : [])]
    const seen = new Set<string>()
    return { hits: rows.filter((h) => !seen.has(h.id) && !!seen.add(h.id)), sections }
  }, [local, text, q, queried, typed, lead, everything])
  const more = named.length > local.length || text.files > text.hits.length

  const go = (h: Hit, mod = false) => {
    const newTab = launcher || mod
    picked()
    onClose()
    setTimeout(() => newTabsAt(at, () => {
      if (h.run) h.run(newTab)
      else if (h.to) openView(h.to, { newTab: true })
      else if (h.file) openFile(h.file, { newTab })
      else if (h.detail) openDetail(h.detail)
    }), 0)
  }
  const create = async (newTab: boolean) => {
    if (!cleanName(q)) return
    picked()
    onClose()
    const f = await createNamed(newNoteFolder(getStore(), currentFile()), q)
    if (f) newTabsAt(at, () => openNew(f.path, { newTab: launcher || newTab }))
  }

  return (
    <Palette label="Search" placeholder={lead ?? "Find or create a note…"} query={q} select={select} items={hits} onClose={onClose} look={fileIcons}
      onEnd={more ? () => setLimit((n) => n + PAGE) : undefined}
      preview={(h) => (h.file ? <FilePreview store={store} path={h.file} near={h.marks.length ? null : near} /> : null)}
      onPick={(h, { mod, shift }) => ((shift && !(h && typedOwned(q, disabled))) || !h ? create(mod) : go(h, mod))}
      setQuery={(v, how) => { setQ(v); setAuto(!how?.deleting) }} complete={complete}
      onKey={(e) => {
        if (!turns || !e.altKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return false
        e.preventDefault()
        setTurn((t) => t + (e.key === "ArrowDown" ? 1 : -1))
        return true
      }}
      heading={!q.trim() ? "Recent files and pages" : node && !plain ? explain(node) : undefined}
      section={(h) => (h.id === "search-tab" ? "More" : sections.has(h.id) ? sections.get(h.id) || undefined : plain && h.id.startsWith("text-") ? "In files" : undefined)}
      empty={error ? <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">{error}</p>
        : q.trim() && <NoMatches what="Nothing matches" query={q} then="Enter makes a note with that name" />}
      hints={[["ArrowUp ArrowDown", "to navigate"], ...(launcher ? [["Enter", "to open in new tab"]] satisfies [string, string][] : [["Enter", "to open"], ["Mod+Enter", "to open in new tab"]] satisfies [string, string][]),
        ...(turns ? [["Alt+ArrowUp Alt+ArrowDown", `to change ${turns}`]] satisfies [string, string][] : []), ["Shift+Enter", "to create"], ["Escape", "to dismiss"]]}
      row={(h) => (<>
        {fileIcons && <h.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2} />}
        <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <span className="min-w-0 shrink truncate text-[15px] leading-[21px] text-foreground/90">{marked(h.title, h.marks)}</span>
          {h.meta && <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{marked(h.meta, h.metaMarks ?? [])}</span>}
        </span>
        {h.tag && (
          <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground" data-tag={h.tag.label}>
            <span className="size-2 rounded-full" style={{ background: h.tag.color }} />{h.tag.label}
          </span>
        )}
      </>)} />
  )
}
