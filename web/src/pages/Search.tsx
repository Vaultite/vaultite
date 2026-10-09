// Search as a tab (view:search/<query>), like VS Code's search editor: the query is the tab's arg, so it stays with
// the tab. Names (fuzzy, plain words only), then every matching line in files; its options are the plugin's settings.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { CaseSensitive, ChevronRight, Ellipsis, FileText, Search as SearchIcon, X } from "lucide-react"
import { useLive, type Store } from "@/core/data"
import { get, put } from "@/core/http"
import { startDrag } from "@/core/drag"
import { folderOf, openFile, openView, stem } from "@/core/files"
import { isDesktop, useFocusedFile } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { editAt } from "@/core/anchors"
import { kindOf } from "@/core/filekinds"
import { useNearEnd } from "@/core/near"
import { usePrefs } from "@/core/prefs"
import { search, useSearchIndex, type Hit } from "@/core/search"
import { Marked } from "@/components/Palette"
import { menuBelow } from "@/components/ContextMenu"
import { fileIcon } from "@/components/FileTree"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"
import { excerpt, explain, highlighter, isPlain, marksOf, parse, type Node } from "../../../core/searchquery.ts"

type Match = { line: number; text: string; ctx?: true }
type Result = { path: string; title: string; context: string; mtime: number; matches?: Match[]; count?: number }
type Found = { results: Result[]; files: number; lines: number }
type Settings = { matchCase?: boolean; sort?: string; collapse?: boolean; context?: number; explain?: boolean }

/** Files come this many at a time, more as the list is scrolled to its end; each with its first LINES lines. */
const PAGE = 100, LINES = 20
/** The most the server gives at once (core/files.ts): files, and lines of one. */
const MOST = 500, MOST_LINES = 100_000

/** The first `n` results of a search (`params` without a page), and the totals. */
async function firstOf(params: string, n: number): Promise<Found> {
  let out: Found | null = null
  for (let at = 0; !out || (at < n && out.results.length === at); at += MOST) {
    const f: Found = await get<Found>(`search?${params}&lines=${LINES}&total=1&offset=${at}&limit=${Math.min(MOST, n - at)}`)
    out = out ? { ...f, results: [...out.results, ...f.results] } : f
  }
  return out
}

/** A line search found opens the file there, the match selected, as Obsidian's does; a file that isn't text opens. */
const atLine = (kind: string) => kind === "markdown" || kind === "code" || kind === "json"

const SORTS: [string, string][] = [
  ["relevance", "Best match"], ["name", "File name (A to Z)"], ["name-desc", "File name (Z to A)"],
  ["modified", "Modified time (new to old)"], ["modified-old", "Modified time (old to new)"],
  ["created", "Created time (new to old)"], ["created-old", "Created time (old to new)"],
]

/** What can be typed, shown while the field is empty: [what a click adds, what it does]. */
const OPERATORS: [string, string][] = [
  ["path:", "in the path, folders included"], ["file:", "in the file's name"], ["content:", "in the text only"],
  ["tag:", "tagged (tag:project finds #project/lighthouse too)"], ["line:", "on one line: line:(rent food)"],
  ["block:", "in one paragraph"], ["section:", "under one heading"], ["task:", "in a task (task-todo:, task-done:)"],
  ["match-case:", "in this case"], ["[", "has a property: [status] or [status:seed]"],
  ['"', '"a phrase": those words together'], ["-", "-word: without it"], ["OR", "either: work OR school"], ["/", "/regex/: a regular expression"],
]

/** The options (changed here at once, saved in the vault). */
function useSettings(): [Settings, (patch: { [K in keyof Settings]?: Settings[K] | null }) => void] {
  const { data } = useLive<Settings>("search/settings")
  const [mine, setMine] = useState<Settings>({})
  const s = { ...data, ...mine }
  return [s, (patch) => {
    setMine((m) => ({ ...m, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? undefined])) }))
    put("search/settings", patch).catch(() => {})
  }]
}

export function SearchPage({ store, query, setQuery }: { store: Store; query: string
  /** The query changed (the tab keeps it in its arg). */
  setQuery: (q: string) => void }) {
  const { disabled, fileIcons } = usePrefs()
  const [settings, save] = useSettings()
  const [q, setQ] = useState(query)
  const [folder, setFolder] = useState("")
  // The tab's arg follows what's typed, a moment after (no history entry per letter).
  const sent = useRef(query)
  useEffect(() => { const t = setTimeout(() => { sent.current = q.trim() ? q : ""; setQuery(sent.current) }, 300); return () => clearTimeout(t) }, [q, setQuery])
  // And the other way: a query that comes from elsewhere (the address, `vau open view:search/…`, back and forward)
  // replaces what's in the field; its own, coming back, doesn't.
  useEffect(() => { if (query !== sent.current) { sent.current = query; setQ(query) } }, [query])
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => { if (isDesktop()) field.current?.focus() }, [])

  const matchCase = !!settings.matchCase
  const { node, error } = useMemo((): { node: Node | null; error?: string } => {
    if (!q.trim()) return { node: null }
    try { return { node: parse(q.trim(), { matchCase }) } } catch (e) { return { node: null, error: (e as Error).message } }
  }, [q, matchCase])
  const plain = !!node && isPlain(node)
  const marks = useMemo(() => (node ? highlighter(node) : () => []), [node])
  const nameMarks = useMemo(() => (node ? highlighter(node, "name") : () => []), [node])

  // Names: the quick switcher's index (pages, people, files, terminals, what plugins index), for plain words.
  const docs = useSearchIndex(store)
  const allNames = useMemo(() => (plain && !matchCase ? search(docs, q, Infinity) : []), [docs, q, plain, matchCase])
  const [allShown, setAllShown] = useState(false)
  useEffect(() => setAllShown(false), [q])
  const names = allShown ? allNames : allNames.slice(0, 8)

  // Inside files: the server's search, every matching line, a page of files at a time.
  const [found, setFound] = useState<Found | null>(null)
  const results = found?.results ?? null
  const [failed, setFailed] = useState("")
  const [busy, setBusy] = useState(false)
  const context = settings.context ?? 0
  const params = useMemo(() => {
    const text = q.trim()
    if (!node || (plain && text.length < 2)) return ""
    const p = new URLSearchParams({ q: text })
    if (folder.trim()) p.set("folder", folder.trim())
    if (matchCase) p.set("case", "1")
    if (settings.sort && settings.sort !== "relevance") p.set("sort", settings.sort)
    if (context) p.set("context", String(context))
    return p.toString()
  }, [q, node, plain, folder, matchCase, settings.sort, context])
  // A file's every line, once "more in this file" is clicked; asked again with the rest when the vault changes.
  const [whole, setWhole] = useState<Record<string, Match[]>>({})
  const shownNow = useRef({ params, n: 0, whole, of: "" })
  shownNow.current = { ...shownNow.current, params, n: results?.length ?? 0, whole }
  const wholeOf = useCallback(async (path: string) => {
    const rs = await get<Result[]>(`search?${params}&path=${encodeURIComponent(path)}&lines=${MOST_LINES}`)
    return rs[0]?.matches ?? []
  }, [params])
  useEffect(() => {
    if (!params) { setFound(null); setWhole({}); setFailed(""); return }
    let on = true
    setBusy(true)
    // (the vault changed: as many as were shown, again; a new query: its first page)
    const same = shownNow.current.of === params
    const n = same ? Math.max(PAGE, shownNow.current.n) : PAGE
    const open = same ? Object.keys(shownNow.current.whole) : []
    if (!same) setWhole({})
    const t = setTimeout(() => {
      firstOf(params, n)
        .then(async (f) => {
          const lines = await Promise.all(open.map(async (p) => [p, await wholeOf(p).catch(() => [])] as const))
          if (!on) return
          shownNow.current.of = params
          setFound(f); setFailed(""); setBusy(false)
          if (open.length) setWhole(Object.fromEntries(lines))
        })
        .catch((e) => { if (on) { setFound({ results: [], files: 0, lines: 0 }); setFailed(e instanceof Error ? e.message : String(e)); setBusy(false) } })
    }, 200)
    return () => { on = false; clearTimeout(t) }
  }, [params, wholeOf, store])
  // The next page, as the end of the list comes near.
  const loading = useRef("")
  const more = () => {
    if (!found || busy || found.results.length >= found.files) return
    const key = `${params}@${found.results.length}`
    if (loading.current === key) return
    loading.current = key
    get<Found>(`search?${params}&lines=${LINES}&total=1&offset=${found.results.length}&limit=${PAGE}`)
      .then((f) => setFound((cur) => (cur && shownNow.current.params === params && cur.results.length === found.results.length
        ? { ...f, results: [...cur.results, ...f.results] } : cur)))
      .catch(() => { loading.current = "" })
  }
  const end = useRef<HTMLParagraphElement>(null)
  useNearEnd(end, more, `${found?.results.length}:${busy}`, "800px")
  const showWhole = (path: string) => {
    wholeOf(path).then((ms) => { if (shownNow.current.params === params) setWhole((w) => ({ ...w, [path]: ms })) }, () => {})
  }
  // Folded files: the ones toggled, or, with "Collapse results" on, every one but those.
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  useEffect(() => setToggled(new Set()), [settings.collapse])

  // Files open beside this tab: in the pane of the file focused last when that's another pane (like the links tab).
  const focused = useFocusedFile()
  const own = usePane().group
  const pane = focused.group && focused.group !== own ? focused.group : undefined
  const open = (path: string, newTab = false) => openFile(path, { newTab, pane })
  const pick = (h: Hit, newTab: boolean) => {
    if (h.run) return h.run(newTab)
    if (h.to) return openView(h.to, { newTab: true })
    if (h.file) return open(h.file, newTab)
    if (h.detail) openDetail(h.detail)
  }
  // An operator from the list, added at the end ("" with the cursor between the quotes).
  const add = (op: string) => {
    const base = q.replace(/\s+$/, "")
    const lead = base ? `${base} ` : ""
    const next = op === '"' ? `${lead}""` : op === "OR" ? `${lead}OR ` : `${lead}${op}`
    setQ(next)
    requestAnimationFrame(() => {
      const f = field.current
      if (!f) return
      f.focus()
      const at = op === '"' ? next.length - 1 : next.length
      f.setSelectionRange(at, at)
    })
  }
  const options = (e: MouseEvent) => menuBelow(e, [
    { label: "Sort", run: () => {}, items: SORTS.map(([v, label]) => ({ label, checked: (settings.sort ?? "relevance") === v, run: () => save({ sort: v === "relevance" ? null : v }) })) },
    { label: "Collapse results", checked: !!settings.collapse, sep: true, run: () => save({ collapse: settings.collapse ? null : true }) },
    { label: "Show more context", checked: context > 0, run: () => save({ context: context ? null : 2 }) },
    { label: "Explain search terms", checked: !!settings.explain, run: () => save({ explain: settings.explain ? null : true }) },
  ])

  const total = found?.lines ?? 0
  const lines = total > 0
  const phone = !isDesktop()
  const tool = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-9"
  const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
  return (
    <div data-search-view data-keylist className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="flex h-9 items-center gap-1 rounded-[8px] border-[0.5px] border-border bg-card pr-1 pl-2.5 focus-within:ring-2 focus-within:ring-primary/40 max-md:h-11">
          <SearchIcon className="mr-1 size-4 shrink-0 text-muted-foreground" strokeWidth={2.25} />
          <input ref={field} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the vault" aria-label="Search the vault" spellCheck={false}
            autoCapitalize="off" autoCorrect="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && names[0] && !results?.length) pick(names[0], e.metaKey || e.ctrlKey)
              // ↓ goes down into the results (core/keylist.ts moves through them from there).
              if (e.key === "ArrowDown") {
                const first = e.currentTarget.closest("[data-search-view]")?.querySelector<HTMLElement>("[data-keyrow]")
                if (first) { e.preventDefault(); first.focus() }
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none max-md:text-[17px]" />
          {q && <button type="button" aria-label="Clear" onClick={() => { setQ(""); field.current?.focus() }} className={tool}><X className="size-3.5" strokeWidth={2.25} /></button>}
          <button type="button" aria-label="Match case" aria-pressed={matchCase} data-tip="Match case" onClick={() => save({ matchCase: matchCase ? null : true })}
            className={cn(tool, matchCase && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}><CaseSensitive className="size-4" strokeWidth={2} /></button>
          <button type="button" aria-label="Search options" data-tip="Search options" onClick={options} className={tool}><Ellipsis className="size-4" strokeWidth={2} /></button>
        </label>
        <label className="flex h-7 items-center gap-2 text-[13px] text-muted-foreground max-md:h-9 max-md:text-[15px]">
          <span className="shrink-0">In folder</span>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Anywhere" aria-label="Only in this folder" spellCheck={false}
            className="h-full min-w-0 flex-1 rounded-[6px] border-[0.5px] border-border bg-card px-2 text-foreground outline-none focus:ring-2 focus:ring-primary/40 max-md:text-[16px]" />
        </label>
        {error ? <p role="alert" className="text-[13px] text-[var(--red)] max-md:text-[15px]">{error}</p>
          : node && (settings.explain || !plain) && <p data-search-explain className="text-[13px] text-muted-foreground max-md:text-[15px]">{explain(node)}</p>}
      </div>

      {!q.trim() && (
        <section aria-label="Search syntax" className="@container flex flex-col gap-2">
          <p className="text-[13px] text-muted-foreground max-md:text-[15px]">Type to search every note and text file, and the names of pages, people, files and terminals. Words can be in any order. To narrow it down:</p>
          <div className="grid grid-cols-1 gap-x-4 @2xl:grid-cols-2">
            {OPERATORS.map(([op, what]) => (
              <button key={op} type="button" onClick={() => add(op)}
                className="flex h-7 min-w-0 cursor-pointer items-baseline gap-2 rounded-[5px] px-1.5 text-left text-[13px] leading-7 hover:bg-foreground/[0.05] max-md:h-10 max-md:text-[15px] max-md:leading-10">
                <code className="w-[84px] shrink-0 font-mono text-[12px] text-foreground max-md:w-[100px] max-md:text-[14px]">{op === "[" ? "[property]" : op === '"' ? '"…"' : op === "/" ? "/…/" : op}</code>
                <span className="min-w-0 truncate text-muted-foreground">{what}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!!names.length && (
        <section aria-label="Names">
          <h2 className="mb-1 text-[12px] font-semibold text-muted-foreground">Names</h2>
          <div className="flex flex-col">
            {names.map((h) => (
              <button key={h.id} type="button" data-keyrow onClick={(e) => pick(h, e.metaKey || e.ctrlKey)}
                onPointerDown={h.file ? (e) => startDrag(e, { from: "row", path: h.file, to: `file:${h.file}`, label: h.title }) : undefined}
                className="flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] hover:bg-foreground/[0.05] max-md:h-11 max-md:text-[17px]">
                {fileIcons && <h.icon className="size-4 shrink-0" strokeWidth={2} style={{ color: h.tint }} />}
                <span className="min-w-0 shrink truncate"><Marked text={h.title} marks={h.marks} /></span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground"><Marked text={h.meta} marks={h.metaMarks ?? []} /></span>
                <span className="shrink-0 text-[12px] text-tertiary">{h.kind}</span>
              </button>
            ))}
            {!allShown && allNames.length > names.length && (
              <button type="button" data-keyrow onClick={() => setAllShown(true)}
                className="flex h-7 cursor-pointer items-center rounded-[5px] px-1.5 text-left text-[12px] text-primary hover:bg-foreground/[0.05] max-md:h-11 max-md:text-[15px]">
                Show all {allNames.length}
              </button>
            )}
          </div>
        </section>
      )}

      {node && (!plain || q.trim().length >= 2) && (
        <section aria-label="In files">
          <h2 className="mb-1 flex items-baseline gap-2 text-[12px] font-semibold text-muted-foreground">
            {plain ? "In files" : "Files"}
            <span className="font-normal">{failed || (!results || (busy && !results.length) ? "Searching…" : !results.length ? "Nothing found"
              : lines ? `${counted(total, "line")} in ${counted(found!.files, "file")}` : counted(found!.files, "file"))}</span>
          </h2>
          <div className="flex flex-col gap-1">
            {results?.map((r) => {
              const shut = !!settings.collapse !== toggled.has(r.path)
              const f = store.files.files.find((x) => x.path === r.path)
              const { icon: Icon, tint } = fileIcon(r.path, f?.type ?? null, disabled, f)
              const where = folderOf(r.path)
              const title = stem(r.path)
              const shown = whole[r.path] ?? r.matches ?? []
              const kind = kindOf(r.path)
              const matched = shown.filter((m) => !m.ctx).length
              return (
                <div key={r.path} data-search-file={r.path}>
                  <div className="group flex h-7 items-center gap-1 rounded-[5px] pr-1.5 text-[13px] hover:bg-foreground/[0.04] max-md:h-11 max-md:text-[17px]">
                    {shown.length ? (
                      <button type="button" aria-label={shut ? "Show lines" : "Hide lines"} aria-expanded={!shut}
                        onClick={() => setToggled((s) => { const n = new Set(s); if (n.has(r.path)) n.delete(r.path); else n.add(r.path); return n })}
                        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:text-foreground">
                        <ChevronRight className={cn("size-3.5 transition-transform duration-150", !shut && "rotate-90")} strokeWidth={2.5} />
                      </button>
                    ) : <span className="size-6 shrink-0" />}
                    <button type="button" data-keyrow onClick={(e) => open(r.path, e.metaKey || e.ctrlKey)} data-preview={/\.md$/i.test(r.path) ? r.path : undefined} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
                      onPointerDown={(e) => startDrag(e, { from: "row", path: r.path, to: `file:${r.path}`, label: title })}>
                      {fileIcons && <Icon className={cn("size-4 shrink-0", !tint && "text-muted-foreground")} strokeWidth={2} style={tint ? { color: tint } : undefined} />}
                      <span className="min-w-0 shrink truncate font-medium"><Marked text={title} marks={marksOf(nameMarks(title))} /></span>
                      {where && <span className="min-w-0 flex-1 truncate text-muted-foreground"><Marked text={where} marks={marksOf(nameMarks(where))} /></span>}
                    </button>
                    {!!r.count && <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] leading-[18px] text-muted-foreground tabular-nums">{r.count}</span>}
                  </div>
                  {!shut && !!shown.length && (
                    <ul className="ml-[13px] border-l-[0.5px] border-border pl-2">
                      {shown.map((m, i) => {
                        const hit = m.ctx ? [] : marks(m.text)
                        const ex = m.ctx ? { text: m.text, ranges: [] } : excerpt(m.text, hit, 180, 40)
                        const go = (e: MouseEvent) => (atLine(kind) ? editAt(r.path, m.line - 1, { newTab: e.metaKey || e.ctrlKey, pane, find: hit[0] && m.text.slice(...hit[0]) })
                          : open(r.path, e.metaKey || e.ctrlKey))
                        return (
                          <Fragment key={m.line}>
                            {context > 0 && i > 0 && m.line !== shown[i - 1].line + 1 && <li aria-hidden className="mx-1.5 my-1 h-px w-6 bg-border" />}
                            <li>
                              <button type="button" data-keyrow={m.ctx ? undefined : ""} onClick={go} data-ctx={m.ctx ? "" : undefined} data-line={m.line}
                                className={cn("flex w-full cursor-pointer items-baseline rounded-[5px] px-1.5 text-left text-[13px] leading-[18px] hover:bg-foreground/[0.04]",
                                  m.ctx ? "py-0" : "py-1", phone && "text-[15px] leading-[21px]", phone && (m.ctx ? "py-0.5" : "py-2"))}>
                                <span className={cn("min-w-0 flex-1 break-words", m.ctx ? "text-muted-foreground" : "text-foreground/85")}>
                                  {ex.text ? <Marked text={ex.text} marks={marksOf(ex.ranges)} /> : <span className="text-tertiary">&nbsp;</span>}
                                </span>
                              </button>
                            </li>
                          </Fragment>
                        )
                      })}
                      {(r.count ?? 0) > matched && (
                        <li><button type="button" data-keyrow onClick={() => showWhole(r.path)}
                          className="cursor-pointer rounded-[5px] px-1.5 py-1 text-left text-[12px] text-primary hover:bg-foreground/[0.04] max-md:py-2 max-md:text-[15px]">
                          {(r.count ?? 0) - matched} more in this file</button></li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
            {found && found.results.length < found.files && (
              <p ref={end} className="px-1.5 py-1 text-[12px] text-tertiary">{found.files - found.results.length} more files…</p>
            )}
          </div>
        </section>
      )}
      {!names.length && results && !results.length && !busy && !failed && node && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><FileText className="size-4" strokeWidth={2} />Nothing matches "{q.trim()}".</p>
      )}
    </div>
  )
}
