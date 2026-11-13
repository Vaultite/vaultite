import { Fragment, type MouseEvent } from "react"
import { ChevronRight } from "lucide-react"
import { type Store } from "@/core/data"
import { startDrag } from "@/core/drag"
import { folderOf, openFile, stem } from "@/core/files"
import { snippet } from "@/core/plaintext"
import { isDesktop } from "@/core/platform"
import { editAt } from "@/core/anchors"
import { kindOf } from "@/core/filekinds"
import { usePrefs } from "@/core/prefs"
import { marked } from "@/components/Palette"
import { fileIcon } from "@/components/FileTree"
import { cn } from "@/lib/utils"
import { excerpt, marksOf } from "../../../core/searchquery.ts"

export type Match = { line: number; text: string; ctx?: true }
export type Result = { path: string; title: string; context: string; mtime: number; matches?: Match[]; count?: number }
export type Found = { results: Result[]; files: number; lines: number }
type Marks = (s: string) => [number, number][]

const atLine = (kind: string) => kind === "markdown" || kind === "code" || kind === "json"

export function SearchHits({ r, store, shown, shut, onToggle, marks, nameMarks, context = 0, pane, onMore }: {
  r: Result; store: Store; shown: Match[]; shut: boolean; onToggle: () => void; marks: Marks; nameMarks: Marks
  context?: number; pane?: string; onMore?: () => void
}) {
  const matched = shown.filter((m) => !m.ctx).length, more = (r.count ?? 0) - matched
  return (
    <div data-search-file={r.path}>
      <FileRow r={r} store={store} lines={shown.length > 0} shut={shut} onToggle={onToggle} nameMarks={nameMarks} pane={pane} />
      {!shut && !!shown.length && (
        <ul className="ml-[13px] border-l-[0.5px] border-border pl-2">
          {shown.map((m, i) => (
            <Fragment key={m.line}>
              {context > 0 && i > 0 && m.line !== shown[i - 1].line + 1 && <li aria-hidden className="mx-1.5 my-1 h-px w-6 bg-border" />}
              <HitLine path={r.path} m={m} marks={marks} pane={pane} />
            </Fragment>
          ))}
          {more > 0 && onMore && (
            <li><button type="button" data-keyrow onClick={onMore}
              className="cursor-pointer rounded-[5px] px-1.5 py-1 text-left text-[12px] text-primary hover:bg-foreground/[0.04] max-md:py-2 max-md:text-[15px]">
              {more} more in this file</button></li>
          )}
        </ul>
      )}
    </div>
  )
}

function FileRow({ r, store, lines, shut, onToggle, nameMarks, pane }: {
  r: Result; store: Store; lines: boolean; shut: boolean; onToggle: () => void; nameMarks: Marks; pane?: string
}) {
  const { disabled, fileIcons } = usePrefs()
  const f = store.files.files.find((x) => x.path === r.path)
  const { icon: Icon, tint } = fileIcon(r.path, f?.type ?? null, disabled, f)
  const where = folderOf(r.path), title = stem(r.path)
  return (
    <div className="group flex h-7 items-center gap-1 rounded-[5px] pr-1.5 text-[13px] hover:bg-foreground/[0.04] max-md:h-11 max-md:text-[17px]">
      {lines ? (
        <button type="button" aria-label={shut ? "Show lines" : "Hide lines"} aria-expanded={!shut} onClick={onToggle}
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", !shut && "rotate-90")} strokeWidth={2.5} />
        </button>
      ) : <span className="size-6 shrink-0" />}
      <button type="button" data-keyrow onClick={(e) => openFileAt(r.path, e, pane)} data-preview={/\.md$/i.test(r.path) ? r.path : undefined} className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        onPointerDown={(e) => startDrag(e, { from: "row", path: r.path, to: `file:${r.path}`, label: title })}>
        {fileIcons && <Icon className={cn("size-4 shrink-0", !tint && "text-muted-foreground")} strokeWidth={2} style={tint ? { color: tint } : undefined} />}
        <span className="min-w-0 shrink truncate font-medium">{marked(title, marksOf(nameMarks(title)))}</span>
        {where && <span className="min-w-0 flex-1 truncate text-muted-foreground">{marked(where, marksOf(nameMarks(where)))}</span>}
      </button>
      {!!r.count && <span className="shrink-0 rounded-full bg-foreground/[0.06] px-1.5 text-[11px] leading-[18px] text-muted-foreground tabular-nums">{r.count}</span>}
    </div>
  )
}

function HitLine({ path, m, marks, pane }: { path: string; m: Match; marks: Marks; pane?: string }) {
  const kind = kindOf(path), phone = !isDesktop()
  const { hit, ex } = lineShown(m, kind, marks)
  const go = (e: MouseEvent) => (atLine(kind) ? editAt(path, m.line - 1, { newTab: e.metaKey || e.ctrlKey, pane, find: hit[0] && m.text.slice(...hit[0]) })
    : openFileAt(path, e, pane))
  return (
    <li>
      <button type="button" data-keyrow={m.ctx ? undefined : ""} onClick={go} data-ctx={m.ctx ? "" : undefined} data-line={m.line}
        className={cn("flex w-full cursor-pointer items-baseline rounded-[5px] px-1.5 text-left text-[13px] leading-[18px] hover:bg-foreground/[0.04]",
          m.ctx ? "py-0" : "py-1", phone && "text-[15px] leading-[21px]", phone && (m.ctx ? "py-0.5" : "py-2"))}>
        <span className={cn("min-w-0 flex-1 break-words", m.ctx ? "text-muted-foreground" : "text-foreground/85")}>
          {ex.text ? marked(ex.text, marksOf(ex.ranges)) : <span className="text-tertiary">&nbsp;</span>}
        </span>
      </button>
    </li>
  )
}

function lineShown(m: Match, kind: string, marks: Marks) {
  const plain = kind === "markdown" ? snippet(m.text) : m.text
  if (m.ctx) return { hit: [], ex: { text: plain, ranges: [] } }
  const hit = marks(m.text), plainHit = plain === m.text ? hit : marks(plain)
  const [text, at] = plainHit.length || !hit.length ? [plain, plainHit] : [m.text, hit]
  return { hit, ex: excerpt(text, at, 180, 40) }
}

const openFileAt = (path: string, e: MouseEvent, pane?: string) => openFile(path, { newTab: e.metaKey || e.ctrlKey, pane })
