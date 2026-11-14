import { useState } from "react"
import { NotebookPen, Quote } from "lucide-react"
import { FilterField, menuFor, notify, useLive } from "@vaultite"
import { insertCitation, openLiterature } from "./client.ts"
import { useLibraryVersion } from "./hooks.ts"
import { entryMenu } from "./menus.ts"
import type { Row, SearchAnswer } from "./wire.ts"

function LibraryRow({ r }: { r: Row }) {
  const cite = () => { if (!insertCitation([r.key])) notify("Open a note to cite in it") }
  return (
    <div role="button" tabIndex={0} data-keyrow data-library-row={r.key} onClick={() => void openLiterature(r.key)} onKeyDown={(e) => { if (e.key === "Enter") void openLiterature(r.key) }}
      onContextMenu={menuFor(() => entryMenu({ key: r.key, note: r.note, links: { doi: "", url: "", zotero: "" } }))}
      className="group/row relative flex min-w-0 cursor-pointer flex-col rounded-[5px] py-1 pr-7 pl-1.5 hover:bg-foreground/[0.04]">
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px]">
        <span className="truncate font-medium">{[r.authors || "Unknown", r.year].filter(Boolean).join(" ")}</span>
        {r.note && <NotebookPen aria-label="Has a literature note" className="size-3 shrink-0 text-tertiary" strokeWidth={2} />}
      </div>
      <div className="line-clamp-2 text-[12px] leading-[16px] text-muted-foreground">{r.title || `@${r.key}`}</div>
      <button type="button" aria-label={`Cite ${r.key}`} data-tip="Cite in note" onClick={(e) => { e.stopPropagation(); cite() }}
        className="absolute top-1 right-1 flex size-5 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-foreground/[0.08] focus-visible:opacity-100 max-md:opacity-100">
        <Quote className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}

export function LibraryList({ path }: { path: string }) {
  const [q, setQ] = useState("")
  const { data } = useLive<SearchAnswer>(`references/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}&limit=60`, useLibraryVersion())
  const rows = data?.results ?? null
  return (
    <div className="flex flex-col gap-1" data-references-library>
      <FilterField value={q} onChange={setQ} placeholder="Find a reference" className="mx-1.5 mb-0.5 flex-none" />
      {rows === null ? <div className="loading-in px-1.5 text-[13px] text-tertiary" aria-busy>Loading…</div>
        : rows.length ? <div role="list" data-keylist>{rows.map((r) => <LibraryRow key={r.key} r={r} />)}</div>
          : <p className="px-1.5 text-[13px] text-muted-foreground">{q ? "Nothing matches." : "Nothing in the library yet."}</p>}
    </div>
  )
}
