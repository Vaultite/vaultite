// A folder's page as a gallery (Finder's, desktop only): the picked thing large (a photo whole, a video that plays, a
// page), what it is under it, and the folder's things in a strip below (← → through them: pages/FolderKeys.ts).
import { useEffect, useRef } from "react"
import { inArchive } from "@/core/files"
import { kindOf } from "@/core/filekinds"
import { selectClick, selectedAttr, useSelected } from "@/core/select"
import { menuFor } from "@/components/ContextMenu"
import type { FolderItem } from "@/components/FileTree"
import { useFill } from "@/components/FileViewers"
import { cn } from "@/lib/utils"
import { Facts, hrefOf, pick as pickIn, playPause, Preview, SELECT, Tile, usePicked, usePreviews, type Kids } from "@/pages/FolderParts"

export function Gallery({ setMoves, items, counts, menuOf, press, lit, folder, openIt }: Kids & { folder: string; openIt: (n: FolderItem, newTab?: boolean) => void }) {
  const current = usePicked(folder)
  // (none picked yet: its first file, a gallery being for what's in files)
  const cur = items.find((n) => n.path === current) ?? items.find((n) => !n.folder) ?? items[0]
  const pick = (n: FolderItem) => pickIn(folder, n.path)
  useEffect(() => { if (current !== cur.path) pickIn(folder, cur.path) }, [folder, current, cur.path])
  const text = usePreviews(folder, items, kindOf(cur.path) === "markdown")
  const [fill, h] = useFill(true)
  const strip = useRef<HTMLDivElement>(null)
  const at = (p: string) => strip.current?.querySelector<HTMLElement>(`[data-vk="${CSS.escape(p)}"]`)
  useEffect(() => { at(cur.path)?.scrollIntoView({ block: "nearest", inline: "nearest" }) }, [cur.path])
  useEffect(() => {
    setMoves({ lines: [items.map((n) => n.path)], along: true, preview: () => playPause(fill.current?.querySelector("[data-folder-stage] :is(video, audio)")) })
  })
  return (
    <div ref={fill} style={{ height: h ?? 520 }} data-folder-gallery className="flex flex-col">
      <div data-folder-stage={cur.path} onDoubleClick={() => openIt(cur)} onContextMenu={menuFor(menuOf(cur))} className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          <Preview n={cur} text={text[cur.path]} stage />
        </div>
      </div>
      <div className="mt-3 shrink-0"><Facts n={cur} counts={counts} short /></div>
      <div ref={strip} data-keylist data-select-list={SELECT} data-folder-strip className="mt-3 flex shrink-0 gap-1 overflow-x-auto px-px pt-px pb-2">
        {items.map((n) => <Thumb key={n.path} n={n} on={n === cur} lit={lit === n.path} pick={pick} open={openIt} menuOf={menuOf} press={press} current={cur.path} />)}
      </div>
    </div>
  )
}

function Thumb({ n, on, lit, pick, open, menuOf, press, current }: Pick<Kids, "menuOf" | "press"> & {
  n: FolderItem; on: boolean; lit: boolean; current: string; pick: (n: FolderItem) => void; open: (n: FolderItem, newTab?: boolean) => void
}) {
  const chosen = useSelected(SELECT, n.path)
  const archived = !!n.file?.archived || inArchive(n.path)
  return (
    <a href={hrefOf(n)} data-vk={n.path} data-keyrow data-select-key={n.path} {...selectedAttr(chosen)} data-folder-item={n.path} data-tip={n.name}
      data-folder-drop={n.folder ? n.path : undefined} data-drops={n.folder ? "" : undefined} aria-current={on ? "true" : undefined} draggable={false}
      onPointerDown={(e) => press(e, n)} onClick={(e) => { e.preventDefault(); if (!selectClick(e, SELECT, n.path, current)) pick(n) }}
      onDoubleClick={() => open(n)} onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); open(n, true) } }} onContextMenu={menuFor(menuOf(n))}
      className={cn("block w-16 shrink-0 cursor-default rounded-[8px] p-[3px] outline-none",
        on ? "bg-primary/[0.16] ring-2 ring-primary/70" : "hover:bg-foreground/[0.05]", lit && "bg-primary/10", archived && "opacity-50")}>
      <Tile n={n} desk small />
    </a>
  )
}
