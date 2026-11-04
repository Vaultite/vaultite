// A folder's page as columns (Finder's, desktop only): each folder from the vault's top down to the tab's, then what's
// picked in the last (a folder's things, a file's preview). The tab is the picked thing's folder: crumbs and Back agree.
import { useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent } from "react"
import { ChevronRight, SquareArrowOutUpRight } from "lucide-react"
import type { Store } from "@/core/data"
import { folderOf, inArchive } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { usePrefs } from "@/core/prefs"
import { selectClick, selectedAttr, useSelected } from "@/core/select"
import { useVirtual } from "@/core/virtual"
import { menuFor } from "@/components/ContextMenu"
import { Button } from "@/components/Button"
import { folderItems, type FolderItem } from "@/components/FileTree"
import { useFill } from "@/components/FileViewers"
import { cn } from "@/lib/utils"
import { drawnRows, Facts, hrefOf, iconFor, NameField, pick as pickIn, pickedIn, playPause, Preview, SELECT, useEnter, useKept, usePicked, usePreviews, type Kids } from "@/pages/FolderParts"
import { arrive } from "@/pages/FolderKeys"

type ColumnsProps = Kids & { files: Store["files"]; folder: string; openIt: (n: FolderItem, newTab?: boolean) => void }

export function Columns({ setMoves, files, folder, items, counts, openIt, menuOf, press, renaming, lit }: ColumnsProps) {
  const { fileSort, showArchived } = usePrefs()
  const enter = useEnter()
  const chain = useMemo(() => (folder ? ["", ...folder.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))] : [""]), [folder])
  const current = usePicked(folder)
  const pick = (p: string) => pickIn(folder, p)
  const cur = items.find((n) => n.path === current) ?? null
  const ahead = cur?.folder ? cur.path : null
  const text = usePreviews(folder, items, !!cur && kindOf(cur.path) === "markdown")

  const [fill, h] = useFill(true)
  const box = useRef<HTMLDivElement>(null)
  // The last columns in sight, as Finder keeps them.
  useLayoutEffect(() => {
    const el = box.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [folder, ahead, cur?.path, current])

  /** Go to `to`, with `then` picked in it (the keyboard on it there: pages/FolderKeys.ts). */
  const step = (to: string, then: string | null, dir: -1 | 1) => {
    if (then) pickIn(to, then)
    arrive(to)
    enter(to, dir)
  }
  const click = (n: FolderItem, column: string, e: MouseEvent) => {
    if (column === folder) { if (!selectClick(e, SELECT, n.path, current)) pick(n.path); return }
    step(column, n.path, column.length < folder.length ? -1 : 1)
  }
  // ← → out of the folder and into the one picked (pages/FolderKeys.ts); Space plays what's previewed.
  useEffect(() => {
    setMoves({
      lines: items.map((n) => [n.path]),
      side: (dir) => {
        if (dir < 0) { if (folder) step(folderOf(folder), folder, -1); return }
        const first = cur?.folder ? folderItems(files, cur.path, fileSort, showArchived)?.items[0] : null
        if (cur && first) step(cur.path, pickedIn(cur.path) ?? first.path, 1)
      },
      preview: () => playPause(box.current?.querySelector("[data-folder-preview] :is(video, audio)")),
    })
  })
  const row = { menuOf, press, renaming, lit, openIt, click }
  return (
    <div ref={fill} style={{ height: h ?? 480 }} data-folder-columns className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card/40">
      <div ref={box} className="flex h-full overflow-x-auto overflow-y-hidden">
        {chain.map((f, i) => (
          <Column key={f} folder={f} files={files} on={chain[i + 1] ?? cur?.path ?? null} last={f === folder} {...row} />
        ))}
        {ahead && <Column key={ahead} folder={ahead} files={files} on={null} last={false} {...row} />}
        {cur && !cur.folder && (
          <div data-folder-preview={cur.path} className="flex h-full min-w-[300px] flex-1 flex-col items-center gap-4 overflow-y-auto p-5"
            onContextMenu={menuFor(menuOf(cur))} onDoubleClick={() => openIt(cur)}>
            <div className="grid h-[min(55%,440px)] min-h-40 w-full shrink-0 place-items-center">
              <Preview n={cur} text={text[cur.path]} />
            </div>
            <Facts n={cur} counts={counts} />
            <Button onClick={() => openIt(cur)}><SquareArrowOutUpRight className="size-4" strokeWidth={2} />Open</Button>
          </div>
        )}
      </div>
    </div>
  )
}

type RowProps = Pick<Kids, "menuOf" | "press" | "renaming" | "lit"> & {
  openIt: (n: FolderItem, newTab?: boolean) => void; click: (n: FolderItem, column: string, e: MouseEvent) => void
}

/** One folder's things, drawn near what's in sight; `on`, the one lit (the way down, or what's picked in the last). */
function Column({ folder, files, on, last, ...row }: RowProps & { folder: string; files: Store["files"]; on: string | null; last: boolean }) {
  const { fileSort, showArchived } = usePrefs()
  const got = useMemo(() => folderItems(files, folder, fileSort, showArchived), [files, folder, fileSort, showArchived])
  const items = useMemo(() => got?.items ?? [], [got])
  const list = useRef<HTMLDivElement>(null)
  const keys = useMemo(() => items.map((n) => n.path), [items])
  const keep = useKept(list, keys, keys, on)
  const v = useVirtual(list, keys, { estimate: 28, keep: [...keep, row.renaming] })
  // The lit row in sight as the column comes (each step draws the columns again).
  useLayoutEffect(() => {
    const el = list.current, i = on ? keys.indexOf(on) : -1
    if (!el || i < 0) return
    const top = v.top(i)
    if (top < el.scrollTop || top + 28 > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    // (only as it comes: after that it scrolls as the user scrolls it)
  }, [folder])
  return (
    <div ref={list} data-keylist data-select-list={last ? SELECT : undefined} data-folder-column={folder} data-folder-drop={folder} data-drops=""
      className="h-full w-[240px] shrink-0 overflow-y-auto border-r-[0.5px] border-border p-1">
      {drawnRows(v, (i) => {
        const n = items[i]
        return <ColumnRow key={n.path} n={n} index={i} column={folder} state={n.path === on ? (last ? "picked" : "way") : null} last={last} {...row} />
      })}
      {!items.length && <p className="px-2 py-3 text-center text-[12px] text-tertiary">Empty</p>}
    </div>
  )
}

function ColumnRow({ n, index, column, state, last, menuOf, press, renaming, lit, openIt, click }: RowProps & {
  n: FolderItem; index: number; column: string; state: "picked" | "way" | null; last: boolean
}) {
  const chosen = useSelected(SELECT, n.path)
  const { fileIcons } = usePrefs()
  const { icon: Icon, tint } = iconFor(n)
  const named = renaming === n.path
  const archived = !!n.file?.archived || inArchive(n.path)
  // (an <a> holds no field: while it's named, the row is a box)
  const Box = named ? "div" : "a"
  return (
    <Box href={named ? undefined : hrefOf(n)} tabIndex={named ? -1 : undefined} data-vi={index} data-vk={n.path} data-keyrow data-select-key={last ? n.path : undefined} {...selectedAttr(chosen)}
      data-folder-item={n.path} data-folder-drop={n.folder ? n.path : undefined} data-drops={n.folder ? "" : undefined} aria-current={state ? "true" : undefined} draggable={false}
      onPointerDown={(e) => press(e, n)} onClick={(e) => { e.preventDefault(); click(n, column, e) }} onDoubleClick={() => openIt(n)}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); openIt(n, true) } }} onContextMenu={menuFor(menuOf(n))}
      className={cn("mb-px flex h-7 cursor-default items-center gap-2 rounded-[5px] pr-1 pl-1.5 text-[13px] whitespace-nowrap outline-none",
        state === "picked" ? "bg-primary/[0.16]" : state === "way" ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
        lit && "bg-primary/10", archived && "opacity-50")}>
      {fileIcons && <Icon className={cn("size-4 shrink-0", !tint && (n.folder ? "text-primary" : "text-muted-foreground"))} strokeWidth={2} style={tint ? { color: tint } : undefined} />}
      {named ? <NameField n={n} className="h-6 flex-1" /> : <span className="min-w-0 flex-1 truncate">{n.name}</span>}
      {n.folder && <ChevronRight className="size-3.5 shrink-0 text-tertiary" strokeWidth={2} />}
    </Box>
  )
}
