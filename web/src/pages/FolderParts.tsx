import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react"
import { Play } from "lucide-react"
import { dateText, fmtDay, iso } from "@/core/data"
import { cleanName, folderOf, folderTarget, joinPath, moveFile, nameProblem, refuseName, stem } from "@/core/files"
import { formatSize, kindName, kindOf } from "@/core/filekinds"
import { get } from "@/core/http"
import { notifyError } from "@/core/notify"
import { snippet } from "@/core/plaintext"
import { cell, signal } from "@/core/signal"
import { step } from "@/core/motion"
import { usePane } from "@/core/pane"
import { useDesktop } from "@/core/platform"
import { listOrders } from "@/core/select"
import type { useVirtual } from "@/core/virtual"
import { go, setFocusedPane } from "@/core/workspace"
import type { MenuItem } from "@/components/ContextMenu"
import { folderIcon, iconAt, type FolderItem } from "@/components/FileTree"
import { rawUrl, thumbUrl, useFileInfo } from "@/components/FileViewers"
import type { SwipeAction } from "@/components/SwipeRow"
import { cn, plural } from "@/lib/utils"

export const SELECT = "folder"
export const naming = cell<{ path: string; fresh: boolean } | null>(null)

export type Kids = {
  setMoves: (m: Moves) => void
  items: FolderItem[]; counts: Map<string, number>; open: (n: FolderItem, e: MouseEvent) => void; menuOf: (n: FolderItem) => () => MenuItem[]
  swipe: (n: FolderItem) => SwipeAction[]; press: (e: PointerEvent<HTMLElement>, n: FolderItem) => void; renaming: string | null; lit: string | null; desk: boolean
}

const picked = new Map<string, string>()
const pickedSubs = signal()
export const pickedIn = (folder: string) => picked.get(folder) ?? null
export const usePicked = (folder: string) => pickedSubs.use(() => picked.get(folder) ?? null)
export function pick(folder: string, path: string) { if (picked.get(folder) !== path) { picked.set(folder, path); pickedSubs.notify() } }

export type Moves = { lines: string[][]; along?: boolean; side?: (dir: -1 | 1) => void; preview?: () => boolean }

export const iconFor = (n: FolderItem) => (n.folder ? folderIcon(n.path) : iconAt(n.path))
export const hrefOf = (n: FolderItem) => (n.folder ? `#view/${encodeURIComponent(folderTarget(n.path).slice(5))}` : `#file/${encodeURIComponent(n.path)}`)

const TIME = { hour: "numeric", minute: "2-digit" } as const
export function whenText(ms: number) {
  if (!ms) return ""
  const d = new Date(ms)
  return iso(d) === iso(new Date()) ? dateText(d, TIME) : fmtDay(iso(d))
}
export const metaOf = (n: FolderItem, counts: Map<string, number>) => (n.folder ? (counts.get(n.path) ? plural(counts.get(n.path)!, "item") : "Empty") : whenText(n.mtime))

export function NameField({ n, className }: { n: FolderItem; className?: string }) {
  const done = useRef(false)
  const finish = (typed: string | null) => {
    if (done.current) return
    done.current = true
    const was = naming.get()
    naming.set(null)
    if (typed !== null) void renameTo(n, typed, !!was?.fresh && was.path === n.path)
  }
  return (
    <input autoFocus defaultValue={n.name} aria-label="New name" spellCheck={false} onFocus={(e) => e.target.select()}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.target.value)} onKeyDown={(e) => {
        if (e.key === "Enter") { const why = renamingTo(n, e.currentTarget.value).why; if (why) refuseName(why, e.currentTarget); else e.currentTarget.blur() }
        if (e.key === "Escape") finish(null)
      }}
      className={cn("min-w-0 rounded-[4px] bg-card px-1 outline-none ring-1 ring-primary/60", className)} />
  )
}
function renamingTo(n: FolderItem, typed: string) {
  const ext = n.folder || n.other ? "" : n.path.slice(n.path.lastIndexOf("."))
  const to = joinPath(folderOf(n.path), cleanName(typed) + ext)
  return { to, why: nameProblem(typed, n.path, to) }
}
async function renameTo(n: FolderItem, typed: string, fresh: boolean) {
  const { to, why } = renamingTo(n, typed)
  if (why) return refuseName(why)
  if (!cleanName(typed) || to === n.path) return
  try { await moveFile(n.path, to, { undo: !fresh }) } catch (e) { notifyError(e, "Couldn't rename") }
}

const untitled = (md: string, path: string) => md.replace(/^#{1,6}[ \t]+([^\n]*)\n*/, (all, h: string) => (snippet(h) === stem(path) ? "" : all))
const previews = new Map<string, { sig: string; text: Record<string, string> }>()
export function usePreviews(folder: string, items: FolderItem[], on = true) {
  const sig = on ? items.filter((n) => n.file).map((n) => `${n.path}\0${n.mtime}`).join("\n") : ""
  const [shown, setShown] = useState(() => ({ folder, sig, text: previews.get(folder)?.text ?? {} }))
  if (shown.folder !== folder || shown.sig !== sig) {
    const had = previews.get(folder)
    setShown({ folder, sig, text: had?.sig === sig || !sig ? had?.text ?? {} : shown.text })
  }
  useEffect(() => {
    const had = previews.get(folder)
    if (had?.sig === sig || !sig) return
    let live = true
    get<{ previews: Record<string, string> }>(`files/previews?folder=${encodeURIComponent(folder)}`).then((r) => {
      const t = Object.fromEntries(Object.entries(r.previews).map(([p, md]) => [p, snippet(untitled(md, p))]))
      previews.delete(folder)
      previews.set(folder, { sig, text: t })
      if (previews.size > 30) previews.delete(previews.keys().next().value!)
      if (live) setShown({ folder, sig, text: t })
    }, () => {})
    return () => { live = false }
  }, [folder, sig])
  return shown.text
}

const failed = new Set<string>()
const paper = "bg-card shadow-[0_1px_3px_rgb(0_0_0/0.08)] ring-[0.5px] ring-border"

function sourcesOf(n: FolderItem, px: number): string[] {
  const k = kindOf(n.path)
  if (n.folder || k === "markdown") return []
  if (k === "image") return /\.svg$/i.test(n.path) ? [rawUrl(n.path)] : [thumbUrl(n.path, px, n.mtime), rawUrl(n.path)]
  return [thumbUrl(n.path, px, n.mtime)]
}

export function Picture({ n, px, icon, className, round = "rounded-[8px]", whole }: { n: FolderItem; px: number; icon: ReactNode; className?: string; round?: string
  whole?: boolean }) {
  const sources = sourcesOf(n, px).filter((s) => !failed.has(s))
  const src = sources[0]
  const [loaded, setLoaded] = useState<string | null>(null)
  const [, setTried] = useState(0)
  const k = kindOf(n.path), fill = !whole && (k === "image" || k === "video"), done = !!src && loaded === src
  return (
    <div className={cn("relative grid place-items-center overflow-hidden", round, !whole && (fill || !done) && paper, className)}>
      {!done && icon}
      {src && (
        <img key={src} src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setLoaded(src)}
          onError={() => { failed.add(src); setTried((t) => t + 1) }}
          className={cn("transition-opacity duration-150", !done && "absolute opacity-0",
            fill ? "size-full object-cover" : "max-h-[calc(100%-8px)] max-w-[calc(100%-8px)] rounded-[3px] object-contain shadow-[0_1px_3px_rgb(0_0_0/0.14)] ring-[0.5px] ring-border")} />
      )}
      {done && k === "video" && (
        <span aria-hidden className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
          <Play className="ml-px size-2.5 fill-current" strokeWidth={0} />
        </span>
      )}
    </div>
  )
}

export function Tile({ n, text, desk, small }: { n: FolderItem; text?: string; desk: boolean; small?: boolean }) {
  const { icon: Icon, tint } = iconFor(n)
  const box = small ? "aspect-square w-full" : "aspect-[4/3] w-full"
  if (n.folder) return <div className={cn("grid place-items-center", box)}><Icon className="size-[70%] fill-primary/15 text-primary" strokeWidth={1} style={tint ? { color: tint } : undefined} /></div>
  if (text && !small) {
    return (
      <div className={cn("grid overflow-hidden rounded-[8px]", paper, box)}>
        <p className={cn("overflow-hidden text-left text-muted-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]", desk ? "p-2.5 text-[10px] leading-[14px]" : "p-2 text-[8px] leading-[11px]")}>{text}</p>
      </div>
    )
  }
  const icon = <Icon className={cn("size-[34%]", !tint && "text-muted-foreground")} strokeWidth={1.5} style={tint ? { color: tint } : undefined} />
  return <Picture n={n} px={small ? 256 : 512} icon={icon} className={box} round={small ? "rounded-[6px]" : "rounded-[8px]"} />
}

export function Preview({ n, text, stage }: { n: FolderItem; text?: string; stage?: boolean }) {
  const k = kindOf(n.path)
  const { icon: Icon, tint } = iconFor(n)
  const big = <Icon className={cn("size-24", !tint && "text-muted-foreground", n.folder && "fill-primary/15 text-primary")} strokeWidth={n.folder ? 1 : 1.25} style={tint ? { color: tint } : undefined} />
  if (n.folder) return <div className="grid size-full place-items-center">{big}</div>
  if (k === "video") {
    return <video key={n.path} src={rawUrl(n.path)} poster={thumbUrl(n.path, 1024, n.mtime)} controls playsInline preload="none" className="max-h-full max-w-full rounded-[8px] bg-black/80" />
  }
  if (k === "audio") return <div className="flex size-full flex-col items-center justify-center gap-5">{big}<audio key={n.path} src={rawUrl(n.path)} controls preload="none" className="w-full max-w-sm" /></div>
  if (k === "image" && stage) {
    return <img key={n.path} src={rawUrl(n.path)} alt="" draggable={false} className="max-h-full max-w-full rounded-[6px] object-contain" />
  }
  if (k === "markdown") {
    return (
      <div className={cn("aspect-[3/4] max-h-full max-w-full overflow-hidden rounded-[8px]", paper, stage ? "h-full" : "w-full")}>
        <p className="h-full overflow-hidden p-5 text-left text-[13px] leading-[19px] text-muted-foreground [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
          {text || <span className="text-tertiary">Nothing written yet</span>}
        </p>
      </div>
    )
  }
  return <Picture key={n.path} n={n} px={1024} icon={big} whole className="size-full" />
}

export function playPause(m: HTMLMediaElement | null | undefined) {
  if (!m) return false
  if (m.paused) void m.play().catch(() => {}); else m.pause()
  return true
}

export function Facts({ n, counts, short }: { n: FolderItem; counts: Map<string, number>; short?: boolean }) {
  return n.folder ? <FactList n={n} what={["Folder", counts.get(n.path) ? plural(counts.get(n.path)!, "item") : "Empty"]} rows={[]} /> : <FileFacts n={n} short={short} />
}
const DAY = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" } as const
function FileFacts({ n, short }: { n: FolderItem; short?: boolean }) {
  const [info] = useFileInfo(n.path)
  const what = [kindOf(n.path) === "markdown" ? "Note" : kindName(n.path), info && formatSize(info.size), info?.pages ? plural(info.pages, "page") : null]
  if (short) return <FactList n={n} what={[...what, whenText(n.mtime)]} rows={[]} />
  return <FactList n={n} what={what} rows={info ? [["Created", dateText(new Date(info.ctime), DAY)], ["Modified", dateText(new Date(info.mtime), DAY)]] : []} />
}
function FactList({ n, what, rows }: { n: FolderItem; what: (string | null | false | undefined)[]; rows: string[][] }) {
  return (
    <div className="w-full min-w-0 text-center">
      <p className="text-[15px] font-semibold break-words">{n.name}</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{what.filter(Boolean).join(" · ")}</p>
      {rows.length > 0 && (
        <dl className="mx-auto mt-3 grid max-w-[280px] grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t-[0.5px] border-border pt-3 text-left text-[12px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents"><dt className="text-right text-muted-foreground">{k}</dt><dd className="tabular-nums">{v}</dd></div>
          ))}
        </dl>
      )}
    </div>
  )
}

export function useEnter() {
  const { pane: own } = usePane()
  const desk = useDesktop()
  return (folder: string, dir: -1 | 1, newTab = false) => {
    const change = () => { if (own) setFocusedPane(own); go(folderTarget(folder), newTab) }
    if (desk || newTab) change(); else step(dir, change)
  }
}

export function useKept(list: React.RefObject<HTMLDivElement | null>, keys: string[], all: string[], at: string | null) {
  useEffect(() => {
    const el = list.current
    if (!el) return
    listOrders.set(el, () => all)
    return () => { listOrders.delete(el) }
  }, [list, all])
  return [keys[0], keys[keys.length - 1], at]
}

export function drawnRows(v: ReturnType<typeof useVirtual>, row: (i: number) => ReactNode) {
  const out: ReactNode[] = []
  for (const { index, gap } of v.slots) {
    if (gap > 0.5) out.push(<div key={`gap:${index}`} aria-hidden style={{ height: gap }} />)
    out.push(row(index))
  }
  if (v.rest > 0.5) out.push(<div key="rest" aria-hidden style={{ height: v.rest }} />)
  return out
}

