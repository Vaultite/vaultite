import { useEffect, useMemo } from "react"
import { Search as SearchIcon, SquareArrowOutUpRight } from "lucide-react"
import { type Store } from "@/core/data"
import { get } from "@/core/http"
import { openView } from "@/core/files"
import { trackSoon } from "@/core/unsaved"
import { useStateFor } from "@/core/statefor"
import { errorText } from "@/core/notify"
import { Panel } from "@/components/kit"
import { SearchHits, type Found, type Match } from "@/pages/SearchHits"
import { plural } from "@/lib/utils"
import { FENCE_FILES, FENCE_LINES, fenceQuery, highlighter, parse, type Node } from "../../../core/searchquery.ts"

type Read = { node: Node | null; error?: string }
function read(q: string): Read {
  if (!q) return { node: null }
  try { return { node: parse(q) } } catch (e) { return { node: null, error: e instanceof Error ? e.message : "This search can't be read" } }
}

export function QueryResults({ store, text }: { store: Store; text: string }) {
  const q = fenceQuery(text)
  const { node, error } = useMemo(() => read(q), [q])
  const marks = useMemo(() => (node ? highlighter(node) : () => []), [node])
  const nameMarks = useMemo(() => (node ? highlighter(node, "name") : () => []), [node])
  const [found, setFound] = useStateFor<Found | null>([q], () => null)
  const [failed, setFailed] = useStateFor([q], () => "")
  const [shut, setShut] = useStateFor<Set<string>>([q], () => new Set())
  const [whole, setWhole] = useStateFor<Record<string, Match[]>>([q], () => ({}))
  useEffect(() => {
    if (!node) return
    let on = true
    const off = trackSoon("a query block's search", () => true)
    const t = setTimeout(() => {
      off()
      const p = new URLSearchParams({ q, lines: String(FENCE_LINES), total: "1", limit: String(FENCE_FILES) })
      get<Found>(`search?${p}`).then((f) => { if (on) { setFound(f); setFailed("") } },
        (e) => { if (on) { setFound({ results: [], files: 0, lines: 0 }); setFailed(errorText(e)) } })
    }, 200)
    return () => { on = false; off(); clearTimeout(t) }
  }, [q, node, store, setFound, setFailed])
  const showWhole = (path: string) => {
    get<Found["results"]>(`search?${new URLSearchParams({ q, path, lines: "100000" })}`)
      .then((rs) => setWhole((w) => ({ ...w, [path]: rs[0]?.matches ?? [] })), () => {})
  }
  const open = () => openView(`search/${q}`, { newTab: true })
  const results = found?.results ?? []
  const more = found ? found.files - results.length : 0
  const status = error ?? failed
  return (
    <Panel title={<span className="block truncate font-mono text-[13px] font-medium" data-query-text>{q || "Search"}</span>} icon={SearchIcon} className="@container min-w-0"
      action={q && !error ? <button type="button" aria-label="Open in search" data-tip="Open in search" onClick={open}
        className="-mr-1 grid size-7 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground pointer-coarse:size-9">
        <SquareArrowOutUpRight className="size-4" strokeWidth={2} /></button> : undefined}>
      <div data-query-results className="flex flex-col gap-1">
        <p className="text-[13px] text-muted-foreground max-md:text-[15px]" data-query-status>
          {!q ? "Type a search in this block: words, \"a phrase\", tag:#project, path:Notes…"
            : status || (!found ? <span className="shimmer" aria-busy>Searching…</span> : !found.files ? "Nothing matches"
              : found.lines ? `${plural(found.lines, "line")} in ${plural(found.files, "file")}` : plural(found.files, "file"))}
        </p>
        {results.map((r) => (
          <SearchHits key={r.path} r={r} store={store} shown={whole[r.path] ?? r.matches ?? []} shut={shut.has(r.path)}
            onToggle={() => setShut((s) => { const n = new Set(s); if (n.has(r.path)) n.delete(r.path); else n.add(r.path); return n })}
            marks={marks} nameMarks={nameMarks} onMore={() => showWhole(r.path)} />
        ))}
        {more > 0 && (
          <button type="button" onClick={open} className="cursor-pointer self-start rounded-[5px] px-1.5 py-1 text-left text-[12px] text-primary hover:bg-foreground/[0.04] max-md:py-2 max-md:text-[15px]">
            {plural(more, "more file")} in search</button>
        )}
      </div>
    </Panel>
  )
}
