// The player in a file's tab and in notes: the browser's own controls (scrubbing, full screen, AirPlay) on the one
// element now.ts hands around, with what they lack under it: skips, speed, captions, picture in picture.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { ArrowDownToLine, Captions, Check, CircleCheck, PictureInPicture2, RotateCcw, RotateCw } from "lucide-react"
import { cn, kindIcon, menuBelow, phoneFiles, rawUrl, type PlayerProps } from "@vaultite"
import { keep, keptOf, unkeep, useKept } from "./phone"
import { BACK, captionsOf, FORWARD, getNow, homeOf, pictureOf, presenting, release, setSlot, speed, SPEEDS, take, titleOf, useTick } from "./now"

const captionsOn = { get: () => localStorage.getItem("vau:player:captions") === "1", set: (on: boolean) => localStorage.setItem("vau:player:captions", on ? "1" : "0") }

export function Player({ path, video, place, height, v, onDuration, onFail }: PlayerProps) {
  const slot = useRef<HTMLDivElement>(null)
  const [el, setEl] = useState<HTMLMediaElement | null>(null)
  const [sound, setSound] = useState(!video)
  const fail = useRef(onFail), dur = useRef(onDuration)
  fail.current = onFail
  dur.current = onDuration

  useLayoutEffect(() => {
    const div = slot.current!
    const m = take(path, video, v)
    if (!presenting(m)) div.append(m)
    setEl(m)
    const meta = () => {
      dur.current?.(m.duration)
      if (m instanceof HTMLVideoElement && m.readyState >= 1) setSound(m.videoWidth === 0 && m.videoHeight === 0)
      if (captionsOn.get() && m.textTracks[0]) m.textTracks[0].mode = "showing"
    }
    const error = () => fail.current?.()
    m.addEventListener("loadedmetadata", meta)
    m.addEventListener("error", error)
    if (m.readyState >= 1) meta()
    // On screen or not: the mini player shows while it's playing and no view of it is in sight.
    const io = new IntersectionObserver(([e]) => {
      setSlot(div, m, e.isIntersecting)
      if (e.isIntersecting && !div.contains(m) && !presenting(m)) div.append(m) // back from the mini player
    }, { threshold: 0.2 })
    io.observe(div)
    setSlot(div, m)
    return () => {
      io.disconnect()
      setSlot(div, null)
      m.removeEventListener("loadedmetadata", meta)
      m.removeEventListener("error", error)
      if (!div.contains(m)) return // (another view, or the mini player, has it now)
      const other = homeOf(m)
      if (other) other.append(m); else release(m)
    }
  }, [path, video, v])

  const pic = pictureOf(path)
  const box = place === "fill" ? "size-full" : place === "page" ? "max-h-[75vh]" : ""
  return (
    <div className={cn("flex flex-col", place === "fill" ? "size-full justify-center" : place === "page" && "mx-auto w-full max-w-3xl", sound && place === "page" && "max-w-md py-6")} data-player={path}>
      {sound && (pic ? <img src={rawUrl(pic)} alt="" draggable={false} className={cn("mx-auto mb-3 aspect-square rounded-[10px] object-cover", place === "page" ? "w-56" : "w-28")} />
        : place === "page" ? <Art path={path} /> : null)}
      <div ref={slot} data-player-slot
        className={cn("w-full [&>audio]:w-full [&>video]:block [&>video]:w-full [&>video]:bg-black/90", place === "fill" ? "[&>video]:size-full [&>video]:object-contain" : video && !sound && "[&>video]:max-h-[75vh]", box,
          !sound && place === "page" && "[&>video]:rounded-[10px]", sound && "px-3", sound && place === "page" && "px-0")}
        style={height && video && !sound ? { height } : undefined} />
      {place !== "fill" && el && <Controls el={el} path={path} video={video && !sound} center={sound && place === "page"} />}
    </div>
  )
}

function Art({ path }: { path: string }) {
  const Icon = kindIcon(path)
  return (
    <div className="mb-4 flex flex-col items-center">
      <Icon className="size-14 text-muted-foreground" strokeWidth={1.25} />
      <p className="mt-3 text-[17px] font-semibold break-all">{titleOf(path)}</p>
    </div>
  )
}

const btn = "inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-[8px] px-2 text-[15px] font-medium text-muted-foreground tabular-nums hover:bg-foreground/[0.06] hover:text-foreground md:h-8 md:min-w-8 md:text-[13px] aria-pressed:text-primary"

export function Controls({ el, path, video, center }: { el: HTMLMediaElement; path: string; video: boolean; center?: boolean }) {
  useTick(el)
  const tracks = video && captionsOf(path).length > 0
  const [cc, setCc] = useState(captionsOn.get())
  useEffect(() => { const t = el.textTracks[0]; if (t) t.mode = cc ? "showing" : "hidden" }, [el, cc])
  const pip = video && (document.pictureInPictureEnabled || "webkitSetPresentationMode" in el)
  const skip = (s: number) => { el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + s)) }
  const speeds = (e: MouseEvent) => menuBelow(e, SPEEDS.map((r) => ({ label: `${r}×`, icon: el.playbackRate === r ? Check : undefined, checked: el.playbackRate === r,
    run: () => { el.playbackRate = r; speed.set(r) } })))
  const togglePip = () => {
    const v = el as HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void; webkitPresentationMode?: string }
    if (document.pictureInPictureElement === v) void document.exitPictureInPicture()
    else if (v.requestPictureInPicture) void v.requestPictureInPicture().catch(() => v.webkitSetPresentationMode?.("picture-in-picture"))
    else v.webkitSetPresentationMode?.(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture")
  }
  const items: ReactNode[] = [
    <button key="back" type="button" className={btn} onClick={() => skip(-BACK)} data-tip={`Back ${BACK} seconds`} aria-label={`Back ${BACK} seconds`}><Skip back /></button>,
    <button key="fwd" type="button" className={btn} onClick={() => skip(FORWARD)} data-tip={`Forward ${FORWARD} seconds`} aria-label={`Forward ${FORWARD} seconds`}><Skip /></button>,
    <button key="speed" type="button" className={cn(btn, "min-w-12")} onClick={speeds} data-tip="Speed" aria-label={`Speed: ${el.playbackRate}×`}>{el.playbackRate}×</button>,
    tracks && <button key="cc" type="button" className={btn} aria-pressed={cc} onClick={() => { captionsOn.set(!cc); setCc(!cc) }} data-tip="Captions" aria-label="Captions"><Captions className="size-5 md:size-4" strokeWidth={2} /></button>,
    phoneFiles && <Keep key="keep" path={path} />,
    pip && <button key="pip" type="button" className={btn} onClick={togglePip} data-tip="Picture in picture" aria-label="Picture in picture"><PictureInPicture2 className="size-5 md:size-4" strokeWidth={2} /></button>,
  ]
  return <div className={cn("flex items-center gap-0.5 px-1.5 py-1", center && "justify-center")} data-player-controls>{items}</div>
}

/** Download to this iPhone, to play without the server; how far it's got; kept. */
function Keep({ path }: { path: string }) {
  const k = keptOf(useKept(), path)
  if (k?.done) return (
    <button type="button" className={cn(btn, "text-primary")} aria-label="On this iPhone" data-tip="On this iPhone"
      onClick={(e) => menuBelow(e, [{ label: "Remove from this iPhone", danger: true, run: () => void unkeep(path) }])}>
      <CircleCheck className="size-5 md:size-4" strokeWidth={2} />
    </button>
  )
  if (k && !k.error) return <span className={btn} aria-label="Downloading">{k.size ? `${Math.floor((k.got / k.size) * 100)}%` : "…"}</span>
  return (
    <button type="button" className={btn} onClick={() => keep(path)} aria-label={k?.error ? `Download again (${k.error})` : "Download to this iPhone"} data-tip="Download to this iPhone">
      <ArrowDownToLine className="size-5 md:size-4" strokeWidth={2} />
    </button>
  )
}

/** The skip icons with their seconds in them, as podcast apps draw them. */
function Skip({ back }: { back?: boolean }) {
  const Icon = back ? RotateCcw : RotateCw
  return (
    <span className="relative grid place-items-center">
      <Icon className="size-6 md:size-5" strokeWidth={1.75} />
      <span className="absolute text-[8px] font-bold md:text-[7px]">{back ? BACK : FORWARD}</span>
    </span>
  )
}

/** For the mini player and the queue: the element playing now, if it's this file's. */
export const playingNow = (path: string) => (getNow()?.path === path ? getNow()!.el : null)
