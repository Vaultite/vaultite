// Files that aren't text: images, PDFs (phones get a card, since mobile browsers draw only a picture of a PDF in a
// frame), players, and a card for anything else. MediaEmbed shows them in notes.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react"
import { ArrowUpRight, Download, SquareArrowOutUpRight, type LucideIcon } from "lucide-react"
import { dateText } from "@/core/data"
import { get } from "@/core/http"
import { formatSize, kindIcon, kindName, type FileKind } from "@/core/filekinds"
import { openFile } from "@/core/files"
import { isDesktop } from "@/core/workspace"
import { useVaultChange } from "@/core/live"
import { canOpenHere, openHere } from "@/components/FileActions"
import { cn } from "@/lib/utils"

export type FileInfo = { path: string; kind: FileKind; size: number; mtime: number; ctime: number; pages?: number | null }

/** Whether this browser draws HEIC photos itself (Safari does; Chrome, so the desktop app, doesn't). */
const drawsHeic = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg\/|Electron|Android/.test(navigator.userAgent)

/** The address of a file's bytes (a vault path, or an outside file's absolute path). An iPhone photo (HEIC) a browser
 *  can't draw comes as JPEG, made on the server (core/heic.ts); a download is always the file itself. */
export const rawUrl = (path: string, opts: { download?: boolean; v?: number } = {}) =>
  `api/raw/${encodeURIComponent(path.split("/").pop()!)}?path=${encodeURIComponent(path)}${opts.download ? "&download=1" : !drawsHeic && /\.(heic|heif)$/i.test(path) ? "&as=jpeg" : ""}${opts.v ? `&v=${opts.v}` : ""}`

/** Size, dates and a PDF's pages, read again when the file changes (`n` counts the changes); `missing` once it's gone. */
export function useFileInfo(path: string) {
  const [info, setInfo] = useState<FileInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let on = true
    get<FileInfo>(`file/info?path=${encodeURIComponent(path)}`).then((i) => { if (on) { setInfo(i); setMissing(false) } })
      .catch((e) => { if (on && /^Error: no file /.test(String(e))) setMissing(true) })
    return () => { on = false }
  }, [path, n])
  useVaultChange(() => setN((x) => x + 1), [path])
  return [info, n, missing] as const
}

/** Opened as a page on desktop: as tall as what's left of the window. */
export function useFill(on: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!on) return
    const fit = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0
      const scroller = ref.current?.closest("[data-pane], [data-stacked]")
      const off = scroller ? scroller.scrollTop : window.scrollY
      setH(Math.max(280, window.innerHeight - Math.max(0, top + off) - 24))
    }
    fit()
    addEventListener("resize", fit)
    return () => removeEventListener("resize", fit)
  }, [on])
  return [ref, h] as const
}

const button = "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[8px] px-3.5 text-[15px] font-medium md:h-8 md:text-[13px]"
const primary = cn(button, "bg-primary text-primary-foreground hover:opacity-90")
const secondary = cn(button, "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]")

/** Any file: what it is, its size and date, and what can be done with it. */
export function FileCard({ path, info, note, children }: { path: string; info: FileInfo | null; note?: ReactNode; children?: ReactNode }) {
  const Icon = kindIcon(path)
  const name = path.split("/").pop()!
  const modified = info ? dateText(new Date(info.mtime), { day: "numeric", month: "short", year: "numeric" }) : null
  const here = canOpenHere()
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-10 text-center" data-file-card>
      <Icon className="size-14 text-muted-foreground" strokeWidth={1.25} />
      <p className="mt-3 text-[17px] font-semibold break-all">{name}</p>
      <p className="mt-1 text-[15px] text-muted-foreground md:text-[13px]">
        {[kindName(path), info && formatSize(info.size), info?.pages ? `${info.pages} page${info.pages === 1 ? "" : "s"}` : null, modified && `modified ${modified}`].filter(Boolean).join(" · ")}
      </p>
      {note && <p className="mt-2 text-[15px] text-muted-foreground md:text-[13px]">{note}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {children}
        {here && (
          <button type="button" className={children ? secondary : primary} onClick={() => openHere(path)}>
            <SquareArrowOutUpRight className="size-4" strokeWidth={2} />Open in default app
          </button>
        )}
        <a href={rawUrl(path, { download: true })} download={name} className={here || children ? secondary : primary}>
          <Download className="size-4" strokeWidth={2} />Download
        </a>
      </div>
    </div>
  )
}

/** An image: fit to the pane, click for its real size (and back). The browser can't draw it (a HEIC on a server that
 *  can't convert it, a broken file): a card. */
export function ImageView({ path, info, v, page, onSize }: { path: string; info: FileInfo | null; v: number; page: boolean; onSize: (w: number, h: number) => void }) {
  const [zoom, setZoom] = useState(false)
  const [failed, setFailed] = useState(false)
  const [ref, h] = useFill(page)
  useEffect(() => setFailed(false), [v])
  if (failed) return <FileCard path={path} info={info} note="This browser can't show this image." />
  return (
    <div ref={ref} className={cn("flex rounded-[10px]", zoom ? "overflow-auto" : "items-center justify-center overflow-hidden", !page && "max-h-[75vh]")}
      style={h ? { height: h } : undefined} data-image-view>
      <img src={rawUrl(path, { v })} alt={path.split("/").pop()} draggable={false}
        onLoad={(e) => onSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} onError={() => setFailed(true)}
        onClick={() => setZoom((z) => !z)} data-zoomed={zoom || undefined}
        className={cn("select-none", zoom ? "m-auto max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain", !page && !zoom && "max-h-[75vh]")} />
    </div>
  )
}

/** A PDF: the browser's viewer on desktop; on phones a card that opens it full screen. */
export function PdfView({ path, info, v, page }: { path: string; info: FileInfo | null; v: number; page: boolean }) {
  const [ref, h] = useFill(page)
  if (!isDesktop()) {
    return (
      <FileCard path={path} info={info}>
        <a href={rawUrl(path, { v })} target="_blank" rel="noopener" className={primary}><ArrowUpRight className="size-4" strokeWidth={2} />Open</a>
      </FileCard>
    )
  }
  return (
    <div ref={ref} style={{ height: h ?? 600 }}>
      <iframe src={rawUrl(path, { v })} title={path.split("/").pop()} className="size-full rounded-[10px] border-[0.5px] border-border bg-card" />
    </div>
  )
}

/** A .webm or .mp4 can be sound only (a recording from the browser's audio recorder): a video that turns out to have no
 *  picture is drawn as audio. */
function useSoundOnly(path: string) {
  const [sound, setSound] = useState(false)
  useEffect(() => setSound(false), [path])
  const check = (e: SyntheticEvent<HTMLMediaElement>) => {
    const el = e.currentTarget
    if (el instanceof HTMLVideoElement && el.videoWidth === 0 && el.videoHeight === 0) setSound(true)
  }
  return [sound, check] as const
}

/** Audio or video, in the browser's player. One it can't play: a card. */
export function PlayerView({ path, info, v, video, onDuration }: { path: string; info: FileInfo | null; v: number; video: boolean; onDuration: (s: number) => void }) {
  const [failed, setFailed] = useState(false)
  const [sound, check] = useSoundOnly(path)
  if (failed) return <FileCard path={path} info={info} note="This browser can't play this file." />
  const common = { src: rawUrl(path, { v }), controls: true, preload: "metadata", onError: () => setFailed(true),
    onLoadedMetadata: (e: SyntheticEvent<HTMLMediaElement>) => { onDuration(e.currentTarget.duration); check(e) } }
  if (video && !sound) return <video {...common} playsInline className="mx-auto max-h-[75vh] w-full rounded-[10px] bg-foreground/[0.04]" />
  const Icon = kindIcon(path)
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-10">
      <Icon className="size-14 text-muted-foreground" strokeWidth={1.25} />
      <p className="mt-3 mb-5 text-[17px] font-semibold break-all">{path.split("/").pop()}</p>
      <audio {...common} className="w-full" />
    </div>
  )
}

/** An embed's header: its name, opening it; held on a phone, its menu (components/EmbedMenu.tsx). */
export function EmbedHead({ path, icon: Icon, name }: { path: string; icon: LucideIcon; name: string }) {
  return (
    <button type="button" onClick={(e) => openFile(path, { newTab: e.metaKey || e.ctrlKey })} data-hold-menu
      className="flex h-9 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[13px] font-semibold text-muted-foreground hover:text-foreground">
      <Icon className="size-4 shrink-0" strokeWidth={2.25} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2.25} />
    </button>
  )
}

/** `![[Statement.pdf]]`, `![[memo.m4a]]` in a note, with a header that opens it. `fill`: no header, filling its parent
 *  (a canvas card). */
export function MediaEmbed({ path, height, fill }: { path: string; height?: number; fill?: boolean }) {
  const [sound, check] = useSoundOnly(path)
  const pdf = /\.pdf$/i.test(path), video = !sound && /\.(mp4|m4v|mov|webm|ogv)$/i.test(path)
  const Icon = kindIcon(path)
  if (fill) {
    return (
      <div className="flex size-full items-center justify-center overflow-hidden" data-media-embed={path}>
        {pdf ? (
          isDesktop()
            ? <iframe src={rawUrl(path)} title={path.split("/").pop()} className="block size-full bg-card" />
            : <a href={rawUrl(path)} target="_blank" rel="noopener" className={primary}><ArrowUpRight className="size-4" strokeWidth={2} />Open</a>
        ) : video ? (
          <video src={rawUrl(path)} controls playsInline preload="metadata" onLoadedMetadata={check} className="block size-full object-contain" />
        ) : (
          <div className="w-full px-3"><audio src={rawUrl(path)} controls preload="metadata" className="w-full" /></div>
        )}
      </div>
    )
  }
  return (
    <div className="glass overflow-hidden rounded-[12px]" data-hold-menu>
      <EmbedHead path={path} icon={Icon} name={path.split("/").pop()!} />
      {pdf ? (
        isDesktop()
          ? <iframe src={rawUrl(path)} title={path.split("/").pop()} className="block w-full bg-card" style={{ height: height ?? 520 }} />
          : null
      ) : video ? (
        <video src={rawUrl(path)} controls playsInline preload="metadata" onLoadedMetadata={check} className="block w-full" style={height ? { height } : undefined} />
      ) : (
        <div className="px-3 pb-3"><audio src={rawUrl(path)} controls preload="metadata" className="w-full" /></div>
      )}
    </div>
  )
}
