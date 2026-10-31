// The player in a file's tab and in notes, on the one element now.ts hands around: a sound's tab is Full.tsx; elsewhere
// the browser's own controls, with what they lack under them (skips, speed, captions, picture in picture, bookmarks).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Captions, FileText, PictureInPicture2 } from "lucide-react"
import { cn, openFile, phoneFiles, type PlayerProps } from "@vaultite"
import { btn, icon, Keep, MarkButton, Skip, SpeedButton } from "./Buttons"
import { Book, Full } from "./Full"
import { artOf, BACK, captionsOf, FORWARD, getNow, homeOf, presenting, release, setSlot, take, useMeta, useTick } from "./now"

// A view shows the browser's own controls on it (the mini player hides them). `home`: a view, holding it in its slot.
const hold = (home: HTMLElement, m: HTMLMediaElement) => {
  m.controls = true
  ;(home.querySelector<HTMLElement>("[data-player-slot]") ?? home).append(m)
}
const captionsOn = { get: () => localStorage.getItem("vau:player:captions") === "1", set: (on: boolean) => localStorage.setItem("vau:player:captions", on ? "1" : "0") }

export function Player({ path, video, place, height, v, onDuration, onFail }: PlayerProps) {
  const root = useRef<HTMLDivElement>(null)
  const [el, setEl] = useState<HTMLMediaElement | null>(null)
  const [sound, setSound] = useState(!video)
  const fail = useRef(onFail), dur = useRef(onDuration)
  fail.current = onFail
  dur.current = onDuration

  useLayoutEffect(() => {
    const div = root.current!
    const m = take(path, video, v)
    if (!presenting(m)) hold(div, m)
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
      if (e.isIntersecting && !div.contains(m) && !presenting(m)) hold(div, m) // back from the mini player
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
      if (other) hold(other, m); else release(m)
    }
  }, [path, video, v])

  useMeta(path)
  const full = sound && place === "page"
  const art = artOf(path)
  const box = place === "fill" ? "size-full" : place === "page" ? "max-h-[75vh]" : ""
  // (one tree whatever it shows, so the slot holding the element is never remade)
  return (
    <div ref={root} className={cn("flex flex-col", place === "fill" ? "size-full justify-center" : place === "page" && "mx-auto w-full max-w-3xl", full && "max-w-none")} data-player={path}>
      {full ? el && <Full el={el} path={path} />
        : sound && art && <img src={art} alt="" draggable={false} className="mx-auto mb-3 aspect-square w-28 rounded-[10px] object-cover" />}
      <div data-player-slot hidden={full}
        className={cn("w-full [&>audio]:w-full [&>video]:block [&>video]:w-full [&>video]:bg-black/90", place === "fill" ? "[&>video]:size-full [&>video]:object-contain" : video && !sound && "[&>video]:max-h-[75vh]", box,
          !sound && place === "page" && "[&>video]:rounded-[10px]", sound && "px-3")}
        style={height && video && !sound ? { height } : undefined} />
      {!full && place !== "fill" && el && <Controls el={el} path={path} video={video && !sound} mark={place === "page"} />}
      {!full && place === "page" && el && <VideoBook el={el} path={path} />}
    </div>
  )
}

function VideoBook({ el, path }: { el: HTMLMediaElement; path: string }) {
  const cs = useMeta(path)?.chapters ?? []
  return <Book el={el} path={path} cs={cs} className="mt-4 px-1.5" />
}

export function Controls({ el, path, video, mark }: { el: HTMLMediaElement; path: string; video: boolean; mark?: boolean }) {
  useTick(el)
  const cs = useMeta(path)?.chapters ?? []
  const from = getNow()?.el === el ? getNow()!.from : undefined
  const tracks = video && captionsOf(path).length > 0
  const [cc, setCc] = useState(captionsOn.get())
  useEffect(() => { const t = el.textTracks[0]; if (t) t.mode = cc ? "showing" : "hidden" }, [el, cc])
  const pip = video && (document.pictureInPictureEnabled || "webkitSetPresentationMode" in el)
  const skip = (s: number) => { el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + s)) }
  const togglePip = () => {
    const v = el as HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void; webkitPresentationMode?: string }
    if (document.pictureInPictureElement === v) void document.exitPictureInPicture()
    else if (v.requestPictureInPicture) void v.requestPictureInPicture().catch(() => v.webkitSetPresentationMode?.("picture-in-picture"))
    else v.webkitSetPresentationMode?.(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture")
  }
  const items: ReactNode[] = [
    <button key="back" type="button" className={btn} onClick={() => skip(-BACK)} data-tip={`Back ${BACK} seconds`} aria-label={`Back ${BACK} seconds`}><Skip back /></button>,
    <button key="fwd" type="button" className={btn} onClick={() => skip(FORWARD)} data-tip={`Forward ${FORWARD} seconds`} aria-label={`Forward ${FORWARD} seconds`}><Skip /></button>,
    <SpeedButton key="speed" el={el} />,
    tracks && <button key="cc" type="button" className={btn} aria-pressed={cc} onClick={() => { captionsOn.set(!cc); setCc(!cc) }} data-tip="Captions" aria-label="Captions"><Captions className={icon} strokeWidth={2} /></button>,
    mark && el.duration >= 60 && <MarkButton key="mark" el={el} path={path} cs={cs} />,
    mark && from && <button key="note" type="button" className={btn} onClick={() => openFile(from)} aria-label="Open note" data-tip="Open note"><FileText className={icon} strokeWidth={2} /></button>,
    phoneFiles && <Keep key="keep" path={path} />,
    pip && <button key="pip" type="button" className={btn} onClick={togglePip} data-tip="Picture in picture" aria-label="Picture in picture"><PictureInPicture2 className={icon} strokeWidth={2} /></button>,
  ]
  return <div className="flex items-center gap-0.5 px-1.5 py-1" data-player-controls>{items}</div>
}

/** For the mini player and the queue: the element playing now, if it's this file's. */
export const playingNow = (path: string) => (getNow()?.path === path ? getNow()!.el : null)
